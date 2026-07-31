-- 087_reminders.sql — "this is coming up", recorded.
--
-- *** COMPLIANCE: THESE ARE ESTIMATES AND THEY ARE SHOWN TO THE USER. ***
-- Read this before wiring anything to it.
--
-- A reminder built on `recurring_bills` (086) rests on a GUESS — 086's own
-- header says every row in it is inferred, and its confidence column exists
-- because some of those inferences are nearly worthless. A reminder built on
-- `card_liabilities` (083) rests on a due date an aggregator reported, which is
-- better but is still a copy of somebody else's record and can be stale or
-- absent.
--
-- So a reminder is a PREDICTION, and the two columns that keep it honest are
-- `basis` and `confidence`:
--
--   * `basis` says which of those two a reminder came from, so a screen can
--     word "your Amex payment is due" differently from "we think a bill is due".
--   * `confidence` is carried through from 086 and is NULL when the basis is a
--     reported due date rather than an inference. NULL here means "not an
--     estimate", which is the opposite of what NULL means in most of this
--     schema, and it is spelled out in the column comment for that reason.
--
-- Nothing here may tell a consumer what will happen to their credit if they pay
-- or do not pay. A reminder states a date and an amount. It does not predict an
-- outcome, and the whole repo is under that rule.
--
--
-- *** NOTHING IN THIS FILE SENDS ANYTHING. ***
-- No email, no SMS, no push, no scheduler, no activation flag. `sendTemplated`
-- writes `messages` rows with status='queued' and nothing transmits — there is
-- no outbound fetch in src/adapters/ or src/lib/. `sent_at` exists so that a
-- future sender has somewhere to record itself, and it will be NULL on every row
-- this system can currently produce. A NULL `sent_at` therefore means "not sent"
-- and must never be rendered as "sent".
--
-- REMINDERS ARE DERIVED AND DISPOSABLE. They are recomputed from bills and
-- liabilities, so `dedupe_key` plus the partial unique index below is what stops
-- a nightly recompute producing a duplicate every night. Same construction as
-- 078's alerts, for the same reason.

CREATE TABLE IF NOT EXISTS reminders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  --   card_payment — a credit card payment due (basis: card_liabilities)
  --   bill_due     — a recurring bill expected (basis: recurring_bills)
  --   low_balance  — a projected shortfall before a known obligation
  kind         text NOT NULL
               CHECK (kind IN ('card_payment', 'bill_due', 'low_balance')),

  -- What it is about. Deliberately NOT a foreign key: the subject may be a
  -- recurring_bill, a card_liability or a bank_account, and three nullable FK
  -- columns with a CHECK that exactly one is set is more machinery than a
  -- disposable derived row deserves. The pair is enough to find the source, and
  -- a reminder whose subject has vanished is recomputed away rather than
  -- repaired.
  subject_type text NOT NULL
               CHECK (subject_type IN ('recurring_bill', 'card_liability', 'bank_account')),
  subject_id   uuid NOT NULL,

  -- SEE THE HEADER. What kind of claim this is.
  --   reported — a due date somebody reported to us (card_liabilities)
  --   inferred — a date we worked out from a pattern (recurring_bills)
  basis        text NOT NULL DEFAULT 'inferred'
               CHECK (basis IN ('reported', 'inferred')),

  -- Carried through from 086 when the basis is inferred. NULL when reported.
  -- SEE THE COLUMN COMMENT: NULL here means "not an estimate", not "unknown".
  confidence   numeric(4,3) CHECK (confidence >= 0 AND confidence < 1),

  -- The date the thing is due. NOT NULL: a reminder with no date is not a
  -- reminder, and this is the one place in the banking schema where a missing
  -- date means the row should not exist rather than be stored as NULL.
  due_date     date NOT NULL,

  -- When to surface it. Also NOT NULL, and always on or before due_date — a
  -- reminder that fires after the thing was due is not a reminder, it is a
  -- report, and the CHECK below makes that unrepresentable.
  remind_on    date NOT NULL,

  -- Integer cents, positive: an obligation, matching 086 rather than 085.
  -- NULLABLE because a varying bill has no single figure, and a reminder that
  -- states one anyway is more wrong than one that says "amount varies".
  amount_cents bigint CHECK (amount_cents > 0),

  --   pending    — not yet surfaced
  --   surfaced   — shown to somebody
  --   dismissed  — a human said no
  --   superseded — recomputed away (the bill changed, the date moved)
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'surfaced', 'dismissed', 'superseded')),

  -- SEE THE HEADER: always NULL today. Nothing sends.
  sent_at      timestamptz,

  evidence     jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key   text,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One live reminder per (client, kind, dedupe_key). Partial over live states, so
-- a dismissed or superseded reminder does not block next month's.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reminders_live_dedupe
  ON reminders (client_id, kind, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('pending', 'surfaced');

-- The reminder feed: what to surface, soonest first.
CREATE INDEX IF NOT EXISTS idx_reminders_client_remind_on
  ON reminders (client_id, remind_on) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_reminders_org_due
  ON reminders (org_id, due_date) WHERE status IN ('pending', 'surfaced');

-- A reminder must fire before the thing it is reminding about.
ALTER TABLE reminders DROP CONSTRAINT IF EXISTS reminders_remind_before_due;
ALTER TABLE reminders ADD CONSTRAINT reminders_remind_before_due
  CHECK (remind_on <= due_date);

-- An inferred reminder must carry the confidence of the inference it rests on,
-- and a reported one must not pretend to have been estimated.
ALTER TABLE reminders DROP CONSTRAINT IF EXISTS reminders_basis_confidence;
ALTER TABLE reminders ADD CONSTRAINT reminders_basis_confidence
  CHECK (
    (basis = 'inferred' AND confidence IS NOT NULL) OR
    (basis = 'reported' AND confidence IS NULL)
  );

COMMENT ON TABLE reminders IS
  'Upcoming obligations, recorded. COMPLIANCE: these are ESTIMATES SHOWN TO THE USER — a reminder from recurring_bills rests on an inference (see 086). basis and confidence keep that visible. NOTHING HERE SENDS ANYTHING: no email, no SMS, no scheduler. sent_at is NULL on every row this system can produce and must never be rendered as sent. See db/migrations/087_reminders.sql.';

COMMENT ON COLUMN reminders.confidence IS
  'Carried from recurring_bills when basis=inferred. NULL means NOT AN ESTIMATE (basis=reported) — the opposite of what NULL means elsewhere in this schema, hence this comment. Enforced by CHECK against basis.';

COMMENT ON COLUMN reminders.sent_at IS
  'Always NULL today — nothing in this repository transmits. Exists so a future sender has somewhere to record itself. NULL means NOT SENT.';

COMMENT ON COLUMN reminders.subject_id IS
  'Deliberately not a foreign key: the subject may be a recurring_bill, card_liability or bank_account. A reminder whose subject vanished is recomputed away, not repaired.';

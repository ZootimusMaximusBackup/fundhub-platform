-- 087_cashflow_reminders.sql — what to say about a card or a bill, when to put
-- it in front of somebody, and whether they have seen it.
--
-- *** NOTHING IN THIS FILE SENDS ANYTHING, AND NOTHING IN THIS FILE CAN BE
-- *** SWITCHED ON TO MAKE IT SEND ANYTHING.
--
-- A REMINDER IS A ROW. Delivery is somebody else's job, later, and it does not
-- exist anywhere in this repository today. AUDIT-FINDINGS.md records the state
-- plainly and it has not changed: "there is no outbound fetch in src/adapters/
-- or src/lib/", and `sendTemplated` writes `messages` rows with
-- status='queued' that nothing ever drains. This table has the same shape of
-- honesty: it records that a thing OUGHT to be said, and stops.
--
-- So there is deliberately NO `sent_at`, NO `channel`, NO `provider_ref`, NO
-- `status` enum a worker could poll, NO retry counter, NO scheduler, NO cron,
-- NO job row, and NO `enabled` / `active` / `is_live` boolean that a later
-- environment variable could flip. This is the same construction 065 and 067
-- used for the mail tables. If wiring a delivery path ever looks like it needs
-- one line in this file, it needs a product decision first, not a column.
--
-- The one lifecycle fact this table does keep is ACKNOWLEDGEMENT, because that
-- is a fact about a human and not about a transport: somebody saw this and said
-- so. A reminder nobody has acknowledged is still worth surfacing; one that has
-- been acknowledged is not. That is the whole state machine and there is no
-- other.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THERE IS NO FOREIGN KEY ON subject_id, WHICH IS THE MAIN THING THIS FILE
-- DELIBERATELY DOES NOT DO.
--
-- A reminder is about a card liability or about a recurring bill. Neither of
-- those tables exists yet: liability ingestion and recurring-bill detection are
-- separate units of work that have not landed. Checked before writing this
-- file, against db/schema and db/migrations rather than against a plan:
--
--   `tradelines` (054) holds a per-card lender, limit, balance and APR, and
--   carries NO due date, NO statement close and NO minimum payment — the three
--   columns a payment reminder is actually about.
--   There is no recurring-bill table of any kind.
--   `cards` (001_init.sql:208) is a PIPELINE KANBAN CARD and is not a credit
--   card. That name collision already caught 054 and is called out there;
--   pointing this table at `cards` would produce reminders about sales-pipeline
--   positions.
--
-- The available moves were: guess at the shape of tables that do not exist and
-- write a foreign key against them, wait, or link softly and say so. The first
-- is how you get a table that has to be dropped and rebuilt the moment the real
-- one arrives; the second stops this work for no benefit. So `subject_id` is a
-- plain uuid with a `subject_kind` discriminator beside it and NO REFERENCES
-- clause, exactly as 065 handled `mail_universe.campaign_id`, and for the same
-- stated reason: it is a soft link and it is honest about being one.
--
-- Tightening it is a later migration, and it must run AFTER the liability and
-- bill tables exist. It cannot be done as one constraint — `subject_id` points
-- at two different tables depending on `subject_kind`, so the honest tightening
-- is a pair of CHECK-partitioned foreign keys or a pair of nullable typed
-- columns, and which one is right depends on what those tables actually look
-- like. Reported as a known gap rather than guessed at here.
--
-- BECAUSE THE LINK IS SOFT, `subject_label` IS NOT REDUNDANT. It is the name of
-- the card or bill AS IT WAS WHEN THE REMINDER WAS WRITTEN. With no foreign key
-- there is no cascade and no join that is guaranteed to resolve, so without
-- this column a reminder whose subject is later re-ingested under a new id
-- would read "pay ****" with no way to say what. Storing it is not a
-- denormalised copy of a live value — it is a snapshot of what was said, which
-- is the same reason `messages` keeps its rendered body.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS FILE DOES NOT DECIDE, AND THAT ABSENCE IS THE FINDING.
--
-- `surface_at` IS SUPPLIED BY THE CALLER. This table does not compute it and
-- there is no default, no trigger and no generated column that derives it from
-- a due date. Deriving it would need a rule of the form "warn N days before
-- due", and *** THERE IS NO ROW ANYWHERE IN THIS SCHEMA THAT HOLDS N. *** Nor
-- is there a row holding a cash-flow safety buffer. Checked before writing: no
-- cashflow_settings table, no banking_config table, no threshold column on
-- orgs, and src/config/ holds three pure classifiers with no operator numbers
-- in them.
--
-- A number invented here would be enforced by a DEFAULT, which is a guess
-- wearing a constraint's clothing — 065 refused exactly this for outcome_tier
-- and 067 refused it for a response-dedupe time window. It is also the defect
-- just removed from src/shifts/timesheet.mjs, where hardcoded rates sat in code
-- as a second, divergent answer to a question `commission_rules` already owned.
--
-- So: the caller passes `surface_at`. src/banking/cashflow.mjs refuses to
-- produce a date when the threshold behind it is missing, and reports the
-- missing threshold by name in its `thresholdGaps` output. The gap is carried,
-- visibly, until an operator decides. It is not this migration's to close.
--
-- NO ORG-LEVEL OR CLIENT-LEVEL REMINDERS. `subject_kind` is a closed two-value
-- set: a card liability or a recurring bill. A reminder about something that is
-- neither — "we cannot project your cash flow because one account balance is
-- unknown" — has no home here. That is a real gap and it is reported rather
-- than papered over by widening the enum on a guess about who such a reminder
-- would even be for.


-- ---------------------------------------------------------------------------
-- A. cashflow_reminders
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cashflow_reminders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id),
  client_id      uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- WHICH liability or bill. Soft link — see the header. `subject_kind` is
  -- closed because the two values are the two things src/banking/cashflow.mjs
  -- can produce a finding about; adding a third means a migration, on purpose.
  subject_kind   text NOT NULL CHECK (subject_kind IN ('card_liability', 'recurring_bill')),
  subject_id     uuid NOT NULL,
  -- The subject's name at the time of writing. Not a cache of a live value; a
  -- snapshot of what was said. See the header.
  subject_label  text NOT NULL CHECK (btrim(subject_label) <> ''),

  --   payment_due            a card payment is coming due.
  --   statement_closed       the statement closed and the balance is now fixed.
  --   projected_shortfall    the projection dips below the floor on a named day.
  --   payment_window_closing the last date a payment can safely land is near.
  --   input_missing          the model REFUSED to answer because an input was
  --                          absent — no due date, an unknown balance, a bill
  --                          nobody has confirmed. This kind exists so that a
  --                          refusal is something a person is told about rather
  --                          than a silence. A missing answer is the finding.
  --
  -- Closed set, and that is a decision with a cost: a new kind needs a
  -- migration. It is closed because these five are exactly the findings
  -- src/banking/cashflow.mjs emits, so the vocabulary has a real owner in this
  -- repository — unlike 065's outcome_tier, which was left free text precisely
  -- because nothing owned it.
  reminder_kind  text NOT NULL CHECK (reminder_kind IN (
                   'payment_due',
                   'statement_closed',
                   'projected_shortfall',
                   'payment_window_closing',
                   'input_missing'
                 )),

  -- WHAT TO SAY. Rendered at write time, stored as written. Same reasoning as
  -- `messages`: the text somebody was shown is evidence, and re-deriving it
  -- later from a template that has since changed produces a different sentence.
  body           text NOT NULL CHECK (btrim(body) <> ''),

  -- WHEN TO SURFACE IT. Supplied by the caller. No default, no derivation, no
  -- trigger — see the header for why there cannot be one yet.
  surface_at     timestamptz NOT NULL,

  -- WHETHER IT HAS BEEN ACKNOWLEDGED. NULL means not yet.
  acknowledged_at      timestamptz,
  -- Who acknowledged it. Soft and polymorphic because this platform has two
  -- kinds of principal that could plausibly do it — a staff member working the
  -- account, or the client themselves through their own login — and they live
  -- in two different tables (`staff` and `accounts`). No foreign key, for the
  -- same reason as subject_id: a single column cannot reference two tables.
  acknowledged_by_kind text CHECK (acknowledged_by_kind IN ('staff', 'account')),
  acknowledged_by_id   uuid,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- The three acknowledgement columns move together or not at all. Without
  -- this, "acknowledged by nobody at no time" and "acknowledged by somebody,
  -- time unrecorded" are both storable, and a reader cannot tell an
  -- unacknowledged reminder from a badly-written one.
  CONSTRAINT cashflow_reminders_ack_complete CHECK (
    (acknowledged_at IS NULL     AND acknowledged_by_kind IS NULL AND acknowledged_by_id IS NULL)
    OR
    (acknowledged_at IS NOT NULL AND acknowledged_by_kind IS NOT NULL AND acknowledged_by_id IS NOT NULL)
  )
);

-- ---------------------------------------------------------------------------
-- B. One reminder per thing-to-say, per subject, per moment
-- ---------------------------------------------------------------------------
--
-- THE RULE: re-running the projection must not produce a second copy of a
-- reminder it already produced. src/banking/cashflow.mjs is pure and takes its
-- clock as a parameter, so running it twice over the same inputs yields the
-- same findings with the same dates — which means a writer that runs nightly,
-- or twice because a job retried, would otherwise insert the same sentence
-- again every time. A reminders list that grows a duplicate every night is
-- worse than no reminders list, because a person stops reading it.
--
-- This is 067's rule applied again: *** YOU CAN ONLY DEDUPE WHAT YOU CAN
-- IDENTIFY. *** Two reminders of the same kind, about the same subject, for the
-- same client, to surface at the same instant, are indistinguishable — not
-- "probably the same", but identical in every recorded respect. Collapsing them
-- to one row describes what is known.
--
-- `surface_at` is in the key at full timestamp precision rather than truncated
-- to a day. Truncating would need a timezone to truncate IN, and
-- `timestamptz AT TIME ZONE 'UTC'` is STABLE rather than IMMUTABLE so it cannot
-- be indexed anyway. More to the point, two reminders genuinely scheduled for
-- different moments on the same day are different reminders, and the caller
-- that scheduled them apart is the one who can tell.
--
-- `body` is NOT in the key, deliberately. If the wording of a template changes
-- between two runs, that is the SAME reminder said differently, not a new one —
-- and if the body were in the key, a copy tweak would silently double every
-- outstanding reminder.
--
-- A unique index and not just a guard SELECT, for 067's reason: a guard
-- followed by an insert is two statements, and two nightly runs overlapping (or
-- a job retried while the first is still going) both read "no prior reminder"
-- and both insert. Only an index settles a race between two writers.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cashflow_reminders_dedupe
  ON cashflow_reminders (org_id, client_id, subject_kind, subject_id, reminder_kind, surface_at);

-- The read this table exists to serve: what is due to be shown, and not yet
-- acknowledged. Partial, because an acknowledged reminder is never the answer
-- to that question and there is no reason to carry it in the index.
CREATE INDEX IF NOT EXISTS idx_cashflow_reminders_due
  ON cashflow_reminders (org_id, surface_at)
  WHERE acknowledged_at IS NULL;

-- One client's reminders, newest first — the client-detail read.
CREATE INDEX IF NOT EXISTS idx_cashflow_reminders_client
  ON cashflow_reminders (client_id, surface_at DESC);

-- Everything outstanding about one card or one bill. This is the index a future
-- migration will need when it comes to replace the soft link with a real
-- foreign key, and it is the one that makes "stop reminding about this, it is
-- handled" cheap.
CREATE INDEX IF NOT EXISTS idx_cashflow_reminders_subject
  ON cashflow_reminders (subject_kind, subject_id);

-- ---------------------------------------------------------------------------
-- C. updated_at trigger
-- ---------------------------------------------------------------------------
-- Same idempotent attach pattern as 065_mail_campaigns.sql and 051_hiring.sql:
-- guarded on the function existing and on the trigger not already being
-- present, so a second run is a no-op rather than a duplicate-object error.
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    FOREACH t IN ARRAY ARRAY['cashflow_reminders'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_' || t || '_updated_at'
                      AND tgrelid = ('public.' || t)::regclass) THEN
        EXECUTE format(
          'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
          'trg_' || t || '_updated_at', t);
      END IF;
    END LOOP;
  END IF;
END $$;

COMMENT ON TABLE cashflow_reminders IS
  'What to say about a card liability or a recurring bill, when to surface it, and whether it has been acknowledged. STORAGE ONLY — NOTHING SENDS. There is no sent_at, no channel, no status, no scheduler and no activation flag, and none may be added here: delivery does not exist in this repository. See db/migrations/087_cashflow_reminders.sql.';
COMMENT ON COLUMN cashflow_reminders.subject_id IS
  'Soft link to a card liability or a recurring bill, discriminated by subject_kind. NOT a foreign key: neither table exists yet, and one column cannot reference two tables. Always filter on subject_kind as well. See the 087 header.';
COMMENT ON COLUMN cashflow_reminders.subject_label IS
  'The subject''s name as it was when the reminder was written. A snapshot of what was said, not a cache of a live value — with no foreign key there is no join guaranteed to resolve later.';
COMMENT ON COLUMN cashflow_reminders.surface_at IS
  'When to put this in front of somebody. Supplied by the caller. Deliberately has no default and is not derived from a due date: a "warn N days before" rule needs a row for N, and no such row exists anywhere in this schema. That gap is reported by src/banking/cashflow.mjs rather than filled in with a guess.';
COMMENT ON COLUMN cashflow_reminders.reminder_kind IS
  'Closed set matching the findings src/banking/cashflow.mjs emits. input_missing is the one that carries a REFUSAL — the model declined to answer because an input was absent — so that a missing answer reaches a person instead of being a silence.';
COMMENT ON INDEX uq_cashflow_reminders_dedupe IS
  'Re-running the projection must not duplicate a reminder it already wrote. Two reminders of the same kind, about the same subject, for the same client, at the same instant are indistinguishable and count once. body is deliberately not in the key: rewording a template is the same reminder said differently.';

-- 084_card_liability_history.sql — every snapshot of a card's terms, kept.
--
-- WHY HISTORY IS A SEPARATE TABLE. `card_liabilities` (083) holds one row per
-- account: what is true now. That is what the screens read on every load. This
-- table holds every snapshot ever taken, which is what answers the questions
-- 083 structurally cannot:
--
--   * "My minimum payment went up — when?"  A single current row cannot say.
--   * "Was the APR always 24.99%?"          Promotional rates expire silently;
--                                           the only evidence is the old row.
--   * "Did we miss a due date, or was it    A due date that moved and a due date
--      never reported?"                     that was never there look identical
--                                           in a table that overwrites.
--
-- APPEND-ONLY. No UPDATE path and no delete. A mutable history is not evidence
-- of anything — the same reasoning `inquiry_attempts` (055) and the commission
-- ledger (016) are built on. If a snapshot was wrong, the correction is a new
-- snapshot, not an edit.
--
-- THE DEDUPE RULE. A refresh that finds nothing changed must NOT write a row.
-- Balances get polled; without this, a daily sync produces 365 identical rows a
-- year per card and "when did the minimum payment change" becomes unanswerable
-- by drowning rather than by absence. `content_hash` is the caller's digest of
-- the values that matter, and the partial unique index makes the rule the
-- database's rather than the caller's to remember.
--
-- NULLS MEAN UNKNOWN HERE TOO, and they are load-bearing in a way that is easy
-- to miss: a snapshot where the due date was NULL is a real, informative record
-- that at that moment the issuer reported no due date. Coercing it to anything
-- would fabricate history, which is worse than fabricating a current value
-- because nobody re-checks history.

CREATE TABLE IF NOT EXISTS card_liability_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- CASCADE matches 083 and 081: disconnecting the bank removes the account and
  -- everything that only had meaning while it was connected.
  bank_account_id uuid NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,

  -- Same columns as 083, same units, same NULL discipline.
  last_statement_balance_cents bigint,
  last_statement_issue_date    date,
  minimum_payment_cents        bigint CHECK (minimum_payment_cents >= 0),
  next_payment_due_date        date,
  last_payment_amount_cents    bigint,
  last_payment_date            date,
  is_overdue                   boolean,
  apr                          numeric(6,5) CHECK (apr >= 0 AND apr <= 1),
  aprs                         jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- NOT NULL here, unlike 083. A snapshot is defined by when it was taken; a
  -- history row without a timestamp cannot be ordered and is not a snapshot.
  as_of        timestamptz NOT NULL,

  -- The caller's digest of the values above. NULL opts this row out of deduping
  -- — a deliberate escape hatch for a caller that knows two identical-looking
  -- snapshots are genuinely distinct events.
  content_hash text,

  created_at   timestamptz NOT NULL DEFAULT now()
);

-- One row per (account, content). A poll that finds nothing changed writes
-- nothing. Partial, so a NULL hash never collides — same construction as 067's
-- anonymous-response index and 054's tradeline index.
CREATE UNIQUE INDEX IF NOT EXISTS uq_card_liability_history_content
  ON card_liability_history (bank_account_id, content_hash)
  WHERE content_hash IS NOT NULL;

-- The history read: one account, newest first.
CREATE INDEX IF NOT EXISTS idx_card_liability_history_account
  ON card_liability_history (bank_account_id, as_of DESC);

CREATE INDEX IF NOT EXISTS idx_card_liability_history_client
  ON card_liability_history (client_id, as_of DESC);

-- APPEND-ONLY, ENFORCED. A trigger rather than a convention, because "we agreed
-- not to update this table" is not a control. Same pattern as
-- 016_ledger_no_delete.sql and 051's hiring_no_delete().
CREATE OR REPLACE FUNCTION card_liability_history_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'card_liability_history is append-only: % is not permitted. A wrong snapshot is corrected by a new snapshot, not an edit.', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_card_liability_history_no_change ON card_liability_history;
CREATE TRIGGER trg_card_liability_history_no_change
  BEFORE UPDATE OR DELETE ON card_liability_history
  FOR EACH ROW EXECUTE FUNCTION card_liability_history_append_only();

COMMENT ON TABLE card_liability_history IS
  'Every snapshot of a card terms, append-only, enforced by trigger. Answers what card_liabilities (083) structurally cannot: when the minimum payment changed, when a promotional APR expired, whether a due date moved or was never reported. A snapshot with a NULL due date is a real record that the issuer reported none — coercing it would fabricate history. See db/migrations/084_card_liability_history.sql.';

COMMENT ON COLUMN card_liability_history.content_hash IS
  'Caller digest of the values that matter. The partial unique index means a poll that finds nothing changed writes nothing — without it a daily sync buries the answer under 365 identical rows a year. NULL opts out of deduping.';

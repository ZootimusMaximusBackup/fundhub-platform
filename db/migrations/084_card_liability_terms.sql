-- 084_card_liability_terms.sql — the dated history of a card's TERMS, so that a
-- limit increase or a rate change does not erase what was true last month.
--
-- WHY THIS EXISTS. 083 holds one row per card, and that row carries the card's
-- terms as they are RIGHT NOW. Update it when the issuer raises a limit and the
-- old limit is gone — not archived, gone. Every question that reaches backwards
-- then becomes unanswerable:
--
--   * "What was this client's utilisation when we underwrote them in March?"
--     Utilisation is balance over limit. If the limit was overwritten in May,
--     March's utilisation cannot be recomputed, and any figure quoted for it is
--     a fabrication.
--   * "Was this card business or personal at the time of that application?"
--   * "What rate did we quote, and was it the rate the card actually carried?"
--
-- HOW THIS REPO DOES EFFECTIVE DATING. 013_commission_rules.sql:98 states the
-- rule in one sentence:
--
--     "To change a rate: set effective_to = now() on the live row, INSERT a new
--      row with effective_from = now(). Never UPDATE the rate itself."
--
-- 013 states it and enforces none of it. This migration states it AND enforces
-- it, because a rule that lives only in a comment is a rule until the first
-- person in a hurry.
--
-- WHAT IS A "TERM" HERE, AND WHAT IS NOT. Versioned: the credit limit, the
-- three APRs, and the business/personal classification. Those are what the
-- issuer sets and changes on a schedule, and each of them changes the meaning
-- of every historical number computed from it.
--
-- NOT versioned: balances, statement balance, minimum payment, due dates. Those
-- are not terms, they are readings — they change every single day, and a
-- history of them is a balance-snapshot problem with entirely different
-- retention, volume and indexing. Versioning them here would put a row per card
-- per day into the same table that is meant to hold a handful of rows per card
-- per decade, and the "what were the terms in March" query would then have to
-- pick its way through thousands of rows that never changed a term. If a
-- balance history is wanted it is its own table.
--
-- THE INTERVAL IS HALF-OPEN: [effective_from, effective_to). A row is in effect
-- at instant T when effective_from <= T AND (effective_to IS NULL OR
-- effective_to > T). Half-open is what makes "close the old row and open the
-- new one at the same instant" produce neither a gap nor an overlap, so the
-- question "which terms were in effect at T" always has exactly one answer.

CREATE TABLE IF NOT EXISTS card_liability_terms (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES orgs(id),

  -- ON DELETE CASCADE: the history of a card that no longer exists is not
  -- history, it is orphaned rows. 083 itself cascades from clients, so deleting
  -- a client removes the cards and then the terms, in that order.
  card_liability_id uuid NOT NULL REFERENCES card_liabilities(id) ON DELETE CASCADE,

  -- The versioned terms. Every one of them is NULL-able and NULL means UNKNOWN,
  -- exactly as in 083. A term row recording "the limit changed to $20,000, and
  -- we still do not know the cash-advance rate" is an honest row; forcing a
  -- number into that column would make the history lie in a way the live table
  -- does not.
  credit_limit_cents   bigint CHECK (credit_limit_cents >= 0),
  apr_purchase         numeric(6,5) CHECK (apr_purchase         >= 0 AND apr_purchase         <= 1),
  apr_cash_advance     numeric(6,5) CHECK (apr_cash_advance     >= 0 AND apr_cash_advance     <= 1),
  apr_balance_transfer numeric(6,5) CHECK (apr_balance_transfer >= 0 AND apr_balance_transfer <= 1),

  -- Three states, same as 083: true / false / NULL-means-unclassified. A card
  -- reclassified from personal to business is a term change worth versioning,
  -- because it changes who is liable and how the balance underwrites.
  is_business          boolean,

  --   bank   — the issuer or aggregator reported this change.
  --   manual — a human typed it.
  -- Same trust distinction 054 draws with its own `source`, and for the same
  -- reason: a reader must never be unable to tell which is which.
  source        text NOT NULL DEFAULT 'bank' CHECK (source IN ('bank', 'manual')),

  -- Free text, optional. "CLI approved", "rate reset after promo", "corrected —
  -- was typed as personal". Not a CHECK-ed vocabulary: the useful reasons are
  -- not knowable in advance and a closed list would just be worked around.
  reason        text,

  -- EFFECTIVE DATING. NULL effective_to = still in effect. Same column names
  -- and the same meaning as commission_rules, so the two tables read the same
  -- way and one query pattern serves both.
  --
  -- TRUNCATED TO MILLISECONDS, AND THIS IS LOAD-BEARING. Postgres timestamptz
  -- keeps microseconds; a JavaScript Date keeps milliseconds and silently drops
  -- the rest. Every consumer of this table is JavaScript. So a boundary stored
  -- as 05:48:30.734567 comes back to Node as 05:48:30.734, and the obvious call
  -- — "give me the terms in effect at the instant this row began",
  -- termsAsOf({ at: row.effective_from }) — sends 05:48:30.734 back to
  -- Postgres, which is 567 microseconds BEFORE the row begins, and returns the
  -- PREVIOUS row. Off by one row, always at the boundary, silently, and
  -- "what was the limit in March" answers with February's.
  --
  -- Truncating here makes every stored instant exactly representable by the
  -- only client this system has. The cost is that two changes inside the same
  -- millisecond are pushed one millisecond apart by
  -- src/card-liabilities/store.mjs; they stay ordered and non-overlapping, and
  -- nothing downstream can tell the difference.
  effective_from timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now()),
  effective_to   timestamptz,

  created_at     timestamptz NOT NULL DEFAULT now(),

  -- A term that ended before or at the instant it began is not a term. Strict
  -- inequality, so a zero-length row cannot exist: if two changes landed at the
  -- same instant there is no answer to "which was in effect", and a row that
  -- claims one is worse than a refusal.
  --
  -- src/card-liabilities/store.mjs is what keeps this satisfiable. It uses
  -- clock_timestamp(), not now(), because now() is frozen for a whole
  -- transaction and two changes inside one transaction would land on the same
  -- instant; and it takes GREATEST(truncated clock, effective_from + 1ms) so
  -- that two changes inside the same MILLISECOND are still strictly ordered
  -- after the truncation above.
  CONSTRAINT card_liability_terms_interval CHECK (
    effective_to IS NULL OR effective_to > effective_from
  )
);

-- ONE OPEN ROW PER CARD, ENFORCED. Without this, two racing writers each close
-- the current row and open their own, and the card ends up with two
-- simultaneously-in-effect sets of terms — at which point "what was the limit
-- in March" has two answers and no tie-break. A check-then-insert in
-- application code cannot close that window; only a unique index can, because
-- it is evaluated at write time by the one component that sees both
-- transactions. Same reasoning, same shape, as uq_shifts_one_open in 060.
CREATE UNIQUE INDEX IF NOT EXISTS uq_card_liability_terms_open
  ON card_liability_terms (card_liability_id)
  WHERE effective_to IS NULL;

-- "What were the terms at instant T" and "show me this card's history, newest
-- first" are the same index.
CREATE INDEX IF NOT EXISTS idx_card_liability_terms_history
  ON card_liability_terms (card_liability_id, effective_from DESC);

-- THE RULE 013 STATED AND NOBODY ENFORCED.
--
-- 013_commission_rules.sql:98 says never UPDATE a rate in place. This trigger
-- makes that true rather than aspirational: the ONLY column an UPDATE may
-- change is effective_to, and only from NULL to a value. Everything else —
-- including effective_from and created_at — is frozen at insert.
--
-- Why this matters more than tidiness: an in-place edit is invisible. There is
-- no row left behind, no diff, nothing in any log this system keeps. A limit
-- silently corrected from 20,000 to 25,000 changes every utilisation figure
-- ever computed from that row, retroactively, and no read anywhere would flag
-- it. The only place it can be stopped is here.
--
-- IS DISTINCT FROM, not <>, throughout: these columns are nullable and
-- NULL <> NULL is NULL, which is not true, so a plain <> would let a change
-- to-or-from NULL slip past every branch.
CREATE OR REPLACE FUNCTION card_liability_terms_no_rewrite() RETURNS trigger AS $$
BEGIN
  IF NEW.id                   IS DISTINCT FROM OLD.id
  OR NEW.org_id               IS DISTINCT FROM OLD.org_id
  OR NEW.card_liability_id    IS DISTINCT FROM OLD.card_liability_id
  OR NEW.credit_limit_cents   IS DISTINCT FROM OLD.credit_limit_cents
  OR NEW.apr_purchase         IS DISTINCT FROM OLD.apr_purchase
  OR NEW.apr_cash_advance     IS DISTINCT FROM OLD.apr_cash_advance
  OR NEW.apr_balance_transfer IS DISTINCT FROM OLD.apr_balance_transfer
  OR NEW.is_business          IS DISTINCT FROM OLD.is_business
  OR NEW.source               IS DISTINCT FROM OLD.source
  OR NEW.reason               IS DISTINCT FROM OLD.reason
  OR NEW.effective_from       IS DISTINCT FROM OLD.effective_from
  OR NEW.created_at           IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'card_liability_terms %: terms are effective-dated and cannot be edited in place — close this row by setting effective_to, then INSERT a new row (the rule stated at 013_commission_rules.sql:98)',
      OLD.id;
  END IF;

  -- Closing is one-way. Re-opening a closed row, or sliding the instant it
  -- closed, rewrites history just as thoroughly as editing the rate would.
  IF OLD.effective_to IS NOT NULL
     AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
    RAISE EXCEPTION
      'card_liability_terms %: already closed at % — a closed term cannot be reopened or moved',
      OLD.id, OLD.effective_to;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_card_liability_terms_no_rewrite ON card_liability_terms;
CREATE TRIGGER trg_card_liability_terms_no_rewrite
  BEFORE UPDATE ON card_liability_terms
  FOR EACH ROW EXECUTE FUNCTION card_liability_terms_no_rewrite();

-- WHAT WAS DELIBERATELY NOT DONE: NO DELETE GUARD.
--
-- 016_ledger_no_delete.sql blocks DELETE on commission_ledger, and the same
-- argument applies in principle here — delete-then-reinsert rewrites history as
-- effectively as an UPDATE does. It is not done, because this table hangs off
-- card_liabilities, which hangs off clients ON DELETE CASCADE. A BEFORE DELETE
-- trigger that raises would fire on the CASCADE too, and deleting a client
-- would become impossible — a data-retention obligation traded away to close a
-- narrower hole. commission_ledger has no such parent, which is why 016 could
-- afford the guard and this cannot.
--
-- The exposure that remains is a direct, deliberate DELETE against this table
-- by someone with database access. That is a different threat from the one the
-- UPDATE guard closes (an ordinary writer taking the obvious shortcut), and it
-- is named here rather than left for the next reader to discover.
--
-- WHAT WAS DELIBERATELY NOT DONE: NOTHING AUTO-OPENS THE FIRST TERM ROW.
-- No trigger on card_liabilities inserts a term row when a card appears. The
-- store does it explicitly (openTerms), because a trigger that writes history
-- as a side effect of an unrelated INSERT is history nobody chose to record,
-- and the first thing anyone debugging it would have to do is find the trigger.

-- 333_dispute_letter_send_claim.sql — separate "we tried to mail this" from
-- "this was mailed", so a send that provably never left the building cannot
-- destroy a letter.
--
-- COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7). Dispute logic.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT 332 GOT WRONG, MEASURED ON A REAL DATABASE
--
-- 332 made the claim and the mailing the same fact: `mailed_at` was stamped
-- BEFORE the provider was called, and the unique index keyed on it. So the
-- index prevented a second ATTEMPT, not a second MAILING, and any attempt that
-- died above the network still consumed the only mailing slot that
-- (org, case, bureau, round, target) will ever have.
--
-- Reproduced on a scratch Postgres on 2026-09-05, with a fetch implementation
-- that throws if it is ever reached — it never fired, so nothing was
-- transmitted:
--
--   press 1  outbound fence held the call   -> row: sending | mailed_at STAMPED
--   press 2  same letter, fence off         -> refused "already_mailed"
--   press 3  a brand new replacement row    -> refused "already_mailed_duplicate_letter"
--
-- Nothing in the repository could clear that. The letter, and every future
-- replacement for it, was dead. A send that did not happen destroyed the
-- letter — which is worse than the double mailing 332 exists to prevent.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE TWO FACTS, NOW IN TWO COLUMNS
--
--   send_claimed_at  — this row is TAKEN. Stamped before the provider is
--                      called. Released back to NULL when the refusal provably
--                      happened above the network. Cleared by a human, on the
--                      record, when a call went out and never came back.
--
--   mailed_at        — this row WAS MAILED. Stamped only after the provider
--                      answered yes and gave us an id. Never released, never
--                      cleared, by anybody.
--
-- Two partial unique indexes over (org_id, case_id, bureau, round, target):
--
--   uq_dispute_letters_one_mailing      WHERE mailed_at IS NOT NULL
--     The hard invariant. One physical mailing per case, bureau, round and
--     destination, for ever. Nothing in the code path can undo a row's
--     membership of this index, so no clear-the-stuck-claim route — staff or
--     otherwise — can turn a letter that really went out into one that may go
--     out again.
--
--   uq_dispute_letters_one_send_claim   WHERE send_claimed_at IS NOT NULL
--     The concurrency guard, and a deliberate SUPERSET of the first (a mailed
--     row keeps its claim; see dispute_letters_mailed_implies_claimed_ck). It
--     is what stops two rows for the same letter both reaching the provider,
--     and what stops a regenerated replacement claiming a slot that a mailed
--     row already holds — refusing at CLAIM time, before the call, rather than
--     at the write-back after an envelope is already in the post.
--     Unlike the first, this one releases.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE BACKFILL, AND WHY IT IS SAFE
--
-- Only rows touched by 332's code path carry mailed_at at all; every other row
-- has NULL and keeps it (CLAUDE.md §12: NULL means unknown and must survive —
-- a pre-332 row honestly does not know when it was mailed, and this migration
-- does not invent an answer).
--
-- For the rows that do carry it, the stamp meant "claimed", so it moves to
-- send_claimed_at. It stays in mailed_at as well ONLY where the row also says
-- the mailing succeeded (status 'sent' or 'delivered'). A row still in
-- 'sending' was claimed and never confirmed, so its mailed_at is cleared: that
-- is precisely the false "this was mailed" that bricked the letter.
--
-- uq_dispute_letters_one_send_claim cannot fail to build. After the backfill
-- the set of rows with send_claimed_at IS NOT NULL is exactly the set that had
-- mailed_at IS NOT NULL before it, and uq_dispute_letters_one_mailing already
-- proves that set is unique on the key.
--
-- SAFETY. Four columns added, one constraint replaced, two added, one index
-- added, one index redefined. The only row writes are the backfill described
-- above, and they are confined to rows 332 itself stamped. Re-running is a
-- no-op: the backfill's WHERE clauses no longer match once it has run.

-- ---------------------------------------------------------------------------
-- 1. The claim column, and the record of a human clearing one
-- ---------------------------------------------------------------------------
ALTER TABLE public.dispute_letters
  ADD COLUMN IF NOT EXISTS send_claimed_at timestamptz;

-- Who cleared a stuck claim, when, and why. A clear is the one action in this
-- system that can knowingly risk a second envelope — the provider call went out
-- and never came back, so nobody can say whether the letter went — and it must
-- therefore never be anonymous. No foreign key to staff on purpose: this is an
-- audit stamp, and it has to survive the staff row being removed.
ALTER TABLE public.dispute_letters
  ADD COLUMN IF NOT EXISTS send_claim_cleared_at timestamptz;
ALTER TABLE public.dispute_letters
  ADD COLUMN IF NOT EXISTS send_claim_cleared_by uuid;
ALTER TABLE public.dispute_letters
  ADD COLUMN IF NOT EXISTS send_claim_cleared_reason text;

-- ---------------------------------------------------------------------------
-- 2. Drop 332's claim CHECK first — the backfill cannot run underneath it
-- ---------------------------------------------------------------------------
-- 332's constraint reads `status <> 'sending' OR mailed_at IS NOT NULL`, which
-- is precisely the rule that forced a claim to look like a mailing. The backfill
-- below clears mailed_at on the rows still sitting in 'sending' — every one of
-- which the old constraint requires to carry one — so leaving it in place until
-- after the backfill makes this migration fail on any database that has a stuck
-- row, which is exactly the database it exists to repair.
--
-- MEASURED, 2026-09-05: with this drop after the backfill instead of before it,
-- `node db/migrate.mjs` against a scratch Postgres carrying one 332-shaped
-- stuck row aborted with
--   ✗ FAILED migrations/333: new row for relation "dispute_letters" violates
--     check constraint "dispute_letters_claim_ck"
-- and applied nothing. The order below is not tidiness.
--
-- The replacement CHECK is added in section 4, AFTER the backfill: it requires
-- send_claimed_at on every 'sending' row, and it is the backfill that puts one
-- there. Between the two the table is briefly unconstrained on this rule, inside
-- one transaction (db/migrate.mjs wraps each file), so nothing else sees it.
--
-- Superseded, not edited: editing an applied migration is a silent no-op
-- (CLAUDE.md §12).
ALTER TABLE public.dispute_letters DROP CONSTRAINT IF EXISTS dispute_letters_claim_ck;

-- ---------------------------------------------------------------------------
-- 3. Backfill — move 332's claim stamps out of mailed_at
-- ---------------------------------------------------------------------------
UPDATE public.dispute_letters
   SET send_claimed_at = mailed_at
 WHERE mailed_at IS NOT NULL
   AND send_claimed_at IS NULL;

-- Claimed and never confirmed. 332 called that "mailed". It was not.
UPDATE public.dispute_letters
   SET mailed_at = NULL
 WHERE status = 'sending'
   AND mailed_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Constraints — the two columns cannot disagree
-- ---------------------------------------------------------------------------
-- The claim rule, re-stated against the column that now carries the claim.
-- Dropped in section 2 above, for the reason given there.
ALTER TABLE public.dispute_letters DROP CONSTRAINT IF EXISTS dispute_letters_claim_ck;
ALTER TABLE public.dispute_letters
  ADD CONSTRAINT dispute_letters_claim_ck
  CHECK (status <> 'sending' OR send_claimed_at IS NOT NULL);

-- A mailing implies a claim. This is what makes the claim index a superset of
-- the mailing index, which is what lets the claim index refuse a replacement
-- row BEFORE the provider is called rather than after.
ALTER TABLE public.dispute_letters DROP CONSTRAINT IF EXISTS dispute_letters_mailed_implies_claimed_ck;
ALTER TABLE public.dispute_letters
  ADD CONSTRAINT dispute_letters_mailed_implies_claimed_ck
  CHECK (mailed_at IS NULL OR send_claimed_at IS NOT NULL);

-- A clear names a person and a reason, or it did not happen.
ALTER TABLE public.dispute_letters DROP CONSTRAINT IF EXISTS dispute_letters_claim_clear_ck;
ALTER TABLE public.dispute_letters
  ADD CONSTRAINT dispute_letters_claim_clear_ck
  CHECK (
    (send_claim_cleared_at IS NULL
       AND send_claim_cleared_by IS NULL
       AND send_claim_cleared_reason IS NULL)
    OR (send_claim_cleared_at IS NOT NULL
       AND send_claim_cleared_by IS NOT NULL
       AND btrim(coalesce(send_claim_cleared_reason, '')) <> '')
  );

-- ---------------------------------------------------------------------------
-- 5. The indexes
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_dispute_letters_one_send_claim
  ON public.dispute_letters (org_id, case_id, bureau, round, target)
  WHERE send_claimed_at IS NOT NULL;

-- "What is stuck mid-send" — the reconciliation read a human needs when a
-- provider call never came back. 332 built this over mailed_at, which no longer
-- carries the claim. DROP then CREATE, because CREATE INDEX IF NOT EXISTS on an
-- existing name with a new definition is silently ignored.
DROP INDEX IF EXISTS public.dispute_letters_sending_idx;
CREATE INDEX dispute_letters_sending_idx
  ON public.dispute_letters (org_id, send_claimed_at)
  WHERE status = 'sending';

-- ---------------------------------------------------------------------------
-- 6. What the columns mean now
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.dispute_letters.mailed_at IS
  'When the mail provider ACCEPTED this letter — stamped only after it answered with an id, never before. NULL = not mailed (which includes a claim that is in flight, one that died above the network, and every row predating migration 332). Never backfilled, never released, never cleared. uq_dispute_letters_one_mailing keys on this and is the one-physical-mailing invariant.';
COMMENT ON COLUMN public.dispute_letters.send_claimed_at IS
  'When the send loop TOOK this letter, stamped before the provider is called. NULL = free to claim. Released back to NULL when the mailer refused provably above the network, or when a human clears a claim whose call never came back. Says nothing about whether anything was mailed — that is mailed_at.';
COMMENT ON COLUMN public.dispute_letters.send_claim_cleared_at IS
  'When a human released a stuck send claim. NULL = never cleared. A clear is a judgement that the letter did not go out; it can be wrong, which is why it is recorded rather than inferred.';
COMMENT ON COLUMN public.dispute_letters.send_claim_cleared_by IS
  'The staff id that cleared the stuck send claim. No foreign key: an audit stamp must outlive the staff row.';
COMMENT ON COLUMN public.dispute_letters.send_claim_cleared_reason IS
  'Why the human believed the letter did not go out. Required whenever send_claim_cleared_at is set.';

COMMENT ON INDEX public.uq_dispute_letters_one_mailing IS
  'One physical mailing per case, bureau, round and destination, for ever. mailed_at is stamped only after the provider accepted the letter, so this counts mailings and not attempts. Nothing releases a row from this index — the staff clear-a-stuck-claim route touches send_claimed_at only.';
COMMENT ON INDEX public.uq_dispute_letters_one_send_claim IS
  'At most one row per case, bureau, round and destination may hold a send claim. A deliberate superset of uq_dispute_letters_one_mailing (a mailed row keeps its claim), so a regenerated replacement for an already-mailed letter is refused at claim time, before the provider is called. Unlike the mailing index this one releases: a refusal that provably happened above the network, or a human clearing a stuck claim, sets send_claimed_at back to NULL.';

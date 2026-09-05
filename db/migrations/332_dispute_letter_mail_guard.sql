-- 332_dispute_letter_mail_guard.sql — make mailing the same letter twice
-- impossible in the database, and record what each piece cost.
--
-- COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7). Dispute logic and fee timing.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT IS BROKEN RIGHT NOW
--
-- `dispute_letters` carries no unique index of any kind, and
-- src/repair/send.mjs sets `status = 'sent'` with NO check of the current
-- status. So re-POSTing the same payload hands the same letters to PostGrid a
-- second time: the consumer gets two identical dispute letters in the post,
-- the bureau gets two, and PostGrid bills twice.
--
-- The only thing standing in the way today is a disabled button in a browser.
-- A retry, a second tab, a phone that resends on a flaky connection, or curl
-- walks straight past it. This is exactly the shape of the soft-pull double-tap
-- fixed by 090 and the double-charge fixed by 276, and it gets the same answer:
-- the database adjudicates, not a check in JavaScript that cannot close the
-- window between its SELECT and its call.
--
-- This lands BEFORE any client-facing "buy another round" button exists.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE TWO DOUBLE-MAILINGS, AND THE TWO GUARDS
--
-- ONE ROW, MAILED TWICE — the re-POST above. Closed by the claim: the send loop
-- now takes the row with a conditional UPDATE that only succeeds when the row
-- has not been claimed, and it takes it BEFORE it calls the provider. A second
-- caller's UPDATE matches nothing, so it never makes the call. That is what
-- `mailed_at` and the `'sending'` status are for.
--
-- TWO ROWS, SAME LETTER, BOTH MAILED — a regenerate that writes a second
-- dispute_letters row for the same case, bureau, round and destination, which
-- is then also sent. The claim cannot see that, because it is a different row.
-- Closed by `uq_dispute_letters_one_mailing`: at most one letter per
-- (org, case, bureau, round, target) may ever carry a mailed_at. The second
-- claim raises a unique violation and the send loop reports it instead of
-- mailing.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THE INDEX KEYS ON mailed_at AND NOT ON status
--
-- Because it must not have to touch a single existing row.
--
-- Keying the partial index on `status IN ('sent','delivered')` would apply to
-- history, and if any two historic rows already duplicate a case/bureau/round/
-- target, CREATE UNIQUE INDEX fails — which means the migration fails, which
-- means the production deploy fails. Fixing that would mean rewriting rows that
-- record real mailings, and a letter that really went out is not something to
-- edit to make an index build.
--
-- `mailed_at` is a NEW column. Every existing row has NULL, NULL is outside the
-- partial index, and NULL is never backfilled — it honestly means "this row
-- predates the guard and nobody recorded when it was mailed" (CLAUDE.md §12:
-- NULL means unknown and must survive). From this migration forward the guard
-- is total, and history is untouched.
--
-- The claim's WHERE clause carries BOTH predicates —
-- `mailed_at IS NULL AND status NOT IN ('sending','sent','delivered')` — so a
-- legacy row that was already sent before this shipped is still refused a
-- second mailing.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 'sending' IS A CLAIM, AND A STUCK CLAIM IS NOT AUTO-RETRIED
--
-- Same reasoning as subscription_charges' `in_flight` (276). If the provider
-- call is made and never comes back, WE DO NOT KNOW WHETHER THE LETTER WENT.
-- Retrying is the one action that can actually mail it twice, so the row is
-- left in 'sending' for a human to reconcile. A stuck row is a support ticket;
-- a second mailing is a real letter in a real person's post and a second bill.
--
-- The send loop releases a claim in exactly one case: the mailer refused
-- BEFORE transmitting, which it does with a known, fixed set of error strings
-- (no API key, no return address, no destination, no PDF or HTML, a private
-- carrier to a PO box). Those are checks in our own code above the fetch, so
-- nothing was sent and the letter must stay sendable. Anything else keeps the
-- claim.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- PER-PIECE MAIL COST
--
-- PostGrid bills per letter (src/messaging/providers/mail-letter.mjs) and
-- nothing in this repository records it, so the margin on a $100 self-serve
-- round is currently unknowable — we know what we charged and not what it cost.
--
-- `mail_cost_cents` is added here. NULL means UNKNOWN and must survive: it does
-- NOT mean the letter was free to send, and a CHECK is not enough on its own to
-- stop that reading, so the column is nullable with no default and no backfill.
-- POPULATING IT IS NOT THIS MIGRATION'S JOB and no code in this change writes
-- it — the provider response has to be read for a price and that is a later
-- lane's work.
--
-- SAFETY. Additive. Two columns, one widened CHECK, two indexes. No row is
-- updated, nothing is dropped, no data is deleted. Re-running it is a no-op.

-- ---------------------------------------------------------------------------
-- 1. The claim column and the cost column
-- ---------------------------------------------------------------------------
ALTER TABLE public.dispute_letters
  ADD COLUMN IF NOT EXISTS mailed_at timestamptz;

ALTER TABLE public.dispute_letters
  ADD COLUMN IF NOT EXISTS mail_cost_cents bigint;

ALTER TABLE public.dispute_letters
  DROP CONSTRAINT IF EXISTS dispute_letters_mail_cost_ck;
ALTER TABLE public.dispute_letters
  ADD CONSTRAINT dispute_letters_mail_cost_ck
  CHECK (mail_cost_cents IS NULL OR mail_cost_cents >= 0);

COMMENT ON COLUMN public.dispute_letters.mailed_at IS
  'When the send loop CLAIMED this letter for mailing, stamped before the provider is called. NULL = never claimed, or the row predates migration 332. Never backfilled. The partial unique index uq_dispute_letters_one_mailing keys on this.';
COMMENT ON COLUMN public.dispute_letters.mail_cost_cents IS
  'What the mail provider charged for this one piece, in integer cents. NULL = UNKNOWN, which is not the same as free. Nothing writes this yet; populating it from the provider response is a later change.';

-- ---------------------------------------------------------------------------
-- 2. 'sending' — the claimed state
-- ---------------------------------------------------------------------------
-- 160_metro2_dispute_engine.sql created the CHECK inline and unnamed, so
-- Postgres named it dispute_letters_status_check. 160 is applied and editing an
-- applied migration is a silent no-op (CLAUDE.md §12), so it is superseded here.
-- Widening only: every existing value stays valid.
ALTER TABLE public.dispute_letters DROP CONSTRAINT IF EXISTS dispute_letters_status_check;
ALTER TABLE public.dispute_letters DROP CONSTRAINT IF EXISTS dispute_letters_status_ck;
ALTER TABLE public.dispute_letters
  ADD CONSTRAINT dispute_letters_status_check
  CHECK (status IN (
    'generated',
    'variance_failed',
    'ready',
    'sending',      -- claimed by the send loop; the provider call is in flight
    'sent',
    'delivered',
    'failed'
  ));

-- A claimed row must say when it was claimed, and a row that says it was
-- claimed must be in or past the claimed state. Without this the two halves of
-- the guard could disagree, and the one that disagreed would decide whether a
-- consumer got a second letter.
ALTER TABLE public.dispute_letters DROP CONSTRAINT IF EXISTS dispute_letters_claim_ck;
ALTER TABLE public.dispute_letters
  ADD CONSTRAINT dispute_letters_claim_ck
  CHECK (status <> 'sending' OR mailed_at IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 3. The unique index — two rows, same letter, cannot both be mailed
-- ---------------------------------------------------------------------------
-- case_id, org_id, bureau, round and target are all NOT NULL on this table, so
-- there is no NULL-skipping hole in the key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dispute_letters_one_mailing
  ON public.dispute_letters (org_id, case_id, bureau, round, target)
  WHERE mailed_at IS NOT NULL;

COMMENT ON INDEX public.uq_dispute_letters_one_mailing IS
  'One physical mailing per case, bureau, round and destination. src/repair/send.mjs claims a letter by stamping mailed_at BEFORE calling the provider, so a duplicate row for the same letter raises a unique violation instead of a second envelope and a second PostGrid bill. Partial on mailed_at so the guard covers everything from migration 332 forward without rewriting a single historic row.';

-- "What is stuck mid-send" — the reconciliation read a human needs when a
-- provider call never came back.
CREATE INDEX IF NOT EXISTS dispute_letters_sending_idx
  ON public.dispute_letters (org_id, mailed_at)
  WHERE status = 'sending';

-- 334_no_clear_after_mailing.sql — put the "you cannot un-mail a letter" rule
-- in the database, so no code path can release a mailing by forgetting a check.
--
-- COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7). Dispute logic.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT WENT WRONG, MEASURED
--
-- 333 split "we took this letter" (send_claimed_at) from "this letter was
-- mailed" (mailed_at) and gave a staff member a way to release the first. The
-- release refuses on any row carrying the second. That was correct — and it
-- never fired, because src/repair/send.mjs only wrote mailed_at when the
-- provider handed back an id:
--
--     if (letterId && providerId && db?.query) { ...stamp mailed_at... }
--
-- PostGrid answering 200 with no id in the body returns { ok: true,
-- providerId: null } (src/messaging/providers/mail-letter.mjs). The envelope is
-- in the post; the whole write-back is skipped. Reproduced on a scratch
-- database on 2026-09-05 with the real send loop:
--
--   press 1   ok:true, providerId null, provider called once
--             row: status 'sending' | mailed_at NULL | claim held | id NULL
--   the row is then LISTED to staff as a stuck claim
--   clear     -> ok, status 'ready'
--   press 2   provider called a SECOND time
--
-- A second envelope to a real person, and a second bill. The code half is fixed
-- in src/repair/send.mjs: the mailing is recorded on ACCEPTANCE, id or no id.
-- This file is the half that does not depend on any code path remembering.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE RULE
--
-- A clear is a person saying "this letter did not go out". If the row says it
-- DID go out, that statement is false and the database refuses to store it.
--
--   send_claim_cleared_at IS NULL          nothing was cleared, nothing to check
--   OR mailed_at IS NULL                   nothing was mailed, a clear is honest
--   OR send_claim_cleared_at <= mailed_at  the clear came FIRST, and the letter
--                                          was mailed afterwards — which is the
--                                          whole point of clearing a stuck claim
--
-- The third arm is why this is an ordering rule and not a flat ban. The normal
-- happy path after a genuinely stuck claim is: clear at T1, re-send, mailed at
-- T2. That row legitimately carries both stamps. What it can never carry is a
-- clear stamped at or after the mailing.
--
-- The second constraint says the same thing about the OTHER piece of evidence
-- that a letter reached the provider — the provider's own id:
--
--   send_claim_cleared_at IS NULL   nothing was cleared, nothing to check
--   OR postgrid_letter_id IS NULL   no provider id, so no evidence to contradict
--   OR mailed_at IS NOT NULL        the id belongs to a mailing that IS recorded,
--                                   and the first constraint already orders that
--                                   clear against it
--
-- The shape it refuses is exactly the dangerous one: a row carrying a provider
-- id with NO mailing time, being cleared. That row is a letter the provider
-- took whose mailing was never written down, and clearing it is what puts a
-- second envelope in the post.
--
-- It is deliberately NOT written as "a row with a provider id must keep its
-- claim". src/metro2/rounds/complaint-filing.mjs:165-170 inserts a complaint
-- letter with status 'sent' and a provider id and no send_claimed_at at all,
-- and that row is legitimate — the constraint would break every CFPB and state
-- AG filing.
--
-- Together with 333's dispute_letters_mailed_implies_claimed_ck — which already
-- makes it impossible to set send_claimed_at back to NULL on a row whose
-- mailed_at is set — the release is now blocked at the database level, for
-- every writer, not only for clearStuckSendClaim().
--
-- WHAT THIS DOES NOT COVER, stated plainly rather than left to be discovered:
-- if the mailing could not be written to the row at all (the database was
-- unreachable at exactly that moment), then mailed_at IS NULL and both
-- constraints are satisfied by a clear, because nothing in the database knows a
-- letter went out. src/repair/send.mjs no longer swallows that failure — it
-- retries once, logs it, and returns it as `unrecordedMailings` — but a
-- constraint cannot enforce a fact that was never stored.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- SAFETY
--
-- Two CHECK constraints added. No columns, no indexes, no row writes, nothing
-- dropped. Re-running is a no-op (DROP IF EXISTS then ADD).
--
-- Added NOT VALID on purpose. Existing rows are not scanned, so this cannot
-- fail on a database that already holds a row 333's world let through, and no
-- historic row is rewritten to satisfy it — NULL means unknown and must survive
-- (CLAUDE.md §12). NOT VALID still enforces the rule on every INSERT and on
-- every UPDATE from here on, which is the only thing that matters: the harm is
-- a clear written in the future, not a stamp already in the table.

ALTER TABLE public.dispute_letters
  DROP CONSTRAINT IF EXISTS dispute_letters_no_clear_after_mailing_ck;

ALTER TABLE public.dispute_letters
  ADD CONSTRAINT dispute_letters_no_clear_after_mailing_ck
  CHECK (
    send_claim_cleared_at IS NULL
    OR mailed_at IS NULL
    OR send_claim_cleared_at <= mailed_at
  ) NOT VALID;

COMMENT ON CONSTRAINT dispute_letters_no_clear_after_mailing_ck ON public.dispute_letters IS
  'A staff clear says "this letter did not go out". It cannot be recorded at or after a mailing. Legitimate rows may carry both stamps when the clear came first and the re-send then mailed — hence an ordering rule rather than a flat ban. Pairs with dispute_letters_mailed_implies_claimed_ck (333), which stops send_claimed_at being set back to NULL on a mailed row. NOT VALID: enforced on every write from migration 334 onward, historic rows left exactly as they are.';

ALTER TABLE public.dispute_letters
  DROP CONSTRAINT IF EXISTS dispute_letters_no_clear_after_provider_id_ck;

ALTER TABLE public.dispute_letters
  ADD CONSTRAINT dispute_letters_no_clear_after_provider_id_ck
  CHECK (
    send_claim_cleared_at IS NULL
    OR postgrid_letter_id IS NULL
    OR mailed_at IS NOT NULL
  ) NOT VALID;

COMMENT ON CONSTRAINT dispute_letters_no_clear_after_provider_id_ck ON public.dispute_letters IS
  'The provider''s own id is evidence the letter reached it. A clear cannot be recorded on a row that carries one with no mailing time behind it — that row is a transmitted letter whose mailing was never written down, and clearing it is what puts a second envelope in the post. Once mailed_at is present the ordering rule in dispute_letters_no_clear_after_mailing_ck governs instead. Deliberately not "an id implies a claim": src/metro2/rounds/complaint-filing.mjs inserts CFPB and state AG letters with an id and no claim, and those are legitimate. NOT VALID: enforced on every write from migration 334 onward.';

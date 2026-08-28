-- 270_dispute_letter_complaint_targets.sql
-- Let a mailed CFPB / state AG complaint be RECORDED on the existing
-- dispute_letters table.
--
-- COMPLIANCE REVIEW REQUIRED — dispute logic.
--
-- WHY. Fundhub mails the Round 4 CFPB complaint and the Round 5 state attorney
-- general complaint on the client's behalf. The Round 6 bureau letter is allowed
-- to say those complaints were filed — but ONLY from a record, never from an
-- expectation. dispute_letters already carries `round` (text, no CHECK, so R4
-- and R5 already fit) and already flips to status 'sent' when the mail provider
-- accepts the letter (src/repair/send.mjs). It is the right table and it needs
-- no new columns.
--
-- The one thing in the way was `dispute_letters_target_check`, added by
-- 252_repair_rounds_six.sql as target IN ('bureau','furnisher'). A complaint is
-- neither: it goes to a federal regulator or a state attorney general. Recording
-- one as 'bureau' would be a false row, and a false row is worse than no row —
-- Round 6 reads this table to decide whether it may say a complaint was filed.
--
-- 252 is already applied, and editing an applied migration is a silent no-op
-- (migrate.mjs keys schema_migrations on <dir>/<file>). This supersedes it.
--
-- Widening only. Every existing row is 'bureau' or 'furnisher' and stays valid.

ALTER TABLE dispute_letters DROP CONSTRAINT IF EXISTS dispute_letters_target_check;
ALTER TABLE dispute_letters
  ADD CONSTRAINT dispute_letters_target_check
  CHECK (target IN ('bureau', 'furnisher', 'cfpb', 'state_ag'));

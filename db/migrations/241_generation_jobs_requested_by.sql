-- 241_generation_jobs_requested_by.sql — record WHO asked for a creative batch,
-- in a shape the two kinds of requester can actually satisfy.
--
-- THE BUG THIS CLOSES. 045_creative_factory.sql:293 declared
--
--   requested_by uuid REFERENCES accounts(id) ON DELETE SET NULL
--
-- and the only HTTP caller that fills it, api/creative/generate.mjs, is reached
-- by an EMPLOYEE as often as by a partner. An employee's id lives in `staff`,
-- not in `accounts` — 044_accounts.sql is explicit that accounts is "A SEPARATE
-- TABLE, not a `kind` column on staff", and accounts.kind is CHECKed to
-- ('client','affiliate','partner') with no 'staff' value at all. So the two ids
-- can never coincide, and every enqueue from an owner or admin session raised a
-- foreign key violation and came back to the screen as a 500. The partner path
-- happened to survive only because a partner principal has no staffId, so it
-- wrote NULL, and NULL always satisfies a foreign key.
--
-- THE SHAPE, copied from 077_soft_pull_requests.sql:123-131 and 173-182: a kind
-- column plus one foreign key per kind, with a CHECK that they agree. Collapsing
-- both into one text column would lose the foreign key, which is the only thing
-- that makes the attribution checkable later.
--
-- ONE DELIBERATE DIFFERENCE FROM 077. There, requested_by_kind is NOT NULL,
-- because an unattributed credit pull is illegal. Here an unattributed job is
-- legitimate and expected — 045:292 says so in as many words, "NULL for a
-- scheduled/agent-initiated batch", and src/creative/runner.mjs drains the queue
-- on a cron with nobody signed in. So the kind is NULLABLE and the CHECK carries
-- a third arm for "nobody asked". Without that arm the cron path would start
-- failing the constraint the day this lands.
--
-- THE OLD COLUMN STAYS, untouched and nullable. Every row written before today
-- has NULL in it, and NULL means unknown, not zero — backfilling it to a
-- placeholder would invent an attribution nobody made. Nothing reads it:
-- src/creative/generate.mjs was the only reference in the codebase, and this
-- migration ships with the change that stops it writing there.
--
-- Editing 045 in place would have been a silent no-op: db/migrate.mjs keys
-- schema_migrations by "<dir>/<file>", so an already-applied file is skipped
-- whatever its contents now say. Supersede, never edit.

ALTER TABLE generation_jobs
  ADD COLUMN IF NOT EXISTS requested_by_kind text
    CHECK (requested_by_kind IS NULL OR requested_by_kind IN ('staff', 'partner')),
  ADD COLUMN IF NOT EXISTS requested_by_staff_id   uuid REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requested_by_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL;

COMMENT ON COLUMN generation_jobs.requested_by_kind IS
  'staff | partner | NULL. NULL means nobody asked — a scheduled or agent-initiated batch.';
COMMENT ON COLUMN generation_jobs.requested_by_staff_id IS
  'The employee who asked. Set only when requested_by_kind = ''staff''.';
COMMENT ON COLUMN generation_jobs.requested_by_account_id IS
  'The partner account that asked. Set only when requested_by_kind = ''partner''.';
COMMENT ON COLUMN generation_jobs.requested_by IS
  'SUPERSEDED by requested_by_kind + requested_by_staff_id + requested_by_account_id (241). Kept for rows written before 2026-08-19; never written to again.';

-- At most one requester, and it must be the kind the row claims. Dropped first
-- so re-running this file is safe; ADD CONSTRAINT has no IF NOT EXISTS form.
ALTER TABLE generation_jobs
  DROP CONSTRAINT IF EXISTS generation_jobs_requester_ck;
ALTER TABLE generation_jobs
  ADD CONSTRAINT generation_jobs_requester_ck CHECK (
    (requested_by_kind IS NULL
       AND requested_by_staff_id IS NULL AND requested_by_account_id IS NULL)
    OR
    (requested_by_kind = 'staff'
       AND requested_by_staff_id IS NOT NULL AND requested_by_account_id IS NULL)
    OR
    (requested_by_kind = 'partner'
       AND requested_by_account_id IS NOT NULL AND requested_by_staff_id IS NULL)
  );

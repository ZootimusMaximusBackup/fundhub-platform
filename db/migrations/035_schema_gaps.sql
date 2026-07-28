-- 035_schema_gaps.sql
--
-- Three structural gaps found while porting the GHL workflows. Each one blocked
-- or degraded a workflow that is otherwise built, and none of them can be closed
-- from the call sites alone:
--
--   1. behavior_scores had no idempotency hook       — BC-01, BC-02
--   2. staff had nowhere to hold rotation state      — POD-01A (BLOCKED)
--   3. cards had no uniqueness behind moveCardToStage's check-then-insert
--                                                    — S-04, DPC-02, DPC-03, F-11
--
-- 001_init.sql is NOT edited — every change here is additive, in the same style
-- as db/schema/020_auth.sql.
--
-- IDEMPOTENT. Every statement is IF NOT EXISTS or guarded by a catalog lookup,
-- so re-running this file is a no-op rather than an error.
--
-- Postgres 15+ for NULLS NOT DISTINCT, already relied on by
-- db/schema/006_tasks_idempotency.sql.
--
-- THIS FILE CHANGES NO CALL SITES. It opens the doors; the inserts named under
-- each section still have to walk through them. What each one needs is spelled
-- out in the "CALL SITES" note in its block.

-- ---------------------------------------------------------------------------
-- 1. behavior_scores — idempotency hook.
--    Gap logged as decision 10 in workflow-migration-table.md.
-- ---------------------------------------------------------------------------
-- Every other handler in the port dedupes a replayed event: tasks through
-- tasks_idempotency_idx (006), crs_results and bank_inbox by stashing the bus
-- event id as __event_id inside a jsonb column they already had,
-- commission_ledger and invoices through (org_id, idempotency_key).
-- behavior_scores had neither a unique constraint nor a jsonb column, so a
-- replayed round.started wrote a second row.
--
-- SHAPE: two typed columns rather than a jsonb bag. behavior_scores is a narrow
-- column-per-dimension table with no jsonb anywhere in it; adding one purely to
-- hold a single string would be the odd column out, and the id has to be indexed
-- regardless. `kind` follows the existing `kind` idiom on staff_events,
-- affiliate_events and outbound_calls.
--
-- `kind` is load-bearing, not decoration. BC-01 (responsiveness) and BC-02
-- (friction) are BOTH triggered by round.started, so for a given client they see
-- the SAME event id. Deduping on (client_id, source_event_id) alone would make
-- BC-02's insert collide with BC-01's and silently swallow the friction score.
ALTER TABLE behavior_scores ADD COLUMN IF NOT EXISTS kind            text;
ALTER TABLE behavior_scores ADD COLUMN IF NOT EXISTS source_event_id text;

COMMENT ON COLUMN behavior_scores.kind IS
  'Which score dimension this row carries: responsiveness (BC-01), friction (BC-02), motivation (BC-03, deferred). NULL for a combined nightly-scoring row that fills several columns at once.';
COMMENT ON COLUMN behavior_scores.source_event_id IS
  'Bus event id (event.id) that produced this row — the __event_id idiom used by crs_results.result and bank_inbox.raw, promoted to a column. NULL for rows not produced by an event (nightly scoring).';

-- A misspelled kind would silently defeat the dedupe below (a misspelling is just a
-- different key), so the allowed dimensions are pinned. NULL stays legal: it is
-- the honest value for a nightly row that is not per-dimension. Adding a fourth
-- dimension means extending this constraint.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'behavior_scores_kind_check') THEN
    ALTER TABLE behavior_scores ADD CONSTRAINT behavior_scores_kind_check
      CHECK (kind IS NULL OR kind IN ('responsiveness', 'friction', 'motivation'));
  END IF;
END $$;

-- Partial, mirroring idx_events_idem in 001_init.sql: dedupe applies only to rows
-- that actually name a source event. Rows written outside the event bus (nightly
-- scoring) leave source_event_id NULL and stay unconstrained — the whole point of
-- behavior_scores is a score history, so this must not become one-row-per-client.
--
-- NULLS NOT DISTINCT (as in 006_tasks_idempotency.sql) covers `kind`: a call site
-- that passes source_event_id but forgets kind still dedupes on replay instead of
-- slipping through on NULL <> NULL.
CREATE UNIQUE INDEX IF NOT EXISTS behavior_scores_source_event_idx
  ON behavior_scores (client_id, kind, source_event_id) NULLS NOT DISTINCT
  WHERE source_event_id IS NOT NULL;

-- CALL SITES (not changed here — both still write NULL into the two new columns,
-- so the index does not yet apply to them and replay still doubles a row):
--   src/workflows/bc-01-customer-responsiveness.mjs — recordScore() must insert
--     kind = 'responsiveness', source_event_id = event.id, plus
--       ON CONFLICT (client_id, kind, source_event_id)
--         WHERE source_event_id IS NOT NULL DO NOTHING
--   src/workflows/bc-02-customer-friction.mjs — same, kind = 'friction'.
--
-- The trailing WHERE is REQUIRED, not decoration: the index above is partial, and
-- Postgres will not infer a partial index unless the ON CONFLICT clause repeats
-- its predicate — omit it and the insert fails outright with "no unique or
-- exclusion constraint matching the ON CONFLICT specification". Same shape as the
-- existing ON CONFLICT (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL
-- in src/commissions/sql.mjs and src/invoices/index.mjs.
-- BC-01 writes at most once per run (the 24h "fast" branch returns before the
-- 48h branch), so a bare event.id is a sufficient key for it; it does not need
-- the `${eventId}:1` / `${eventId}:2` step discriminator that F-02 uses.
-- The known-gap test in bc-01-customer-responsiveness.test.mjs asserts the
-- CURRENT double-write and flips to a dedupe assertion with those call sites.

-- ---------------------------------------------------------------------------
-- 2. staff — round-robin rotation state.
--    Gap logged as decision 15 in workflow-migration-table.md; POD-01A (Lead
--    Intake & Setter Assignment) is BLOCKED on it.
-- ---------------------------------------------------------------------------
-- CHOICE: least-recently-assigned on staff, NOT a shared counter on orgs/settings.
--
-- A counter is the obvious shape and the wrong one here. Round-robin by
-- `counter++ % N` is only stable while N is: add or deactivate one rep and every
-- position after them re-maps, so somebody gets skipped and somebody gets served
-- twice — and the damage is invisible, because the counter still looks healthy.
-- The rotation this feeds is a live sales team, where mid-rotation membership
-- changes are the normal case, not the edge case.
--
-- Least-recently-assigned has no N in it. The rotation state lives on the person,
-- so membership changes are self-correcting:
--   * a new hire lands with last_assigned_at NULL, sorts first, and is picked next
--   * a departing rep drops out of the candidate set and moves nobody else
--   * a suspended rep resumes at their real position, not a re-mapped one
-- Over a stable roster it produces exactly the same cycle a counter would.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS assignment_order integer;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS last_assigned_at timestamptz;

COMMENT ON COLUMN staff.assignment_order IS
  'Optional manual position in the round-robin rotation; also the deterministic cold-start tie-break when several candidates have last_assigned_at NULL. NULL = unordered, sorts last among the untouched and falls through to the id tie-break.';
COMMENT ON COLUMN staff.last_assigned_at IS
  'When this staff member was last handed a round-robin assignment. The rotation state itself: oldest (NULL first) wins the next lead. Set by the assigning transaction, never by the updated_at trigger.';

-- Supports the pick below as an index-ordered scan. NULLS FIRST is explicit
-- because ASC defaults to NULLS LAST, and a never-assigned rep must sort first.
CREATE INDEX IF NOT EXISTS idx_staff_rotation
  ON staff (org_id, role, last_assigned_at NULLS FIRST, assignment_order NULLS LAST, id);

-- CALL SITES (POD-01A is not built; this is the query it is unblocked to use).
-- Eligibility is already expressible — `role` is from 001_init.sql and `status`
-- from db/schema/020_auth.sql — so no new eligibility flag is added here:
--
--   BEGIN;
--   SELECT id FROM staff
--    WHERE org_id = $1 AND role = $2 AND status = 'active'
--    ORDER BY last_assigned_at NULLS FIRST, assignment_order NULLS LAST, id
--    LIMIT 1
--      FOR UPDATE SKIP LOCKED;                  -- two leads at once ⇒ two reps
--   UPDATE staff SET last_assigned_at = now() WHERE id = $picked;
--   COMMIT;
--
-- FOR UPDATE SKIP LOCKED is the part that makes it a rotation rather than a
-- race: without it, concurrent intakes read the same oldest row and both assign
-- to the same rep. `now()` is transaction time, so the whole pick-and-stamp is
-- one atomic step.
--
-- FLAG for Darwin/Chris: assignment_order VALUES are a business decision (who
-- sits where in the rotation) and are deliberately left NULL — an unordered
-- roster still rotates correctly, just with an arbitrary first cycle. No seed
-- data is invented here.

-- ---------------------------------------------------------------------------
-- 3. cards — uniqueness behind moveCardToStage.
-- ---------------------------------------------------------------------------
-- moveCardToStage (src/workflows/cards.mjs) is a check-then-insert: SELECT the
-- client's card for the pipeline, UPDATE if found, INSERT if not. With nothing
-- enforcing uniqueness, two triggers firing concurrently for the same client
-- both miss on the SELECT and both INSERT, leaving the client on two cards in
-- one pipeline — and every later read takes an arbitrary one of them.
--
-- ALREADY PRESENT as of db/schema/007_cards_unique.sql, which creates this index
-- under this exact name. Repeated here deliberately and under the SAME name, so
-- that this statement is a true no-op wherever 007 has been applied while this
-- file still stands on its own. Do not rename it — a second index over the same
-- columns under a different name would be dead weight that ON CONFLICT ignores.
--
-- A unique index rather than an ALTER TABLE ... ADD CONSTRAINT: it is what 007
-- created, it is what 006/009/020 create for the same job elsewhere in this
-- schema, and ON CONFLICT (client_id, pipeline_id) infers from it identically.
CREATE UNIQUE INDEX IF NOT EXISTS cards_client_pipeline_idx
  ON cards (client_id, pipeline_id);

-- CALL SITES — every one of these needs ON CONFLICT, because a unique index
-- alone converts the silent duplicate into a hard 23505 on the losing insert:
--   src/workflows/cards.mjs — moveCardToStage(): the single INSERT INTO cards in
--     the codebase, and therefore the only place the clause is needed. It
--     already carries
--       ON CONFLICT (client_id, pipeline_id) DO UPDATE SET stage_id = EXCLUDED.stage_id
--     DO UPDATE, not DO NOTHING: the loser of the race must still land on its
--     requested stage, or the move is silently dropped.
--   Reached through that helper, so covered by it and needing no change of their
--   own: s-04-call-booked.mjs (S-04),
--   dpc-02-call-outcome-enforcement.mjs (DPC-02),
--   dpc-03-inbound-reply-router.mjs (DPC-03),
--   f-11-bank-email-event-router.mjs (F-11).

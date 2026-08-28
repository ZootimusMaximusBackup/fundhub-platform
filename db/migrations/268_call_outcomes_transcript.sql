-- 268_call_outcomes_transcript.sql — the column the Meet sweeper has been
-- writing to since 2026-08-26, which has never existed.
--
-- WHAT WAS BROKEN
--
-- src/sales/recordings.mjs:73 stampCallTranscript() runs
--     UPDATE call_outcomes SET transcript = $3 ...
-- and 147_call_outcomes.sql never created that column. Every call reached
-- Postgres and came back `error: column "transcript" does not exist`.
--
-- That is not dead code. The path is:
--     src/workflows/meet-transcript-sweeper.mjs   (cron */10 * * * *,
--       registered in src/workflows/index.mjs:16, so it runs on production)
--   → src/company-brain/meet-transcript.mjs:57
--   → src/sales/recordings.mjs:73
--
-- So a scheduled job has been failing every ten minutes since the sweeper
-- shipped, on any Google Meet transcript it could match to a client. Nobody saw
-- it because src/http/launch-proof-chain.pg.test.mjs — which catches exactly
-- this — sits in the *.pg.test.mjs suite, and that suite has not run since
-- ~2026-08-21: scripts/run-suite.mjs exits on the first unit failure before the
-- database tests start, and a stale adapter count kept unit red for six days.
--
-- WHY A COLUMN AND NOT A DELETION
--
-- The reader half already exists and is wired to a screen: src/sales/
-- unrecorded.mjs:18 treats a row with no recording link AND no transcript as an
-- unrecorded call, and reports "Logged sales call has no recording link and no
-- transcript". With no column, that check reads NULL forever and every logged
-- call looks unrecorded. The feature was built end to end; only the column is
-- missing.
--
-- SHAPE
--
-- Plain nullable text. NULL means "no transcript for this call", which is the
-- honest state for every row that exists today and for calls that are never
-- transcribed. Deliberately NOT defaulted to '' — src/sales/unrecorded.mjs
-- distinguishes NULL from empty via nonempty(), and a default would silently
-- reclassify every historic call.

ALTER TABLE call_outcomes
  ADD COLUMN IF NOT EXISTS transcript text;

COMMENT ON COLUMN call_outcomes.transcript IS
  'Spoken words of the call, written by the Meet transcript sweeper. NULL means no transcript exists for this call — never defaulted, because src/sales/unrecorded.mjs treats NULL and empty differently.';

-- 159_soft_pull_processing_status_check.sql
--
-- Pair to 158. Some databases kept the pre-157 status check, which lists
-- queued/fulfilled/failed/cancelled and refuses 'processing'. Claim cannot
-- land until 'processing' is an allowed status.

ALTER TABLE soft_pull_requests
  DROP CONSTRAINT IF EXISTS soft_pull_requests_status_check;

ALTER TABLE soft_pull_requests
  ADD CONSTRAINT soft_pull_requests_status_check CHECK (
    status IN ('queued', 'processing', 'fulfilled', 'failed', 'cancelled')
  );

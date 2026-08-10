-- 158_soft_pull_processing_resolved_ck.sql
--
-- 157 was recorded as applied on some databases while still carrying the 077
-- resolved_at rule (only 'queued' may have a null resolved_at). Claiming a
-- request into 'processing' then fails the check. Re-assert the 157 rule:
-- queued and processing are both unresolved.
--
-- Status allow-list is fixed in 159 (this migration already ran on a local DB
-- before that second gap was found).

ALTER TABLE soft_pull_requests
  DROP CONSTRAINT IF EXISTS soft_pull_requests_resolved_ck;

ALTER TABLE soft_pull_requests
  ADD CONSTRAINT soft_pull_requests_resolved_ck CHECK (
    (status IN ('queued', 'processing') AND resolved_at IS NULL)
    OR (status NOT IN ('queued', 'processing') AND resolved_at IS NOT NULL)
  );

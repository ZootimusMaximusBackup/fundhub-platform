-- 157_crs_result_identity.sql — one durable CRS result per provider response.
--
-- The provider's RequestID is the stable identity for one returned credit file.
-- Keeping it beside the raw result lets retries reuse the first row instead of
-- creating a second history row and ingesting the same file twice.

-- A provider order must be claimed before anything can go on the wire. Both
-- queued and processing are unresolved states: neither has a result or end
-- time, and either one blocks another open request for the same client.
ALTER TABLE soft_pull_requests
  DROP CONSTRAINT IF EXISTS soft_pull_requests_status_check,
  DROP CONSTRAINT IF EXISTS soft_pull_requests_resolved_ck;

ALTER TABLE soft_pull_requests
  ADD CONSTRAINT soft_pull_requests_status_check CHECK (
    status IN ('queued', 'processing', 'fulfilled', 'failed', 'cancelled')
  ),
  ADD CONSTRAINT soft_pull_requests_resolved_ck CHECK (
    (status IN ('queued', 'processing') AND resolved_at IS NULL)
    OR (status NOT IN ('queued', 'processing') AND resolved_at IS NOT NULL)
  );

DROP INDEX IF EXISTS uq_soft_pull_requests_one_open;
CREATE UNIQUE INDEX uq_soft_pull_requests_one_open
  ON soft_pull_requests (client_id)
  WHERE status IN ('queued', 'processing');

ALTER TABLE crs_results
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_result_id text;

ALTER TABLE crs_results
  ADD CONSTRAINT crs_results_provider_identity_ck CHECK (
    (provider IS NULL AND provider_result_id IS NULL)
    OR (provider IS NOT NULL AND provider_result_id IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_crs_results_provider_identity
  ON crs_results (org_id, provider, provider_result_id)
  WHERE provider IS NOT NULL AND provider_result_id IS NOT NULL;

-- Refuse an ambiguous history instead of choosing one request and silently
-- discarding the others. A migration failure leaves every audit row untouched.
DO $$
BEGIN
  IF EXISTS (
    SELECT crs_result_id
      FROM soft_pull_requests
     WHERE crs_result_id IS NOT NULL
     GROUP BY crs_result_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'cannot enforce one soft-pull request per CRS result: duplicate crs_result_id values exist';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_soft_pull_requests_crs_result
  ON soft_pull_requests (crs_result_id)
  WHERE crs_result_id IS NOT NULL;

COMMENT ON COLUMN crs_results.provider IS
  'Provider namespace for provider_result_id. Both fields are null for legacy unanchored rows.';
COMMENT ON COLUMN crs_results.provider_result_id IS
  'Provider response identity, such as the CRS SoftView RequestID. Replays reuse this result row.';

-- 299_hiring_apply_attempts.sql — durable per-IP rate limit for the careers door.
--
-- src/hiring/apply-public.mjs's burst limiter needs state that survives cold
-- starts and is shared across serverless instances. An in-process Map resets on
-- every deploy and is not shared between warm instances, so a distributed flood
-- walks right through it.
--
-- Records attempt IDENTITY only — org and source address. No applicant email,
-- name, or phone: those belong in candidates, and an IP on a rate-limit row is
-- one more piece of data about a person we would then have to defend.
--
-- Every submission that reaches the limiter is counted, accepted or refused.
-- A limiter that only counts successes is one an attacker never trips.

CREATE TABLE IF NOT EXISTS hiring_apply_attempts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id),
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hiring_apply_attempts_ip
  ON hiring_apply_attempts (org_id, ip, created_at DESC)
  WHERE ip IS NOT NULL;

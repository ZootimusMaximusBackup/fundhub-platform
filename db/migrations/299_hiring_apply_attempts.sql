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

-- Row lock declared here, in the file that creates the table, so a switch flipped
-- from the Supabase dashboard later has nothing to break: rls-shape.test.mjs fails
-- any production build where a table is RLS-on with no policy, and that failed six
-- builds on 2026-09-06 (see 364_hiring_rls_policies.sql). Per-IP rate limit, no
-- org scope, so the policy is permissive like every other hiring table.
ALTER TABLE hiring_apply_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE hiring_apply_attempts FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hiring_apply_attempts_app_all ON hiring_apply_attempts;
CREATE POLICY hiring_apply_attempts_app_all ON hiring_apply_attempts FOR ALL USING (true) WITH CHECK (true);

-- Owner-set (Chris, 2026-08-19): put Chris on the closer boards.
--
-- WHY THIS FILE EXISTS AND IS NOT A MIGRATION. T12 was allocated no migration
-- numbers, and this is one company's roster row rather than a schema change, so
-- it is a one-time statement rather than db/migrations/NNN_*.sql.
--
-- WHAT IT DOES. src/sales/metrics.mjs recognises the owner-set closer by
-- email 'chris@fundhub.ai' OR name 'Chris Stanbridge' (OWNER_SET_CLOSER), and
-- the Sales Floor roster additionally requires status='active'. This adds that
-- row if it is missing, or activates it if it exists and is not active. It
-- never changes an existing row's role.
--
-- IT DOES NOT CREATE A LOGIN. No password_hash is set, so this row cannot sign
-- in. Signing in needs status='active' AND password_hash IS NOT NULL — issue a
-- credential through src/auth/invite.mjs, not through this file.
--
-- Safe to run more than once.

BEGIN;

-- Already there but not active? Activate it, and correct the display name.
UPDATE staff
   SET status     = 'active',
       name       = 'Chris Stanbridge',
       updated_at = now()
 WHERE org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1)
   AND lower(btrim(email)) = 'chris@fundhub.ai';

-- Not there at all? Add it.
INSERT INTO staff (org_id, name, email, role, status)
SELECT o.id, 'Chris Stanbridge', 'chris@fundhub.ai', 'owner', 'active'
  FROM orgs o
 WHERE o.is_default
   AND NOT EXISTS (
     SELECT 1 FROM staff s
      WHERE s.org_id = o.id AND lower(btrim(s.email)) = 'chris@fundhub.ai'
   );

-- Show the result before committing.
SELECT name, email, role, status,
       (password_hash IS NOT NULL) AS can_sign_in
  FROM staff
 WHERE org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1)
   AND lower(btrim(email)) = 'chris@fundhub.ai';

-- Who the Sales Floor board will now show (the exact predicate from
-- closerRoster() in src/sales/metrics.mjs after this branch):
SELECT s.name, s.email, s.role, s.status
  FROM staff s
 WHERE s.org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1)
   AND s.status = 'active'
   AND (lower(btrim(s.role)) = 'closer'
        OR lower(btrim(s.email)) = 'chris@fundhub.ai'
        OR lower(btrim(s.name))  = 'chris stanbridge');

COMMIT;

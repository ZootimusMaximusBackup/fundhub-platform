-- 111_sales_manager_role.sql — builds the sales_manager role.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THIS REVERSES A RECORDED OWNER DECISION, ON THE OWNER'S INSTRUCTION
--
-- docs/journeys/role-sales-manager-actual.md carries a decision dated
-- 2026-07-31: the role is planned, it stays tracked, and "no agent should
-- create a sales_manager role, add it to a ROLE_SETS value, or write endpoints
-- for it ON ITS OWN INITIATIVE." scripts/journeys/generate.test.mjs enforced
-- that by failing if the string appeared anywhere under src/, api/ or db/.
--
-- That guard is about agent initiative, and this is not agent initiative. The
-- owner directed the build in Ticket 8, which states the resolution explicitly:
-- "The correct resolution is to build the role, not to remove it from the
-- editor." So the premise of the guard is spent, and the guard is inverted
-- rather than deleted — generate.test.mjs now asserts the role is wired
-- consistently everywhere instead of asserting it is absent.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THE ROLE IS
--
-- A real role in the business: it owns the Sales pipeline and the closers
-- under it. Three parts of the system already assumed it existed — CLAUDE.md
-- §4 tracks a sales-manager journey, `npm run journeys` generates a page for
-- it, and the staff-teams permission matrix lists it — while the code had
-- nothing, so a journey step assigning to it assigned to nobody.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- COMMISSION VISIBILITY IS AN OWNER DECISION, ALREADY MADE (H-6)
--
-- Ticket 8 flags this as a human call an agent must not make. It was made:
-- sales_manager joins ROLE_SETS.FINANCE with COMPANY-WIDE scope, not limited
-- to their own team's closers. The owner's reasoning, recorded verbatim:
-- closers are the only commissioned staff, so team-wide and company-wide are
-- the same set of people here and the distinction is currently moot.
--
-- Recorded as decided. Not to be re-raised.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 094_demo_logins.sql IS ALREADY APPLIED, so its staff list cannot be edited —
-- migrate.mjs keys schema_migrations on <dir>/<file> and an edit to an applied
-- file is a silent no-op. The demo login is added here instead, in the same
-- guarded style, which is why this file both extends a catalog and seeds a row.

-- 1. The catalog. Same additive, guarded shape as 036_partner_role.sql.
INSERT INTO staff_roles (org_id, key, name, description, sort_order)
SELECT o.id, v.key, v.name, v.description, v.sort_order
  FROM orgs o
  CROSS JOIN (VALUES
    ('sales_manager', 'Sales Manager', 'Owns the Sales pipeline and the closers under it.', 15)
  ) AS v(key, name, description, sort_order)
 WHERE o.is_default
   AND NOT EXISTS (
     SELECT 1 FROM staff_roles r
      WHERE r.org_id = o.id AND lower(r.key) = lower(v.key)
   );

-- 2. Task routing. 041_task_routing.sql constrains tasks.assignee_role to a
-- fixed list; without this a task routed to a sales manager is rejected by the
-- database, which is a runtime failure rather than a missing feature.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_assignee_role_ck;
ALTER TABLE tasks
  ADD CONSTRAINT tasks_assignee_role_ck
  CHECK (assignee_role IS NULL OR assignee_role IN
    ('owner', 'admin', 'funding_advisor', 'closer', 'inquiry_specialist', 'setter', 'sales_manager'));

-- 3. The demo login, matching the six seeded by 094_demo_logins.sql. The role
-- string must match public/app/shell.js ROLE_TABS character for character —
-- the shell folds with lower(btrim()) and an unrecognised role falls back to
-- the shared staff tabs, hiding the very thing being reviewed.
-- src/http/demo-logins.test.mjs fails if these drift apart.
DO $$
DECLARE
  v_org  uuid;
  v_hash text;
BEGIN
  SELECT id INTO v_org FROM orgs WHERE is_default LIMIT 1;
  IF v_org IS NULL THEN RETURN; END IF;

  -- Reuse whatever hash the existing demo staff already carry rather than
  -- embedding a second copy of the demo password in another migration.
  SELECT password_hash INTO v_hash FROM staff
   WHERE org_id = v_org AND is_demo = true AND password_hash IS NOT NULL
   LIMIT 1;
  IF v_hash IS NULL THEN RETURN; END IF;  -- 094 has not run; nothing to match

  INSERT INTO staff (org_id, email, name, role, status, password_hash, is_demo)
  SELECT v_org, 'sales@demo.fundhub.local', 'DEMO Sales Manager', 'sales_manager', 'active', v_hash, true
   WHERE NOT EXISTS (
     SELECT 1 FROM staff s
      WHERE s.org_id = v_org AND lower(s.email) = 'sales@demo.fundhub.local'
   );
END $$;

COMMENT ON CONSTRAINT tasks_assignee_role_ck ON tasks IS
  'employee roles that may own a task; extended with sales_manager by 111_sales_manager_role.sql';

-- 290_csm_role.sql — builds the csm (Client Success Manager) role.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THE ROLE IS
--
-- The only staff member who talks to a client AFTER the sale. Owner-described
-- 2026-09-05: a recorded mid-service check-in, then a post interview that
-- collects results, collects unpaid money, and upsells — one call, not two.
-- Outbound to existing clients in whatever time is left.
--
-- It is NOT a setter. Owner-set the same day: setting is done by AI
-- (src/workflows/ai-set-01-josh-setter.mjs), not by a person, and the human
-- 'setter' catalog row stays only because seeded rows already carry it.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THE ROLE IS THE MISSING PIECE AND NOT THE FEATURE
--
-- 166_customer_insights.sql already built the table this role writes to —
-- stage IN ('mid','post'), answers, meeting_url, recording_url, recorded_by —
-- and its header says "a round.funded handler creates a funding-advisor task
-- to run the Google Meet interview". That handler was never written, so the
-- table has no producer. src/workflows/ar-collections.mjs already runs the
-- AR-01..AR-04 dunning ladder and its AR-04 step ends by tagging the client
-- and stopping, because there was nobody to hand to.
--
-- Both gaps are the same gap: work with no owner. This file creates the owner.
-- The handlers that fill it are csm-01/csm-02 in src/workflows/.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- SHAPE COPIED FROM 112_sales_manager_role.sql, INCLUDING WHY
--
-- 094_demo_logins.sql is already applied, so its staff list cannot be edited —
-- migrate.mjs keys schema_migrations on <dir>/<file> and an edit to an applied
-- file is a silent no-op. The demo login is therefore added here, which is why
-- this file both extends a catalog and seeds a row.
--
-- NOT DONE HERE, ON PURPOSE: shell.js ROLE_TABS gets no 'csm' entry yet. The
-- drift test in src/auth/role-catalog-drift.pg.test.mjs runs one way only —
-- every role shell.js grants tabs to must exist in the catalog, not the
-- reverse — so a catalog row with no tabs entry is legal and simply falls back
-- to the shared staff tabs. The CSM screen is step 5 of the build, last.

-- 1. The catalog. Same additive, guarded shape as 112 and 036_partner_role.sql.
--    sort_order 25 puts it between funding_advisor (20) and inquiry_specialist
--    (30): the CSM picks the client up where the advisor puts them down.
INSERT INTO staff_roles (org_id, key, name, description, sort_order)
SELECT o.id, v.key, v.name, v.description, v.sort_order
  FROM orgs o
  CROSS JOIN (VALUES
    ('csm', 'Client Success Manager',
     'Owns the client after the sale: mid-service check-in, results interview, collections and upsell.',
     25)
  ) AS v(key, name, description, sort_order)
 WHERE o.is_default
   AND NOT EXISTS (
     SELECT 1 FROM staff_roles r
      WHERE r.org_id = o.id AND lower(r.key) = lower(v.key)
   );

-- 2. Task routing. 041_task_routing.sql constrains tasks.assignee_role to a
-- fixed list and 112 widened it once already; without this a task routed to a
-- CSM is rejected by the database, which is a runtime failure rather than a
-- missing feature.
--
-- EMPLOYEE_ROLES in src/lib/create-task.mjs is the JavaScript half of this
-- constraint and 112's own comment says the two must stay in step. They are
-- widened in this order deliberately: the database accepting a role the code
-- does not yet send is harmless, the reverse throws at runtime.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_assignee_role_ck;
ALTER TABLE tasks
  ADD CONSTRAINT tasks_assignee_role_ck
  CHECK (assignee_role IS NULL OR assignee_role IN
    ('owner', 'admin', 'funding_advisor', 'closer', 'inquiry_specialist',
     'setter', 'sales_manager', 'csm'));

-- 3. The demo login, matching the seven now seeded by 094 + 112. The role
-- string is lower-case with no spaces because shell.js folds with
-- lower(btrim()) and an unrecognised role falls back to the shared staff tabs.
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
  SELECT v_org, 'csm@demo.fundhub.local', 'DEMO Client Success Manager', 'csm', 'active', v_hash, true
   WHERE NOT EXISTS (
     SELECT 1 FROM staff s
      WHERE s.org_id = v_org AND lower(s.email) = 'csm@demo.fundhub.local'
   );
END $$;

COMMENT ON CONSTRAINT tasks_assignee_role_ck ON tasks IS
  'employee roles that may own a task; extended with sales_manager by 112_sales_manager_role.sql and csm by 290_csm_role.sql';

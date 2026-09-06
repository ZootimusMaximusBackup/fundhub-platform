-- 294_hiring_role_brief_and_owner.sql — who owns a hiring req, and what the role IS.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS FILE EXISTS
--
-- 051_hiring.sql gave hiring_roles a hiring_manager_staff_id and then never
-- filled it in. Its own health view says so: v_hiring_config_gaps (051:728)
-- reports 'no hiring manager assigned to <key>' for every active role, which is
-- every role, because the seed at 051:148 sets only key, name and bench_target.
-- So the column exists, nothing reads it, and nothing writes it.
--
-- Owner-described 2026-09-05: "depending on the role — if it's a sales rep or
-- CSM or something like that, it goes to Sarah, or the role, which would be the
-- sales manager. If it's anything other than that, it goes to either a hiring
-- manager or the COO. For now it's just give the COO, which is me, the CEO."
--
-- That is a rule about ROLES, not about people, so it is stored as a role. A
-- person can still be named on top of it — see the resolution order below.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RESOLUTION ORDER (implemented in src/hiring/owner.mjs, not here)
--
--   1. hiring_manager_staff_id — a specific person was named for this req.
--   2. owner_role               — the standing rule for this kind of role.
--   3. 'owner'                  — the backstop. Chris until there is a COO.
--
-- Step 3 is why owner_role is NOT NULL with a default rather than nullable: a
-- req that routes nowhere is a req nobody works, and that failure is silent.
-- The default is 'owner' precisely because being wrong in that direction wakes
-- the owner up, and being wrong the other way loses the candidate.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE BRIEF, AND WHY IT HAS A HISTORY TABLE
--
-- Owner-described the same day: "we could put a little prompt to understand
-- what the role is, and then the AI could track it to augment the role as it
-- goes."
--
-- role_brief is that prompt: plain English describing the job, who is good at
-- it, and what to screen for. It is read when a posting is written and when a
-- candidate is contacted, so one edit changes both.
--
-- hiring_role_brief_revisions keeps every version. Two reasons, and the second
-- is the load-bearing one:
--
--   1. "Augment as it goes" means something is rewriting this text over time.
--      Overwriting in place would silently lose what a human wrote.
--   2. A job description is evidence in an employment claim. If a brief is
--      edited after a rejection, the version that was live AT THE TIME is the
--      one that matters, and a single mutable column cannot answer that.
--
-- Revisions are additive and never updated — see the guard trigger at the end.

-- ---------------------------------------------------------------------------
-- 1. The two new columns on hiring_roles
-- ---------------------------------------------------------------------------

ALTER TABLE hiring_roles ADD COLUMN IF NOT EXISTS role_brief text;

ALTER TABLE hiring_roles
  ADD COLUMN IF NOT EXISTS owner_role text NOT NULL DEFAULT 'owner';

-- Kept in step with tasks_assignee_role_ck (041_task_routing.sql, widened by
-- 112_sales_manager_role.sql and 290_csm_role.sql) and with EMPLOYEE_ROLES in
-- src/lib/create-task.mjs. A hiring req that routes to a role which cannot own
-- a task would produce a to-do the database then rejects.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hiring_roles_owner_role_ck'
  ) THEN
    ALTER TABLE hiring_roles
      ADD CONSTRAINT hiring_roles_owner_role_ck
      CHECK (owner_role IN
        ('owner', 'admin', 'funding_advisor', 'closer', 'inquiry_specialist',
         'setter', 'sales_manager', 'csm'));
  END IF;
END $$;

COMMENT ON COLUMN hiring_roles.owner_role IS
  'Standing rule for who owns this req when no person is named in hiring_manager_staff_id. Owner-set 2026-09-05: sales-facing roles to sales_manager, everything else to owner.';
COMMENT ON COLUMN hiring_roles.role_brief IS
  'Plain-English description of the job, read when writing a posting and when contacting a candidate. Edited through hiring_role_brief_revisions, never in place.';

-- ---------------------------------------------------------------------------
-- 2. Brief history
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hiring_role_brief_revisions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  role_id       uuid NOT NULL REFERENCES hiring_roles(id) ON DELETE CASCADE,

  brief         text NOT NULL,

  -- WHO CHANGED IT. Exactly one of these is set, enforced below. An automated
  -- revision must say which agent made it, because "the AI augmented the role"
  -- is only auditable if the specific agent is named.
  revised_by_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
  revised_by_agent    text,

  -- Why, in one line. Required for both humans and agents: a diff without a
  -- reason cannot be reviewed, only re-read.
  reason        text NOT NULL,

  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT hiring_brief_rev_brief_ck CHECK (btrim(brief) <> ''),
  CONSTRAINT hiring_brief_rev_reason_ck CHECK (btrim(reason) <> ''),
  CONSTRAINT hiring_brief_rev_author_ck CHECK (
    (revised_by_staff_id IS NOT NULL AND revised_by_agent IS NULL) OR
    (revised_by_staff_id IS NULL AND revised_by_agent IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS hiring_brief_rev_role_idx
  ON hiring_role_brief_revisions (role_id, created_at DESC);

-- APPEND ONLY. An edited history is not a history. This is a trigger rather
-- than a convention because the whole point of the table is to be trustworthy
-- when someone is looking for evidence that it was tampered with.
--
-- THE CASCADE EXCEPTION. A blanket block also blocks the ON DELETE CASCADE from
-- hiring_roles, which makes a role with any brief history undeletable — that
-- took out demo wipe and every test fixture before this exception existed.
-- Postgres fires this trigger AFTER the parent row is gone, so the parent's
-- absence is what separates "the role was deleted" from "someone is deleting
-- history while the role still exists". Only the first is allowed.
CREATE OR REPLACE FUNCTION hiring_brief_rev_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM hiring_roles WHERE id = OLD.role_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'hiring_role_brief_revisions is append-only: % is not allowed', TG_OP;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hiring_brief_rev_append_only ON hiring_role_brief_revisions;
CREATE TRIGGER trg_hiring_brief_rev_append_only
  BEFORE UPDATE OR DELETE ON hiring_role_brief_revisions
  FOR EACH ROW EXECUTE FUNCTION hiring_brief_rev_append_only();

-- ---------------------------------------------------------------------------
-- 3. Apply the owner's routing rule to the roles that exist
-- ---------------------------------------------------------------------------
-- Sales-facing seats go to the sales manager. 051:148 seeded closer, setter and
-- sales_coordinator; csm is added below. Everything else keeps the 'owner'
-- default, which is the rule for "anything other than that".
--
-- Guarded on owner_role = 'owner' so this only ever moves a role off the
-- default. Re-running after someone re-points a req by hand will not undo them.

UPDATE hiring_roles
   SET owner_role = 'sales_manager', updated_at = now()
 WHERE key IN ('closer', 'setter', 'sales_coordinator', 'csm')
   AND owner_role = 'owner';

-- ---------------------------------------------------------------------------
-- 4. The CSM req
-- ---------------------------------------------------------------------------
-- 290_csm_role.sql created csm as a STAFF role — a seat a person can hold.
-- This is the separate thing: a req we recruit against. Both are needed and
-- neither implies the other; sales_manager has a staff role and no req, because
-- we are not currently hiring one.
--
-- bench_target 2 rather than the 4 the sales seats carry: doc 10's "4-5 on the
-- bench" is about closers, where churn is the norm. Copying 4 here would open a
-- standing task to keep two spare client success managers warm, which nobody
-- asked for.

INSERT INTO hiring_roles (org_id, key, name, bench_target, owner_role)
SELECT o.id, 'csm', 'Client Success Manager', 2, 'sales_manager'
  FROM orgs o
 WHERE o.is_default
   AND NOT EXISTS (
     SELECT 1 FROM hiring_roles r WHERE r.org_id = o.id AND r.key = 'csm'
   );

-- ---------------------------------------------------------------------------
-- 5. Briefs are NOT seeded. On purpose.
-- ---------------------------------------------------------------------------
-- Same reasoning 051 gives for leaving scorecard and comp empty: the real
-- outcomes live in the owner's scorecard docs, and an invented brief would put
-- made-up words about the job in front of a real candidate and into a real job
-- advert. v_hiring_config_gaps already reports the empty ones; the extension
-- below makes an empty brief visible the same way.

-- COLUMN SHAPE IS FIXED AND IT IS 052's, NOT 051's.
-- 052_config_defaults.sql already replaced this view and added a fifth column,
-- `status`. CREATE OR REPLACE VIEW cannot add, drop or reorder columns, so the
-- first three arms below are 052's definition reproduced exactly — including
-- the two helper functions it defines — and only the fourth arm is new.
-- Reproducing rather than referencing is forced by Postgres, not preferred.
CREATE OR REPLACE VIEW v_hiring_config_gaps AS
SELECT r.org_id,
       'hiring_roles.' || r.key AS config,
       CASE
         WHEN r.scorecard = '{}'::jsonb THEN 'scorecard is empty'
         ELSE 'scorecard structure set in 052, but at least one TARGET is null'
       END AS detail,
       'STRUCTURE ONLY — doc 7 links to external scorecard docs that were not in the folder' AS status,
       'do not extend an offer against a scorecard with no targets' AS consequence
  FROM hiring_roles r
 WHERE r.active AND hiring_scorecard_has_null_target(r.scorecard)
UNION ALL
SELECT r.org_id,
       'hiring_roles.' || r.key || '.comp' AS config,
       'comp figures are null' AS detail,
       'UNSOURCED — doc 6 describes the method, not the numbers' AS status,
       'OTE cannot be quoted to a candidate' AS consequence
  FROM hiring_roles r
 WHERE r.active AND hiring_comp_has_null_figure(r.comp)
UNION ALL
-- CONSEQUENCE DOWNGRADED BY 294. Before this file an unassigned req routed
-- nowhere, so 052 said "bench alerts have nobody to route to" — which was true.
-- owner_role now catches it, so the honest consequence is that it falls to the
-- standing rule, not that it is lost. Leaving the old wording would keep an
-- alarm ringing about a hole this migration filled.
SELECT o.id AS org_id,
       'hiring_roles.hiring_manager_staff_id' AS config,
       'no named hiring manager for ' || r.key || ' — routing to ' || r.owner_role AS detail,
       'FALLING BACK TO THE RULE' AS status,
       'nobody is personally accountable; the role queue picks it up' AS consequence
  FROM orgs o JOIN hiring_roles r ON r.org_id = o.id
 WHERE o.is_default AND r.active AND r.hiring_manager_staff_id IS NULL
UNION ALL
-- New in 294. A req with no brief can still be worked by a human who knows the
-- job; it is the posting text and the candidate outreach that have nothing to
-- say, so the consequence names those rather than claiming the req is broken.
SELECT o.id AS org_id,
       'hiring_roles.role_brief' AS config,
       'no role brief written for ' || r.key AS detail,
       'UNSET' AS status,
       'job postings and candidate outreach have no description to work from' AS consequence
  FROM orgs o JOIN hiring_roles r ON r.org_id = o.id
 WHERE o.is_default AND r.active
   AND (r.role_brief IS NULL OR btrim(r.role_brief) = '');

COMMENT ON VIEW v_hiring_config_gaps IS
  'Hiring config a human still has to fill in. Extended by 294 with role_brief. Read by the Hiring screen.';

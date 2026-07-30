-- 051_hiring.sql — the always-on inbound recruiting pipeline.
--
-- BUILT FROM THE SIXTEEN SOURCE DOCS, not invented. The funnel, the stages, the
-- grading rubric and the scorecard model all come from the Recruiting & Hiring
-- library in Drive. Where the docs contradict each other, the newer one wins and
-- the conflict is recorded here rather than silently resolved — see MOCK CALLS.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- THIS IS AN AUTOMATED EMPLOYMENT DECISION TOOL. READ BEFORE CHANGING IT.
--
-- Scoring and ranking job applicants is regulated in a way that scoring ad
-- creative is not. Title VII adverse-impact liability attaches regardless of
-- intent; NYC Local Law 144 requires an annual independent bias audit and
-- candidate notice for any AEDT used to screen; Illinois, Maryland and Colorado
-- have their own rules. So this schema is built on one hard invariant:
--
--   NO CANDIDATE IS EVER REJECTED BY SOFTWARE.
--
-- The grader produces a SCORE and a RECOMMENDATION. It never produces a
-- rejection. hiring_decisions requires a human `decided_by` on every adverse
-- outcome, enforced by CHECK — not by convention, and not by a UI that could be
-- bypassed by a script. An auto-disqualification rule flags for review; it does
-- not close the application.
--
-- Everything the grader looked at is retained on the row (rubric version, per
-- category scores, the answers as submitted) so a disparate-impact analysis or a
-- bias audit is possible after the fact. A scoring system whose inputs are not
-- retained cannot be audited, and an unauditable AEDT is the legal exposure.
-- ══════════════════════════════════════════════════════════════════════════════
--
-- WHY NOT `cards`. The backlog says "own pipeline in cards/pipelines — add a
-- Hiring pipeline row, not a new system". Half of that is honoured and half is
-- not, deliberately: the hiring PIPELINE and its STAGES are rows in the existing
-- pipelines/pipeline_stages tables, so the rail renders in the board, galaxy and
-- automations screens with no new concepts. But `cards.client_id` is NOT NULL and
-- references clients — a job candidate is not a client, and making one to satisfy
-- a foreign key would put candidates in the closer queue and in every client
-- count in the platform. So applications carry their own stage_id into
-- pipeline_stages instead.
--
-- HIRING IS SPLIT OFF FROM AFFILIATES. 002_pipelines seeded one rail,
-- 'affiliates_hiring' (R-07), covering both. A referral and a candidate share
-- nothing but a screen. This migration adds a dedicated 'hiring' pipeline and
-- leaves R-07 to affiliates; the old rail keeps its three stages so nothing that
-- reads it breaks.
--
-- ORG-SCOPED, STAFF-ONLY. No partner_id and no RLS policy, unlike the creative
-- module: these are fundhub's own hires. Candidate PII is protected by the
-- endpoint role gate (recruiting roles only) and by column-level redaction, not
-- by tenancy. If partner-run hiring is ever wanted, that is a partner_id column
-- and a policy — do not repurpose these tables by loosening the role gate.

-- ---------------------------------------------------------------------------
-- A. The hiring pipeline and its stages
-- ---------------------------------------------------------------------------
--
-- THE FUNNEL, from "The Ultimate Guide To Recruiting & Hiring A-Player Setters &
-- Closers" (doc 10) and "Group Interview Training" (doc 11):
--
--   Applied → Screening (app + DISC + optional video) → Group Interview
--     → 1:1 Interview → Offer → Hired → Onboarding → Ramp (60-day trial)
--     → Performing
--
-- MOCK CALLS ARE DEPRECATED AND DELIBERATELY ABSENT. Doc 10 lists "Interview #2 —
-- Mock Triage Call // Scorecard Interview" as a stage. Doc 9 (Recruiting & Hiring
-- Overview) carries an explicit "Important Update: We no longer recommend Mock
-- Calls for interviewing — they produced MANY false positives and false negatives.
-- Added complexity and time requirement for no extra benefit. We no longer do it
-- internally in our company, either." Doc 11 independently lists "They need to
-- have a great mock call" under MISCONCEPTIONS.
--
-- Two of three sources retire it and one of those is an explicit correction, so
-- the stage is not seeded. The stage KEY is kept in the CHECK below so a team that
-- wants it back can insert the row without a migration.

WITH org AS (SELECT id AS oid FROM orgs WHERE slug = 'fundhub')
INSERT INTO pipelines (org_id, key, name)
SELECT oid, 'hiring', 'Hiring' FROM org
ON CONFLICT (org_id, key) DO NOTHING;

WITH org AS (SELECT id AS oid FROM orgs WHERE slug = 'fundhub')
INSERT INTO pipeline_stages (org_id, pipeline_id, key, name, sort_order)
SELECT org.oid, p.id, s.key, s.name, s.ord
FROM org
JOIN pipelines p ON p.org_id = org.oid AND p.key = 'hiring'
JOIN (VALUES
  ('applied',           'Applied',            0),
  ('screening',         'Screening',          1),
  ('group_interview',   'Group Interview',    2),
  ('one_on_one',        '1:1 Interview',      3),
  ('offer',             'Offer',              4),
  ('hired',             'Hired',              5),
  ('onboarding',        'Onboarding',         6),
  ('ramp',              'Ramp (60-day trial)',7),
  ('performing',        'Performing',         8),
  ('rejected',          'Not Moving Forward', 9),
  ('withdrawn',         'Withdrawn',         10)
) AS s(key, name, ord) ON true
ON CONFLICT (pipeline_id, key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- B. hiring_roles — the positions, with their scorecards
-- ---------------------------------------------------------------------------
--
-- SCORECARDS ARE FROM "WHO", per doc 7: a clear agreement of the OUTCOMES
-- (lagging indicators) the position owns, plus the LEADING indicators required to
-- reach them. Stored as jsonb rather than columns because each role's scorecard
-- has a different shape, and the docs treat the scorecard as a living document.
--
-- The scorecard content itself is NOT seeded. Doc 7 links to two external Google
-- Docs (Closer Scorecard, Setter Scorecard) that hold the actual outcomes and
-- numbers; those are the source of truth and they are not in the library folder.
-- Seeding invented outcomes would put made-up performance agreements in front of
-- real candidates. v_hiring_config_gaps surfaces the empty ones.

CREATE TABLE IF NOT EXISTS hiring_roles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),

  key           text NOT NULL,
  name          text NOT NULL,

  -- Whose lane this req belongs to (backlog: "Sarah's lane (closers) + Chris's
  -- lane"). A staff id rather than a name string so it survives someone leaving.
  hiring_manager_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,

  -- { outcomes: [...], leading_indicators: [...] } — see doc 7.
  scorecard     jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- { base, commission, ote, notes } — doc 6, Determining OTE & Comp Structure.
  comp          jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- "Always be recruiting… ideally have 4-5 potential reps on your bench"
  -- (doc 10). This is what makes the pipeline always-on rather than reactive:
  -- src/hiring/bench.mjs opens a task when the bench falls below target.
  bench_target  integer NOT NULL DEFAULT 4,

  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT hiring_roles_key_ck CHECK (key = lower(btrim(key)) AND key <> ''),
  CONSTRAINT hiring_roles_bench_ck CHECK (bench_target >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS hiring_roles_key_uniq ON hiring_roles (org_id, key);

-- The three positions the docs describe. Scorecard and comp deliberately empty.
INSERT INTO hiring_roles (org_id, key, name, bench_target)
SELECT o.id, v.k, v.n, 4
  FROM orgs o
  CROSS JOIN (VALUES
    ('closer',            'Closer'),
    ('setter',            'Setter'),
    ('sales_coordinator', 'Sales Coordinator')
  ) AS v(k, n)
 WHERE o.is_default
   AND NOT EXISTS (SELECT 1 FROM hiring_roles r WHERE r.org_id = o.id AND r.key = v.k);

-- ---------------------------------------------------------------------------
-- C. candidates — the person
-- ---------------------------------------------------------------------------
--
-- SEPARATE FROM THE APPLICATION on purpose. Doc 10's whole thesis is a standing
-- bench and repeat contact: "Can Setters Turn Into Closers" (doc 5) is a person
-- applying twice for different roles, and a candidate declined for closer today
-- may be the right setter next quarter. One row per person, many applications.
--
-- PII lives here and nowhere else, so a retention sweep has one table to work on.

CREATE TABLE IF NOT EXISTS candidates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),

  full_name     text NOT NULL,
  email         text NOT NULL,
  phone         text,

  -- Sourcing, in the order doc 10 prescribes: referral → client base → audience
  -- → broad social → ads & job boards. Stored so the funnel can be measured by
  -- source, which is the point of prescribing an order.
  source        text NOT NULL DEFAULT 'inbound',
  source_detail text,
  referred_by_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,

  linkedin_urn      text,
  linkedin_profile_url text,

  -- DISC, from the Initial Application step. "DI on disc is a bonus" (doc 10) —
  -- a bonus, never a filter, and never an auto-disqualifier.
  disc_profile  text,

  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT candidates_email_ck CHECK (email = lower(btrim(email)) AND email <> ''),
  CONSTRAINT candidates_name_ck  CHECK (btrim(full_name) <> ''),
  CONSTRAINT candidates_source_ck CHECK (source IN
    ('referral', 'client_base', 'audience', 'social', 'job_board', 'ads', 'linkedin', 'recruiter', 'inbound'))
);

CREATE UNIQUE INDEX IF NOT EXISTS candidates_email_uniq ON candidates (org_id, email);
CREATE UNIQUE INDEX IF NOT EXISTS candidates_linkedin_uniq
  ON candidates (org_id, linkedin_urn) WHERE linkedin_urn IS NOT NULL;
CREATE INDEX IF NOT EXISTS candidates_source_idx ON candidates (org_id, source);

-- ---------------------------------------------------------------------------
-- D. candidate_applications — one application to one role
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS candidate_applications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  candidate_id  uuid NOT NULL REFERENCES candidates(id) ON DELETE RESTRICT,
  role_id       uuid NOT NULL REFERENCES hiring_roles(id) ON DELETE RESTRICT,

  -- The stage, in the SHARED pipeline_stages table — see the header for why this
  -- is not a `cards` row.
  stage_id      uuid NOT NULL REFERENCES pipeline_stages(id),
  entered_stage_at timestamptz NOT NULL DEFAULT now(),

  -- The application as submitted, verbatim. Retained because a bias audit has to
  -- be able to re-derive a score from the same inputs the grader saw.
  answers       jsonb NOT NULL DEFAULT '{}'::jsonb,
  video_url     text,
  resume_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,

  -- 'open' while in play; the terminal states are set only by a human decision.
  status        text NOT NULL DEFAULT 'open',

  -- Which external posting this came from, when it came through LinkedIn.
  external_application_id text,

  applied_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT candidate_applications_status_ck
    CHECK (status IN ('open', 'hired', 'rejected', 'withdrawn'))
);

-- One OPEN application per candidate per role. A second, later application for the
-- same role is legitimate (doc 5: setters becoming closers, re-applications after
-- a ramp period) so the index is partial rather than absolute.
CREATE UNIQUE INDEX IF NOT EXISTS candidate_applications_open_uniq
  ON candidate_applications (candidate_id, role_id) WHERE status = 'open';
CREATE UNIQUE INDEX IF NOT EXISTS candidate_applications_external_uniq
  ON candidate_applications (org_id, external_application_id)
  WHERE external_application_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS candidate_applications_stage_idx
  ON candidate_applications (stage_id, entered_stage_at DESC);
CREATE INDEX IF NOT EXISTS candidate_applications_role_idx
  ON candidate_applications (role_id, status);

-- The stage must belong to the hiring pipeline. Without this an application could
-- be parked in a Sales stage and would appear on the closer board.
CREATE OR REPLACE FUNCTION hiring_stage_belongs_to_pipeline() RETURNS trigger AS $$
DECLARE pkey text;
BEGIN
  SELECT p.key INTO pkey
    FROM pipeline_stages s JOIN pipelines p ON p.id = s.pipeline_id
   WHERE s.id = NEW.stage_id;
  IF pkey IS DISTINCT FROM 'hiring' THEN
    RAISE EXCEPTION
      'application stage must belong to the hiring pipeline, got "%" (051_hiring.sql)', pkey;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_candidate_applications_stage ON candidate_applications;
CREATE TRIGGER trg_candidate_applications_stage
  BEFORE INSERT OR UPDATE OF stage_id ON candidate_applications
  FOR EACH ROW EXECUTE FUNCTION hiring_stage_belongs_to_pipeline();

-- ---------------------------------------------------------------------------
-- E. The grading rubric — config, versioned, auditable
-- ---------------------------------------------------------------------------
--
-- STRUCTURE ADAPTED FROM "SC Application Grading System" (doc 32): categories
-- scored 1-4, an average, and a rating that maps to a recommended action, plus a
-- set of automatic-disqualification conditions.
--
-- ⚠️ THE CRITERIA IN DOC 32 ARE NOT REUSED. That sheet grades inbound SALES leads
-- (current revenue, lead flow, able to invest) — it is a prospect triage rubric,
-- not a candidate rubric, despite living in the hiring folder. Applying "able to
-- invest" to a job applicant would be nonsense at best and unlawful at worst.
--
-- The categories seeded below come from doc 10's "What you're looking for" list
-- for the initial application, which IS about candidates.
--
-- VERSIONED. A rubric edit creates a new version rather than mutating the old one,
-- because scores already given were given under the old rubric and a bias audit
-- has to know which. application_scores stores rubric_version as applied.

CREATE TABLE IF NOT EXISTS hiring_rubrics (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id),
  role_id     uuid REFERENCES hiring_roles(id) ON DELETE CASCADE,

  stage_key   text NOT NULL,
  version     integer NOT NULL DEFAULT 1,

  -- [{ key, label, weight, guidance: {1:…,2:…,3:…,4:…} }]
  categories  jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Conditions that FLAG for human review. Never an automatic rejection — see the
  -- header. [{ key, label, when: … }]
  review_flags jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- average → recommendation. Recommendations are advisory strings the reviewer
  -- sees; none of them closes an application.
  rating_bands jsonb NOT NULL DEFAULT '[]'::jsonb,

  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT hiring_rubrics_stage_ck CHECK (stage_key IN
    ('applied', 'screening', 'group_interview', 'one_on_one', 'mock_call')),
  CONSTRAINT hiring_rubrics_version_ck CHECK (version >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS hiring_rubrics_uniq
  ON hiring_rubrics (org_id, role_id, stage_key, version) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS hiring_rubrics_active_idx
  ON hiring_rubrics (org_id, stage_key) WHERE active;

-- The application rubric, from doc 10's "What you're looking for".
INSERT INTO hiring_rubrics (org_id, role_id, stage_key, version, categories, review_flags, rating_bands)
SELECT o.id, NULL, 'applied', 1,
  '[
    {"key":"effort","label":"Effort / thoroughness","guidance":{"1":"Vague, one-line answers","2":"Some detail","3":"Detailed and clear","4":"Very detailed, clearly took it seriously"}},
    {"key":"honesty","label":"Honesty, no exaggeration","guidance":{"1":"Obvious incongruence","2":"Some overstatement","3":"Consistent","4":"Candid, including about gaps"}},
    {"key":"income_goal_fit","label":"Income goals align with the position","guidance":{"1":"Far below or above the role","2":"Loosely aligned","3":"Aligned","4":"Aligned and specific"}},
    {"key":"relevant_experience","label":"Experience with our market/offer OR prior selling","guidance":{"1":"Neither","2":"Some selling, no market fit","3":"One of the two, clearly","4":"Both"}},
    {"key":"sales_inputs","label":"Positive sales inputs (training, reading, practice)","guidance":{"1":"None","2":"Passive interest","3":"Active and current","4":"Deliberate and sustained"}},
    {"key":"work_history","label":"Positive relationship with past work experience","guidance":{"1":"Blames every past employer","2":"Mixed","3":"Constructive","4":"Constructive and self-aware"}}
  ]'::jsonb,
  -- FLAGS, NOT REJECTIONS. Each of these sends the application to a human with a
  -- reason attached. None of them closes it.
  '[
    {"key":"incongruent_answers","label":"Answers appear internally inconsistent — verify before proceeding"},
    {"key":"income_goal_mismatch","label":"Stated income goal is far outside the role''s OTE — confirm expectations"}
  ]'::jsonb,
  '[
    {"min":1.0,"max":1.99,"recommendation":"review_likely_no","label":"Below bar on the rubric — human review required"},
    {"min":2.0,"max":2.99,"recommendation":"review_maybe","label":"Mixed — consider for the other lane or a later cycle"},
    {"min":3.0,"max":3.49,"recommendation":"advance","label":"Meets the bar — advance to group interview"},
    {"min":3.5,"max":4.0,"recommendation":"advance_priority","label":"Strong — prioritise scheduling"}
  ]'::jsonb
  FROM orgs o
 WHERE o.is_default
   AND NOT EXISTS (SELECT 1 FROM hiring_rubrics r
                    WHERE r.org_id = o.id AND r.stage_key = 'applied' AND r.role_id IS NULL);

-- The group-interview rubric, from doc 11's "What we look for".
INSERT INTO hiring_rubrics (org_id, role_id, stage_key, version, categories, rating_bands)
SELECT o.id, NULL, 'group_interview', 1,
  '[
    {"key":"culture_fit","label":"Company / division culture fit","guidance":{"1":"Clear mismatch","2":"Unclear","3":"Fits","4":"Adds to it"}},
    {"key":"self_awareness","label":"Self-aware, has EQ","guidance":{"1":"None evident","2":"Some","3":"Clear","4":"Notably strong"}},
    {"key":"purpose_goals","label":"Has purpose and goals","guidance":{"1":"Drifting","2":"Vague","3":"Clear","4":"Clear and specific"}},
    {"key":"presence","label":"Energy, confidence, original answers","guidance":{"1":"Flat or rehearsed","2":"Uneven","3":"Good energy","4":"Led the room"}}
  ]'::jsonb,
  -- Doc 11: "We should be moving all candidates that are absolute yes and maybes
  -- forward" / "Move people onto next step even if you''re 50/50". The bands are
  -- deliberately generous at the bottom for exactly that reason.
  '[
    {"min":1.0,"max":1.74,"recommendation":"review_likely_no","label":"Human review required"},
    {"min":1.75,"max":4.0,"recommendation":"advance","label":"Yes or maybe — move to 1:1 per the group-interview SOP"}
  ]'::jsonb
  FROM orgs o
 WHERE o.is_default
   AND NOT EXISTS (SELECT 1 FROM hiring_rubrics r
                    WHERE r.org_id = o.id AND r.stage_key = 'group_interview' AND r.role_id IS NULL);

-- ---------------------------------------------------------------------------
-- F. application_scores — what the grader produced, retained for audit
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS application_scores (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id),
  application_id uuid NOT NULL REFERENCES candidate_applications(id) ON DELETE RESTRICT,

  stage_key      text NOT NULL,
  rubric_id      uuid REFERENCES hiring_rubrics(id) ON DELETE SET NULL,
  -- AS APPLIED, never back-filled. Same discipline as partner_revenue's
  -- share_pct_applied: a rubric change must not restate a score already given.
  rubric_version integer NOT NULL,

  -- { category_key: 1..4 }
  category_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  average        numeric(4,2),

  recommendation text,
  -- Flags raised. Advisory: they route to a human, they do not decide.
  flags          jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Who scored it. NULL means the deterministic grader; a staff id means a person
  -- scored or overrode it. Both are kept — an override is a data point in any
  -- bias review.
  scored_by_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
  is_automated   boolean NOT NULL DEFAULT true,

  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT application_scores_avg_ck
    CHECK (average IS NULL OR (average >= 1 AND average <= 4)),
  -- A human score must name the human. An automated one must not claim to be one.
  CONSTRAINT application_scores_actor_ck
    CHECK ((is_automated AND scored_by_staff_id IS NULL)
        OR (NOT is_automated AND scored_by_staff_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS application_scores_app_idx
  ON application_scores (application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS application_scores_audit_idx
  ON application_scores (org_id, stage_key, rubric_version, created_at DESC);

-- Scores are evidence in a bias audit. They are not disposable.
CREATE OR REPLACE FUNCTION hiring_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    '% rows are not deletable — they are the audit trail for an automated employment decision tool (051_hiring.sql)',
    TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_application_scores_no_delete ON application_scores;
CREATE TRIGGER trg_application_scores_no_delete
  BEFORE DELETE ON application_scores
  FOR EACH ROW WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION hiring_no_delete();

-- ---------------------------------------------------------------------------
-- G. interviews — group and 1:1
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hiring_interviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id),
  role_id        uuid REFERENCES hiring_roles(id) ON DELETE SET NULL,

  kind           text NOT NULL,
  scheduled_for  timestamptz,
  -- Doc 11: "Book a 1 hour call slot - plan to wrap within 45 minutes".
  duration_min   integer NOT NULL DEFAULT 60,
  -- Doc 11: "BE SURE THE ZOOM LINK IS IN THE CALENDAR INVITE".
  meeting_url    text,

  host_staff_id  uuid REFERENCES staff(id) ON DELETE SET NULL,
  status         text NOT NULL DEFAULT 'scheduled',
  notes          text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT hiring_interviews_kind_ck CHECK (kind IN ('group', 'one_on_one')),
  CONSTRAINT hiring_interviews_status_ck
    CHECK (status IN ('scheduled', 'held', 'cancelled', 'no_show')),
  CONSTRAINT hiring_interviews_duration_ck CHECK (duration_min > 0)
);

CREATE INDEX IF NOT EXISTS hiring_interviews_upcoming_idx
  ON hiring_interviews (scheduled_for) WHERE status = 'scheduled';

-- A group interview has many candidates; a 1:1 has one. Same table either way, so
-- attendance and outcome are recorded identically.
CREATE TABLE IF NOT EXISTS hiring_interview_attendees (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id),
  interview_id   uuid NOT NULL REFERENCES hiring_interviews(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES candidate_applications(id) ON DELETE RESTRICT,

  attended       boolean,
  -- Doc 11 grades to yes / maybe / no, and says to advance yes AND maybe.
  outcome        text,
  notes          text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT hiring_interview_attendees_outcome_ck
    CHECK (outcome IS NULL OR outcome IN ('yes', 'maybe', 'no'))
);

CREATE UNIQUE INDEX IF NOT EXISTS hiring_interview_attendees_uniq
  ON hiring_interview_attendees (interview_id, application_id);
CREATE INDEX IF NOT EXISTS hiring_interview_attendees_app_idx
  ON hiring_interview_attendees (application_id);

-- ---------------------------------------------------------------------------
-- H. hiring_decisions — every advance, offer and rejection, by a NAMED HUMAN
-- ---------------------------------------------------------------------------
--
-- THE EEOC CONTROL, at the engine. An adverse decision — reject, or an offer
-- rescinded — requires decided_by. The grader has no staff id and therefore
-- cannot produce one, which is what makes "no candidate is ever rejected by
-- software" a property of the schema rather than a promise in a code comment.
--
-- Doc 11 also requires this operationally: "Give feedback to candidates via email
-- and let your AM and RAM know who you didn't move forward and why." A rejection
-- with no reason cannot produce that email.

CREATE TABLE IF NOT EXISTS hiring_decisions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id),
  application_id uuid NOT NULL REFERENCES candidate_applications(id) ON DELETE RESTRICT,

  decision       text NOT NULL,
  from_stage_key text,
  to_stage_key   text,

  -- The human. NOT NULL for anything adverse, by CHECK below.
  decided_by     uuid REFERENCES staff(id) ON DELETE SET NULL,
  reason         text,
  -- What the grader had recommended at the time, so "how often do humans follow
  -- the machine" is answerable — the core question in an AEDT bias review.
  score_id       uuid REFERENCES application_scores(id) ON DELETE SET NULL,
  recommendation_at_decision text,

  candidate_notified_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT hiring_decisions_decision_ck CHECK (decision IN
    ('advance', 'reject', 'offer', 'offer_accepted', 'offer_declined', 'withdraw', 'hold')),

  -- THE INVARIANT. Adverse outcomes require a named human AND a reason.
  CONSTRAINT hiring_decisions_human_ck
    CHECK (decision NOT IN ('reject', 'offer_declined')
           OR (decided_by IS NOT NULL AND btrim(COALESCE(reason, '')) <> '')),
  -- An offer is a commitment; it also needs a name against it.
  CONSTRAINT hiring_decisions_offer_ck
    CHECK (decision <> 'offer' OR decided_by IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS hiring_decisions_app_idx
  ON hiring_decisions (application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS hiring_decisions_audit_idx
  ON hiring_decisions (org_id, decision, created_at DESC);

DROP TRIGGER IF EXISTS trg_hiring_decisions_no_delete ON hiring_decisions;
CREATE TRIGGER trg_hiring_decisions_no_delete
  BEFORE DELETE ON hiring_decisions
  FOR EACH ROW WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION hiring_no_delete();

-- An application cannot reach a terminal status without a decision row that says
-- who did it. Belt to the CHECK above: the CHECK guards the decision row, this
-- guards the application from being closed without one.
CREATE OR REPLACE FUNCTION application_terminal_needs_decision() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected' THEN
    IF NOT EXISTS (
      SELECT 1 FROM hiring_decisions d
       WHERE d.application_id = NEW.id AND d.decision = 'reject' AND d.decided_by IS NOT NULL
    ) THEN
      RAISE EXCEPTION
        'application % cannot be rejected without a hiring_decisions row naming the human who decided (051_hiring.sql)',
        NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_application_terminal ON candidate_applications;
CREATE TRIGGER trg_application_terminal
  BEFORE UPDATE OF status ON candidate_applications
  FOR EACH ROW EXECUTE FUNCTION application_terminal_needs_decision();

-- ---------------------------------------------------------------------------
-- I. LinkedIn Talent Solutions — job postings and inbound applications
-- ---------------------------------------------------------------------------
--
-- ⚠️ CONFIRM BEFORE THIS RUNS LIVE. Partner-gated API; payload shapes unverified
-- against a real Talent Solutions account, same status as the other adapters in
-- this repo carrying this marker.
--
-- NO PROFILE HARVESTING. This models postings we own and applications people
-- chose to send us. It deliberately has nowhere to put a scraped profile: reading
-- or storing LinkedIn member data outside what an applicant submits breaches the
-- platform terms and, for candidate data, compounds the AEDT exposure above.

CREATE TABLE IF NOT EXISTS hiring_job_postings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id),
  role_id        uuid NOT NULL REFERENCES hiring_roles(id) ON DELETE RESTRICT,

  channel        text NOT NULL,
  external_id    text,
  title          text NOT NULL,
  description    text,
  location       text,
  apply_url      text,

  status         text NOT NULL DEFAULT 'draft',
  posted_at      timestamptz,
  closed_at      timestamptz,
  last_error     text,
  last_synced_at timestamptz,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT hiring_job_postings_channel_ck
    CHECK (channel IN ('linkedin', 'facebook', 'job_board', 'internal')),
  CONSTRAINT hiring_job_postings_status_ck
    CHECK (status IN ('draft', 'posted', 'paused', 'closed', 'failed')),
  CONSTRAINT hiring_job_postings_title_ck CHECK (btrim(title) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS hiring_job_postings_external_uniq
  ON hiring_job_postings (org_id, channel, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS hiring_job_postings_open_idx
  ON hiring_job_postings (org_id, role_id) WHERE status = 'posted';

ALTER TABLE candidate_applications
  ADD COLUMN IF NOT EXISTS job_posting_id uuid REFERENCES hiring_job_postings(id) ON DELETE SET NULL;

-- The connection itself. Tokens encrypted at rest by src/adplatforms/tokens.mjs,
-- reusing that module rather than growing a second crypto path.
CREATE TABLE IF NOT EXISTS hiring_channel_connections (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id),

  channel        text NOT NULL,
  external_account_id text,

  encrypted_access_token  text,
  encrypted_refresh_token text,
  token_expires_at        timestamptz,
  scopes                  jsonb NOT NULL DEFAULT '[]'::jsonb,

  connection_state text NOT NULL DEFAULT 'pending',
  last_error     text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT hiring_channel_connections_channel_ck
    CHECK (channel IN ('linkedin', 'facebook', 'job_board')),
  CONSTRAINT hiring_channel_connections_state_ck
    CHECK (connection_state IN ('pending', 'active', 'expired', 'revoked')),
  CONSTRAINT hiring_channel_connections_active_token_ck
    CHECK (connection_state <> 'active' OR encrypted_access_token IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS hiring_channel_connections_uniq
  ON hiring_channel_connections (org_id, channel, external_account_id) NULLS NOT DISTINCT;

-- ---------------------------------------------------------------------------
-- J. updated_at + views
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    FOREACH t IN ARRAY ARRAY[
      'hiring_roles', 'candidates', 'candidate_applications', 'hiring_rubrics',
      'hiring_interviews', 'hiring_interview_attendees', 'hiring_job_postings',
      'hiring_channel_connections'
    ] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_' || t || '_updated_at'
                      AND tgrelid = ('public.' || t)::regclass) THEN
        EXECUTE format(
          'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
          'trg_' || t || '_updated_at', t);
      END IF;
    END LOOP;
  END IF;
END $$;

-- The bench. "Always be recruiting… ideally have 4-5 potential reps on your
-- bench" (doc 10) — this is what makes the funnel always-on, and what
-- src/hiring/bench.mjs alerts on.
CREATE OR REPLACE VIEW v_hiring_bench AS
SELECT r.org_id,
       r.id   AS role_id,
       r.key  AS role_key,
       r.name AS role_name,
       r.bench_target,
       r.hiring_manager_staff_id,
       count(a.id) FILTER (WHERE a.status = 'open')::int AS open_applications,
       -- "Bench" is the qualified end of the funnel, not everyone who applied:
       -- candidates who have cleared at least the group interview.
       count(a.id) FILTER (
         WHERE a.status = 'open' AND s.key IN ('one_on_one', 'offer')
       )::int AS bench_count,
       greatest(r.bench_target - count(a.id) FILTER (
         WHERE a.status = 'open' AND s.key IN ('one_on_one', 'offer')
       )::int, 0) AS bench_shortfall
  FROM hiring_roles r
  LEFT JOIN candidate_applications a ON a.role_id = r.id
  LEFT JOIN pipeline_stages s ON s.id = a.stage_id
 WHERE r.active
 GROUP BY r.org_id, r.id, r.key, r.name, r.bench_target, r.hiring_manager_staff_id;

-- Funnel conversion by stage and by source — the reason `source` is a constrained
-- column rather than free text.
CREATE OR REPLACE VIEW v_hiring_funnel AS
SELECT a.org_id,
       r.key  AS role_key,
       c.source,
       s.key  AS stage_key,
       s.sort_order,
       count(*)::int AS applications
  FROM candidate_applications a
  JOIN candidates c      ON c.id = a.candidate_id
  JOIN hiring_roles r    ON r.id = a.role_id
  JOIN pipeline_stages s ON s.id = a.stage_id
 GROUP BY a.org_id, r.key, c.source, s.key, s.sort_order;

-- What a human still has to fill in, in the style of v_creative_config_gaps.
CREATE OR REPLACE VIEW v_hiring_config_gaps AS
SELECT r.org_id,
       'hiring_roles.' || r.key AS config,
       CASE
         WHEN r.scorecard = '{}'::jsonb AND r.comp = '{}'::jsonb
           THEN 'scorecard and comp are both empty'
         WHEN r.scorecard = '{}'::jsonb THEN 'scorecard is empty'
         WHEN r.comp = '{}'::jsonb      THEN 'comp / OTE is empty'
       END AS detail,
       'offers and ramp targets cannot be generated for this role' AS consequence
  FROM hiring_roles r
 WHERE r.active AND (r.scorecard = '{}'::jsonb OR r.comp = '{}'::jsonb)
UNION ALL
SELECT o.id, 'hiring_roles.hiring_manager_staff_id',
       'no hiring manager assigned to ' || r.key,
       'bench alerts have nobody to route to'
  FROM orgs o JOIN hiring_roles r ON r.org_id = o.id
 WHERE o.is_default AND r.active AND r.hiring_manager_staff_id IS NULL;

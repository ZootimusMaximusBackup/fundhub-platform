-- 053_eeo_selfid.sql — voluntary EEO self-identification, held APART from hiring.
--
-- WHY THIS EXISTS. 051 built an automated employment decision tool and deliberately
-- collects no protected characteristics — the intake path strips them before
-- storage. That is the right call for the SCORING path, but it leaves a real gap:
-- an adverse-impact analysis, and the annual bias audit NYC Local Law 144 requires,
-- both need demographic data. Without this table the audit trail can answer "did a
-- human decide" but not "did the tool affect groups differently", which is the
-- question that actually matters.
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- THE ENTIRE DESIGN IS ABOUT KEEPING THIS DATA AWAY FROM DECISIONS.
--
-- 1. VOLUNTARY, AND DECLINING IS A FIRST-CLASS ANSWER. Every column is nullable and
--    'decline_to_state' is a valid value, because a form that forces disclosure is
--    not voluntary and its data is not usable.
--
-- 2. NO FOREIGN KEY TO candidate_applications. This is the load-bearing decision.
--    A join key would let anyone reconstruct "this candidate is in this group",
--    which is precisely what must not be possible for the people making hiring
--    decisions. Instead each response carries a per-response `survey_token` that
--    the candidate submits with, and the LINK between token and application is
--    deleted once the response lands (see eeo_survey_invites.consumed_at).
--
--    The cost is real and worth stating: because the link is destroyed, this data
--    can support AGGREGATE analysis by stage and outcome, and cannot support
--    per-candidate lookup. That is the trade the law intends.
--
-- 3. AGGREGATE READS ONLY, WITH A MINIMUM CELL SIZE. v_eeo_aggregate suppresses any
--    group under 5, because a "group" of one is an identification, not a statistic.
--
-- 4. NOT READABLE BY THE HIRING ROLE. api/hiring/* is gated to HIRING (owner,
--    admin) — the same people who make decisions. This data is gated separately in
--    the endpoint layer to COMPLIANCE, and the raw table is never projected.
--
-- 5. NOTHING HERE IS AN INPUT TO grading.mjs. The grader takes a rubric and category
--    scores; it has no reader for this table and must never gain one. The deny-list
--    in src/hiring/grading.mjs already refuses these field names if they appear in
--    an answer set.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- A. eeo_survey_invites — the token, and its deliberate destruction
-- ---------------------------------------------------------------------------
--
-- One invite per application. The application_id lives HERE and only here, and is
-- nulled when the response arrives — so before submission we know who was asked,
-- and after submission we know only that a token was used.

CREATE TABLE IF NOT EXISTS eeo_survey_invites (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id),

  -- Nulled on consumption. ON DELETE SET NULL rather than CASCADE so deleting an
  -- application never silently removes audit evidence that it was surveyed.
  application_id uuid REFERENCES candidate_applications(id) ON DELETE SET NULL,

  survey_token   text NOT NULL,

  -- The stage the candidate was at when asked, and the eventual outcome, copied
  -- across at consumption time. These are what make aggregate analysis possible
  -- once application_id is gone — the whole point of copying rather than joining.
  invited_at_stage text,

  sent_at        timestamptz NOT NULL DEFAULT now(),
  consumed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT eeo_survey_invites_token_ck CHECK (length(survey_token) >= 32),
  -- Once consumed, the link MUST be gone. This is the invariant, at the engine.
  CONSTRAINT eeo_survey_invites_unlinked_ck
    CHECK (consumed_at IS NULL OR application_id IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS eeo_survey_invites_token_uniq
  ON eeo_survey_invites (survey_token);
CREATE UNIQUE INDEX IF NOT EXISTS eeo_survey_invites_app_uniq
  ON eeo_survey_invites (application_id) WHERE application_id IS NOT NULL;

COMMENT ON CONSTRAINT eeo_survey_invites_unlinked_ck ON eeo_survey_invites IS
  'A consumed invite carries no application_id. This is what makes per-candidate demographic lookup impossible rather than merely discouraged.';

-- ---------------------------------------------------------------------------
-- B. eeo_responses — the demographic data, unlinkable to a person
-- ---------------------------------------------------------------------------
--
-- Categories follow the EEO-1 component-1 shape, which is the form employers
-- already report against, so the data is usable without a translation step.

CREATE TABLE IF NOT EXISTS eeo_responses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id),

  -- NOT a foreign key to anything about the person. See the header.
  invite_id      uuid NOT NULL REFERENCES eeo_survey_invites(id) ON DELETE RESTRICT,

  -- Copied at submission so aggregates survive the link being destroyed.
  role_key       text,
  source         text,
  stage_at_invite text,
  -- Stamped later by the outcome sweep, keyed on invite rather than application.
  final_outcome  text,

  -- Every one of these is nullable, and 'decline_to_state' is valid. A required
  -- field would make the survey non-voluntary and the data unusable.
  race_ethnicity text,
  gender         text,
  veteran_status text,
  disability_status text,

  submitted_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT eeo_responses_race_ck CHECK (race_ethnicity IS NULL OR race_ethnicity IN (
    'hispanic_or_latino', 'white', 'black_or_african_american',
    'native_hawaiian_or_pacific_islander', 'asian',
    'american_indian_or_alaska_native', 'two_or_more_races', 'decline_to_state')),
  CONSTRAINT eeo_responses_gender_ck CHECK (gender IS NULL OR gender IN (
    'male', 'female', 'non_binary', 'decline_to_state')),
  CONSTRAINT eeo_responses_veteran_ck CHECK (veteran_status IS NULL OR veteran_status IN (
    'protected_veteran', 'not_a_protected_veteran', 'decline_to_state')),
  CONSTRAINT eeo_responses_disability_ck CHECK (disability_status IS NULL OR disability_status IN (
    'yes', 'no', 'decline_to_state')),
  CONSTRAINT eeo_responses_outcome_ck CHECK (final_outcome IS NULL OR final_outcome IN (
    'hired', 'rejected', 'withdrawn', 'in_progress'))
);

CREATE UNIQUE INDEX IF NOT EXISTS eeo_responses_invite_uniq ON eeo_responses (invite_id);
CREATE INDEX IF NOT EXISTS eeo_responses_agg_idx
  ON eeo_responses (org_id, role_key, stage_at_invite, final_outcome);

-- Audit evidence. Voiding is not a concept here — a response is either given or not.
CREATE OR REPLACE FUNCTION eeo_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'eeo_responses are bias-audit evidence and are not deletable (053_eeo_selfid.sql)';
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_eeo_responses_no_delete ON eeo_responses;
CREATE TRIGGER trg_eeo_responses_no_delete
  BEFORE DELETE ON eeo_responses
  FOR EACH ROW WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION eeo_no_delete();

-- ---------------------------------------------------------------------------
-- C. submit_eeo_response — the one write path, which destroys the link
-- ---------------------------------------------------------------------------
--
-- A function rather than an INSERT at the call site, because the link destruction
-- and the response insert must be one atomic step. Two statements in application
-- code is one crash away from a stored response that is still joinable to a name.

CREATE OR REPLACE FUNCTION submit_eeo_response(
  p_token text,
  p_race text DEFAULT NULL,
  p_gender text DEFAULT NULL,
  p_veteran text DEFAULT NULL,
  p_disability text DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  v_invite eeo_survey_invites;
  v_role text; v_source text; v_stage text;
  v_id uuid;
BEGIN
  SELECT * INTO v_invite FROM eeo_survey_invites WHERE survey_token = p_token;
  IF v_invite.id IS NULL THEN
    RAISE EXCEPTION 'unknown survey token';
  END IF;
  IF v_invite.consumed_at IS NOT NULL THEN
    -- Already answered. Not an error the candidate should see twice, and not an
    -- opportunity to overwrite.
    RETURN NULL;
  END IF;

  -- Read the context WHILE the link still exists. This is the only moment it can
  -- be captured, which is why it is copied rather than joined later.
  SELECT r.key, c.source, s.key
    INTO v_role, v_source, v_stage
    FROM candidate_applications a
    JOIN candidates c ON c.id = a.candidate_id
    JOIN hiring_roles r ON r.id = a.role_id
    JOIN pipeline_stages s ON s.id = a.stage_id
   WHERE a.id = v_invite.application_id;

  INSERT INTO eeo_responses
    (org_id, invite_id, role_key, source, stage_at_invite, final_outcome,
     race_ethnicity, gender, veteran_status, disability_status)
  VALUES
    (v_invite.org_id, v_invite.id, v_role, v_source, COALESCE(v_invite.invited_at_stage, v_stage),
     'in_progress', p_race, p_gender, p_veteran, p_disability)
  RETURNING id INTO v_id;

  -- THE LINK IS DESTROYED HERE, in the same transaction as the insert.
  UPDATE eeo_survey_invites
     SET consumed_at = now(), application_id = NULL
   WHERE id = v_invite.id;

  RETURN v_id;
END $$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- D. v_eeo_aggregate — the only read, with a minimum cell size
-- ---------------------------------------------------------------------------
--
-- SUPPRESSES ANY GROUP UNDER 5. A cell of one is an identification, not a
-- statistic, and a table of small cells cross-referenced against a hire list
-- re-identifies people — which would undo everything above.
--
-- Selection rate by group is what an adverse-impact analysis compares (the
-- four-fifths rule looks at whether a group's selection rate falls below 80% of the
-- highest group's). It is computed here so the number is defined once.

CREATE OR REPLACE VIEW v_eeo_aggregate AS
WITH counted AS (
  SELECT org_id, role_key,
         COALESCE(race_ethnicity, 'no_response') AS race_ethnicity,
         COALESCE(gender, 'no_response')         AS gender,
         count(*)::int AS responses,
         count(*) FILTER (WHERE final_outcome = 'hired')::int    AS hired,
         count(*) FILTER (WHERE final_outcome = 'rejected')::int  AS rejected
    FROM eeo_responses
   GROUP BY org_id, role_key, COALESCE(race_ethnicity, 'no_response'), COALESCE(gender, 'no_response')
)
SELECT org_id, role_key, race_ethnicity, gender, responses, hired, rejected,
       CASE WHEN responses = 0 THEN NULL
            ELSE round(100.0 * hired / responses, 1) END AS selection_rate_pct
  FROM counted
 -- The suppression threshold. Do not lower it.
 WHERE responses >= 5;

COMMENT ON VIEW v_eeo_aggregate IS
  'Aggregate EEO self-ID by role and group, suppressing cells under 5 responses. A cell of one is an identification, not a statistic. Selection rate supports a four-fifths-rule comparison. This view is the ONLY intended read of eeo_responses.';

-- 300_eeo_invite_template_and_submit_outcome.sql
--
-- COMPLIANCE REVIEW REQUIRED — voluntary EEO self-identification invite mail and
-- the submit function that copies application outcome while the link still exists.
--
-- Lane 5 (post-PR-336): wires 053_eeo_selfid.sql. The invite email is separate
-- from the careers apply form. submit_eeo_response now copies the application's
-- status into final_outcome at consumption time — the only moment the join exists.

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT o.id, v.k, v.ch, v.subj, v.body, true
  FROM orgs o
  CROSS JOIN (VALUES
    ('EMAIL-CANDIDATE-EEO-INVITE', 'email',
     'Optional equal-opportunity survey — Fundhub',
     'Hi {{candidate.first_name}},

Thank you for applying. Federal and local bias-audit rules ask employers to
offer a voluntary, separate survey about race, gender, veteran status, and
disability. Your answers are optional. You may skip any question or decline
to answer the whole survey.

Nothing you put here is shown to the people reviewing your application, and
your answers cannot be linked back to your name once you submit.

Open the survey here:
{{survey.url}}

If the link does not open, copy and paste it into your browser.

— Fundhub Hiring'))
  ) AS v(k, ch, subj, body)
 WHERE NOT EXISTS (
   SELECT 1 FROM message_templates t
    WHERE t.org_id = o.id AND t.template_key = v.k
 );

CREATE OR REPLACE FUNCTION submit_eeo_response(
  p_token text,
  p_race text DEFAULT NULL,
  p_gender text DEFAULT NULL,
  p_veteran text DEFAULT NULL,
  p_disability text DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  v_invite eeo_survey_invites;
  v_role text; v_source text; v_stage text; v_outcome text;
  v_id uuid;
BEGIN
  SELECT * INTO v_invite FROM eeo_survey_invites WHERE survey_token = p_token;
  IF v_invite.id IS NULL THEN
    RAISE EXCEPTION 'unknown survey token';
  END IF;
  IF v_invite.consumed_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  SELECT r.key, c.source, s.key, a.status
    INTO v_role, v_source, v_stage, v_outcome
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
     CASE v_outcome
       WHEN 'hired' THEN 'hired'
       WHEN 'rejected' THEN 'rejected'
       WHEN 'withdrawn' THEN 'withdrawn'
       ELSE 'in_progress'
     END,
     p_race, p_gender, p_veteran, p_disability)
  RETURNING id INTO v_id;

  UPDATE eeo_survey_invites
     SET consumed_at = now(), application_id = NULL
   WHERE id = v_invite.id;

  RETURN v_id;
END $$ LANGUAGE plpgsql;

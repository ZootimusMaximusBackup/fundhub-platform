-- 295_candidate_outreach.sql — the applicant actually hears from us.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS FILE EXISTS
--
-- 051_hiring.sql built the whole inbound funnel and src/hiring/pipeline.mjs
-- works, and between them they contain ZERO send calls. An applicant fills in
-- the form, a `candidates` row and a `candidate_applications` row appear, a
-- score is written — and nothing ever reaches the person. They wait, hear
-- nothing, and take another job.
--
-- Owner-described 2026-09-05: applicant arrives, we reach out automatically by
-- email and text, and we keep following up until they book or go cold.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THREE THINGS THIS FILE IS CAREFUL ABOUT
--
-- 1. A CANDIDATE IS NOT A CLIENT. Nothing here touches `clients`, `opt_outs`
--    or `client_consents` — all three are keyed on a client id, and minting a
--    client row for a job applicant would put them in the closer queue and in
--    every client count in the platform (051's own header says this at length).
--    So consent and opt-out live on `candidates`, next to the rest of that
--    person's data, and the retention sweep still has one table to work on.
--
-- 2. TEXTING NEEDS CONSENT AND THE WORDS ARE PART OF IT. sms_consent alone is a
--    boolean somebody could flip. The CHECK below refuses a `true` that does not
--    carry WHEN it was given and the VERBATIM WORDING the applicant agreed to —
--    the same posture as client_consents.consent_text in 099. An applicant who
--    left the box unticked gets email only, and that is a database property
--    here rather than a promise in application code.
--
-- 3. A CADENCE WITH NO EXIT IS A COMPLAINT GENERATOR. `candidate_outreach`
--    carries an explicit stop, with a reason, and a stopped row cannot be
--    stopped "for no reason" — see candidate_outreach_stop_ck.
--
-- NO CANDIDATE IS EVER REJECTED BY SOFTWARE, and nothing in this file changes
-- that. Going cold stops the FOLLOW-UPS. It does not close the application, it
-- writes no hiring_decisions row, and it touches candidate_applications.status
-- not at all. The application stays open for a human exactly as it was.
--
-- NOTHING HERE TRANSMITS. src/hiring/outreach.mjs writes `messages` rows with
-- status='queued'; src/messaging/dispatch.mjs is the only thing that hands a
-- row to a provider, and outbound fetch lives in src/messaging/providers/* and
-- nowhere else (CLAUDE.md §12).

-- ---------------------------------------------------------------------------
-- A. Consent and contactability, on the candidate
-- ---------------------------------------------------------------------------

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS sms_consent      boolean NOT NULL DEFAULT false;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS sms_consent_at   timestamptz;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS sms_consent_text text;

-- Opt-out is per channel and is recorded as an INSTANT, not a flag: "when did
-- they ask us to stop" is the question a complaint asks, and a boolean cannot
-- answer it.
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS email_opt_out_at timestamptz;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS sms_opt_out_at   timestamptz;

-- Consent that cannot say what was agreed to, or when, is not a consent record.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'candidates_sms_consent_ck') THEN
    ALTER TABLE candidates ADD CONSTRAINT candidates_sms_consent_ck
      CHECK (sms_consent = false
             OR (sms_consent_at IS NOT NULL
                 AND btrim(COALESCE(sms_consent_text, '')) <> ''));
  END IF;
END $$;

COMMENT ON COLUMN candidates.sms_consent IS
  'Did this applicant tick the text-message box. false is the default and means email only. Cannot be true without sms_consent_at and the verbatim sms_consent_text (candidates_sms_consent_ck).';
COMMENT ON COLUMN candidates.sms_consent_text IS
  'The wording the applicant was shown when they ticked the box, copied verbatim. Same standing as client_consents.consent_text (099).';
COMMENT ON COLUMN candidates.sms_opt_out_at IS
  'When they asked us to stop texting. Set by a STOP reply or by a person. Never cleared by the cadence.';

-- ---------------------------------------------------------------------------
-- B. Where we ask them to book
-- ---------------------------------------------------------------------------
--
-- EVERY MESSAGE IN THIS CADENCE EXISTS TO GET SOMEBODY BOOKED, so every one of
-- them needs a destination. There is no candidate booking URL anywhere in this
-- repo — not in env, not in a seed, not in hiring_job_postings.apply_url (which
-- is where an application comes FROM, not where an interview is booked).
--
-- So the column is NULLABLE AND EMPTY and src/hiring/outreach.mjs refuses to
-- queue anything for a req that has no link, with reason "no_booking_link".
-- Inventing a plausible URL would mail real applicants a dead link, which is
-- worse than the silence this file exists to fix. v_hiring_outreach_gaps below
-- reports it.

ALTER TABLE hiring_roles ADD COLUMN IF NOT EXISTS interview_booking_url text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hiring_roles_booking_url_ck') THEN
    ALTER TABLE hiring_roles ADD CONSTRAINT hiring_roles_booking_url_ck
      CHECK (interview_booking_url IS NULL OR interview_booking_url ~ '^https://[^[:space:]]+$');
  END IF;
END $$;

COMMENT ON COLUMN hiring_roles.interview_booking_url IS
  'Where a candidate books their interview. DELIBERATELY EMPTY — owner-supplied. src/hiring/outreach.mjs sends nothing for a req without one rather than inventing a link.';

-- ---------------------------------------------------------------------------
-- C. candidate_outreach — one row per application, the cadence's whole state
-- ---------------------------------------------------------------------------
--
-- ONE ROW PER APPLICATION, not per message. The sends themselves are `messages`
-- rows and that is the record; a second copy of "what did we send" would be a
-- second source of truth that drifts. Idempotency per step comes from the
-- unique index on (org_id, provider_ref) that migration 004 already enforces —
-- outreach.mjs writes provider_ref 'candidate:<application>:step<n>:<channel>',
-- so a replayed sweep cannot double-send.

CREATE TABLE IF NOT EXISTS candidate_outreach (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id),
  application_id uuid NOT NULL REFERENCES candidate_applications(id) ON DELETE RESTRICT,
  candidate_id   uuid NOT NULL REFERENCES candidates(id) ON DELETE RESTRICT,

  status         text NOT NULL DEFAULT 'active',

  -- How many steps have been queued. 0 means the first one has not gone yet.
  step           integer NOT NULL DEFAULT 0,
  next_due_at    timestamptz NOT NULL DEFAULT now(),
  last_sent_at   timestamptz,

  -- THE THREE EXITS, each recorded as the instant it happened rather than as a
  -- flag, so "we texted them after they replied" is answerable.
  replied_at     timestamptz,
  booked_at      timestamptz,

  stopped_at     timestamptz,
  stop_reason    text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT candidate_outreach_status_ck CHECK (status IN ('active', 'stopped')),
  CONSTRAINT candidate_outreach_step_ck   CHECK (step >= 0),

  -- A stop must say why and when. A cadence that stopped for no recorded reason
  -- cannot be reviewed after a complaint, only guessed at.
  CONSTRAINT candidate_outreach_stop_ck CHECK (
    (status = 'active'  AND stopped_at IS NULL AND stop_reason IS NULL)
    OR
    (status = 'stopped' AND stopped_at IS NOT NULL AND stop_reason IS NOT NULL)
  ),
  CONSTRAINT candidate_outreach_reason_ck CHECK (
    stop_reason IS NULL OR stop_reason IN
      ('replied', 'booked', 'opted_out', 'decided', 'completed', 'manual', 'undeliverable')
  )
);

-- One cadence per application. A second one would double every follow-up.
CREATE UNIQUE INDEX IF NOT EXISTS candidate_outreach_app_uniq
  ON candidate_outreach (application_id);

-- The sweeper's only query: what is active and due.
CREATE INDEX IF NOT EXISTS candidate_outreach_due_idx
  ON candidate_outreach (next_due_at) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS candidate_outreach_candidate_idx
  ON candidate_outreach (candidate_id);

COMMENT ON TABLE candidate_outreach IS
  'The follow-up cadence for one job application: which step we are on, when the next one is due, and — if it stopped — when and why. Stopping the cadence is NOT a hiring decision: it never closes an application and writes no hiring_decisions row.';
COMMENT ON COLUMN candidate_outreach.stop_reason IS
  'replied | booked | opted_out | decided | completed | manual | undeliverable. "decided" means a human moved or closed the application, so the automatic chasing is no longer wanted.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at')
     AND NOT EXISTS (SELECT 1 FROM pg_trigger
                      WHERE tgname = 'trg_candidate_outreach_updated_at'
                        AND tgrelid = 'public.candidate_outreach'::regclass) THEN
    CREATE TRIGGER trg_candidate_outreach_updated_at
      BEFORE UPDATE ON candidate_outreach
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- D. The copy
-- ---------------------------------------------------------------------------
--
-- FOUR STEPS, EMAIL AND TEXT. The step count and the spacing are process
-- choices and live in src/hiring/outreach.mjs (CADENCE), not here — this file
-- holds only the words.
--
-- WHAT THE COPY DELIBERATELY DOES NOT SAY. Not one line of it names pay, an
-- OTE, a commission, hours, a location, a title beyond the req's own name, or
-- anything about what the job is like. Every one of those is a claim a real
-- applicant would rely on and none of them exists anywhere in this repo:
-- hiring_roles.comp is '{}' for every seeded role and v_hiring_config_gaps has
-- been reporting that since 051. Writing them here would be inventing the terms
-- of somebody's employment.
--
-- So the messages say only what is true and procedural: we got it, here is
-- where to book, we have not heard from you, and we are going quiet.
--
-- {{role.name}} is the req's own name column. {{candidate.first_name}} and
-- {{role.booking_url}} are the only other tags, and outreach.mjs will not queue
-- a message whose booking URL is blank.
--
-- Every text ends with STOP wording because src/handlers/comms.mjs honours
-- STOP / UNSUBSCRIBE, and a text that offers no way out is the thing that
-- generates the complaint.

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT o.id, v.k, v.ch, v.subj, v.body, true
  FROM orgs o
  CROSS JOIN (VALUES
    ('EMAIL-CANDIDATE-OUTREACH-1', 'email',
     'We got your application — {{role.name}}',
     'Hi {{candidate.first_name}},

Thanks for applying for the {{role.name}} role at Fundhub. We have your application.

The next step is a short interview. You can pick a time here:
{{role.booking_url}}

If none of those times work, reply to this email and tell us when does.

— Fundhub Hiring'),

    ('EMAIL-CANDIDATE-OUTREACH-2', 'email',
     'Still want to talk? — {{role.name}}',
     'Hi {{candidate.first_name}},

Following up on your {{role.name}} application. We have not seen a time booked yet.

Here is the link again:
{{role.booking_url}}

It takes about a minute. If you have changed your mind, just reply and say so and we will close it out.

— Fundhub Hiring'),

    ('EMAIL-CANDIDATE-OUTREACH-3', 'email',
     'Two minutes to pick a time — {{role.name}}',
     'Hi {{candidate.first_name}},

We are still holding a spot for your {{role.name}} interview.

Pick any time that works:
{{role.booking_url}}

If you would rather not go ahead, reply and tell us and we will stop emailing.

— Fundhub Hiring'),

    ('EMAIL-CANDIDATE-OUTREACH-4', 'email',
     'Last note about your application — {{role.name}}',
     'Hi {{candidate.first_name}},

This is the last time we will chase you about the {{role.name}} role.

The link is open if you want it:
{{role.booking_url}}

If we do not hear from you we will leave your application where it is and stop
emailing. You are welcome to come back to it later.

— Fundhub Hiring'),

    ('SMS-CANDIDATE-OUTREACH-1', 'sms', NULL,
     'Fundhub Hiring: thanks for applying for {{role.name}}, {{candidate.first_name}}. Book your interview here: {{role.booking_url}} Reply STOP to opt out.'),

    ('SMS-CANDIDATE-OUTREACH-2', 'sms', NULL,
     'Fundhub Hiring: {{candidate.first_name}}, we have not seen a time booked for your {{role.name}} interview. {{role.booking_url}} Reply STOP to opt out.'),

    ('SMS-CANDIDATE-OUTREACH-3', 'sms', NULL,
     'Fundhub Hiring: still holding a spot for your {{role.name}} interview, {{candidate.first_name}}. {{role.booking_url}} Reply STOP to opt out.'),

    ('SMS-CANDIDATE-OUTREACH-4', 'sms', NULL,
     'Fundhub Hiring: last note on your {{role.name}} application, {{candidate.first_name}}. Link is open if you want it: {{role.booking_url}} Reply STOP to opt out.')
  ) AS v(k, ch, subj, body)
ON CONFLICT (org_id, template_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- E. What a human still has to fill in
-- ---------------------------------------------------------------------------
--
-- Its own view rather than a line added to v_hiring_config_gaps: that view is
-- 051's and other work is in flight against the same file set. Same style, same
-- three columns, so a screen can UNION them if it ever wants one list.

CREATE OR REPLACE VIEW v_hiring_outreach_gaps AS
SELECT r.org_id,
       'hiring_roles.interview_booking_url.' || r.key AS config,
       'no interview booking link for ' || r.key      AS detail,
       'applicants for this role get no automatic follow-up at all' AS consequence
  FROM hiring_roles r
 WHERE r.active AND btrim(COALESCE(r.interview_booking_url, '')) = '';

COMMENT ON VIEW v_hiring_outreach_gaps IS
  'Reqs whose candidate follow-up cannot run because nobody has said where an interview is booked. Empty is the healthy state.';

-- ---------------------------------------------------------------------------
-- F. Grants
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidate_outreach TO fundhub_app';
    EXECUTE 'GRANT SELECT ON public.v_hiring_outreach_gaps TO fundhub_app';
  END IF;
END $$;

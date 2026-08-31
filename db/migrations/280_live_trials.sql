-- 280_live_trials.sql — the Live Trial: $297, seven days, one row per buyer.
--
-- COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7). This file records a paid trial in
-- which FundHub's regulated consumer-finance advertising runs under a third
-- party's brand BEFORE any partner agreement is signed. Nothing in this file
-- charges anything or sends anything; it is the record and the gates.
--
-- Spec: docs/specs/W4-live-trial.md. Owner terms: docs/specs/W0-decisions.md.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY A TABLE AT ALL, WHEN 042 ALREADY HAS partners
--
-- Because a trial is a STATE OF A PARTNER RELATIONSHIP THAT HAS NOT HAPPENED
-- YET, and partners has nowhere honest to put it. A trial buyer is a partners
-- row at status 'invited' — "record exists, cannot sign in, cannot be paid" —
-- and 042's payout trigger already refuses every payout while
-- agreement_signed_at is NULL. That is exactly the shape a trial needs, and it
-- is why a trial can safely create a partners row on day 0: an unsigned trial
-- partner is STRUCTURALLY UNPAYABLE.
--
-- What partners cannot carry is the trial's own facts: when the clock started,
-- whether it started at all, what the buyer answered at the gate, and what was
-- owed when it ended. Putting those on partners would mean every partner row
-- carrying seven columns that are NULL forever.
--
-- NO SECOND LEDGER. There is no money table here. Trial money is a payments
-- row like any other, partner money accrues through partner_revenue with
-- share_pct_applied frozen at accrual, and affiliate money runs through
-- affiliate_referrals. This file adds a record of a relationship, not a
-- second set of books.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE CLOCK COLUMN IS THE ONE THAT MATTERS: started_at
--
-- started_at is the FIRST AD IMPRESSION, not the checkout. NULL means the ads
-- have not served yet, and NULL must survive: nothing in this schema or the
-- code above it may default it to now() to make a screen easier to draw. A
-- buyer whose Meta verification is pending has a paid, provisioned, fully
-- delivered trial with started_at NULL for as long as Meta takes — that is the
-- held-start path, and it is correct.
--
-- ends_at is derived from started_at and is stored rather than computed on read
-- so that a change to the trial length never silently re-dates a trial that has
-- already run.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- NO ROW-LEVEL SECURITY ON THESE TABLES, DELIBERATELY
--
-- 045 installs partner isolation on the creative-factory tables and
-- src/partners/rls.mjs opens a scoped transaction for them. These two tables
-- follow partner_brand (043) instead: no RLS, and every read carries an
-- explicit org_id + partner_id predicate written by the endpoint, which
-- resolves partner_id from the SESSION and never from the query string.
--
-- The reason is not laziness. Provisioning and the day-8 conversion both run as
-- FundHub staff on a plain pooled connection, outside any partner scope. Under
-- FORCE row-level security those statements would see nothing, and the fix
-- would be a staff bypass — which is the hole, not the lock. Explicit
-- predicates plus requirePrincipal is the same posture partner_brand has held
-- since 043, and it is enforced by the endpoint tests rather than by hope.

-- ---------------------------------------------------------------------------
-- A. live_trials
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS live_trials (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),

  -- ONE TRIAL PER PARTNER. A second trial for the same buyer would split their
  -- leads, their dashboard and their day-8 record across two rows.
  partner_id    uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,

  -- Created on DAY 0, never on day 8. attribute() writes affiliate_referrals
  -- with ON CONFLICT DO NOTHING — first writer wins, permanently — so an
  -- affiliate account that appears a week late loses every lead another path
  -- already claimed. Day 0 removes the race completely.
  affiliate_id  uuid REFERENCES affiliates(id) ON DELETE SET NULL,

  contact_email text NOT NULL,

  --   pending_eligibility — gate asked, sale not made
  --   held_start          — paid; Meta verification pending, clock held
  --   provisioned         — paid and built, waiting on the first impression
  --   running             — the seven days are running
  --   ended               — seven live days complete; dashboard frozen, readable
  --   converted           — paid the entry fee, became a partner
  --   declined            — said no; keeps the leads, paid as an affiliate
  --   refunded            — money returned (day-1 guarantee or refused verification)
  status        text NOT NULL DEFAULT 'pending_eligibility',

  -- Integer cents, always. $297.00.
  price_cents   bigint NOT NULL DEFAULT 29700,

  -- TRUE when the trial was sold with the clock held because Meta business
  -- verification was not in yet. The buyer still got the funnel and the ad set
  -- on day 0; only the seven days waited.
  held_start    boolean NOT NULL DEFAULT false,

  -- What the buyer answered at the pre-checkout gate, as asked. Kept because
  -- "they said they had a budget" is the whole of the refund conversation when
  -- a trial spends nothing.
  eligibility   jsonb NOT NULL DEFAULT '{}'::jsonb,

  paid_at                   timestamptz,
  provisioned_at            timestamptz,
  verification_confirmed_at timestamptz,

  -- THE CLOCK. First ad impression. NULL until the ads actually serve.
  started_at    timestamptz,
  ends_at       timestamptz,

  -- The dashboard stays readable, frozen, until this moment. 30 days past the end.
  frozen_until  timestamptz,

  converted_at  timestamptz,
  declined_at   timestamptz,
  refunded_at   timestamptz,

  -- What the zero-call service remedy granted, if it was granted. NULL means
  -- no remedy was evaluated or none applied — it does not mean "nothing owed".
  remedy        jsonb,

  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT live_trials_status_ck CHECK (status IN (
    'pending_eligibility', 'held_start', 'provisioned', 'running',
    'ended', 'converted', 'declined', 'refunded')),

  CONSTRAINT live_trials_price_ck CHECK (price_cents >= 0),

  -- A running trial has a clock. Without this a screen can show "day 3 of 7"
  -- computed from nothing.
  CONSTRAINT live_trials_running_ck
    CHECK (status <> 'running' OR started_at IS NOT NULL),

  -- An ended trial has an end. Same reasoning, at the other boundary.
  CONSTRAINT live_trials_ended_ck
    CHECK (status <> 'ended' OR ends_at IS NOT NULL),

  -- ends_at is derived from started_at; one without the other is a half-written
  -- clock and every day count computed from it would be wrong.
  CONSTRAINT live_trials_clock_pair_ck
    CHECK ((started_at IS NULL) = (ends_at IS NULL)),

  -- A held-start trial cannot already be running: that is what "held" means.
  CONSTRAINT live_trials_held_ck
    CHECK (status <> 'held_start' OR started_at IS NULL),

  -- Day 8 has one answer. Both stamped is a record nobody can act on.
  CONSTRAINT live_trials_outcome_ck
    CHECK (converted_at IS NULL OR declined_at IS NULL),

  CONSTRAINT live_trials_converted_ck
    CHECK (status <> 'converted' OR converted_at IS NOT NULL),
  CONSTRAINT live_trials_declined_ck
    CHECK (status <> 'declined' OR declined_at IS NOT NULL),
  CONSTRAINT live_trials_refunded_ck
    CHECK (status <> 'refunded' OR refunded_at IS NOT NULL),

  CONSTRAINT live_trials_email_ck CHECK (btrim(contact_email) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS live_trials_partner_uniq
  ON live_trials (partner_id);
CREATE INDEX IF NOT EXISTS live_trials_org_status_idx
  ON live_trials (org_id, status);
-- The sweeper's read: trials whose seventh day has passed and which nobody has
-- closed out yet.
CREATE INDEX IF NOT EXISTS live_trials_open_clock_idx
  ON live_trials (ends_at)
  WHERE status IN ('running', 'provisioned', 'held_start');
CREATE INDEX IF NOT EXISTS live_trials_affiliate_idx
  ON live_trials (affiliate_id)
  WHERE affiliate_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- B. live_trial_events — append-only. What happened, when, and who did it.
-- ---------------------------------------------------------------------------
--
-- The audit answer to "who approved a regulated credit ad under someone else's
-- brand on the third of September" is a compliance_screenings row plus a named
-- approved_by. This table is the rest of the story around it: provisioned,
-- clock started, day-3 check done, remedy granted, converted, declined.
--
-- NO DELETES. Same archive-only posture as the ledger and the creative factory,
-- using the same fundhub_no_delete() guard 045 installs. A trial record that
-- can be tidied up is a trial record that cannot answer an audit.

CREATE TABLE IF NOT EXISTS live_trial_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  live_trial_id uuid NOT NULL REFERENCES live_trials(id) ON DELETE RESTRICT,

  kind          text NOT NULL,
  -- Free text, on purpose: a human note beside the machine fact.
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Who. A staff id when a person did it, NULL when the system did.
  actor_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,

  occurred_at   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT live_trial_events_kind_ck CHECK (btrim(kind) <> '')
);

CREATE INDEX IF NOT EXISTS live_trial_events_trial_idx
  ON live_trial_events (live_trial_id, occurred_at DESC);

DO $$
BEGIN
  IF to_regprocedure('fundhub_no_delete()') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
       WHERE tgname = 'live_trial_events_no_delete'
         AND tgrelid = 'live_trial_events'::regclass
    ) THEN
      EXECUTE 'CREATE TRIGGER live_trial_events_no_delete
                 BEFORE DELETE ON live_trial_events
                 FOR EACH ROW EXECUTE FUNCTION fundhub_no_delete()';
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- C. A NAMED HUMAN ON EVERY TRIAL CAMPAIGN — W4 §9.2
-- ---------------------------------------------------------------------------
--
-- 046's campaigns_credit_repair_approver_ck requires approved_by only for
-- credit_repair, and that asymmetry is deliberate and correct for ordinary
-- partners: approve_before_launch is a per-partner setting, so a funding
-- campaign may legitimately reach live with no human in the loop.
--
-- A TRIAL IS NOT AN ORDINARY PARTNER. During the seven days the buyer is not a
-- partner, not a signatory and not under any production standard, and FundHub's
-- regulated creative is running under their brand. §9.2 makes human approval
-- mandatory there, without exception.
--
-- WHY A TRIGGER AND NOT A CHECK. The condition is on another table — does this
-- campaign's partner have an open trial — and a CHECK constraint cannot see one.
-- WHY NOT WIDEN 046'S CHECK TO EVERY CAMPAIGN. That would break the supported
-- auto-approve path for signed partners who have switched it off, which is a
-- different decision belonging to a different unit. This trigger fires ONLY for
-- a partner with an open trial, so its blast radius is exactly the population
-- §9.2 is about.
--
-- Editing 046 in place would have been a silent no-op — migrate.mjs keys
-- schema_migrations on <dir>/<file> and never re-reads an applied one. Hence a
-- new file, which is the only way to supersede anything in this schema.

CREATE OR REPLACE FUNCTION live_trial_campaign_needs_approver() RETURNS trigger AS $$
DECLARE
  open_trial boolean;
BEGIN
  IF NEW.approval_state NOT IN ('approved', 'live') THEN
    RETURN NEW;
  END IF;
  IF NEW.approved_by IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM live_trials t
     WHERE t.partner_id = NEW.partner_id
       AND t.status IN ('held_start', 'provisioned', 'running', 'ended')
  ) INTO open_trial;

  IF open_trial THEN
    RAISE EXCEPTION
      'campaign % belongs to a partner with an open Live Trial: approved_by must name the human who approved it (W4 §9.2)',
      COALESCE(NEW.id::text, '(new)')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS campaigns_live_trial_approver ON campaigns;
CREATE TRIGGER campaigns_live_trial_approver
  BEFORE INSERT OR UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION live_trial_campaign_needs_approver();

-- ---------------------------------------------------------------------------
-- D. Grants
-- ---------------------------------------------------------------------------
--
-- 104_app_role.sql sets ALTER DEFAULT PRIVILEGES for fundhub_app, which covers
-- tables created afterwards by the same owner. Naming them explicitly costs
-- nothing and removes the dependency on who ran this file.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON live_trials TO fundhub_app';
    EXECUTE 'GRANT SELECT, INSERT ON live_trial_events TO fundhub_app';
  END IF;
END $$;

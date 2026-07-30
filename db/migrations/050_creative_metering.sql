-- 050_creative_metering.sql — usage metering for billing (Creative Factory UNIT 9).
--
-- RENUMBERED from the spec's 045. The spec allocated three migrations assuming 042
-- was the highest; 043 and 044 were already taken, and UNITs 4 and 6 needed config
-- tables the spec did not number. This is the last file in the module.
--
-- MIRRORS THE partner_revenue ACCRUAL PATTERN FROM 042, which means three things
-- specifically:
--
--   1. IDEMPOTENT ON source_event_id. Same event twice = one row, enforced by a
--      unique index rather than by a caller's check. A metering row inserted twice
--      is money the partner is billed twice, and it is the kind of bug that is only
--      discovered by the customer.
--
--   2. THE RATE IS STORED AS APPLIED. unit_cost_cents and rate_pct_applied are
--      copied onto the row at accrual time and never back-filled, so changing a
--      rate cannot retroactively restate what was already billed. That is only
--      possible if the historical rate lives on the historical row.
--
--   3. NOTHING DELETES. A billing record is voided with a reason, never removed.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- THE TWO RATES ARE DELIBERATELY UNSET. READ THIS BEFORE BILLING ANYONE.
--
-- The spec says: "Both rates are config values. Do not pick numbers — leave them
-- editable and flag them for me." So creative_billing_rates ships with the rows
-- present and rate NULL:
--
--     generation_markup_pct  — the markup on fundhub's generation cost
--     managed_spend_pct      — the percentage of managed ad spend
--
-- accrue_creative_usage() RAISES rather than inserting while the applicable rate is
-- null. That is the correct failure: a metering row written against a guessed rate
-- looks exactly like a real one, and nobody would find it until an invoice went
-- out. A loud stop is recoverable; a plausible number is not.
--
-- Set them like this, once the commercial terms are settled:
--   UPDATE creative_billing_rates SET rate = 25.0
--    WHERE org_id = (SELECT id FROM orgs WHERE is_default) AND rate_key = 'generation_markup_pct';
--
-- v_creative_config_gaps (048) surfaces these alongside the other unset values.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS creative_billing_rates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES orgs(id),
  rate_key   text NOT NULL,
  -- NULL means "not decided". Not zero: zero is a decision to bill nothing, and
  -- the two must not be confusable.
  rate       numeric(9,4),
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT creative_billing_rates_key_ck
    CHECK (rate_key IN ('generation_markup_pct', 'managed_spend_pct')),
  CONSTRAINT creative_billing_rates_rate_ck CHECK (rate IS NULL OR rate >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS creative_billing_rates_uniq
  ON creative_billing_rates (org_id, rate_key);

INSERT INTO creative_billing_rates (org_id, rate_key, rate, notes)
SELECT o.id, v.k, NULL, v.n
  FROM orgs o
  CROSS JOIN (VALUES
    ('generation_markup_pct',
     'FLAGGED FOR A HUMAN: markup applied to fundhub generation cost. Deliberately unset — generation billing raises until it is set.'),
    ('managed_spend_pct',
     'FLAGGED FOR A HUMAN: percentage of managed ad spend billed to the partner. Deliberately unset — spend billing raises until it is set.')
  ) AS v(k, n)
 WHERE o.is_default
   AND NOT EXISTS (SELECT 1 FROM creative_billing_rates r
                    WHERE r.org_id = o.id AND r.rate_key = v.k);

-- ---------------------------------------------------------------------------
-- creative_usage_events
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS creative_usage_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES orgs(id),
  partner_id       uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,

  --   generation    — one generation job's cost, marked up
  --   managed_spend — a slice of platform spend
  event_type       text NOT NULL,

  quantity         numeric(14,4) NOT NULL DEFAULT 1,
  -- Fundhub's underlying cost per unit, as applied. For managed_spend this is the
  -- spend being billed against.
  unit_cost_cents  bigint NOT NULL DEFAULT 0,
  -- The rate AS APPLIED, copied at accrual time. Changing the config rate must not
  -- restate history.
  rate_pct_applied numeric(9,4) NOT NULL,
  total_cents      bigint NOT NULL,

  -- Where it came from, so an accrual is traceable to the thing that caused it.
  generation_job_id uuid REFERENCES generation_jobs(id) ON DELETE SET NULL,
  campaign_id       uuid REFERENCES campaigns(id) ON DELETE SET NULL,

  -- The replay key. Same rule as partner_revenue: same event twice = one row.
  source_event_id  text NOT NULL,

  status           text NOT NULL DEFAULT 'accrued',
  void_reason      text,

  occurred_at      timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT creative_usage_events_type_ck CHECK (event_type IN ('generation', 'managed_spend')),
  CONSTRAINT creative_usage_events_status_ck CHECK (status IN ('accrued', 'billed', 'void')),
  CONSTRAINT creative_usage_events_void_ck CHECK (status <> 'void' OR void_reason IS NOT NULL),
  CONSTRAINT creative_usage_events_qty_ck   CHECK (quantity >= 0),
  CONSTRAINT creative_usage_events_cost_ck  CHECK (unit_cost_cents >= 0),
  CONSTRAINT creative_usage_events_total_ck CHECK (total_cents >= 0),
  CONSTRAINT creative_usage_events_rate_ck  CHECK (rate_pct_applied >= 0),
  CONSTRAINT creative_usage_events_src_ck   CHECK (btrim(source_event_id) <> '')
);

-- THE IDEMPOTENCY GUARD. Scoped per partner, like partner_revenue's, so two
-- partners deriving the same key cannot collide into one row.
CREATE UNIQUE INDEX IF NOT EXISTS creative_usage_events_source_uniq
  ON creative_usage_events (org_id, partner_id, source_event_id);
CREATE INDEX IF NOT EXISTS creative_usage_events_partner_idx
  ON creative_usage_events (partner_id, event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS creative_usage_events_billable_idx
  ON creative_usage_events (org_id, partner_id) WHERE status = 'accrued';

-- Billing records void, they do not delete — as 042 does for partner_revenue.
DROP TRIGGER IF EXISTS trg_creative_usage_events_no_delete ON creative_usage_events;
CREATE TRIGGER trg_creative_usage_events_no_delete
  BEFORE DELETE ON creative_usage_events
  FOR EACH ROW WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION fundhub_no_delete();

DO $$
DECLARE t text;
BEGIN
  PERFORM fundhub_apply_partner_rls('creative_usage_events');
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    FOREACH t IN ARRAY ARRAY['creative_usage_events', 'creative_billing_rates'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_' || t || '_updated_at'
                      AND tgrelid = ('public.' || t)::regclass) THEN
        EXECUTE format(
          'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
          'trg_' || t || '_updated_at', t);
      END IF;
    END LOOP;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- accrue_creative_usage — the one way a usage event is written
-- ---------------------------------------------------------------------------
--
-- A function rather than an INSERT at each call site, because the rate lookup, the
-- unset-rate guard and the idempotency key must be identical everywhere. A second
-- code path that forgot the guard would bill against a null rate as zero.
--
-- RAISES when the rate is unset. See the header: a loud stop is recoverable, a
-- plausible number is not.

CREATE OR REPLACE FUNCTION accrue_creative_usage(
  p_org uuid, p_partner uuid, p_event_type text,
  p_quantity numeric, p_unit_cost_cents bigint,
  p_source_event_id text,
  p_generation_job_id uuid DEFAULT NULL,
  p_campaign_id uuid DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  v_rate_key text;
  v_rate numeric;
  v_total bigint;
  v_id uuid;
BEGIN
  v_rate_key := CASE p_event_type
                  WHEN 'generation'    THEN 'generation_markup_pct'
                  WHEN 'managed_spend' THEN 'managed_spend_pct'
                END;
  IF v_rate_key IS NULL THEN
    RAISE EXCEPTION 'unknown creative usage event_type "%"', p_event_type;
  END IF;

  SELECT rate INTO v_rate FROM creative_billing_rates
   WHERE org_id = p_org AND rate_key = v_rate_key;

  IF v_rate IS NULL THEN
    RAISE EXCEPTION
      'creative_billing_rates.% is not set — refusing to accrue usage against an unchosen rate. Set it before billing (050_creative_metering.sql)',
      v_rate_key;
  END IF;

  -- Rounded once, here. Rounding at each call site is how two invoices for the
  -- same month disagree by a cent.
  v_total := round(p_quantity * p_unit_cost_cents * v_rate / 100.0);

  INSERT INTO creative_usage_events
    (org_id, partner_id, event_type, quantity, unit_cost_cents, rate_pct_applied,
     total_cents, generation_job_id, campaign_id, source_event_id, occurred_at)
  VALUES
    (p_org, p_partner, p_event_type, p_quantity, p_unit_cost_cents, v_rate,
     v_total, p_generation_job_id, p_campaign_id, p_source_event_id,
     COALESCE(p_occurred_at, now()))
  ON CONFLICT (org_id, partner_id, source_event_id) DO NOTHING
  RETURNING id INTO v_id;

  -- No row back means the unique index absorbed a replay. That is a successful
  -- dedupe, so the existing id is returned rather than an error.
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM creative_usage_events
     WHERE org_id = p_org AND partner_id = p_partner AND source_event_id = p_source_event_id;
  END IF;

  RETURN v_id;
END $$ LANGUAGE plpgsql;

-- v_partner_creative_usage — the billing summary UNIT 8 renders.
CREATE OR REPLACE VIEW v_partner_creative_usage AS
SELECT e.org_id,
       e.partner_id,
       e.event_type,
       date_trunc('month', e.occurred_at) AS period,
       count(*)::int                      AS events,
       sum(e.quantity)                    AS quantity,
       sum(e.unit_cost_cents)::bigint     AS underlying_cost_cents,
       sum(e.total_cents) FILTER (WHERE e.status <> 'void')::bigint AS billable_cents,
       sum(e.total_cents) FILTER (WHERE e.status = 'void')::bigint  AS voided_cents
  FROM creative_usage_events e
 GROUP BY e.org_id, e.partner_id, e.event_type, date_trunc('month', e.occurred_at);

COMMENT ON VIEW v_partner_creative_usage IS
  'Monthly creative usage per partner. SECURITY INVOKER so RLS applies to the caller — do not convert to SECURITY DEFINER.';

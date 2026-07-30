-- 042_partners.sql — the white-label business.
--
-- PARTNERS ARE NOT AFFILIATES, and keeping them apart in the schema is the point
-- of having two sets of tables rather than a `kind` column on one:
--   an AFFILIATE refers a client to fundhub and earns commission on that client.
--     The client is fundhub's. Modelled in 033_affiliates.sql.
--   a PARTNER runs their own brand on this platform and earns revenue share on
--     their own book. The client is THEIRS, and fundhub must never show it to
--     another partner.
-- Collapsing them would put one shared scope predicate over two different
-- ownership models, which is exactly how a cross-tenant leak happens.
--
-- REVENUE SHARE IS CONFIGURATION. revenue_share_pct lives on the partner row with
-- a documented default of 50, and every accrual stores the rate it actually used.
-- No percentage is written in code anywhere: a rate that changes must not
-- retroactively restate money already accrued, which is only possible if the
-- historical rate is on the historical row.
--
-- THE ISOLATION BOUNDARY. clients.partner_id is the whole tenancy model:
--   NULL          → a direct fundhub client
--   set           → belongs to that partner and to no other
-- Every partner-facing read goes through src/partners/scope.mjs. This migration
-- gives that predicate something indexable to stand on, and adds the constraints
-- that make a leak a database error rather than a rendering accident.

-- ---------------------------------------------------------------------------
-- A. partners
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS partners (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs(id),

  name                text NOT NULL,          -- the legal/operator name
  brand_name          text,                   -- what their clients see
  slug                text NOT NULL,          -- URL key; unique per org

  --   invited — record exists, cannot sign in, cannot be paid
  --   active  — operating
  --   paused  — suspended; keeps its book and its balance, cannot be paid
  status              text NOT NULL DEFAULT 'invited',

  -- Per-partner, configurable, never a constant in code. 50 is the documented
  -- default, not a rule: a signed agreement overrides it on the row.
  revenue_share_pct   numeric(9,5) NOT NULL DEFAULT 50,

  -- The hold. No payout may reach processing or paid before this is stamped,
  -- mirroring the affiliate partner-license hold in 033.
  agreement_signed_at timestamptz,

  contact_email       text,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT partners_status_ck CHECK (status IN ('invited', 'active', 'paused')),
  CONSTRAINT partners_share_ck  CHECK (revenue_share_pct >= 0 AND revenue_share_pct <= 100),
  CONSTRAINT partners_slug_ck   CHECK (slug = lower(btrim(slug)) AND slug <> ''),
  -- A slug is a URL key; anything outside this charset breaks routing. It must
  -- also START and END alphanumeric: "alpha-" and "alpha" are visually near
  -- identical and would both be valid, which is how a white-label partner ends up
  -- one typo away from another partner's URL.
  CONSTRAINT partners_slug_fmt_ck CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$')
);

CREATE UNIQUE INDEX IF NOT EXISTS partners_slug_uniq ON partners (org_id, slug);
CREATE INDEX IF NOT EXISTS partners_status_idx ON partners (org_id, status);

-- ---------------------------------------------------------------------------
-- B. clients.partner_id — the tenancy column
-- ---------------------------------------------------------------------------

ALTER TABLE clients ADD COLUMN IF NOT EXISTS partner_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_partner_fk') THEN
    -- RESTRICT, not CASCADE and not SET NULL. Deleting a partner must not delete
    -- their clients, and must not silently reassign them to fundhub direct
    -- either — both are data loss dressed as a cleanup. Detach deliberately or
    -- not at all.
    ALTER TABLE clients
      ADD CONSTRAINT clients_partner_fk
      FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE RESTRICT;
  END IF;
END $$;

COMMENT ON COLUMN clients.partner_id IS
  'Owning partner, or NULL for a direct fundhub client. The tenancy boundary — every partner-facing read filters on it via src/partners/scope.mjs.';

-- Partial: the direct book is the majority and is never queried by partner, so
-- indexing NULLs would be dead weight.
CREATE INDEX IF NOT EXISTS clients_partner_idx
  ON clients (org_id, partner_id) WHERE partner_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- C. partner_revenue — accrual, one row per qualifying transaction
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS partner_revenue (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES orgs(id),
  partner_id        uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  client_id         uuid REFERENCES clients(id) ON DELETE SET NULL,

  transaction_id    uuid REFERENCES transactions(id) ON DELETE SET NULL,
  -- The replay key. Rule: same event twice = one row.
  source_event_id   uuid REFERENCES events(id) ON DELETE SET NULL,

  gross_amount      numeric(14,2) NOT NULL,
  -- The rate AS APPLIED. Copied from the partner row at accrual time and never
  -- back-filled: changing revenue_share_pct must not restate history.
  share_pct_applied numeric(9,5) NOT NULL,
  share_amount      numeric(14,2) NOT NULL,
  currency          text NOT NULL DEFAULT 'USD',

  --   accrued — earned, not yet in a payout run
  --   paid    — settled through a payout line
  --   void    — reversed (refund, chargeback, correction)
  status            text NOT NULL DEFAULT 'accrued',
  void_reason       text,

  occurred_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT partner_revenue_status_ck CHECK (status IN ('accrued', 'paid', 'void')),
  CONSTRAINT partner_revenue_void_ck   CHECK (status <> 'void' OR void_reason IS NOT NULL),
  CONSTRAINT partner_revenue_gross_ck  CHECK (gross_amount >= 0),
  CONSTRAINT partner_revenue_share_ck  CHECK (share_amount >= 0),
  CONSTRAINT partner_revenue_pct_ck
    CHECK (share_pct_applied >= 0 AND share_pct_applied <= 100)
);

-- Idempotency, two ways, because an accrual can be driven from either side:
-- by event (replay of the bus) or by transaction (a re-run of a backfill).
CREATE UNIQUE INDEX IF NOT EXISTS partner_revenue_event_uniq
  ON partner_revenue (org_id, source_event_id, partner_id)
  WHERE source_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS partner_revenue_tx_uniq
  ON partner_revenue (org_id, transaction_id, partner_id)
  WHERE transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS partner_revenue_partner_idx
  ON partner_revenue (partner_id, status, occurred_at DESC);
CREATE INDEX IF NOT EXISTS partner_revenue_payable_idx
  ON partner_revenue (org_id, partner_id) WHERE status = 'accrued';

-- Money already earned is not disposable. Void it; do not delete it.
CREATE OR REPLACE FUNCTION partner_revenue_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'partner_revenue rows are not deletable — set status to void with a reason (042_partners.sql)';
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_partner_revenue_no_delete ON partner_revenue;
CREATE TRIGGER trg_partner_revenue_no_delete
  BEFORE DELETE ON partner_revenue
  FOR EACH ROW WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION partner_revenue_no_delete();

-- ---------------------------------------------------------------------------
-- D. partner_payouts + lines — mirroring 033_affiliates.sql's shape
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS partner_payouts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),
  partner_id      uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,

  -- Half-open [start, end) so consecutive runs cannot both claim one instant.
  period_start    timestamptz NOT NULL,
  period_end      timestamptz NOT NULL,

  amount          numeric(14,2) NOT NULL DEFAULT 0,
  currency        text NOT NULL DEFAULT 'USD',

  status          text NOT NULL DEFAULT 'pending',
  hold_reason     text,
  void_reason     text,

  method          text,
  external_ref    text,
  initiated_at    timestamptz,
  paid_at         timestamptz,

  idempotency_key text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT partner_payouts_status_ck
    CHECK (status IN ('pending', 'held', 'processing', 'paid', 'void')),
  CONSTRAINT partner_payouts_period      CHECK (period_end > period_start),
  CONSTRAINT partner_payouts_hold_reason CHECK (status <> 'held' OR hold_reason IS NOT NULL),
  CONSTRAINT partner_payouts_void_reason CHECK (status <> 'void' OR void_reason IS NOT NULL),
  CONSTRAINT partner_payouts_paid_at     CHECK (status <> 'paid' OR paid_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS partner_payouts_idem_uniq
  ON partner_payouts (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS partner_payouts_partner_idx
  ON partner_payouts (partner_id, status, period_end DESC);
CREATE INDEX IF NOT EXISTS partner_payouts_open_idx
  ON partner_payouts (org_id, status) WHERE status IN ('pending', 'held', 'processing');

CREATE TABLE IF NOT EXISTS partner_payout_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id),
  payout_id   uuid NOT NULL REFERENCES partner_payouts(id) ON DELETE CASCADE,
  revenue_id  uuid NOT NULL REFERENCES partner_revenue(id) ON DELETE RESTRICT,
  client_id   uuid REFERENCES clients(id) ON DELETE SET NULL,
  amount      numeric(14,2) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_payout_lines_amount_ck CHECK (amount >= 0)
);

-- An accrual settles exactly once, across all runs. This is the double-pay guard.
CREATE UNIQUE INDEX IF NOT EXISTS partner_payout_lines_revenue_once
  ON partner_payout_lines (revenue_id);
CREATE INDEX IF NOT EXISTS partner_payout_lines_payout_idx
  ON partner_payout_lines (payout_id);

-- THE AGREEMENT HOLD, enforced by the database rather than by the caller: a run
-- cannot reach processing or paid while the partner has not signed. Revenue keeps
-- accruing; it just does not release.
CREATE OR REPLACE FUNCTION partner_payout_agreement_gate() RETURNS trigger AS $$
DECLARE signed timestamptz; st text;
BEGIN
  IF NEW.status NOT IN ('processing', 'paid') THEN RETURN NEW; END IF;
  SELECT agreement_signed_at, status INTO signed, st
    FROM partners WHERE id = NEW.partner_id;
  IF signed IS NULL THEN
    RAISE EXCEPTION
      'partner % has not signed an agreement — payout cannot be % (042_partners.sql)',
      NEW.partner_id, NEW.status;
  END IF;
  IF st <> 'active' THEN
    RAISE EXCEPTION
      'partner % is %, not active — payout cannot be %', NEW.partner_id, st, NEW.status;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_partner_payout_agreement_gate ON partner_payouts;
CREATE TRIGGER trg_partner_payout_agreement_gate
  BEFORE INSERT OR UPDATE OF status ON partner_payouts
  FOR EACH ROW EXECUTE FUNCTION partner_payout_agreement_gate();

-- A payout line must belong to the same partner as the accrual it settles.
-- Without this, a line could pay partner A out of partner B's revenue.
CREATE OR REPLACE FUNCTION partner_payout_line_same_partner() RETURNS trigger AS $$
DECLARE rev_partner uuid; pay_partner uuid;
BEGIN
  SELECT partner_id INTO rev_partner FROM partner_revenue WHERE id = NEW.revenue_id;
  SELECT partner_id INTO pay_partner FROM partner_payouts WHERE id = NEW.payout_id;
  IF rev_partner IS DISTINCT FROM pay_partner THEN
    RAISE EXCEPTION
      'payout line crosses partners: revenue belongs to % but payout is for % (042_partners.sql)',
      rev_partner, pay_partner;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_partner_payout_line_same_partner ON partner_payout_lines;
CREATE TRIGGER trg_partner_payout_line_same_partner
  BEFORE INSERT OR UPDATE ON partner_payout_lines
  FOR EACH ROW EXECUTE FUNCTION partner_payout_line_same_partner();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_partners_updated_at'
                    AND tgrelid = 'public.partners'::regclass) THEN
      CREATE TRIGGER trg_partners_updated_at BEFORE UPDATE ON partners
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_partner_revenue_updated_at'
                    AND tgrelid = 'public.partner_revenue'::regclass) THEN
      CREATE TRIGGER trg_partner_revenue_updated_at BEFORE UPDATE ON partner_revenue
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_partner_payouts_updated_at'
                    AND tgrelid = 'public.partner_payouts'::regclass) THEN
      CREATE TRIGGER trg_partner_payouts_updated_at BEFORE UPDATE ON partner_payouts
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- E. views
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_partner_balance AS
SELECT p.org_id,
       p.id AS partner_id,
       p.slug,
       p.name,
       p.status,
       p.revenue_share_pct,
       (p.agreement_signed_at IS NOT NULL) AS agreement_signed,
       COALESCE(sum(r.share_amount) FILTER (WHERE r.status = 'accrued'), 0) AS balance_accrued,
       COALESCE(sum(r.share_amount) FILTER (WHERE r.status = 'paid'), 0)    AS total_paid,
       count(r.id) FILTER (WHERE r.status = 'accrued')                      AS open_accruals
  FROM partners p
  LEFT JOIN partner_revenue r ON r.partner_id = p.id
 GROUP BY p.org_id, p.id, p.slug, p.name, p.status, p.revenue_share_pct, p.agreement_signed_at;

CREATE OR REPLACE VIEW v_partner_book AS
SELECT c.org_id, c.partner_id, count(*)::int AS clients
  FROM clients c
 WHERE c.partner_id IS NOT NULL
 GROUP BY c.org_id, c.partner_id;

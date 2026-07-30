-- 032_entitlements.sql — what a client has bought, and therefore may access.
--
-- THE GAP. public/app/client-portal.html shows five deliverables and has no way
-- to know which of them a given client is entitled to, so it shows all five to
-- everyone. There is nothing to gate on: `transactions` records that money
-- arrived and `products` records what is for sale, but nothing records what a
-- payment ENTITLED someone to. Locked tiles are also the upsell surface, so the
-- absence costs revenue as well as correctness.
--
-- THREE TABLES, and the split matters:
--
--   entitlement_catalog  — the grantable things. A catalog, so the portal can
--                          render a locked tile for something the client has NOT
--                          bought. Without it, "locked" is unrepresentable: you
--                          can only show what exists in the grant ledger.
--   product_entitlements — configuration. Which product grants which
--                          entitlements. A mapping table rather than a CASE in
--                          code, for the same reason commission rates are rows
--                          (013_commission_rules.sql): it changes with the offer
--                          and must not need a deploy.
--   entitlements         — the grant ledger. Append-mostly, one row per grant.
--
-- NOTHING HARD-DELETES. Documents stay retrievable years later, so a grant that
-- ends is stamped, never removed: revoked_at for a withdrawal, expires_at for a
-- term. resolve-time filtering uses those, and the row survives either way. A
-- DELETE trigger blocks the accident, as 016_ledger_no_delete.sql does for the
-- commission ledger.
--
-- RE-DELIVERY. A grant must survive it. The unique index is on
-- (org_id, client_id, entitlement_code, source_transaction_id) NULLS NOT
-- DISTINCT, so re-processing the same payment re-grants nothing, while a genuine
-- second purchase of the same thing (a second repair round, say) is a separate
-- transaction and so a separate row. source_event_id is carried for the same
-- reason the dead-letter queue carries it: replay must be provably one-shot.
--
-- WHAT IS DELIBERATELY NOT SEEDED — read this before wiring the portal.
--   product_entitlements is EMPTY. The five deliverables below are sourced: they
--   are the tiles public/app/client-portal.html actually renders. Which PRODUCT
--   grants which of them is NOT documented anywhere in this repo — not in
--   015_seed_products.sql, not in fundhub-docs/sources/, not in the portal
--   markup. Guessing it would decide an offer question in a migration, so the
--   mapping is left for a human to fill in and the portal keeps its sample
--   markup until then (rule: fall back, do not blank).
--
--   Insert the mapping like this, once the offer is settled:
--     INSERT INTO product_entitlements (org_id, product_code, entitlement_code)
--     SELECT id, 'repair-bundle', 'metro2-letter-pack' FROM orgs WHERE is_default;

CREATE TABLE IF NOT EXISTS entitlement_catalog (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  code          text NOT NULL,
  name          text NOT NULL,
  description   text,
  -- What kind of thing this is, which is how the portal decides where to render
  -- it. Kept small and additive.
  kind          text NOT NULL DEFAULT 'deliverable',
  sort_order    integer NOT NULL DEFAULT 100,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entitlement_catalog_kind_ck
    CHECK (kind IN ('deliverable', 'feature', 'service')),
  CONSTRAINT entitlement_catalog_code_ck CHECK (code = lower(btrim(code)))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_entitlement_catalog_code
  ON entitlement_catalog (org_id, code);

CREATE TABLE IF NOT EXISTS product_entitlements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES orgs(id),
  -- products.code, matched softly by text the way 013_commission_rules.sql
  -- references staff_roles.key: the seed can be re-run and a product renamed
  -- without a cascade rewriting grant history.
  product_code      text NOT NULL,
  entitlement_code  text NOT NULL,
  -- A term-limited grant. NULL means perpetual, which is the default for a
  -- delivered document.
  duration_days     integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_entitlements_duration_ck
    CHECK (duration_days IS NULL OR duration_days > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_entitlements_pair
  ON product_entitlements (org_id, product_code, entitlement_code);

CREATE TABLE IF NOT EXISTS entitlements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES orgs(id),
  client_id             uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  entitlement_code      text NOT NULL,

  -- Where the grant came from. A transaction for a purchase; NULL for a manual
  -- or comped grant, which granted_by then explains.
  source_transaction_id uuid REFERENCES transactions(id) ON DELETE SET NULL,
  source_event_id       uuid REFERENCES events(id) ON DELETE SET NULL,
  granted_by            uuid REFERENCES staff(id) ON DELETE SET NULL,
  grant_reason          text,

  granted_at            timestamptz NOT NULL DEFAULT now(),
  -- NULL = perpetual. A delivered document does not stop being delivered.
  expires_at            timestamptz,
  revoked_at            timestamptz,
  revoked_by            uuid REFERENCES staff(id) ON DELETE SET NULL,
  revoke_reason         text,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT entitlements_code_ck CHECK (entitlement_code = lower(btrim(entitlement_code))),
  -- A revocation must say when, so "was this ever active" is answerable later.
  CONSTRAINT entitlements_revoked_ck
    CHECK ((revoked_by IS NULL AND revoke_reason IS NULL) OR revoked_at IS NOT NULL)
);

-- The re-delivery guard. NULLS NOT DISTINCT so repeated manual grants of the
-- same code (source_transaction_id NULL) also collapse to one row rather than
-- stacking every time an operator clicks.
CREATE UNIQUE INDEX IF NOT EXISTS idx_entitlements_grant_unique
  ON entitlements (org_id, client_id, entitlement_code, source_transaction_id)
  NULLS NOT DISTINCT;

-- The portal's read: everything this client holds.
CREATE INDEX IF NOT EXISTS idx_entitlements_client
  ON entitlements (org_id, client_id, entitlement_code);

-- "who holds this" — the reverse read, for an ops screen.
CREATE INDEX IF NOT EXISTS idx_entitlements_code
  ON entitlements (org_id, entitlement_code)
  WHERE revoked_at IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_entitlements_updated_at'
                    AND tgrelid = 'public.entitlements'::regclass) THEN
      CREATE TRIGGER trg_entitlements_updated_at BEFORE UPDATE ON entitlements
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_entitlement_catalog_updated_at'
                    AND tgrelid = 'public.entitlement_catalog'::regclass) THEN
      CREATE TRIGGER trg_entitlement_catalog_updated_at BEFORE UPDATE ON entitlement_catalog
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
  END IF;
END $$;

-- A grant is a record of something the client was promised. Revoke it, do not
-- erase it. The clients CASCADE path stays open, so deleting a client still
-- works; only direct deletes are blocked.
CREATE OR REPLACE FUNCTION entitlements_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'entitlements rows are not deletable — set revoked_at instead (032_entitlements.sql)';
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_entitlements_no_delete ON entitlements;
CREATE TRIGGER trg_entitlements_no_delete
  BEFORE DELETE ON entitlements
  FOR EACH ROW WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION entitlements_no_delete();

-- v_client_entitlements — what the portal reads. Resolves active-ness once, here,
-- so no caller has to remember the revoked/expired rules. LEFT JOIN to the
-- catalog so a grant of a code that has since been retired still resolves.
CREATE OR REPLACE VIEW v_client_entitlements AS
SELECT e.org_id,
       e.client_id,
       e.entitlement_code,
       c.name         AS entitlement_name,
       c.kind,
       c.sort_order,
       e.granted_at,
       e.expires_at,
       e.revoked_at,
       (e.revoked_at IS NULL
        AND (e.expires_at IS NULL OR e.expires_at > now())) AS active,
       e.source_transaction_id
  FROM entitlements e
  LEFT JOIN entitlement_catalog c
         ON c.org_id = e.org_id AND c.code = e.entitlement_code;

-- The five deliverables the client portal actually renders. Sourced from the
-- shipped markup (public/app/client-portal.html), not invented — see FIELD-NOTES
-- for the addition of the fifth. Guarded so re-running is a no-op, in the style
-- of 020_auth.sql's role seed.
INSERT INTO entitlement_catalog (org_id, code, name, description, kind, sort_order)
SELECT o.id, v.code, v.name, v.description, 'deliverable', v.sort_order
  FROM orgs o
  CROSS JOIN (VALUES
    ('credit-analysis-report',   'Credit Analysis Report',
     'The analyzer output the client receives.', 10),
    ('credit-optimization-roadmap', 'Credit Optimization Roadmap',
     'The optimization plan derived from the analysis.', 20),
    ('funding-snapshot',         'Funding Snapshot',
     'Position and prequalification estimate at a point in time.', 30),
    ('bank-lender-match-list',   'Bank and Lender Match List',
     'Which institutions match the client profile.', 40),
    ('metro2-letter-pack',       'Metro 2 Dispute Letter Pack',
     'The paid DIY letter pack. Delivered by ds-02.', 50)
  ) AS v(code, name, description, sort_order)
 WHERE o.is_default
   AND NOT EXISTS (
     SELECT 1 FROM entitlement_catalog ec
      WHERE ec.org_id = o.id AND ec.code = v.code
   );

-- product_entitlements is intentionally left EMPTY. See the header.

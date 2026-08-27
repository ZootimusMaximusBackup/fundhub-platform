-- 262_slo_connections.sql
-- COMPLIANCE REVIEW REQUIRED — payment rails.
--
-- First SLO slice: the owner maps a ClickFunnels funnel ID + product ID to one
-- Fundhub product and can turn that map on or off. A signed ClickFunnels paid
-- webhook writes a sales row on the client named in the payload. The offer is
-- never chosen by email, phone, product name, or price.
--
-- Soft pull, UnderwriteIQ, paper mail, recurring, white-label, and GHL are
-- not in this file.

CREATE TABLE IF NOT EXISTS slo_connections (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id),
  name           text NOT NULL,
  cf_funnel_id   text NOT NULL,
  cf_product_id  text NOT NULL,
  product_id     uuid NOT NULL REFERENCES products(id),
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT slo_connections_name_ck CHECK (btrim(name) <> ''),
  CONSTRAINT slo_connections_funnel_ck CHECK (btrim(cf_funnel_id) <> ''),
  CONSTRAINT slo_connections_cf_product_ck CHECK (btrim(cf_product_id) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS slo_connections_org_cf_uniq
  ON slo_connections (
    org_id,
    lower(btrim(cf_funnel_id)),
    lower(btrim(cf_product_id))
  );

CREATE INDEX IF NOT EXISTS slo_connections_org_active_idx
  ON slo_connections (org_id, active);

CREATE INDEX IF NOT EXISTS slo_connections_product_idx
  ON slo_connections (product_id);

DROP TRIGGER IF EXISTS trg_slo_connections_updated ON slo_connections;
CREATE TRIGGER trg_slo_connections_updated BEFORE UPDATE ON slo_connections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE slo_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE slo_connections FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'slo_connections'
       AND policyname = 'slo_connections_app_all'
  ) THEN
    CREATE POLICY slo_connections_app_all ON slo_connections
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON slo_connections TO fundhub_app;
  ELSE
    RAISE NOTICE 'skipped grants: role fundhub_app does not exist in this database';
  END IF;
END $$;

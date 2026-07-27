-- 010 — PRODUCTS. What we sell.
--
-- Master Rebuild Spec §12 (Billing Engine) + Hard Rule 4 (route by NAME, never
-- by dollar amount). 001_init.sql is never edited; this is additive.
--
-- THE CORE IDEA, and the reason this table looks the way it does:
--
--   Product identity is the RECORD, not the name and never the amount.
--   The product carries DEFAULTS (a prefill for the sale screen).
--   The SALE carries the agreed terms (see 011_sales.sql).
--
-- Chris edits `name`, `default_price` and `default_success_fee_percent` from the
-- admin screen whenever he likes. Nothing downstream reads a price off this table
-- at calculation time, and nothing stores a copy of the name, so a rename or a
-- reprice cannot corrupt a single existing sale or commission.
--
-- Everything here is idempotent and re-runnable.

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),

  -- code: stable machine handle. Set once at creation, then LEAVE IT ALONE.
  -- Seeds, imports and support scripts key on this. It is deliberately not the
  -- thing the team reads on screen — that is `name`.
  code          text NOT NULL,

  -- name: the editable, human-facing product name. Change it freely. A trigger
  -- below preserves the old name as a routing alias so inbound webhooks still
  -- resolve. This is the string the whole team sees, everywhere.
  name          text NOT NULL,
  description   text,

  -- category: which side of the business this product belongs to. Free text on
  -- purpose (no CHECK) so Chris can add one without a developer.
  -- In use today: funding | repair | diagnostic | consulting | inquiry_removal
  category      text,

  -- PRICING. Read this carefully before wiring a screen to it.
  -- default_price is a PREFILL ONLY. It is what the sale form suggests. It is
  -- NOT what anyone owes. The authoritative number is sales.agreed_price, set
  -- per client, per sale. Changing default_price affects only future sale forms.
  default_price          numeric(14,2) CHECK (default_price IS NULL OR default_price >= 0),
  min_price              numeric(14,2) CHECK (min_price IS NULL OR min_price >= 0),
  max_price              numeric(14,2) CHECK (max_price IS NULL OR max_price >= 0),
  price_is_variable      boolean NOT NULL DEFAULT true,

  -- Client-facing success fee (the §12 "10% success fee closeout", AX20/AX21).
  -- Also a prefill only — the agreed percent freezes onto the sale.
  -- 10.0000 means 10%.
  default_success_fee_percent numeric(7,4)
    CHECK (default_success_fee_percent IS NULL
           OR (default_success_fee_percent >= 0 AND default_success_fee_percent <= 100)),

  -- Products are never deleted, because sales point at them forever.
  -- Retiring a product = active = false. It disappears from the sale form and
  -- stays intact on every historical record.
  active        boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  notes         text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT products_price_band CHECK (
    min_price IS NULL OR max_price IS NULL OR min_price <= max_price
  )
);

-- code is the stable key; name is unique so the admin screen cannot end up with
-- two products both called "Repair Bundle" that nobody can tell apart.
CREATE UNIQUE INDEX IF NOT EXISTS products_org_code_uniq ON products (org_id, lower(code));
CREATE UNIQUE INDEX IF NOT EXISTS products_org_name_uniq ON products (org_id, lower(name));
CREATE INDEX IF NOT EXISTS products_org_active_idx ON products (org_id, active, sort_order);
CREATE INDEX IF NOT EXISTS products_org_category_idx ON products (org_id, category);

-- ---------------------------------------------------------------------------
-- product_aliases — the piece that makes an editable name safe.
--
-- Inbound webhooks (Commas, ClickFunnels) carry a product STRING, not our uuid.
-- transactions.product_name in 001_init.sql is exactly that string. This table
-- resolves any such string — current name, previous name, provider SKU, legacy
-- GHL label — to the one product record.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_aliases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id),
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  alias       text NOT NULL,
  -- where this string arrives from: commas | clickfunnels | legacy | rename | manual
  source      text NOT NULL DEFAULT 'manual',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS product_aliases_org_alias_uniq
  ON product_aliases (org_id, lower(alias));
CREATE INDEX IF NOT EXISTS product_aliases_product_idx ON product_aliases (product_id);

-- ---------------------------------------------------------------------------
-- Rename safety. When Chris edits products.name, the OLD name is retained as a
-- routing alias automatically. A Commas webhook still carrying last month's
-- product string keeps landing on the right product, forever, with no deploy.
--
-- This is what "the change propagates everywhere without breaking existing
-- sales" means in practice: sales already reference product_id, and inbound
-- strings keep resolving through here.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION products_retain_old_name() RETURNS trigger AS $$
BEGIN
  IF lower(NEW.name) IS DISTINCT FROM lower(OLD.name) THEN
    INSERT INTO product_aliases (org_id, product_id, alias, source)
    VALUES (OLD.org_id, OLD.id, OLD.name, 'rename')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_retain_old_name ON products;
CREATE TRIGGER trg_products_retain_old_name
  AFTER UPDATE OF name ON products
  FOR EACH ROW EXECUTE FUNCTION products_retain_old_name();

-- A product's current name always resolves too, without needing an alias row.
--
-- The current name is ranked ahead of any alias explicitly. UNION ALL does not
-- guarantee ordering, so without the rank column a stale alias could win over a
-- live product name — which is exactly the failure this whole mechanism exists
-- to prevent.
CREATE OR REPLACE FUNCTION resolve_product_id(p_org_id uuid, p_name text)
RETURNS uuid AS $$
  SELECT m.product_id FROM (
    SELECT p.id AS product_id, 0 AS rank
      FROM products p
     WHERE p.org_id = p_org_id AND lower(p.name) = lower(btrim(p_name))
    UNION ALL
    SELECT a.product_id, 1
      FROM product_aliases a
     WHERE a.org_id = p_org_id AND lower(a.alias) = lower(btrim(p_name))
  ) m
  ORDER BY m.rank
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------------
-- updated_at triggers (001_init.sql convention).
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_products_updated ON products;
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_product_aliases_updated ON product_aliases;
CREATE TRIGGER trg_product_aliases_updated BEFORE UPDATE ON product_aliases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 286_client_ad_attribution.sql — which ad brought each client, as typed columns.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT WAS MISSING
--
-- A Meta ad URL carries five UTMs. The ClickFunnels application form captures
-- them in hidden fields and the webhook delivers them under `attribution`.
-- src/handlers/client-lifecycle.mjs already folds the seven raw values into
-- clients.custom_fields (jsonb). That is a blob: nothing can GROUP BY it
-- cheaply, nothing constrains what lands in it, and the three things a closer
-- and the ad-buyer actually ask about — the LANE, the AD, the VARIANT — were
-- never derived anywhere. This table is where those three become columns.
--
-- THE WIRE FORMAT (owner-set 2026-09-03):
--
--   utm_source   = fb
--   utm_medium   = paid
--   utm_campaign = lane        → funding600 | premium | sorting | uwiq | wl
--   utm_content  = ad id       → number-slug: 16-phase, 26-underwriter, 42-ringlights
--   utm_term     = variant     → sun | nosun | sedona
--
-- DERIVED, NOT TYPED TWICE. lane, ad_id and variant are GENERATED ALWAYS
-- columns computed from utm_campaign / utm_content / utm_term. The writer only
-- ever stores the raw UTMs; the database does the parsing, once, the same way
-- for every row, and the application cannot disagree with it. A row where the
-- raw value and the derived value drift apart is impossible by construction.
--
-- THE ENUM. ad_lane is a real Postgres enum, not a text column with a CHECK.
-- `unknown` is a member on purpose: a UTM this file does not recognise is a
-- fact worth keeping (somebody typed a campaign name wrong, or a non-Meta link
-- was shared) and the raw utm_campaign beside it says what was actually sent.
-- It is never NULL: no campaign at all is also `unknown`.
--
-- ad_id is the LEADING DIGITS of utm_content and nothing else. "16-phase" → 16,
-- "16" → 16, "oVid: 3" → NULL. Strict on purpose: a value that is not
-- number-slug is not an ad id from this system, and a NULL here says so rather
-- than guessing. The registry (docs/ads/registry.json) resolves the id to its
-- tags at read time; an id the registry does not know resolves to the sorting
-- default in src/ads/registry.mjs, not here.
--
-- variant is utm_term lowercased and squeezed to [a-z0-9_-], so the CHECK on it
-- is satisfied by construction. The squeeze exists so a stray utm_term can
-- never make the INSERT fail: this row is written inside the entry.captured
-- handler, and a lead must never be lost because its ad tag was odd.
--
-- FIRST TOUCH WINS. One row per client, keyed on client_id. A second
-- entry.captured for the same person fills in blanks but never overwrites a
-- value already there — the ad that brought them is the one that gets credit.
-- The writer expresses that with COALESCE(existing, new) in its ON CONFLICT.
--
-- RLS. Enabled, forced, with the same permissive `_app_all` policy the clients
-- table carries (see 285 for why enable-plus-policy rather than off). Isolation
-- is org_id in the application layer, exactly as for clients.
--
-- SAFETY. Additive and idempotent. No DELETE, no UPDATE of existing rows,
-- nothing revoked. Re-running it is a no-op.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ad_lane') THEN
    CREATE TYPE ad_lane AS ENUM ('funding600', 'premium', 'sorting', 'uwiq', 'wl', 'unknown');
  END IF;
END $$;

-- utm_campaign → lane. Case- and whitespace-insensitive; anything else is unknown.
CREATE OR REPLACE FUNCTION fundhub_ad_lane(campaign text) RETURNS ad_lane
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE lower(btrim(coalesce(campaign, '')))
    WHEN 'funding600' THEN 'funding600'::ad_lane
    WHEN 'premium'    THEN 'premium'::ad_lane
    WHEN 'sorting'    THEN 'sorting'::ad_lane
    WHEN 'uwiq'       THEN 'uwiq'::ad_lane
    WHEN 'wl'         THEN 'wl'::ad_lane
    ELSE 'unknown'::ad_lane
  END
$$;

-- utm_content → ad id. Leading digits, optionally followed by -slug or _slug.
-- Anything that is not that shape is NULL, never a guess.
CREATE OR REPLACE FUNCTION fundhub_ad_id(content text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT substring(btrim(coalesce(content, '')) from '^([0-9]{1,9})(?:[-_][^[:space:]]*)?$')
$$;

-- utm_term → variant. Lowercased, squeezed to [a-z0-9_-], capped at 64 chars.
CREATE OR REPLACE FUNCTION fundhub_ad_variant(term text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT nullif(
    btrim(left(regexp_replace(lower(btrim(coalesce(term, ''))), '[^a-z0-9_-]+', '-', 'g'), 64), '-'),
    ''
  )
$$;

CREATE TABLE IF NOT EXISTS client_ad_attribution (
  client_id        uuid PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  org_id           uuid NOT NULL REFERENCES orgs(id),

  -- The raw wire values, exactly as the webhook delivered them (trimmed).
  utm_source       text,
  utm_medium       text,
  utm_campaign     text,
  utm_content      text,
  utm_term         text,
  landing_path     text,
  referrer_domain  text,

  -- The three derived facts. Never written by the app; always computed here.
  lane             ad_lane NOT NULL GENERATED ALWAYS AS (fundhub_ad_lane(utm_campaign)) STORED,
  ad_id            text            GENERATED ALWAYS AS (fundhub_ad_id(utm_content))   STORED,
  variant          text            GENERATED ALWAYS AS (fundhub_ad_variant(utm_term))  STORED,

  captured_at      timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT client_ad_attribution_ad_id_ck
    CHECK (ad_id IS NULL OR ad_id ~ '^[0-9]{1,9}$'),
  CONSTRAINT client_ad_attribution_variant_ck
    CHECK (variant IS NULL OR variant ~ '^[a-z0-9_-]{1,64}$')
);

CREATE INDEX IF NOT EXISTS idx_caa_org_lane     ON client_ad_attribution (org_id, lane);
CREATE INDEX IF NOT EXISTS idx_caa_org_ad       ON client_ad_attribution (org_id, ad_id);
CREATE INDEX IF NOT EXISTS idx_caa_org_captured ON client_ad_attribution (org_id, captured_at);

-- RLS: declared on, permissive, matching clients. See the header.
ALTER TABLE client_ad_attribution ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_ad_attribution FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'client_ad_attribution'
       AND policyname = 'client_ad_attribution_app_all'
  ) THEN
    CREATE POLICY client_ad_attribution_app_all ON public.client_ad_attribution
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_ad_attribution TO fundhub_app;
  ELSE
    RAISE NOTICE 'skipped grants: role fundhub_app does not exist in this database';
  END IF;
END $$;

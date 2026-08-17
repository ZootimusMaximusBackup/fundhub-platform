-- 171_content.sql — welcome videos and the price shown on a locked tile.
--
-- Content (public/app/content-admin.html) had no table and no route. Tile
-- names and copy already live on entitlement_catalog. The editor also shows
-- a price, and that column did not exist — NULL until someone saves one.
-- Videos and the tier→video map are new; nothing is seeded.

ALTER TABLE entitlement_catalog
  ADD COLUMN IF NOT EXISTS display_price_cents integer;

ALTER TABLE entitlement_catalog
  DROP CONSTRAINT IF EXISTS entitlement_catalog_display_price_ck;

ALTER TABLE entitlement_catalog
  ADD CONSTRAINT entitlement_catalog_display_price_ck
  CHECK (display_price_cents IS NULL OR display_price_cents >= 0);

CREATE TABLE IF NOT EXISTS content_videos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  title         text NOT NULL,
  duration_label text,
  storage_key   text NOT NULL,
  mime_type     text,
  byte_size     integer,
  uploaded_by   uuid REFERENCES staff(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_videos_title_ck CHECK (btrim(title) <> '')
);

CREATE INDEX IF NOT EXISTS content_videos_org_idx
  ON content_videos (org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS content_tier_map (
  org_id     uuid NOT NULL REFERENCES orgs(id),
  tier_code  text NOT NULL,
  video_id   uuid NOT NULL REFERENCES content_videos(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, tier_code),
  CONSTRAINT content_tier_map_code_ck CHECK (btrim(tier_code) <> '')
);

COMMENT ON TABLE content_videos IS
  'Welcome videos uploaded from Content. Bytes live in the document store; this row is the library entry.';
COMMENT ON TABLE content_tier_map IS
  'Which welcome video a product tier (or default) shows. Empty until someone maps one.';
COMMENT ON COLUMN entitlement_catalog.display_price_cents IS
  'Price shown on the locked tile in the client portal. NULL means no price has been saved.';

-- Supabase often enables RLS with zero policies on a new table (deny-all).
-- Same patch as 109 / 154 / 166 so fundhub_app can actually write.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'content_videos'
  ) THEN
    ALTER TABLE content_videos ENABLE ROW LEVEL SECURITY;
    CREATE POLICY content_videos_no_bare_rls ON content_videos
      USING (true) WITH CHECK (true);
    ALTER TABLE content_videos FORCE ROW LEVEL SECURITY;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'content_tier_map'
  ) THEN
    ALTER TABLE content_tier_map ENABLE ROW LEVEL SECURITY;
    CREATE POLICY content_tier_map_no_bare_rls ON content_tier_map
      USING (true) WITH CHECK (true);
    ALTER TABLE content_tier_map FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON content_videos TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON content_tier_map TO fundhub_app;
  ELSE
    RAISE NOTICE 'skipped grants: role fundhub_app does not exist in this database';
  END IF;
END $$;

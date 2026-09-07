-- 302_analytics_connections.sql — read-only marketing-analytics connections:
-- ClickFunnels (the funnel pages themselves) and YouTube (VSL watch time).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY A NEW TABLE, NOT ad_platform_connections
--
-- ad_platform_connections (046) is built around running paid ads: it has
-- external_ad_account_id NOT NULL, special_ad_category on the campaigns it
-- feeds, and a platform CHECK locked to ('meta','tiktok','google'). Neither
-- ClickFunnels nor YouTube spends money through this app — Chris asked
-- tonight to READ from them: how a funnel page performs, how much a VSL has
-- been watched. That is a different shape of connection, org-wide rather
-- than per ad account, so it gets its own table instead of widening a CHECK
-- constraint on a table whose other four columns would not apply.
--
-- ORG-WIDE, NOT PARTNER-SCOPED. Chris's own YouTube channel and his own
-- ClickFunnels workspace are not owned by any one partner — they are the
-- house's. So there is no partner_id column here, and the RLS policy below
-- is staff-only, the same fundhub_is_staff() 045_creative_factory.sql
-- already defines. A partner login should never see these rows; there is
-- nothing partner-scoped to show it.
--
-- CREDENTIALS AS ONE ENCRYPTED JSON BLOB, NOT SEPARATE COLUMNS. The two
-- platforms need different shapes: ClickFunnels needs an API key and a
-- workspace subdomain; YouTube needs an OAuth client id, client secret and
-- refresh token. Rather than a wide table with half its columns always NULL,
-- encrypted_credentials holds one JSON object per platform, encrypted whole.
--
-- REUSING src/adplatforms/tokens.mjs's encryptToken/decryptToken ON PURPOSE.
-- Its "partnerId" argument is really just the string this ciphertext is
-- bound to (the additional authenticated data) — nothing in the function
-- requires it to be an actual partner id. This module passes org_id in that
-- slot instead. Documented here so the next person reading tokens.mjs does
-- not "fix" the parameter name assuming a partner is required.
--
-- CLOSED BETA, NOT ASSUMED GENERAL ACCESS. ClickFunnels' funnel/page stats
-- endpoints (GET /funnels/{id}/stats, GET /pages/{id}/stats) were in closed
-- beta as of the API's own changelog when this was written, 2026-09-07. This
-- schema does not assume Chris's account has that beta flag; the adapter
-- code (src/analytics/clickfunnels.mjs) handles a refusal from that endpoint
-- as a real, reportable state, not a crash.

CREATE TABLE IF NOT EXISTS analytics_connections (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES orgs(id),

  platform               text NOT NULL,
  -- ClickFunnels: the workspace subdomain (the X in X.myclickfunnels.com).
  -- YouTube: the channel id, filled in once the first sync resolves it.
  external_account_id    text,

  -- One JSON object, encrypted whole. Never a plaintext sibling column — see
  -- encrypted_access_token's own comment in 046_ad_platforms.sql for why
  -- that rule exists; the same reasoning applies here.
  encrypted_credentials  text,

  --   pending  — row created, no credential saved yet
  --   active   — credential saved and the last sync succeeded (or none tried yet)
  --   expired  — the platform says the token needs refreshing and refresh failed
  --   revoked  — Chris disconnected it, or the platform revoked it
  --   error    — the last sync failed for a reason that is not "expired"
  connection_state       text NOT NULL DEFAULT 'pending',

  -- The platform's own words, verbatim, same rule as ad_platform_connections:
  -- a rewording is a message Chris cannot act on.
  last_error             text,
  last_synced_at         timestamptz,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT analytics_connections_platform_ck
    CHECK (platform IN ('clickfunnels', 'youtube')),
  CONSTRAINT analytics_connections_state_ck
    CHECK (connection_state IN ('pending', 'active', 'expired', 'revoked', 'error')),
  -- One connection per platform per org. Reconnecting overwrites, it does
  -- not duplicate — there is only one company here, not one per partner.
  CONSTRAINT analytics_connections_org_platform_uq UNIQUE (org_id, platform)
);

CREATE INDEX IF NOT EXISTS analytics_connections_org_idx
  ON analytics_connections (org_id, platform);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_analytics_connections_updated_at'
  ) THEN
    CREATE TRIGGER trg_analytics_connections_updated_at
      BEFORE UPDATE ON analytics_connections
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- ClickFunnels — page performance, one row per page per day.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS funnel_page_stats (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES orgs(id),
  connection_id         uuid NOT NULL REFERENCES analytics_connections(id) ON DELETE CASCADE,

  clickfunnels_funnel_id text NOT NULL,
  clickfunnels_page_id   text NOT NULL,
  funnel_name            text,
  page_name              text,

  stat_date              date NOT NULL,
  -- NULL, never 0, when the platform did not answer for this metric — the
  -- same "NULL means unknown, never default it to 0" rule CLAUDE.md §12
  -- already states for money applies here for the same reason: a real zero
  -- and "we don't know" must never look the same on a screen.
  views                  integer,
  conversions            integer,

  captured_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT funnel_page_stats_uq
    UNIQUE (connection_id, clickfunnels_page_id, stat_date)
);

CREATE INDEX IF NOT EXISTS funnel_page_stats_org_date_idx
  ON funnel_page_stats (org_id, stat_date DESC);

-- ---------------------------------------------------------------------------
-- YouTube — video watch time, one row per video per day.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS video_watch_stats (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                      uuid NOT NULL REFERENCES orgs(id),
  connection_id               uuid NOT NULL REFERENCES analytics_connections(id) ON DELETE CASCADE,

  youtube_video_id            text NOT NULL,
  video_title                 text,

  stat_date                   date NOT NULL,
  views                       integer,
  estimated_minutes_watched   numeric,
  average_view_duration_sec   numeric,
  -- 0-100. The Analytics API's own unit; stored as given, not divided.
  average_view_percentage     numeric,

  captured_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT video_watch_stats_uq
    UNIQUE (connection_id, youtube_video_id, stat_date)
);

CREATE INDEX IF NOT EXISTS video_watch_stats_org_date_idx
  ON video_watch_stats (org_id, stat_date DESC);

-- ---------------------------------------------------------------------------
-- RLS — staff only. No partner concept applies to any of the three tables.
-- ---------------------------------------------------------------------------

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['analytics_connections', 'funnel_page_stats', 'video_watch_stats']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_staff_only', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (fundhub_is_staff()) WITH CHECK (fundhub_is_staff())',
      tbl || '_staff_only', tbl
    );
  END LOOP;
END $$;

COMMENT ON TABLE analytics_connections IS
  'One row per platform per org: ClickFunnels or YouTube credentials, encrypted whole in encrypted_credentials. Staff-only, no partner scope. See this file''s header for why it is not ad_platform_connections.';
COMMENT ON TABLE funnel_page_stats IS
  'One row per ClickFunnels page per day. views/conversions are NULL, never 0, when the platform did not answer.';
COMMENT ON TABLE video_watch_stats IS
  'One row per YouTube video per day. From the YouTube Analytics API v2/reports endpoint, dimensions=video.';

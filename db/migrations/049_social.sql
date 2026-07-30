-- 049_social.sql — organic posting for connected channels (Creative Factory UNIT 7).
--
-- SAME RAILS AS THE PAID SIDE, deliberately. Organic posts pass the same guardrail
-- screen, write the same action_log, carry the same partner scope and RLS. The
-- temptation is to treat organic as lower-stakes and skip the screen — but a CROA
-- violation in an Instagram caption is the same violation it would be in an ad,
-- and the FTC does not distinguish by placement.
--
-- SEPARATE FROM ad_platform_connections. A social channel is not an ad account:
-- it has different scopes, different tokens, a different verification story, and a
-- partner can have a TikTok channel for organic while having no TikTok ad account
-- at all. Collapsing them would put one connection_state over two unrelated
-- lifecycles.

CREATE TABLE IF NOT EXISTS social_channels (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs(id),
  partner_id          uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,

  channel             text NOT NULL,
  external_account_id text NOT NULL,
  handle              text,

  -- Ciphertext only, same rule as ad_platform_connections: no plaintext sibling
  -- column may be added, and src/adplatforms/tokens.mjs is what writes these.
  encrypted_access_token  text,
  encrypted_refresh_token text,
  token_expires_at        timestamptz,
  scopes                  jsonb NOT NULL DEFAULT '[]'::jsonb,

  connection_state    text NOT NULL DEFAULT 'pending',
  last_error          text,

  -- Per-channel best-time config: { "mon": ["09:00","17:30"], ... } in the
  -- partner's timezone. Config rather than a constant, because the right time to
  -- post differs per channel AND per audience, and neither is ours to decide.
  best_times          jsonb NOT NULL DEFAULT '{}'::jsonb,
  timezone            text NOT NULL DEFAULT 'UTC',

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT social_channels_channel_ck CHECK (channel IN
    ('instagram', 'tiktok', 'facebook', 'linkedin', 'x', 'youtube_shorts', 'threads', 'pinterest')),
  CONSTRAINT social_channels_state_ck
    CHECK (connection_state IN ('pending', 'active', 'expired', 'revoked')),
  CONSTRAINT social_channels_active_token_ck
    CHECK (connection_state <> 'active' OR encrypted_access_token IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS social_channels_uniq
  ON social_channels (partner_id, channel, external_account_id);
CREATE INDEX IF NOT EXISTS social_channels_partner_idx
  ON social_channels (partner_id, connection_state);

CREATE TABLE IF NOT EXISTS social_posts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id),
  partner_id     uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  channel_id     uuid NOT NULL REFERENCES social_channels(id) ON DELETE RESTRICT,
  asset_id       uuid REFERENCES creative_assets(id) ON DELETE RESTRICT,

  caption        text,
  -- Carried on the post so the screen has an offer type to judge against; organic
  -- content still sits under one of the three offers.
  offer_type     text NOT NULL,

  scheduled_for  timestamptz,
  posted_at      timestamptz,
  external_post_id text,

  --   draft     — being composed
  --   queued    — screened and scheduled
  --   posting   — in flight
  --   posted    — done
  --   failed    — retried and gave up; surfaces as a task
  --   blocked   — the guardrail said no
  status         text NOT NULL DEFAULT 'draft',
  blocked_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,

  attempt        integer NOT NULL DEFAULT 0,
  last_error     text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT social_posts_offer_ck
    CHECK (offer_type IN ('funding', 'credit_cards', 'credit_repair')),
  CONSTRAINT social_posts_status_ck
    CHECK (status IN ('draft', 'queued', 'posting', 'posted', 'failed', 'blocked')),
  CONSTRAINT social_posts_blocked_reason_ck
    CHECK (status <> 'blocked' OR jsonb_array_length(blocked_reasons) > 0),
  CONSTRAINT social_posts_posted_ck
    CHECK (status <> 'posted' OR posted_at IS NOT NULL),
  CONSTRAINT social_posts_attempt_ck CHECK (attempt >= 0)
);

CREATE INDEX IF NOT EXISTS social_posts_partner_idx
  ON social_posts (partner_id, status, scheduled_for);
-- The scheduler's read: what is due.
CREATE INDEX IF NOT EXISTS social_posts_due_idx
  ON social_posts (scheduled_for) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS social_posts_channel_idx
  ON social_posts (channel_id, posted_at DESC);

-- A post must belong to the same partner as its channel. RLS stops the read; this
-- stops a staff-context write from posting one partner's content to another's
-- account — which would be a disclosure AND a brand incident.
CREATE OR REPLACE FUNCTION social_post_same_partner() RETURNS trigger AS $$
DECLARE ch_partner uuid; asset_partner uuid;
BEGIN
  SELECT partner_id INTO ch_partner FROM social_channels WHERE id = NEW.channel_id;
  IF ch_partner IS DISTINCT FROM NEW.partner_id THEN
    RAISE EXCEPTION
      'social post crosses partners: channel belongs to % but post is for % (049)',
      ch_partner, NEW.partner_id;
  END IF;
  IF NEW.asset_id IS NOT NULL THEN
    SELECT partner_id INTO asset_partner FROM creative_assets WHERE id = NEW.asset_id;
    IF asset_partner IS DISTINCT FROM NEW.partner_id THEN
      RAISE EXCEPTION
        'social post uses another partner''s asset (% vs %) (049)', asset_partner, NEW.partner_id;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_social_post_same_partner ON social_posts;
CREATE TRIGGER trg_social_post_same_partner
  BEFORE INSERT OR UPDATE OF channel_id, asset_id, partner_id ON social_posts
  FOR EACH ROW EXECUTE FUNCTION social_post_same_partner();

-- A post may only reach 'queued' or 'posting' from a screened state. Blocking at
-- the engine so no scheduler path can queue unscreened copy.
CREATE OR REPLACE FUNCTION social_post_screen_gate() RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('queued', 'posting', 'posted')
     AND NOT EXISTS (
       SELECT 1 FROM compliance_screenings s
        WHERE s.subject_type = 'social_post' AND s.subject_id = NEW.id
          AND s.state IN ('passed', 'needs_approval')) THEN
    RAISE EXCEPTION
      'social post % has not passed the guardrail engine — it cannot be queued (049)', NEW.id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_social_post_screen_gate ON social_posts;
CREATE TRIGGER trg_social_post_screen_gate
  BEFORE UPDATE OF status ON social_posts
  FOR EACH ROW EXECUTE FUNCTION social_post_screen_gate();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['social_channels', 'social_posts'] LOOP
    PERFORM fundhub_apply_partner_rls(t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    FOREACH t IN ARRAY ARRAY['social_channels', 'social_posts'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_' || t || '_updated_at'
                      AND tgrelid = ('public.' || t)::regclass) THEN
        EXECUTE format(
          'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
          'trg_' || t || '_updated_at', t);
      END IF;
    END LOOP;
  END IF;
END $$;

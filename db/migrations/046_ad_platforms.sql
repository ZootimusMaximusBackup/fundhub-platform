-- 046_ad_platforms.sql — connected ad accounts, the campaign mirror, the action
-- log, and the spend ceilings (Creative Factory UNIT 2).
--
-- RENUMBERED from the spec's 044, which is taken by 044_accounts.sql.
--
-- THE COMPLIANCE BLOCKS ARE CHECK CONSTRAINTS, NOT VALIDATION. A rule that lives
-- only in the API is a rule that a backfill script, a psql session or a future
-- endpoint can walk straight past. The two that matter most:
--
--   TikTok + credit repair is impossible to represent. TikTok prohibits credit
--   repair and debt relief outright, so the pair is rejected by the constraint
--   below and again by the guardrail engine. There is no override column, and one
--   must not be added — the spec says so and so does TikTok's policy. A campaign
--   that cannot exist in the table cannot be launched by any code path.
--
--   Meta forces a special ad category. NOT NULL-when-meta, so a Meta campaign
--   row without one cannot be inserted at all.
--
-- WHICH special_ad_category VALUE IS DELIBERATELY UNSET. The spec named
-- 'FINANCIAL_PRODUCTS_AND_SERVICES'. That string is not a Meta enum member (Meta
-- has no AND in it), and for `funding`/`credit_cards` offers the applicable
-- category is very likely CREDIT rather than the financial-products one. Writing
-- a guessed enum into a CHECK would do two bad things at once: reject every
-- campaign at the platform on create, and make a COMPLIANCE control that silently
-- enforces nothing. So the offer_type → category mapping is a config table with
-- no value chosen, flagged for a human, and a Meta launch is blocked while it is
-- empty. Same discipline as 032_entitlements.sql leaving product_entitlements
-- empty rather than deciding an offer question inside a migration.
--
-- ACTION LOG IS APPEND-ONLY AND WRITTEN BEFORE THE FACT. Every automated action
-- writes its row BEFORE it executes, carrying the rule that fired, the metrics
-- that triggered it, before/after state and a reversible undo payload. Logging
-- after the call means a crash mid-flight leaves a change nobody can find or
-- revert.
--
-- TOKENS. Only ciphertext columns exist. There is no plaintext token column to
-- accidentally SELECT, the read APIs never project these, and
-- src/http/read-api.mjs's redact() already strips anything matching /token_hash/
-- — the column names here are chosen to be caught by that net as well.

-- ---------------------------------------------------------------------------
-- A. ad_platform_connections — the partner's own ad accounts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ad_platform_connections (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES orgs(id),
  partner_id             uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,

  platform               text NOT NULL,
  external_business_id   text,
  external_ad_account_id text NOT NULL,

  -- Ciphertext only. Encrypted at rest by src/adplatforms/tokens.mjs, scoped to
  -- one partner, never logged, never projected by any API response, never put in
  -- an error message. A plaintext sibling column must never be added: the moment
  -- one exists, some `SELECT *` will carry it into a JSON body.
  encrypted_access_token  text,
  encrypted_refresh_token text,
  token_expires_at        timestamptz,

  scopes                 jsonb NOT NULL DEFAULT '[]'::jsonb,

  --   pending             — OAuth started, not finished
  --   active              — usable
  --   expired             — refresh needed
  --   revoked             — partner or platform pulled it
  --   needs_verification  — connected but the platform wants business verification
  connection_state       text NOT NULL DEFAULT 'pending',

  -- Separate from connection_state on purpose: a connection can be perfectly
  -- ACTIVE while the business is still UNVERIFIED, and credit-related offers turn
  -- on the second fact, not the first.
  platform_verification_state text NOT NULL DEFAULT 'unverified',

  -- The platform's own message, verbatim. Never a paraphrase: a policy rejection
  -- reworded by us is a policy rejection the partner cannot act on.
  last_error             text,
  last_synced_at         timestamptz,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ad_platform_connections_platform_ck
    CHECK (platform IN ('meta', 'tiktok', 'google')),
  CONSTRAINT ad_platform_connections_state_ck
    CHECK (connection_state IN ('pending', 'active', 'expired', 'revoked', 'needs_verification')),
  CONSTRAINT ad_platform_connections_verif_ck
    CHECK (platform_verification_state IN ('unverified', 'submitted', 'approved', 'rejected')),
  CONSTRAINT ad_platform_connections_acct_ck
    CHECK (btrim(external_ad_account_id) <> ''),
  -- An active connection with no token is a connection that cannot do anything;
  -- it means an OAuth callback half-finished and the state was stamped anyway.
  CONSTRAINT ad_platform_connections_active_token_ck
    CHECK (connection_state <> 'active' OR encrypted_access_token IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS ad_platform_connections_uniq
  ON ad_platform_connections (partner_id, platform, external_ad_account_id);
CREATE INDEX IF NOT EXISTS ad_platform_connections_partner_idx
  ON ad_platform_connections (partner_id, connection_state);
-- The token-refresh sweep's read.
CREATE INDEX IF NOT EXISTS ad_platform_connections_expiring_idx
  ON ad_platform_connections (token_expires_at)
  WHERE connection_state = 'active' AND token_expires_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- B. offer_type → special_ad_category. CONFIG, AND DELIBERATELY EMPTY.
-- ---------------------------------------------------------------------------
--
-- FLAGGED FOR A HUMAN. Fill this in with the enum members your Meta API version
-- actually accepts, then Meta launches unblock. Until then meta_category_for()
-- returns NULL and the campaign CHECK below rejects every Meta insert, which is
-- the correct failure: no campaign ships with a guessed compliance category.
--
--   INSERT INTO ad_platform_category_map (org_id, platform, offer_type, special_ad_category)
--   SELECT id, 'meta', 'credit_cards', 'CREDIT' FROM orgs WHERE is_default;

CREATE TABLE IF NOT EXISTS ad_platform_category_map (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs(id),
  platform            text NOT NULL,
  offer_type          text NOT NULL,
  special_ad_category text NOT NULL,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_platform_category_map_platform_ck CHECK (platform IN ('meta', 'tiktok', 'google')),
  CONSTRAINT ad_platform_category_map_offer_ck
    CHECK (offer_type IN ('funding', 'credit_cards', 'credit_repair')),
  CONSTRAINT ad_platform_category_map_value_ck CHECK (btrim(special_ad_category) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS ad_platform_category_map_uniq
  ON ad_platform_category_map (org_id, platform, offer_type);

-- STABLE, so it is usable from a trigger. Not from a CHECK: Postgres CHECK
-- constraints must be immutable, and this reads a table. The enforcement is
-- therefore a BEFORE trigger (section D) plus the structural CHECKs on the
-- campaign tables.
CREATE OR REPLACE FUNCTION meta_category_for(p_org uuid, p_offer text) RETURNS text AS $$
  SELECT special_ad_category FROM ad_platform_category_map
   WHERE org_id = p_org AND platform = 'meta' AND offer_type = p_offer;
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------------
-- C. campaigns / ad_sets / ads — the local mirror of platform objects
-- ---------------------------------------------------------------------------
--
-- A MIRROR, not the source of truth. external_id is what the platform calls it;
-- synced_at says how stale our copy is. The platform is authoritative for spend
-- and delivery, which is why the kill-switch job (UNIT 6) reads platform spend
-- rather than trusting these rows.

CREATE TABLE IF NOT EXISTS campaigns (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs(id),
  partner_id          uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  connection_id       uuid NOT NULL REFERENCES ad_platform_connections(id) ON DELETE RESTRICT,

  external_id         text,
  name                text NOT NULL,
  status              text,                  -- the platform's own status string
  objective           text,

  offer_type          text NOT NULL,
  special_ad_category text,
  budget_cents        bigint NOT NULL DEFAULT 0,
  targeting           jsonb NOT NULL DEFAULT '{}'::jsonb,
  strategy_key        text,

  approval_state      text NOT NULL DEFAULT 'draft',
  approved_by         uuid REFERENCES accounts(id) ON DELETE SET NULL,
  approved_at         timestamptz,

  last_error          text,
  synced_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT campaigns_offer_ck
    CHECK (offer_type IN ('funding', 'credit_cards', 'credit_repair')),
  CONSTRAINT campaigns_approval_ck
    CHECK (approval_state IN ('draft', 'awaiting_approval', 'approved', 'live', 'paused', 'archived')),
  CONSTRAINT campaigns_budget_ck CHECK (budget_cents >= 0),
  CONSTRAINT campaigns_name_ck   CHECK (btrim(name) <> ''),

  -- An approval must record WHEN, always. Without it, "was this ever approved"
  -- has no answer at audit time.
  CONSTRAINT campaigns_approved_at_ck
    CHECK (approval_state NOT IN ('approved', 'live') OR approved_at IS NOT NULL),

  -- WHO is required only for credit_repair, and that asymmetry is deliberate.
  -- approve_before_launch is a per-partner setting, so a funding or credit_cards
  -- campaign may legitimately reach live with no human in the loop when the
  -- partner has it switched off — approved_by is NULL there, meaning "auto".
  -- Requiring a human on every campaign would block that supported path.
  --
  -- credit_repair is the exception the spec makes unconditional: human approval is
  -- ALWAYS required and the setting cannot turn it off. src/compliance/screen.mjs
  -- enforces that in code; this is the same rule at the engine, so a credit-repair
  -- campaign cannot be marked live by any path without naming the person who
  -- approved it.
  CONSTRAINT campaigns_credit_repair_approver_ck
    CHECK (offer_type <> 'credit_repair'
           OR approval_state NOT IN ('approved', 'live')
           OR approved_by IS NOT NULL)
);

-- THE TIKTOK CREDIT-REPAIR BLOCK, at the engine.
--
-- Written against a denormalised `platform` column rather than a join, because a
-- CHECK cannot read another table. platform is kept in sync with the connection
-- by trg_campaigns_platform below, so this cannot be defeated by lying about it.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS platform text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_tiktok_credit_repair_ck') THEN
    ALTER TABLE campaigns ADD CONSTRAINT campaigns_tiktok_credit_repair_ck
      CHECK (NOT (platform = 'tiktok' AND offer_type = 'credit_repair'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_platform_ck') THEN
    ALTER TABLE campaigns ADD CONSTRAINT campaigns_platform_ck
      CHECK (platform IS NULL OR platform IN ('meta', 'tiktok', 'google'));
  END IF;
  -- Meta requires a special ad category on every campaign in these verticals.
  -- NOT NULL-when-meta, so the row cannot exist without one.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_meta_category_ck') THEN
    ALTER TABLE campaigns ADD CONSTRAINT campaigns_meta_category_ck
      CHECK (platform <> 'meta' OR special_ad_category IS NOT NULL);
  END IF;
END $$;

COMMENT ON CONSTRAINT campaigns_tiktok_credit_repair_ck ON campaigns IS
  'TikTok prohibits credit repair and debt relief outright. There is no override flag and none may be added (spec UNIT 2/4). Also enforced in src/compliance/screen.mjs and rejected by the API.';

CREATE INDEX IF NOT EXISTS campaigns_partner_idx
  ON campaigns (partner_id, approval_state, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS campaigns_external_uniq
  ON campaigns (connection_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS campaigns_live_idx
  ON campaigns (partner_id) WHERE approval_state = 'live';
CREATE INDEX IF NOT EXISTS campaigns_approval_queue_idx
  ON campaigns (partner_id, updated_at DESC) WHERE approval_state = 'awaiting_approval';

CREATE TABLE IF NOT EXISTS ad_sets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id),
  partner_id     uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  connection_id  uuid NOT NULL REFERENCES ad_platform_connections(id) ON DELETE RESTRICT,
  campaign_id    uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,

  external_id    text,
  name           text NOT NULL,
  status         text,
  budget_cents   bigint NOT NULL DEFAULT 0,
  targeting      jsonb NOT NULL DEFAULT '{}'::jsonb,
  strategy_key   text,

  -- The learning phase. UNIT 6 must never edit an ad set inside it, so the window
  -- is a column the optimiser reads rather than a heuristic it re-derives.
  learning_until timestamptz,

  approval_state text NOT NULL DEFAULT 'draft',
  last_error     text,
  synced_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ad_sets_approval_ck
    CHECK (approval_state IN ('draft', 'awaiting_approval', 'approved', 'live', 'paused', 'archived')),
  CONSTRAINT ad_sets_budget_ck CHECK (budget_cents >= 0),
  CONSTRAINT ad_sets_name_ck   CHECK (btrim(name) <> '')
);

CREATE INDEX IF NOT EXISTS ad_sets_campaign_idx ON ad_sets (campaign_id);
CREATE INDEX IF NOT EXISTS ad_sets_partner_idx  ON ad_sets (partner_id, approval_state);
CREATE UNIQUE INDEX IF NOT EXISTS ad_sets_external_uniq
  ON ad_sets (connection_id, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ads (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id),
  partner_id     uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  connection_id  uuid NOT NULL REFERENCES ad_platform_connections(id) ON DELETE RESTRICT,
  campaign_id    uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  ad_set_id      uuid NOT NULL REFERENCES ad_sets(id) ON DELETE RESTRICT,
  -- Which creative is running. RESTRICT: an asset that is live on a platform must
  -- not become undiscoverable locally.
  asset_id       uuid REFERENCES creative_assets(id) ON DELETE RESTRICT,

  external_id    text,
  name           text NOT NULL,
  status         text,
  approval_state text NOT NULL DEFAULT 'draft',

  -- The AI-content disclosure the publisher attached, and when. Recorded because
  -- "we disclose" is only auditable if each ad says what it sent.
  ai_disclosure          text,
  ai_disclosure_at       timestamptz,

  -- Creative rotation bookkeeping for the fatigue rules (UNIT 6).
  rotated_at     timestamptz,
  last_error     text,
  synced_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ads_approval_ck
    CHECK (approval_state IN ('draft', 'awaiting_approval', 'approved', 'live', 'paused', 'archived')),
  CONSTRAINT ads_name_ck CHECK (btrim(name) <> '')
);

CREATE INDEX IF NOT EXISTS ads_ad_set_idx   ON ads (ad_set_id);
CREATE INDEX IF NOT EXISTS ads_campaign_idx ON ads (campaign_id);
CREATE INDEX IF NOT EXISTS ads_partner_idx  ON ads (partner_id, approval_state);
CREATE INDEX IF NOT EXISTS ads_asset_idx    ON ads (asset_id) WHERE asset_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ads_external_uniq
  ON ads (connection_id, external_id) WHERE external_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- D. The triggers that keep the mirror honest
-- ---------------------------------------------------------------------------

-- platform is denormalised onto campaigns so the TikTok CHECK can see it. This
-- keeps it equal to the connection's platform, so the constraint cannot be
-- defeated by writing platform='meta' on a TikTok connection.
CREATE OR REPLACE FUNCTION campaign_platform_from_connection() RETURNS trigger AS $$
DECLARE conn_platform text; conn_partner uuid;
BEGIN
  SELECT platform, partner_id INTO conn_platform, conn_partner
    FROM ad_platform_connections WHERE id = NEW.connection_id;
  IF conn_platform IS NULL THEN
    RAISE EXCEPTION 'campaign references connection % which does not exist (046)', NEW.connection_id;
  END IF;
  IF conn_partner IS DISTINCT FROM NEW.partner_id THEN
    RAISE EXCEPTION
      'campaign crosses partners: connection belongs to % but campaign is for % (046)',
      conn_partner, NEW.partner_id;
  END IF;
  NEW.platform := conn_platform;

  -- Meta's category is forced from config, never from the caller. A caller who
  -- supplies one gets it overwritten; a caller who omits it gets the mapped
  -- value; and when the map is empty the value stays NULL and
  -- campaigns_meta_category_ck rejects the row.
  IF conn_platform = 'meta' THEN
    NEW.special_ad_category := meta_category_for(NEW.org_id, NEW.offer_type);
    IF NEW.special_ad_category IS NULL THEN
      RAISE EXCEPTION
        'no special_ad_category configured for meta/% — populate ad_platform_category_map before launching Meta campaigns (046)',
        NEW.offer_type;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_campaigns_platform ON campaigns;
CREATE TRIGGER trg_campaigns_platform
  BEFORE INSERT OR UPDATE OF connection_id, offer_type, partner_id, special_ad_category ON campaigns
  FOR EACH ROW EXECUTE FUNCTION campaign_platform_from_connection();

-- A child must belong to the same partner as its parent. RLS stops a partner
-- reading across the boundary; this stops a staff-context write from stitching one
-- partner's ad set under another's campaign.
CREATE OR REPLACE FUNCTION ad_object_same_partner() RETURNS trigger AS $$
DECLARE parent_partner uuid;
BEGIN
  IF TG_TABLE_NAME = 'ad_sets' THEN
    SELECT partner_id INTO parent_partner FROM campaigns WHERE id = NEW.campaign_id;
  ELSE
    SELECT partner_id INTO parent_partner FROM ad_sets WHERE id = NEW.ad_set_id;
  END IF;
  IF parent_partner IS DISTINCT FROM NEW.partner_id THEN
    RAISE EXCEPTION
      '% crosses partners: parent belongs to % but row is for % (046)',
      TG_TABLE_NAME, parent_partner, NEW.partner_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ad_sets_same_partner ON ad_sets;
CREATE TRIGGER trg_ad_sets_same_partner
  BEFORE INSERT OR UPDATE OF campaign_id, partner_id ON ad_sets
  FOR EACH ROW EXECUTE FUNCTION ad_object_same_partner();

DROP TRIGGER IF EXISTS trg_ads_same_partner ON ads;
CREATE TRIGGER trg_ads_same_partner
  BEFORE INSERT OR UPDATE OF ad_set_id, partner_id ON ads
  FOR EACH ROW EXECUTE FUNCTION ad_object_same_partner();

-- THE LAUNCH GATE, at the engine.
--   connection_state != 'active'            → cannot go live at all
--   verification != 'approved' + credit      → cannot go live
-- The API surfaces both as onboarding tasks (section G) rather than a silent
-- failure, but the database is what makes them true.
CREATE OR REPLACE FUNCTION campaign_launch_gate() RETURNS trigger AS $$
DECLARE conn record;
BEGIN
  IF NEW.approval_state <> 'live' THEN RETURN NEW; END IF;
  SELECT connection_state, platform_verification_state, platform
    INTO conn FROM ad_platform_connections WHERE id = NEW.connection_id;

  IF conn.connection_state <> 'active' THEN
    RAISE EXCEPTION
      'connection is %, not active — campaign cannot go live (046)', conn.connection_state;
  END IF;
  -- All three offer types in this module are credit-related products; funding and
  -- credit_cards are financial offers and credit_repair obviously so. The spec
  -- gates "an offer_type which is credit-related", which is all of them, and
  -- naming them explicitly keeps the rule readable if a non-credit type is ever
  -- added.
  IF NEW.offer_type IN ('funding', 'credit_cards', 'credit_repair')
     AND conn.platform_verification_state <> 'approved' THEN
    RAISE EXCEPTION
      'platform business verification is % — a % campaign cannot go live until it is approved (046)',
      conn.platform_verification_state, NEW.offer_type;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_campaign_launch_gate ON campaigns;
CREATE TRIGGER trg_campaign_launch_gate
  BEFORE INSERT OR UPDATE OF approval_state ON campaigns
  FOR EACH ROW EXECUTE FUNCTION campaign_launch_gate();

-- ---------------------------------------------------------------------------
-- E. ad_metrics_daily — upserted on sync
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ad_metrics_daily (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  partner_id   uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  ad_id        uuid NOT NULL REFERENCES ads(id) ON DELETE RESTRICT,

  date         date NOT NULL,

  spend_cents  bigint  NOT NULL DEFAULT 0,
  impressions  bigint  NOT NULL DEFAULT 0,
  reach        bigint  NOT NULL DEFAULT 0,
  frequency    numeric(12,4),
  clicks       bigint  NOT NULL DEFAULT 0,
  ctr          numeric(12,6),
  conversions  bigint  NOT NULL DEFAULT 0,
  cpa_cents    bigint,
  roas         numeric(14,6),

  synced_at    timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ad_metrics_daily_nonneg_ck
    CHECK (spend_cents >= 0 AND impressions >= 0 AND reach >= 0 AND clicks >= 0 AND conversions >= 0),
  CONSTRAINT ad_metrics_daily_cpa_ck CHECK (cpa_cents IS NULL OR cpa_cents >= 0)
);

-- The upsert target. ad_id already implies the partner (ads.partner_id, enforced
-- by trigger), so this is sufficient without partner_id in the key.
CREATE UNIQUE INDEX IF NOT EXISTS ad_metrics_daily_uniq
  ON ad_metrics_daily (ad_id, date);
CREATE INDEX IF NOT EXISTS ad_metrics_daily_partner_date_idx
  ON ad_metrics_daily (partner_id, date DESC);
-- The optimiser's read: this ad's recent series, newest first.
CREATE INDEX IF NOT EXISTS ad_metrics_daily_series_idx
  ON ad_metrics_daily (ad_id, date DESC);

-- ---------------------------------------------------------------------------
-- F. action_log — append-only, written before the action executes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS action_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES orgs(id),
  partner_id       uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,

  actor            text NOT NULL,
  agent_id         uuid REFERENCES agents(id)   ON DELETE SET NULL,
  user_id          uuid REFERENCES accounts(id) ON DELETE SET NULL,

  target_type      text NOT NULL,
  target_id        uuid,

  rule_key         text,
  reason           text NOT NULL,
  metrics_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  before           jsonb NOT NULL DEFAULT '{}'::jsonb,
  after            jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- What a one-click revert replays. NOT NULL for an agent action: an automated
  -- change nobody can undo is the thing the partner cannot defend against.
  undo_payload     jsonb,

  -- Set when the undo has been applied, so a revert is itself idempotent and the
  -- dashboard can show "reverted" rather than offering the button twice.
  undone_at        timestamptz,
  undone_by        uuid REFERENCES accounts(id) ON DELETE SET NULL,

  -- Written before the platform call; stamped after. A row with executed_at NULL
  -- and an old created_at is an action that died mid-flight — findable, which is
  -- the entire point of logging first.
  executed_at      timestamptz,
  execute_error    text,

  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT action_log_actor_ck  CHECK (actor IN ('agent', 'human')),
  CONSTRAINT action_log_target_ck
    CHECK (target_type IN ('campaign', 'ad_set', 'ad', 'creative_asset', 'connection', 'social_post', 'autopilot')),
  CONSTRAINT action_log_reason_ck CHECK (btrim(reason) <> ''),
  -- An agent action must name the rule that fired and carry an undo. A human
  -- action need not: a person's reason is the reason.
  CONSTRAINT action_log_agent_ck
    CHECK (actor <> 'agent' OR (rule_key IS NOT NULL AND undo_payload IS NOT NULL)),
  CONSTRAINT action_log_undone_ck
    CHECK (undone_by IS NULL OR undone_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS action_log_partner_idx
  ON action_log (partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS action_log_target_idx
  ON action_log (target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS action_log_rule_idx
  ON action_log (partner_id, rule_key, created_at DESC) WHERE rule_key IS NOT NULL;
-- Revertible actions: what the one-click undo screen lists.
CREATE INDEX IF NOT EXISTS action_log_revertible_idx
  ON action_log (partner_id, created_at DESC)
  WHERE undone_at IS NULL AND undo_payload IS NOT NULL;

-- Append-only. An audit trail that can be edited is not one.
CREATE OR REPLACE FUNCTION action_log_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'action_log is append-only — rows are not deletable (046)';
  END IF;
  -- The only mutations allowed are the outcome stamps. Everything describing WHAT
  -- was done and WHY is frozen at insert.
  IF NEW.partner_id IS DISTINCT FROM OLD.partner_id
     OR NEW.actor      IS DISTINCT FROM OLD.actor
     OR NEW.target_type IS DISTINCT FROM OLD.target_type
     OR NEW.target_id  IS DISTINCT FROM OLD.target_id
     OR NEW.rule_key   IS DISTINCT FROM OLD.rule_key
     OR NEW.reason     IS DISTINCT FROM OLD.reason
     OR NEW.metrics_snapshot IS DISTINCT FROM OLD.metrics_snapshot
     OR NEW.before     IS DISTINCT FROM OLD.before
     OR NEW.after      IS DISTINCT FROM OLD.after
     OR NEW.undo_payload IS DISTINCT FROM OLD.undo_payload
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'action_log rows are immutable except executed_at/execute_error/undone_at/undone_by (046)';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_action_log_no_delete ON action_log;
CREATE TRIGGER trg_action_log_no_delete
  BEFORE DELETE ON action_log
  FOR EACH ROW WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION action_log_append_only();

DROP TRIGGER IF EXISTS trg_action_log_immutable ON action_log;
CREATE TRIGGER trg_action_log_immutable
  BEFORE UPDATE ON action_log
  FOR EACH ROW EXECUTE FUNCTION action_log_append_only();

-- ---------------------------------------------------------------------------
-- G. Spend ceilings — in THIS migration, so UNIT 8's view has data in phase one
-- ---------------------------------------------------------------------------
--
-- THREE SCOPES, as the spec requires: daily per partner, per campaign, per
-- platform. One table with a scope discriminator rather than three tables,
-- because the pre-flight check and the kill-switch both want to ask "every
-- ceiling that applies to this write" in one query.
--
-- max_daily_increase_pct SEEDS AT 20 WITH A HARD CAP OF 30, per the spec — the
-- only number in this module that is specified rather than left open. The cap is
-- a CHECK, so no config edit and no automated action can push past it.

CREATE TABLE IF NOT EXISTS spend_ceilings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),
  partner_id      uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,

  --   partner  — the daily ceiling across everything this partner runs
  --   campaign — one campaign's daily ceiling
  --   platform — this partner's daily ceiling on one platform
  scope           text NOT NULL,
  campaign_id     uuid REFERENCES campaigns(id) ON DELETE CASCADE,
  platform        text,

  daily_limit_cents bigint NOT NULL,

  -- 20 seeded, 30 hard cap (spec). Per-partner so an agreement can lower it.
  max_daily_increase_pct numeric(6,3) NOT NULL DEFAULT 20,

  -- Belt for the kill-switch: when it trips it stamps here, and the pre-flight
  -- check refuses any budget write while it is set.
  breached_at     timestamptz,
  breach_reason   text,

  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT spend_ceilings_scope_ck CHECK (scope IN ('partner', 'campaign', 'platform')),
  CONSTRAINT spend_ceilings_limit_ck CHECK (daily_limit_cents >= 0),
  -- THE HARD CAP. No config row and no automated action may exceed 30%.
  CONSTRAINT spend_ceilings_increase_ck
    CHECK (max_daily_increase_pct >= 0 AND max_daily_increase_pct <= 30),
  -- Each scope carries exactly the discriminator it needs and no other, so a
  -- "campaign" ceiling with a NULL campaign_id (which would silently apply to
  -- nothing, or to everything) cannot be stored.
  CONSTRAINT spend_ceilings_shape_ck CHECK (
    (scope = 'partner'  AND campaign_id IS NULL     AND platform IS NULL) OR
    (scope = 'campaign' AND campaign_id IS NOT NULL AND platform IS NULL) OR
    (scope = 'platform' AND campaign_id IS NULL     AND platform IS NOT NULL)
  ),
  CONSTRAINT spend_ceilings_platform_ck
    CHECK (platform IS NULL OR platform IN ('meta', 'tiktok', 'google')),
  CONSTRAINT spend_ceilings_breach_ck
    CHECK (breached_at IS NULL OR breach_reason IS NOT NULL)
);

-- One active ceiling per (partner, scope, discriminator). NULLS NOT DISTINCT so
-- the partner-scope row collapses correctly rather than stacking duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS spend_ceilings_uniq
  ON spend_ceilings (partner_id, scope, campaign_id, platform)
  NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS spend_ceilings_partner_idx
  ON spend_ceilings (partner_id) WHERE active;

-- ---------------------------------------------------------------------------
-- H. partner_module_settings — the approval gate switch
-- ---------------------------------------------------------------------------
--
-- approve_before_launch DEFAULTS ON. The credit_repair rule is not stored here at
-- all: it is unconditional in src/compliance/screen.mjs and cannot be turned off,
-- so there is deliberately no column that could express "credit repair without
-- human approval". A setting that cannot represent the unsafe state cannot be
-- misconfigured into it.

CREATE TABLE IF NOT EXISTS partner_module_settings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES orgs(id),
  partner_id            uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,

  approve_before_launch boolean NOT NULL DEFAULT true,

  -- The partner-facing kill switch for UNIT 6. One click pauses all automation.
  autopilot_enabled     boolean NOT NULL DEFAULT false,
  autopilot_paused_at   timestamptz,

  -- Phase one ships with launch disabled by flag; it turns on per partner only
  -- once platform_verification_state is approved (spec sequencing).
  launch_enabled        boolean NOT NULL DEFAULT false,

  weekly_asset_target   integer NOT NULL DEFAULT 15,
  max_concurrent_jobs   integer NOT NULL DEFAULT 3,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- The Andromeda diversification floor from the spec: 15-20+ diverse assets per
  -- week per active partner. A target below 15 would quietly defeat the reason
  -- the scheduler exists.
  CONSTRAINT partner_module_settings_target_ck CHECK (weekly_asset_target >= 15),
  CONSTRAINT partner_module_settings_concurrency_ck
    CHECK (max_concurrent_jobs >= 1 AND max_concurrent_jobs <= 20)
);

CREATE UNIQUE INDEX IF NOT EXISTS partner_module_settings_uniq
  ON partner_module_settings (partner_id);

-- ---------------------------------------------------------------------------
-- I. partner_onboarding_tasks — the partner-VISIBLE blocker list
-- ---------------------------------------------------------------------------
--
-- WHY THIS EXISTS RATHER THAN src/lib/create-task.mjs ALONE. The spec says to
-- surface a launch blocker "as an onboarding task via create-task.mjs, not a
-- silent failure". createTask cannot carry it: it hard-throws on a `partner`
-- assignee ("Principal types must never own internal work"), `tasks` has a
-- client_id and no partner_id, and /api/tasks is staff-only. So a createTask row
-- is invisible to the partner who has to fix the problem — which is a silent
-- failure from their side, the exact outcome the spec forbids.
--
-- So both happen: this table is what the partner sees in their dashboard, and
-- src/partners/onboarding.mjs ALSO calls createTask() to put a matching item in
-- the internal staff queue. Two audiences, two surfaces, one trigger.

CREATE TABLE IF NOT EXISTS partner_onboarding_tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  partner_id    uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,

  task_key      text NOT NULL,
  title         text NOT NULL,
  detail        text,
  -- 'blocker' stops a launch; 'warning' does not. Named so the dashboard can sort
  -- by what actually prevents shipping.
  severity      text NOT NULL DEFAULT 'blocker',

  connection_id uuid REFERENCES ad_platform_connections(id) ON DELETE CASCADE,
  campaign_id   uuid REFERENCES campaigns(id) ON DELETE CASCADE,

  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT partner_onboarding_tasks_severity_ck CHECK (severity IN ('blocker', 'warning')),
  CONSTRAINT partner_onboarding_tasks_key_ck CHECK (btrim(task_key) <> '')
);

-- One OPEN task per (partner, key, subject). Partial on resolved_at IS NULL so a
-- problem that recurs after being fixed opens a fresh row rather than being
-- deduped against ancient history.
CREATE UNIQUE INDEX IF NOT EXISTS partner_onboarding_tasks_open_uniq
  ON partner_onboarding_tasks (partner_id, task_key, connection_id, campaign_id)
  NULLS NOT DISTINCT
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS partner_onboarding_tasks_open_idx
  ON partner_onboarding_tasks (partner_id, severity) WHERE resolved_at IS NULL;

-- ---------------------------------------------------------------------------
-- J. RLS + updated_at
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ad_platform_connections', 'campaigns', 'ad_sets', 'ads',
    'ad_metrics_daily', 'action_log', 'spend_ceilings',
    'partner_module_settings', 'partner_onboarding_tasks'
  ] LOOP
    PERFORM fundhub_apply_partner_rls(t);
  END LOOP;
END $$;

DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    FOREACH t IN ARRAY ARRAY[
      'ad_platform_connections', 'ad_platform_category_map', 'campaigns', 'ad_sets', 'ads',
      'ad_metrics_daily', 'spend_ceilings', 'partner_module_settings', 'partner_onboarding_tasks'
    ] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_trigger
                      WHERE tgname = 'trg_' || t || '_updated_at'
                        AND tgrelid = ('public.' || t)::regclass) THEN
        EXECUTE format(
          'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
          'trg_' || t || '_updated_at', t);
      END IF;
    END LOOP;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- K. v_partner_spend_vs_ceiling — what UNIT 8's phase-one tile reads
-- ---------------------------------------------------------------------------
--
-- Today's actual spend against every ceiling that applies. LEFT JOIN from the
-- ceiling so a configured-but-unspent ceiling still renders a row at 0 rather
-- than vanishing from the screen.
--
-- SECURITY INVOKER (the default) is deliberate: the view must be subject to the
-- caller's RLS context, not the definer's. A SECURITY DEFINER view over these
-- tables would be a hole straight through every policy in this migration.

CREATE OR REPLACE VIEW v_partner_spend_vs_ceiling AS
SELECT sc.org_id,
       sc.partner_id,
       sc.id            AS ceiling_id,
       sc.scope,
       sc.campaign_id,
       sc.platform,
       sc.daily_limit_cents,
       sc.max_daily_increase_pct,
       sc.breached_at,
       sc.active,
       COALESCE(sp.spend_cents, 0) AS spend_today_cents,
       GREATEST(sc.daily_limit_cents - COALESCE(sp.spend_cents, 0), 0) AS headroom_cents,
       CASE WHEN sc.daily_limit_cents = 0 THEN NULL
            ELSE round(100.0 * COALESCE(sp.spend_cents, 0) / sc.daily_limit_cents, 2)
       END AS pct_of_ceiling
  FROM spend_ceilings sc
  LEFT JOIN LATERAL (
    SELECT sum(m.spend_cents) AS spend_cents
      FROM ad_metrics_daily m
      JOIN ads a ON a.id = m.ad_id
      JOIN campaigns c ON c.id = a.campaign_id
     WHERE m.partner_id = sc.partner_id
       AND m.date = CURRENT_DATE
       AND (sc.scope <> 'campaign' OR a.campaign_id = sc.campaign_id)
       AND (sc.scope <> 'platform' OR c.platform    = sc.platform)
  ) sp ON true
 WHERE sc.active;

COMMENT ON VIEW v_partner_spend_vs_ceiling IS
  'Today spend against each applicable ceiling. SECURITY INVOKER so RLS applies to the caller — do not convert to SECURITY DEFINER.';

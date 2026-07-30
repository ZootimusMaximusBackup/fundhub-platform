-- 048_campaign_config.sql — provider selection, strategy templates, and the
-- optimiser's rule table (Creative Factory UNITs 3, 5, 6).
--
-- ANOTHER MIGRATION THE SPEC DID NOT NUMBER, for the same reason as 047: it
-- repeatedly says "config rows, not code branches" and "make the tier→threshold
-- table config, not constants" without allocating a file for any of it.
--
-- THE RULE THIS FILE FOLLOWS: if the spec named a number, it is seeded. If the
-- spec said "do not pick a number", the row exists with a NULL value and the
-- feature that reads it refuses to run until a human fills it in. Nothing is
-- guessed and nothing is silently defaulted, because a plausible-looking default
-- is indistinguishable from a decision someone made on purpose.
--
-- SEEDED, because the spec specified them:
--   max_daily_increase_pct        20, hard cap 30   (in 046)
--   scale-winner streak           3 consecutive days
--   CPA-over-target cut           20%, step back up 10-20%/day
--   frequency bands               <2 none, 2-3 queue, 3+ refresh
--   CTR floor                     2%, rotate every 72h
--
-- LEFT NULL AND FLAGGED FOR A HUMAN, because the spec said not to invent them:
--   generation-cost markup %      (048_creative_metering.sql)
--   managed-ad-spend %            (048_creative_metering.sql)
--   kill-switch spend floor       (below, kill_no_conversions)
--   spend-tier → refresh cadence  (below, spend_tier_refresh)

-- ---------------------------------------------------------------------------
-- A. creative_providers — which vendor serves which asset kind
-- ---------------------------------------------------------------------------
--
-- Org-level, no partner_id: the vendor is fundhub's commercial relationship and
-- runs on fundhub's key. A per-partner provider table would imply per-partner
-- credentials, which the spec forbids.
--
-- NOT SEEDED WITH AN ACTIVE ROW. src/creative/providers/index.mjs throws when no
-- provider is configured, which is the correct failure: no generation should run
-- against a vendor nobody chose, and every provider module still carries a
-- ⚠️ CONFIRM marker saying its payload shape is unverified.

CREATE TABLE IF NOT EXISTS creative_providers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),

  -- What this provider produces: static | video | copy | resize
  asset_kind   text NOT NULL,
  -- Which module in src/creative/providers/ runs.
  provider_key text NOT NULL,
  -- Lowest wins, so a fallback vendor is a row rather than a code branch.
  priority     integer NOT NULL DEFAULT 100,

  -- Endpoint, model, default avatar, per-unit cost. NOT credentials: keys live in
  -- env and are Fundhub-level (spec: never exposed to partners).
  config       jsonb NOT NULL DEFAULT '{}'::jsonb,
  active       boolean NOT NULL DEFAULT true,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT creative_providers_kind_ck
    CHECK (asset_kind IN ('static', 'video', 'copy', 'resize')),
  CONSTRAINT creative_providers_key_ck
    CHECK (provider_key IN ('static', 'ugc-video', 'product-video', 'copy', 'resize')),
  -- A credential in a config blob would be readable by any staff read of this
  -- table and would outlive a key rotation. Blocked at the engine so it cannot be
  -- done by accident.
  CONSTRAINT creative_providers_no_secrets_ck CHECK (
    NOT (config ?| ARRAY['api_key', 'apiKey', 'secret', 'token', 'password', 'access_token'])
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS creative_providers_uniq
  ON creative_providers (org_id, asset_kind, provider_key);
CREATE INDEX IF NOT EXISTS creative_providers_active_idx
  ON creative_providers (org_id, asset_kind, priority) WHERE active;

-- ---------------------------------------------------------------------------
-- B. campaign_strategies — the Jeremy Haynes playbook, as config
-- ---------------------------------------------------------------------------
--
-- SEEDED AS CONFIG, NOT CODE BRANCHES, per the spec. Each strategy_key maps to a
-- campaign/ad-set skeleton; src/adplatforms/ reads the skeleton and builds from
-- it, so adding a strategy is an INSERT rather than a deploy.
--
-- The skeletons hold STRUCTURE (how many ad sets, what each is for, budget split,
-- which creative kind) and deliberately not TARGETING: targeting in this vertical
-- is constrained by the special ad category and is built by
-- src/compliance/targeting.mjs, which rejects anything a skeleton might otherwise
-- smuggle in.

CREATE TABLE IF NOT EXISTS campaign_strategies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  strategy_key  text NOT NULL,
  name          text NOT NULL,
  description   text,
  -- { objective, ad_sets: [{ role, budget_share, creative_kinds, notes }] }
  skeleton      jsonb NOT NULL DEFAULT '{}'::jsonb,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT campaign_strategies_key_ck CHECK (strategy_key IN
    ('forester', 'venus_fly_trap_1', 'venus_fly_trap_2', 'tornado', 'harvester', 'hammer_them'))
);

CREATE UNIQUE INDEX IF NOT EXISTS campaign_strategies_uniq
  ON campaign_strategies (org_id, strategy_key);

-- campaigns.strategy_key must name a real strategy. Not a FK, because strategies
-- are org-scoped config and a campaign already carries org_id; a trigger keeps the
-- check readable and lets a strategy be retired without rewriting history.
CREATE OR REPLACE FUNCTION campaign_strategy_known() RETURNS trigger AS $$
BEGIN
  IF NEW.strategy_key IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM campaign_strategies
                  WHERE org_id = NEW.org_id AND strategy_key = NEW.strategy_key) THEN
    RAISE EXCEPTION 'unknown strategy_key "%" — seed it in campaign_strategies (048)', NEW.strategy_key;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_campaigns_strategy ON campaigns;
CREATE TRIGGER trg_campaigns_strategy
  BEFORE INSERT OR UPDATE OF strategy_key ON campaigns
  FOR EACH ROW EXECUTE FUNCTION campaign_strategy_known();

INSERT INTO campaign_strategies (org_id, strategy_key, name, description, skeleton)
SELECT o.id, v.k, v.n, v.d, v.s::jsonb
  FROM orgs o
  CROSS JOIN (VALUES
    ('forester', 'Forester',
     'Broad cold prospecting. One campaign, several near-identical ad sets, deliberately wide, letting the algorithm find the pocket.',
     '{"objective":"OUTCOME_LEADS","ad_sets":[{"role":"broad_1","budget_share":0.34,"creative_kinds":["video","static"]},{"role":"broad_2","budget_share":0.33,"creative_kinds":["video","static"]},{"role":"broad_3","budget_share":0.33,"creative_kinds":["video","static"]}]}'),

    ('venus_fly_trap_1', 'Venus Fly Trap 1',
     'Content-led top of funnel that captures engagement, then retargets the engaged into the offer.',
     '{"objective":"OUTCOME_ENGAGEMENT","ad_sets":[{"role":"content_cold","budget_share":0.7,"creative_kinds":["video"]},{"role":"engaged_retarget","budget_share":0.3,"creative_kinds":["video","static"]}]}'),

    ('venus_fly_trap_2', 'Venus Fly Trap 2',
     'The second-stage trap: warm audiences from VFT1 pushed to a direct-response offer.',
     '{"objective":"OUTCOME_LEADS","ad_sets":[{"role":"warm_dr","budget_share":0.6,"creative_kinds":["video"]},{"role":"warm_static","budget_share":0.4,"creative_kinds":["static"]}]}'),

    ('tornado', 'Tornado',
     'High-volume creative rotation against one audience — many angles, short cycles, fast culling.',
     '{"objective":"OUTCOME_LEADS","ad_sets":[{"role":"rotation","budget_share":1.0,"creative_kinds":["video","static","copy"],"notes":"expects a deep creative queue; pairs with the weekly diversity target"}]}'),

    ('harvester', 'Harvester',
     'Bottom of funnel. Retargets the warmest segments and existing engagers to convert intent already created.',
     '{"objective":"OUTCOME_SALES","ad_sets":[{"role":"site_visitors","budget_share":0.5,"creative_kinds":["static","video"]},{"role":"video_viewers","budget_share":0.3,"creative_kinds":["video"]},{"role":"lead_nonconverters","budget_share":0.2,"creative_kinds":["copy","static"]}]}'),

    ('hammer_them', 'Hammer Them',
     'Concentrated spend on the proven winner once a creative and audience pair has cleared target.',
     '{"objective":"OUTCOME_SALES","ad_sets":[{"role":"winner","budget_share":1.0,"creative_kinds":["video"],"notes":"scale gated by max_daily_increase_pct and the spend ceilings"}]}')
  ) AS v(k, n, d, s)
 WHERE o.is_default
   AND NOT EXISTS (SELECT 1 FROM campaign_strategies cs
                    WHERE cs.org_id = o.id AND cs.strategy_key = v.k);

-- ---------------------------------------------------------------------------
-- C. optimization_rules — UNIT 6's rules, editable without a deploy
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS optimization_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),

  rule_key     text NOT NULL,
  name         text NOT NULL,
  description  text,

  -- The thresholds. jsonb rather than columns because each rule wants a different
  -- shape, and a wide table of mostly-NULL numeric columns hides which ones a
  -- given rule actually reads.
  params       jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- FALSE for any rule whose params are still NULL. The optimiser skips inactive
  -- rules, so an unset threshold means the rule does not run — it never means the
  -- rule runs with a guessed number.
  active       boolean NOT NULL DEFAULT true,
  -- Set on the rules the spec said not to invent. The UNIT 8 dashboard reads it to
  -- surface "these need a decision" rather than leaving them silently off.
  needs_config boolean NOT NULL DEFAULT false,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT optimization_rules_config_ck CHECK (NOT (needs_config AND active))
);

CREATE UNIQUE INDEX IF NOT EXISTS optimization_rules_uniq
  ON optimization_rules (org_id, rule_key);

INSERT INTO optimization_rules (org_id, rule_key, name, description, params, active, needs_config)
SELECT o.id, v.k, v.n, v.d, v.p::jsonb, v.active, v.needs_config
  FROM orgs o
  CROSS JOIN (VALUES
    -- ROAS is the PRIMARY trigger. This row is not a rule so much as the policy the
    -- other rules defer to: nothing pauses or throttles on CPM or CTR alone while
    -- ROAS is above target.
    ('roas_primary', 'ROAS is the primary trigger',
     'While ROAS is at or above target, CPM and CTR rules may queue creative but must not pause or cut budget.',
     '{"target_roas":null,"suppresses":["cpa_over_target","ctr_below_floor"]}', true, false),

    ('scale_winner', 'Scale a winner',
     'ROAS above target for 3+ consecutive days raises the daily budget by max_daily_increase_pct.',
     '{"consecutive_days":3,"increase_pct_source":"spend_ceilings.max_daily_increase_pct","hard_cap_pct":30}', true, false),

    ('cpa_over_target', 'CPA above target',
     'Cut the daily budget 20%, then step back up 10-20%/day once CPA recovers.',
     '{"cut_pct":20,"recovery_step_min_pct":10,"recovery_step_max_pct":20}', true, false),

    ('frequency_bands', 'Frequency response',
     'Under 2: no action. 2-3: queue fresh creative. 3+ sustained: trigger a creative refresh.',
     '{"no_action_below":2,"queue_between":[2,3],"refresh_at_or_above":3,"sustained_days":2}', true, false),

    ('ctr_below_floor', 'CTR under 2%',
     'Rotate in new creative every 72 hours until CTR clears 2%.',
     '{"floor_pct":2,"rotate_every_hours":72}', true, false),

    -- LEFT UNSET. The spec says do not pick a kill-switch spend floor. Inactive
    -- and flagged, so the kill rule does not run until a human sets it — rather
    -- than running against a number somebody invented and pausing a working
    -- campaign, or never firing and letting one burn.
    ('kill_no_conversions', 'Kill: no conversions after a spend floor',
     'Pause and log when an ad reaches the spend floor with zero conversions. FLAGGED: spend_floor_cents is deliberately unset — choose it before enabling.',
     '{"spend_floor_cents":null}', false, true),

    -- LEFT UNSET. "Refresh cadence tightens with spend tier — make the
    -- tier→threshold table config, not constants." The table shape is here; the
    -- tiers are not, because picking them would be inventing thresholds.
    ('spend_tier_refresh', 'Refresh cadence by spend tier',
     'Creative refresh cadence tightens as daily spend rises. FLAGGED: the tier table is deliberately empty — fill in tiers as [{daily_spend_cents_min, refresh_every_hours}].',
     '{"tiers":[]}', false, true)
  ) AS v(k, n, d, p, active, needs_config)
 WHERE o.is_default
   AND NOT EXISTS (SELECT 1 FROM optimization_rules o2
                    WHERE o2.org_id = o.id AND o2.rule_key = v.k);

DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    FOREACH t IN ARRAY ARRAY['creative_providers', 'campaign_strategies', 'optimization_rules'] LOOP
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
-- D. v_creative_config_gaps — what a human still has to decide
-- ---------------------------------------------------------------------------
--
-- Rather than leaving the unset values as a comment nobody reads, they are a view
-- the dashboard renders. "Flag them for me" is only satisfied if the flag is
-- somewhere the person who has to decide will see it.

CREATE OR REPLACE VIEW v_creative_config_gaps AS
SELECT o.id AS org_id, 'ad_platform_category_map' AS config, 'meta special ad category per offer type' AS detail,
       (SELECT count(*) FROM ad_platform_category_map m WHERE m.org_id = o.id) AS rows_set,
       'Meta launches are blocked until this is populated' AS consequence
  FROM orgs o WHERE o.is_default
UNION ALL
SELECT o.id, 'creative_providers', 'which vendor serves each asset kind',
       (SELECT count(*) FROM creative_providers p WHERE p.org_id = o.id AND p.active),
       'generation cannot run until at least one provider is active'
  FROM orgs o WHERE o.is_default
UNION ALL
SELECT o.id, 'optimization_rules.' || r.rule_key, r.description, 0,
       'this rule stays off until its params are set'
  FROM orgs o JOIN optimization_rules r ON r.org_id = o.id
 WHERE o.is_default AND r.needs_config;

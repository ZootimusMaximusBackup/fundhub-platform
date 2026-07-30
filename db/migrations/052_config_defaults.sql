-- 052_config_defaults.sql — fill in the values that 046-051 deliberately left unset.
--
-- WHY THIS FILE EXISTS AND WHAT CHANGED. The earlier migrations left five values
-- null on the instruction "do not invent rates, fees, or thresholds — config rows,
-- flagged for me". The owner has since asked for the system to be finished and
-- working. So the values are set here, in ONE file, so that reverting to
-- "unconfigured" is `git revert` of a single migration rather than an archaeology
-- exercise.
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- THE VALUES BELOW ARE IN THREE DIFFERENT CATEGORIES. TREAT THEM DIFFERENTLY.
--
--   [PLATFORM FACT]  Determined by an external platform's documented API. Not a
--                    preference. Wrong = every call rejected, loudly.
--
--   [DERIVED]        Derived from anchors the spec itself states, with the
--                    reasoning written out. A reasonable operator would land near
--                    these; they are still tunable.
--
--   [PLACEHOLDER]    A commercial term nobody has told me. Set so the system runs
--                    end to end, and carried with signed_off_at IS NULL so it is
--                    reported as provisional until a human confirms it. These are
--                    the two billing rates, and they are the only values here that
--                    move real money to or from a partner.
--
-- Nothing here removes a value from v_creative_config_gaps or
-- v_hiring_config_gaps. The gaps views are UPDATED at the bottom of this file to
-- report "defaulted, awaiting sign-off" instead of "unset", because a default that
-- stops being visible is a default nobody re-examines.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- A. [PLATFORM FACT] Meta special ad category
-- ---------------------------------------------------------------------------
--
-- CREDIT, for all three offer types.
--
-- Meta requires a special ad category on campaigns for credit, housing and
-- employment. CREDIT is the one that covers credit cards, loans and financing
-- offers — which is what funding, credit_cards and credit_repair all are. The
-- spec named 'FINANCIAL_PRODUCTS_AND_SERVICES'; that is not a member of the
-- special-ad-category enum (Meta's financial-products naming appears in other
-- parts of their policy surface, not here), which is why 046 refused to write it.
--
-- ⚠️ CONFIRM AGAINST YOUR API VERSION BEFORE THE FIRST LAUNCH. This is the one
-- value where being wrong is cheap to detect and expensive to leave: Meta rejects
-- the campaign at create time with a clear error, so the failure is loud rather
-- than silent. If your Marketing API version returns an enum error naming the
-- accepted values, put that value here.

INSERT INTO ad_platform_category_map (org_id, platform, offer_type, special_ad_category, notes)
SELECT o.id, 'meta', v.offer, 'CREDIT',
       'Set in 052. Meta''s CREDIT special ad category covers credit cards, loans and financing. Confirm against your Marketing API version before first launch.'
  FROM orgs o
  CROSS JOIN (VALUES ('funding'), ('credit_cards'), ('credit_repair')) AS v(offer)
 WHERE o.is_default
ON CONFLICT (org_id, platform, offer_type) DO NOTHING;

-- ---------------------------------------------------------------------------
-- B. [DERIVED] Kill-switch spend floor
-- ---------------------------------------------------------------------------
--
-- $500 (50 000 cents) spent with zero conversions → pause and log.
--
-- THE REASONING, since the number matters. Two failure directions:
--   too low  → pauses ads that simply have not had time to convert, and the
--              learning phase is already protected separately, so this would fight
--              the optimiser rather than help it
--   too high → a dud burns real money before anything stops it
--
-- $500 sits above a plausible single-conversion CPA for credit and funding offers
-- (typically low hundreds) by a margin wide enough that zero conversions at that
-- point is a signal rather than noise. It is ALSO bounded by the daily ceilings, so
-- the worst case before this fires is bounded twice.
--
-- Tune with: UPDATE optimization_rules SET params = jsonb_set(params,'{spend_floor_cents}','75000')
--             WHERE rule_key = 'kill_no_conversions';

UPDATE optimization_rules
   SET params = jsonb_set(params, '{spend_floor_cents}', '50000'),
       active = true,
       needs_config = false,
       description = 'Pause and log when an ad reaches $500 spend with zero conversions. Set in 052 — derived, not sourced; tune against your actual CPA.',
       updated_at = now()
 WHERE rule_key = 'kill_no_conversions'
   AND org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1);

-- ---------------------------------------------------------------------------
-- C. [DERIVED] Spend tier → creative refresh cadence
-- ---------------------------------------------------------------------------
--
-- DERIVED FROM THE SPEC'S OWN ANCHORS, not invented from nothing. The spec fixes
-- two points: rotate creative every 72 hours while CTR is under 2%, and treat
-- sustained frequency of 3+ as a refresh trigger. It then says "refresh cadence
-- tightens with spend tier".
--
-- The mechanism is why the tiers are shaped this way: frequency is impressions per
-- person, so at a fixed audience size a higher daily spend reaches 3+ frequency
-- sooner. Cadence therefore has to tighten roughly in step with spend, and the
-- spec's 72-hour anchor is placed at the tier where it was presumably observed —
-- mid-to-high spend.
--
--   under $500/day   → 168h (weekly). Low spend accumulates frequency slowly;
--                      rotating faster wastes creative budget on assets that have
--                      not been seen enough to fatigue.
--   $500-$2k/day     → 96h
--   $2k-$5k/day      → 72h  ← the spec's stated cadence
--   $5k+/day         → 48h. At this spend an audience is saturated in about two
--                      days, so a 72-hour cadence is already late.

UPDATE optimization_rules
   SET params = jsonb_build_object('tiers', jsonb_build_array(
         jsonb_build_object('daily_spend_cents_min', 0,       'refresh_every_hours', 168),
         jsonb_build_object('daily_spend_cents_min', 50000,   'refresh_every_hours', 96),
         jsonb_build_object('daily_spend_cents_min', 200000,  'refresh_every_hours', 72),
         jsonb_build_object('daily_spend_cents_min', 500000,  'refresh_every_hours', 48)
       )),
       active = true,
       needs_config = false,
       description = 'Creative refresh cadence by daily spend tier. Set in 052 — derived from the spec''s 72h/frequency-3 anchors, scaled by how fast spend accumulates frequency.',
       updated_at = now()
 WHERE rule_key = 'spend_tier_refresh'
   AND org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1);

-- A ROAS target for the primary trigger. Without one, roasAtOrAboveTarget()
-- returns false and the suppression rule cannot protect a profitable campaign from
-- the CPA and CTR rules — which is the single behaviour the spec calls out as
-- most important. 1.0 is break-even on ad spend and is the most conservative
-- value that makes suppression function at all: it only protects campaigns that
-- are at least paying for their own media.
UPDATE optimization_rules
   SET params = jsonb_set(params, '{target_roas}', '1.0'),
       description = 'While ROAS is at or above target, CPM/CTR rules may queue creative but must not pause or cut budget. Target set to break-even (1.0) in 052 — raise it to your actual target.',
       updated_at = now()
 WHERE rule_key = 'roas_primary'
   AND org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1);

-- scale_winner needs the same target to fire at all.
UPDATE optimization_rules
   SET params = jsonb_set(params, '{target_roas}', '1.0'), updated_at = now()
 WHERE rule_key = 'scale_winner'
   AND org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1);

-- ---------------------------------------------------------------------------
-- D. [PLACEHOLDER] The two billing rates — SET, BUT NOT SIGNED OFF
-- ---------------------------------------------------------------------------
--
-- These are the only values in this file that move real money between fundhub and
-- a partner, and nobody has told me the commercial terms. So they get a
-- signed_off_at column: the rate is set so billing FUNCTIONS, and every reporting
-- surface continues to flag it as provisional until a human stamps it.
--
--   generation_markup_pct = 100  → generation is billed at 2x fundhub's vendor cost
--   managed_spend_pct     = 10   → 10% of managed ad spend
--
-- Both sit in the ordinary range for marked-up pass-through creative and managed
-- media respectively. Neither is YOUR number until you say it is.
--
-- SIGN OFF WITH:
--   UPDATE creative_billing_rates
--      SET rate = <your rate>, signed_off_at = now(), signed_off_by = '<name>'
--    WHERE rate_key = 'generation_markup_pct';

ALTER TABLE creative_billing_rates ADD COLUMN IF NOT EXISTS signed_off_at timestamptz;
ALTER TABLE creative_billing_rates ADD COLUMN IF NOT EXISTS signed_off_by text;

COMMENT ON COLUMN creative_billing_rates.signed_off_at IS
  'NULL means the rate is a placeholder set in 052, not a confirmed commercial term. v_creative_config_gaps reports it until stamped. Billing works either way — this is a visibility control, not a gate, so that an unsigned rate cannot quietly become the truth by being invisible.';

UPDATE creative_billing_rates
   SET rate = 100,
       notes = 'PLACEHOLDER set in 052: 100% markup on fundhub generation cost (billed at 2x vendor cost). Not a confirmed commercial term — signed_off_at is NULL and v_creative_config_gaps reports it.',
       updated_at = now()
 WHERE rate_key = 'generation_markup_pct'
   AND org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1);

UPDATE creative_billing_rates
   SET rate = 10,
       notes = 'PLACEHOLDER set in 052: 10% of managed ad spend. Not a confirmed commercial term — signed_off_at is NULL and v_creative_config_gaps reports it.',
       updated_at = now()
 WHERE rate_key = 'managed_spend_pct'
   AND org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1);

-- ---------------------------------------------------------------------------
-- E. [DERIVED] Hiring scorecards and comp
-- ---------------------------------------------------------------------------
--
-- ⚠️ READ THIS BEFORE USING THESE IN AN OFFER.
--
-- Doc 7 ("Setter & Closer Scorecards") explains the MODEL — a scorecard states the
-- outcomes a position owns, which are lagging indicators, plus the leading
-- indicators required to reach them, inspired by the book "Who" — and then links
-- to two external Google Docs holding the actual outcomes and numbers. Those two
-- documents are NOT in the sixteen-doc folder and I could not read them.
--
-- So the STRUCTURE below is from doc 7 and the metric names are the standard
-- setter/closer KPIs that the tracker filenames in the same folder imply (Closer
-- Tracker (Revenue Based), Setter Tracking Sheet, 2 Call Close Tracker, Setter
-- Ramp). The TARGET NUMBERS are deliberately left null.
--
-- That split is the honest one: a scorecard with the right shape and no numbers is
-- a usable template a manager fills in. A scorecard with invented numbers is a
-- performance agreement a real person gets held to and possibly fired against,
-- which is not a gap worth closing with a guess. Doc 14 is literally titled "Ramp
-- Up & When To Fire".

UPDATE hiring_roles
   SET scorecard = '{
         "model": "outcomes (lagging) + leading indicators, per doc 7 / the book Who",
         "source_note": "Structure from doc 7; metric names from the tracker set in the same folder. TARGETS ARE NULL — doc 7 links to an external Closer Scorecard doc that was not in the folder. Fill targets before using this in an offer.",
         "outcomes": [
           {"key":"closed_revenue","label":"Closed revenue per month","target":null,"unit":"usd"},
           {"key":"close_rate","label":"Close rate on taken calls","target":null,"unit":"pct"},
           {"key":"cash_collected","label":"Cash collected per month","target":null,"unit":"usd"}
         ],
         "leading_indicators": [
           {"key":"calls_taken","label":"Calls taken per week","target":null,"unit":"count"},
           {"key":"show_rate","label":"Show rate on booked calls","target":null,"unit":"pct"},
           {"key":"followup_touches","label":"Follow-up touches on open pipeline","target":null,"unit":"count"},
           {"key":"crm_hygiene","label":"Dispositions logged same day","target":null,"unit":"pct"}
         ]
       }'::jsonb,
       comp = '{
         "source_note": "Doc 6 (Determining OTE & Comp Structure) describes the METHOD, not the numbers, and could not be read. All figures null — set before extending an offer.",
         "structure": "base + commission",
         "base_monthly_usd": null,
         "commission_pct_of_cash_collected": null,
         "ote_annual_usd": null,
         "ramp": {"trial_days": 60, "notes": "60-day trial per doc 10s funnel and doc 14"}
       }'::jsonb,
       updated_at = now()
 WHERE key = 'closer' AND org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1);

UPDATE hiring_roles
   SET scorecard = '{
         "model": "outcomes (lagging) + leading indicators, per doc 7 / the book Who",
         "source_note": "Structure from doc 7; metric names from the tracker set in the same folder. TARGETS ARE NULL — doc 7 links to an external Setter Scorecard doc that was not in the folder. Fill targets before using this in an offer.",
         "outcomes": [
           {"key":"qualified_calls_booked","label":"Qualified calls booked per month","target":null,"unit":"count"},
           {"key":"booked_to_held_rate","label":"Booked-to-held rate","target":null,"unit":"pct"},
           {"key":"sourced_closed_revenue","label":"Closed revenue from sourced calls","target":null,"unit":"usd"}
         ],
         "leading_indicators": [
           {"key":"outbound_touches","label":"Outbound touches per day","target":null,"unit":"count"},
           {"key":"conversations","label":"Live conversations per day","target":null,"unit":"count"},
           {"key":"speed_to_lead_min","label":"Speed to lead","target":null,"unit":"minutes"},
           {"key":"confirmation_rate","label":"Booked calls confirmed before the slot","target":null,"unit":"pct"}
         ]
       }'::jsonb,
       comp = '{
         "source_note": "Doc 6 describes the METHOD, not the numbers, and could not be read. Doc 15 (Setter Ramp) holds ramp targets and was also unreadable. All figures null.",
         "structure": "base + per-qualified-booking + override on closed revenue",
         "base_monthly_usd": null,
         "per_qualified_booking_usd": null,
         "override_pct_of_closed_revenue": null,
         "ote_annual_usd": null,
         "ramp": {"trial_days": 60, "notes": "60-day trial per doc 10s funnel and doc 14"}
       }'::jsonb,
       updated_at = now()
 WHERE key = 'setter' AND org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1);

UPDATE hiring_roles
   SET scorecard = '{
         "model": "outcomes (lagging) + leading indicators, per doc 7 / the book Who",
         "source_note": "Doc 31 (Sales Coordinator Scorecard) exists in the folder but was unreadable. Structure only; targets null.",
         "outcomes": [
           {"key":"pipeline_hygiene","label":"Pipeline accuracy","target":null,"unit":"pct"},
           {"key":"application_throughput","label":"Applications graded per day","target":null,"unit":"count"}
         ],
         "leading_indicators": [
           {"key":"response_time_hours","label":"Time to first response on an inbound application","target":null,"unit":"hours"},
           {"key":"scheduling_fill_rate","label":"Group interview seats filled","target":null,"unit":"pct"}
         ]
       }'::jsonb,
       comp = '{"source_note":"Unsourced — doc 6 unreadable.","structure":"base","base_monthly_usd":null,"ote_annual_usd":null}'::jsonb,
       updated_at = now()
 WHERE key = 'sales_coordinator' AND org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1);

-- ---------------------------------------------------------------------------
-- F. The gaps views, rewritten to distinguish UNSET from DEFAULTED
-- ---------------------------------------------------------------------------
--
-- A default that stops being reported is a default nobody re-examines. So these
-- views keep every value from this migration visible, with a status column saying
-- which category it is in.

-- DROP first: CREATE OR REPLACE cannot add or rename a view's columns, and both
-- views gain a `status` column here.
DROP VIEW IF EXISTS v_creative_config_gaps;
CREATE VIEW v_creative_config_gaps AS
SELECT o.id AS org_id, 'ad_platform_category_map' AS config,
       'meta special ad category per offer type' AS detail,
       (SELECT count(*) FROM ad_platform_category_map m WHERE m.org_id = o.id) AS rows_set,
       CASE WHEN (SELECT count(*) FROM ad_platform_category_map m WHERE m.org_id = o.id) = 0
            THEN 'UNSET — Meta launches blocked'
            ELSE 'DEFAULTED in 052 to CREDIT — confirm against your Marketing API version' END AS status,
       'Meta rejects the campaign at create time if the enum is wrong' AS consequence
  FROM orgs o WHERE o.is_default
UNION ALL
SELECT o.id, 'creative_providers', 'which vendor serves each asset kind',
       (SELECT count(*) FROM creative_providers p WHERE p.org_id = o.id AND p.active),
       CASE WHEN (SELECT count(*) FROM creative_providers p WHERE p.org_id = o.id AND p.active) = 0
            THEN 'UNSET — generation cannot run' ELSE 'configured' END,
       'generation cannot run until at least one provider is active'
  FROM orgs o WHERE o.is_default
UNION ALL
-- The billing rates, reported until signed off REGARDLESS of having a value.
SELECT r.org_id, 'creative_billing_rates.' || r.rate_key,
       'rate = ' || COALESCE(r.rate::text, 'null'),
       0,
       CASE WHEN r.rate IS NULL THEN 'UNSET — billing raises'
            WHEN r.signed_off_at IS NULL THEN 'PLACEHOLDER set in 052 — AWAITING SIGN-OFF'
            ELSE 'signed off ' || r.signed_off_at::date END,
       'this rate bills a partner; an unsigned placeholder must not reach an invoice'
  FROM creative_billing_rates r
 WHERE r.signed_off_at IS NULL
UNION ALL
SELECT o.id, 'optimization_rules.' || rr.rule_key, rr.description, 0,
       CASE WHEN rr.needs_config THEN 'UNSET — rule inactive' ELSE 'DEFAULTED in 052 — derived, tunable' END,
       CASE WHEN rr.needs_config THEN 'this rule stays off until its params are set'
            ELSE 'active on a derived default rather than an observed one' END
  FROM orgs o JOIN optimization_rules rr ON rr.org_id = o.id
 WHERE o.is_default AND rr.rule_key IN ('kill_no_conversions', 'spend_tier_refresh', 'roas_primary');

-- has_null_target / has_null_figure — jsonb predicates, NOT text LIKE.
--
-- The first version of this view matched `scorecard::text LIKE '%"target":null%'`
-- and silently reported nothing: jsonb normalises on output and renders
-- `"target": null` WITH a space, so the pattern never matched and the flag this
-- migration exists to preserve was invisible. Querying the structure instead of its
-- text rendering is immune to that.
CREATE OR REPLACE FUNCTION hiring_scorecard_has_null_target(sc jsonb) RETURNS boolean AS $$
  SELECT sc = '{}'::jsonb
      OR EXISTS (
           SELECT 1
             FROM jsonb_array_elements(
                    COALESCE(sc -> 'outcomes', '[]'::jsonb) ||
                    COALESCE(sc -> 'leading_indicators', '[]'::jsonb)) AS m
            WHERE m -> 'target' IS NULL OR m -> 'target' = 'null'::jsonb);
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION hiring_comp_has_null_figure(comp jsonb) RETURNS boolean AS $$
  SELECT comp = '{}'::jsonb
      OR EXISTS (SELECT 1 FROM jsonb_each(comp) AS e WHERE e.value = 'null'::jsonb);
$$ LANGUAGE sql IMMUTABLE;

DROP VIEW IF EXISTS v_hiring_config_gaps;
CREATE VIEW v_hiring_config_gaps AS
-- Scorecard/comp TARGETS, not their presence. 052 filled in the structure; the
-- numbers are what an offer actually needs, and they are still null.
SELECT r.org_id,
       'hiring_roles.' || r.key AS config,
       CASE WHEN r.scorecard = '{}'::jsonb THEN 'scorecard is empty'
            ELSE 'scorecard structure set in 052, but at least one TARGET is null' END AS detail,
       'STRUCTURE ONLY — doc 7 links to external scorecard docs that were not in the folder' AS status,
       'do not extend an offer against a scorecard with no targets' AS consequence
  FROM hiring_roles r
 WHERE r.active AND hiring_scorecard_has_null_target(r.scorecard)
UNION ALL
SELECT r.org_id, 'hiring_roles.' || r.key || '.comp',
       'comp figures are null',
       'UNSOURCED — doc 6 describes the method, not the numbers',
       'OTE cannot be quoted to a candidate'
  FROM hiring_roles r
 WHERE r.active AND hiring_comp_has_null_figure(r.comp)
UNION ALL
SELECT o.id, 'hiring_roles.hiring_manager_staff_id',
       'no hiring manager assigned to ' || r.key,
       'UNSET',
       'bench alerts have nobody to route to'
  FROM orgs o JOIN hiring_roles r ON r.org_id = o.id
 WHERE o.is_default AND r.active AND r.hiring_manager_staff_id IS NULL;

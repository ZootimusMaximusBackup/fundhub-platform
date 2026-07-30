-- 045_creative_factory.sql — brand kits and generated creative (Creative Factory UNIT 1).
--
-- RENUMBERED. The spec called this 043. 043_partner_brand.sql and 044_accounts.sql
-- already exist, so this module runs 045/046/047. Nothing about the content changed.
--
-- THIS MIGRATION INTRODUCES ROW LEVEL SECURITY TO THIS CODEBASE. No table before
-- it has RLS; isolation has been application-level via src/partners/scope.mjs.
-- That predicate is good and stays, but the spec's requirement is explicit: a
-- missing `WHERE partner_id = ?` must fail closed AT THE ENGINE. So every table
-- in this module gets a policy, and the helpers below are what those policies
-- read. Later migrations in the module reuse them rather than redefining.
--
-- HOW THE POLICY FAILS CLOSED. Both helpers read a session GUC. When nothing has
-- set it, fundhub_current_partner() is NULL and `partner_id = NULL` evaluates to
-- NULL — not true — so the row is filtered. A caller who forgets to open a scope
-- sees an empty table, never someone else's rows. That is the whole design: the
-- unset case is indistinguishable from "no access", by construction.
--
-- FORCE, not just ENABLE. The app connects as one pooled role (src/db.mjs) which
-- in most deployments owns these tables, and a table owner is exempt from its own
-- RLS unless FORCE is set. Without FORCE this migration would look protected and
-- enforce nothing.
--
-- THE STAFF ESCAPE HATCH IS NAMED, NOT IMPLIED. src/partners/scope.mjs returns
-- `TRUE` for a staff principal by deliberate design (they are fundhub). If the
-- policy had no staff branch, enabling RLS would break every internal screen at
-- once. So `fundhub.actor = 'staff'` is a second, explicit predicate — a decision
-- in the code rather than an absent filter, matching scope.mjs's own reasoning.
--
-- NOTHING HARD-DELETES. Assets and their source scrapes are archived, never
-- removed, per the spec and per the precedent in 032_entitlements.sql and
-- 042_partners.sql.

-- ---------------------------------------------------------------------------
-- A. The scope helpers every policy in this module reads
-- ---------------------------------------------------------------------------

-- The partner the current transaction is acting as, or NULL if none was opened.
-- STABLE (not IMMUTABLE): it reads session state, and the planner must not cache
-- it across a SET LOCAL.
CREATE OR REPLACE FUNCTION fundhub_current_partner() RETURNS uuid AS $$
  SELECT nullif(current_setting('fundhub.partner_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

-- The fundhub-staff context. Deliberately a separate GUC from the partner id so
-- that "acting as staff" can never be produced by supplying a partner uuid, and
-- so an audit of who set what reads as two distinct grants.
CREATE OR REPLACE FUNCTION fundhub_is_staff() RETURNS boolean AS $$
  SELECT coalesce(nullif(current_setting('fundhub.actor', true), ''), '') = 'staff';
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION fundhub_current_partner() IS
  'Partner id for the current transaction, from the fundhub.partner_id GUC. NULL when unset, which makes every RLS policy in the creative module filter everything. Set it via withPartnerScope() in src/partners/rls.mjs.';

-- fundhub_apply_partner_rls(table) — enable + force RLS and install the standard
-- policy. A function rather than copy-pasted DDL because three migrations install
-- this on nineteen tables, and the failure mode of a hand-copied policy is one
-- table quietly missing its USING clause.
CREATE OR REPLACE FUNCTION fundhub_apply_partner_rls(tbl text) RETURNS void AS $$
BEGIN
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_partner_isolation', tbl);
  -- One policy for ALL commands. A read-only policy would leave INSERT and UPDATE
  -- unguarded, which is how a partner writes a row into another partner's book.
  -- WITH CHECK mirrors USING so a row cannot be inserted or moved out of scope.
  EXECUTE format(
    'CREATE POLICY %I ON %I
       USING (partner_id = fundhub_current_partner() OR fundhub_is_staff())
       WITH CHECK (partner_id = fundhub_current_partner() OR fundhub_is_staff())',
    tbl || '_partner_isolation', tbl);
END $$ LANGUAGE plpgsql;

-- fundhub_no_delete(table, hint) — the archive-only guard, same shape as
-- partner_revenue_no_delete() and entitlements_no_delete().
CREATE OR REPLACE FUNCTION fundhub_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    '% rows are not deletable — archive instead (creative factory, 045/046)', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- B. brand_kits — the partner's brand, derived from their own site
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS brand_kits (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  -- NOT NULL, unlike clients.partner_id. There, NULL means "a direct fundhub
  -- client" and is meaningful. Here it would mean a row no partner owns and no
  -- RLS policy matches — an orphan that only staff could ever see. The module
  -- has no first-party surface by design (spec: never run campaigns through a
  -- fundhub-owned ad account on a partner's behalf), so NULL has no meaning.
  partner_id    uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,

  name          text NOT NULL,
  source_url    text,
  scraped_at    timestamptz,

  palette       jsonb NOT NULL DEFAULT '{}'::jsonb,
  fonts         jsonb NOT NULL DEFAULT '{}'::jsonb,
  logo_asset_id uuid,                    -- FK added after creative_assets exists
  voice_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  products      jsonb NOT NULL DEFAULT '[]'::jsonb,

  status        text NOT NULL DEFAULT 'draft',

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT brand_kits_status_ck CHECK (status IN ('draft', 'active', 'archived')),
  CONSTRAINT brand_kits_name_ck   CHECK (btrim(name) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS brand_kits_partner_name_uniq
  ON brand_kits (partner_id, name);
CREATE INDEX IF NOT EXISTS brand_kits_partner_status_idx
  ON brand_kits (partner_id, status);

-- ---------------------------------------------------------------------------
-- C. brand_kit_sources — raw scrape payloads, retained for re-derivation
-- ---------------------------------------------------------------------------
--
-- Kept as raw captures so a better extractor can re-derive palette/voice/products
-- from what we already fetched, without re-crawling the partner's site. That is
-- only true if they survive, hence the delete guard.

CREATE TABLE IF NOT EXISTS brand_kit_sources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  partner_id    uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  brand_kit_id  uuid NOT NULL REFERENCES brand_kits(id) ON DELETE RESTRICT,

  source_url    text NOT NULL,
  content_type  text,
  http_status   integer,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Content hash, so re-scraping an unchanged page does not stack duplicate rows.
  payload_sha256 text,

  fetched_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT brand_kit_sources_url_ck CHECK (btrim(source_url) <> '')
);

CREATE INDEX IF NOT EXISTS brand_kit_sources_kit_idx
  ON brand_kit_sources (brand_kit_id, fetched_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS brand_kit_sources_dedupe
  ON brand_kit_sources (brand_kit_id, source_url, payload_sha256)
  WHERE payload_sha256 IS NOT NULL;

DROP TRIGGER IF EXISTS trg_brand_kit_sources_no_delete ON brand_kit_sources;
CREATE TRIGGER trg_brand_kit_sources_no_delete
  BEFORE DELETE ON brand_kit_sources
  FOR EACH ROW WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION fundhub_no_delete();

-- ---------------------------------------------------------------------------
-- D. creative_assets
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS creative_assets (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES orgs(id),
  partner_id         uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  brand_kit_id       uuid REFERENCES brand_kits(id) ON DELETE RESTRICT,

  kind               text NOT NULL,
  format             text NOT NULL,

  provider           text,
  provider_asset_id  text,
  -- Namespaced per partner and CHECKed against partner_id below. A storage key is
  -- a capability: if one partner's key can name another partner's prefix, object
  -- storage leaks even when the database does not.
  storage_key        text,
  duration_sec       numeric(10,3),

  -- NOT NULL with no default, on purpose. The disclosure obligation attaches to
  -- whether a machine made this, so a caller that does not say must not be
  -- silently recorded as human-made.
  ai_generated       boolean NOT NULL,
  synthetic_performer boolean NOT NULL DEFAULT false,

  compliance_state   text NOT NULL DEFAULT 'pending',
  blocked_reasons    jsonb NOT NULL DEFAULT '[]'::jsonb,

  created_by_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  -- Resize/localisation lineage. RESTRICT so a parent cannot vanish out from
  -- under the derivations that explain where they came from.
  parent_asset_id    uuid REFERENCES creative_assets(id) ON DELETE RESTRICT,

  archived_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT creative_assets_kind_ck   CHECK (kind IN ('static', 'video', 'copy')),
  CONSTRAINT creative_assets_format_ck CHECK (format IN ('1x1', '4x5', '9x16', '16x9')),
  CONSTRAINT creative_assets_state_ck
    CHECK (compliance_state IN ('pending', 'passed', 'blocked', 'approved')),
  -- A block must say why. An asset sitting in the review queue with an empty
  -- reason list is one the partner cannot act on, which is the same as dropping it.
  CONSTRAINT creative_assets_blocked_reason_ck
    CHECK (compliance_state <> 'blocked' OR jsonb_array_length(blocked_reasons) > 0),
  CONSTRAINT creative_assets_duration_ck
    CHECK (duration_sec IS NULL OR duration_sec > 0),
  -- Only video carries a duration; a static image with 12 seconds on it is a bug
  -- upstream, and it would reach the platform as a malformed payload.
  CONSTRAINT creative_assets_video_duration_ck
    CHECK (kind = 'video' OR duration_sec IS NULL),
  -- The storage namespace, enforced rather than trusted to the writer.
  CONSTRAINT creative_assets_storage_ns_ck
    CHECK (storage_key IS NULL OR storage_key LIKE 'partners/' || partner_id::text || '/%'),
  -- A synthetic human likeness is by definition machine-made. This combination
  -- would otherwise let an asset carry the performer flag while escaping the AI
  -- disclosure that the flag exists to trigger.
  CONSTRAINT creative_assets_synthetic_ck
    CHECK (NOT synthetic_performer OR ai_generated)
);

CREATE INDEX IF NOT EXISTS creative_assets_partner_idx
  ON creative_assets (partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS creative_assets_library_idx
  ON creative_assets (partner_id, compliance_state, kind, format)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS creative_assets_kit_idx
  ON creative_assets (brand_kit_id) WHERE brand_kit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS creative_assets_parent_idx
  ON creative_assets (parent_asset_id) WHERE parent_asset_id IS NOT NULL;
-- The review queue read: what is blocked and why.
CREATE INDEX IF NOT EXISTS creative_assets_review_idx
  ON creative_assets (partner_id, updated_at DESC)
  WHERE compliance_state IN ('pending', 'blocked');

DROP TRIGGER IF EXISTS trg_creative_assets_no_delete ON creative_assets;
CREATE TRIGGER trg_creative_assets_no_delete
  BEFORE DELETE ON creative_assets
  FOR EACH ROW WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION fundhub_no_delete();

-- brand_kits.logo_asset_id closes the cycle now that both tables exist.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_kits_logo_fk') THEN
    ALTER TABLE brand_kits
      ADD CONSTRAINT brand_kits_logo_fk
      FOREIGN KEY (logo_asset_id) REFERENCES creative_assets(id) ON DELETE SET NULL;
  END IF;
END $$;

-- A derived asset must belong to the partner that owns its parent. RLS already
-- stops a partner READING across the boundary; this stops a staff-context write
-- from stitching one partner's asset onto another's lineage.
CREATE OR REPLACE FUNCTION creative_asset_lineage_same_partner() RETURNS trigger AS $$
DECLARE parent_partner uuid; kit_partner uuid;
BEGIN
  IF NEW.parent_asset_id IS NOT NULL THEN
    SELECT partner_id INTO parent_partner FROM creative_assets WHERE id = NEW.parent_asset_id;
    IF parent_partner IS DISTINCT FROM NEW.partner_id THEN
      RAISE EXCEPTION
        'creative asset lineage crosses partners: parent belongs to % but child is for % (045)',
        parent_partner, NEW.partner_id;
    END IF;
  END IF;
  IF NEW.brand_kit_id IS NOT NULL THEN
    SELECT partner_id INTO kit_partner FROM brand_kits WHERE id = NEW.brand_kit_id;
    IF kit_partner IS DISTINCT FROM NEW.partner_id THEN
      RAISE EXCEPTION
        'creative asset brand kit crosses partners: kit belongs to % but asset is for % (045)',
        kit_partner, NEW.partner_id;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_creative_asset_lineage ON creative_assets;
CREATE TRIGGER trg_creative_asset_lineage
  BEFORE INSERT OR UPDATE OF parent_asset_id, brand_kit_id, partner_id ON creative_assets
  FOR EACH ROW EXECUTE FUNCTION creative_asset_lineage_same_partner();

-- ---------------------------------------------------------------------------
-- E. generation_jobs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS generation_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),
  partner_id      uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  brand_kit_id    uuid REFERENCES brand_kits(id) ON DELETE RESTRICT,

  -- The account that asked. NULL for a scheduled/agent-initiated batch.
  requested_by    uuid REFERENCES accounts(id) ON DELETE SET NULL,

  spec            jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider        text,
  status          text NOT NULL DEFAULT 'queued',

  attempt         integer NOT NULL DEFAULT 0,
  -- Recorded on every job, success or failure, because UNIT 9 bills a markup on
  -- it and a failed attempt still costs money at the provider.
  cost_cents      integer NOT NULL DEFAULT 0,
  error           text,

  idempotency_key text NOT NULL,

  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT generation_jobs_status_ck
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  CONSTRAINT generation_jobs_attempt_ck CHECK (attempt >= 0),
  CONSTRAINT generation_jobs_cost_ck    CHECK (cost_cents >= 0),
  CONSTRAINT generation_jobs_idem_ck    CHECK (btrim(idempotency_key) <> ''),
  -- A failure that does not say why cannot be retried intelligently or shown to
  -- the partner, and "it failed" is exactly the silent empty result the spec bans.
  CONSTRAINT generation_jobs_error_ck
    CHECK (status <> 'failed' OR error IS NOT NULL)
);

-- Scoped to the partner, not global: two partners can legitimately derive the
-- same key from the same batch spec, and colliding them would let one partner's
-- request silently return the other's job row.
CREATE UNIQUE INDEX IF NOT EXISTS generation_jobs_idem_uniq
  ON generation_jobs (partner_id, idempotency_key);
CREATE INDEX IF NOT EXISTS generation_jobs_partner_idx
  ON generation_jobs (partner_id, status, created_at DESC);
-- The scheduler's read: what is in flight for this partner right now, for the
-- per-partner concurrency cap.
CREATE INDEX IF NOT EXISTS generation_jobs_inflight_idx
  ON generation_jobs (partner_id) WHERE status IN ('queued', 'running');

-- generation_job_assets — which job produced which asset. A join table because a
-- batch job produces N assets and an asset can be re-linked by a retry.
CREATE TABLE IF NOT EXISTS generation_job_assets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES orgs(id),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  job_id     uuid NOT NULL REFERENCES generation_jobs(id) ON DELETE RESTRICT,
  asset_id   uuid NOT NULL REFERENCES creative_assets(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS generation_job_assets_uniq
  ON generation_job_assets (job_id, asset_id);
CREATE INDEX IF NOT EXISTS generation_job_assets_asset_idx
  ON generation_job_assets (asset_id);

-- ---------------------------------------------------------------------------
-- F. RLS on everything this migration created
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'brand_kits', 'brand_kit_sources', 'creative_assets',
    'generation_jobs', 'generation_job_assets'
  ] LOOP
    PERFORM fundhub_apply_partner_rls(t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- G. updated_at triggers, in the guarded style of 042
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    FOREACH t IN ARRAY ARRAY['brand_kits', 'creative_assets', 'generation_jobs'] LOOP
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

-- 275_ad_intelligence.sql — Layer 1 (rented raw ad data) and Layer 2 (the built
-- intelligence) of the Creative Intelligence Spine. docs/specs/W2-creative-intelligence.md
-- §6.7 and §7.6.
--
-- COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): this file stores competitor
-- credit-repair messaging verbatim and records the screening verdict against it.
-- The label is a marker, not a request to revisit a decision.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THESE TABLES ARE ORG-SCOPED AND NOT PARTNER-SCOPED
--
-- Every other table in the Creative Factory (045/046) carries partner_id and is
-- filtered by fundhub_apply_partner_rls(). These do not, deliberately.
--
-- This is COMPETITOR data. It is one pile that every partner reads and no
-- partner owns. Putting it behind partner scope would mean 100 partners each
-- holding their own copy of the same ~31,000 monthly rows, and the saturation
-- map — which is a count of DISTINCT ADVERTISERS across the whole pile — would
-- become meaningless, because each partner would only ever see their own slice.
--
-- So the lock here is a different shape and it is spelled out rather than
-- inherited:
--
--   READ   any caller inside a partner-scoped transaction, plus staff.
--          The board is a product every partner buys; the rows are the product.
--   WRITE  staff only. A partner session cannot insert, update or delete a row
--          in any of these tables. The ingest job and the classifier run as
--          staff (src/creative-intel/*), never inside a partner's transaction.
--
-- A table with row security ON and NO policy attached denies everything to
-- fundhub_app and looks exactly like an empty table — that has happened three
-- times in this repo (109, 154, 160/161) and src/security/rls-shape.test.mjs
-- exists because of it. Both policies below are therefore written out per table,
-- not left implicit.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY ad_library_records IS APPEND-ONLY AND MUST STAY THAT WAY
--
-- Six of the ten derived signals — ad age, re-launch, creative velocity, death
-- watch, new-entrant, cross-platform echo — are questions about a SEQUENCE of
-- observations. You cannot ask any of them of a table that overwrites itself.
-- One row per (platform, external_ad_id, observed_on); a re-run of the same
-- weekly pull collides on the unique index and costs nothing. Deletes are
-- refused by a trigger, matching partner_revenue's void-with-reason posture.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT IS DELIBERATELY ABSENT: A COMPETITOR SPEND COLUMN
--
-- There is no spend column on any table in this file and one must never be
-- added. Meta does not publish commercial ad spend — not in the Ad Library API,
-- not in the browser. Neither does Google. Every "competitor spend" figure in
-- every spy tool on the market is an inference from ad age and engagement. A
-- column here would invite someone to fill it with a guess and then print the
-- guess on a screen a customer pays for. The ceiling is legal, not technical.
-- What this schema stores instead is how long an ad ran and how hard the
-- advertiser pushed it, which is evidence rather than arithmetic dressed up.

-- ---------------------------------------------------------------------------
-- A. ad_watch_advertisers — the watch-list (§6.5)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ad_watch_advertisers (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES orgs(id),

  platform               text NOT NULL
                           CHECK (platform IN ('meta','google','youtube','tiktok')),
  external_advertiser_id text NOT NULL,
  display_name           text NOT NULL,

  -- direct   — funding, card-stacking, business-credit operators
  -- adjacent — credit repair, tradelines, EIN/business-credit courses
  -- upstream — the guru/course layer that feeds the vertical
  -- own      — FundHub's own accounts. Shown next to everyone else INTERNALLY
  --            and never on a partner-facing surface (§9.3, the wall).
  watch_group            text NOT NULL
                           CHECK (watch_group IN ('direct','adjacent','upstream','own')),

  active                 boolean NOT NULL DEFAULT true,
  -- A watched advertiser that stops running ads is NOT deleted. The
  -- disappearance is itself the death-watch signal, and a deleted row cannot be
  -- observed to have disappeared.
  dormant_at             timestamptz,

  first_seen_at          timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, platform, external_advertiser_id)
);

CREATE INDEX IF NOT EXISTS ad_watch_advertisers_active_idx
  ON ad_watch_advertisers (org_id, watch_group) WHERE active;

-- ---------------------------------------------------------------------------
-- B. ad_library_records — the append-only observation log (§6.7)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ad_library_records (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES orgs(id),

  platform           text NOT NULL
                       CHECK (platform IN ('meta','google','youtube','tiktok')),
  external_ad_id     text NOT NULL,
  -- The VENDOR's advertiser id, not a FK to ad_watch_advertisers. A pull can
  -- return an advertiser nobody has added to the watch-list yet, and that is
  -- precisely the new-entrant signal — a foreign key would reject the one row
  -- the signal is made of.
  advertiser_id      text NOT NULL,

  observed_on        date NOT NULL,
  first_seen_at      timestamptz,
  last_seen_at       timestamptz,

  body_text          text,
  headline           text,
  cta                text,
  destination_url    text,
  destination_domain text,
  media_kind         text CHECK (media_kind IS NULL OR media_kind IN ('image','video','carousel')),
  media_url          text,
  placements         jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- The vendor payload verbatim. Kept because a re-derivation of any signal
  -- against a shape we did not anticipate is a re-read of this column rather
  -- than a re-purchase of the data.
  raw                jsonb NOT NULL DEFAULT '{}'::jsonb,
  vendor             text NOT NULL,
  vendor_run_id      text,

  -- SHA-256 of normalised body + headline + media url. Denormalised onto the
  -- observation so the sequence questions above are answerable without a join.
  content_hash       text NOT NULL,

  created_at         timestamptz NOT NULL DEFAULT now(),

  -- THE IDEMPOTENCY KEY. Re-running a weekly pull duplicates nothing.
  UNIQUE (org_id, platform, external_ad_id, observed_on)
);

CREATE INDEX IF NOT EXISTS ad_library_records_hash_idx
  ON ad_library_records (org_id, content_hash, observed_on);
CREATE INDEX IF NOT EXISTS ad_library_records_advertiser_idx
  ON ad_library_records (org_id, advertiser_id, observed_on);

-- ---------------------------------------------------------------------------
-- C. ad_creatives_seen — the deduped creative (§6.7)
-- ---------------------------------------------------------------------------
--
-- This is the row Layer 2 classifies, and it exists so the same creative is
-- never sent to the model twice. ~31,000 monthly records collapse to roughly
-- 3,000 distinct creatives; this one index is about a 90% saving on the
-- classification bill.

CREATE TABLE IF NOT EXISTS ad_creatives_seen (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES orgs(id),
  content_hash       text NOT NULL,

  platform           text NOT NULL,
  advertiser_id      text NOT NULL,

  first_seen_at      timestamptz NOT NULL,
  last_seen_at       timestamptz NOT NULL,
  observation_count  integer NOT NULL DEFAULT 1,

  body_text          text,
  headline           text,
  cta                text,
  destination_url    text,
  destination_domain text,
  media_kind         text,
  media_url          text,
  -- The UNION of every placement this creative has ever been observed in, which
  -- is what the placement-spread signal counts.
  placements         jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- The set of platforms this exact creative has been seen on. Cross-platform
  -- echo reads this.
  platforms_seen     jsonb NOT NULL DEFAULT '[]'::jsonb,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, content_hash)
);

CREATE INDEX IF NOT EXISTS ad_creatives_seen_advertiser_idx
  ON ad_creatives_seen (org_id, advertiser_id);

-- ---------------------------------------------------------------------------
-- D. ad_creative_classification — one row per creative per taxonomy version (§7.6)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ad_creative_classification (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES orgs(id),
  content_hash     text NOT NULL,

  -- Re-classify ONLY on a bump. Without this column the only way to adopt a new
  -- taxonomy would be to delete history, and then last quarter's signals would
  -- silently re-label themselves.
  taxonomy_version integer NOT NULL,

  angle            text NOT NULL,
  ad_format        text NOT NULL,
  promise_shape    text NOT NULL,
  compliance_risk  text NOT NULL,
  funnel           text NOT NULL,

  -- The opening line of the ad, COPIED VERBATIM. A paraphrase is worthless to
  -- someone trying to learn what works, so nothing in the write path may
  -- rewrite it.
  hook_line        text,

  model            text,
  classified_at    timestamptz NOT NULL DEFAULT now(),
  input_tokens     integer,
  output_tokens    integer,
  -- Integer cents (CLAUDE.md §12). NULL means the cost is unknown, which is a
  -- different fact from zero and must survive as one.
  cost_cents       integer,

  -- The verdict from src/compliance/screen.mjs, run over the competitor's copy
  -- with exactly the rules FundHub applies to its own. One definition of a
  -- banned claim, not two.
  screen_state     text CHECK (screen_state IS NULL OR screen_state IN ('passed','blocked','needs_approval')),
  screen_reasons   jsonb NOT NULL DEFAULT '[]'::jsonb,

  created_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, content_hash, taxonomy_version)
);

CREATE INDEX IF NOT EXISTS ad_creative_classification_angle_idx
  ON ad_creative_classification (org_id, taxonomy_version, angle);

-- ---------------------------------------------------------------------------
-- E. ad_creative_signals — one row per creative per ISO week (§7.6)
-- ---------------------------------------------------------------------------
--
-- Recomputed weekly and KEPT FOREVER. History is what makes the death watch and
-- the trend arrows possible; a table that only holds this week can only ever
-- say what is running now, which is what every competing product already does.

CREATE TABLE IF NOT EXISTS ad_creative_signals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES orgs(id),
  content_hash          text NOT NULL,
  -- ISO week, e.g. '2026-W35'. Text rather than a date so a week is one value
  -- and cannot be compared as if it were a day.
  iso_week              text NOT NULL,

  -- The ten signals. EVERY ONE IS NULLABLE ON PURPOSE. NULL means "not known",
  -- which the Winner Score treats by renormalising the remaining weights. A
  -- zero here would mean "measured, and it is nothing" — a different fact, and
  -- defaulting one to the other is the exact error CLAUDE.md §12 names.
  ad_age_days           integer,
  variant_count         integer,
  relaunch_count        integer,
  creative_velocity     numeric(10,3),
  placement_spread      integer,
  landing_page_changed  boolean,
  -- Integer cents. NULL when no price could be extracted from the copy.
  offer_price_cents     bigint,
  offer_term            text,
  new_entrant           boolean,
  death_watch           boolean,
  cross_platform_echo   integer,
  -- TikTok publishes ordinal buckets and never a rate. Stored as the bucket it
  -- actually is; nothing may convert it into a number.
  tiktok_perf_bucket    text CHECK (tiktok_perf_bucket IS NULL OR tiktok_perf_bucket IN ('high','medium','low')),

  -- Phase 1 shows a RANK and a BAND, never a decimal, because a number with two
  -- decimal places implies a precision that does not exist until Layer 3 has
  -- real closes to fit against. The raw score is stored for the refit and is not
  -- projected to any partner-facing surface.
  winner_score          numeric(8,4),
  winner_score_rank     integer,
  winner_score_band     text CHECK (winner_score_band IS NULL OR winner_score_band IN ('hot','warm','cold')),
  weights_version       integer,

  computed_at           timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, content_hash, iso_week)
);

CREATE INDEX IF NOT EXISTS ad_creative_signals_week_idx
  ON ad_creative_signals (org_id, iso_week, winner_score_rank);

-- ---------------------------------------------------------------------------
-- F. Append-only guard on the observation log
-- ---------------------------------------------------------------------------
--
-- fundhub_no_delete() comes from 045_creative_factory.sql. Reused rather than
-- redefined so there is one message and one behaviour.

DROP TRIGGER IF EXISTS trg_ad_library_records_no_delete ON ad_library_records;
CREATE TRIGGER trg_ad_library_records_no_delete
  BEFORE DELETE ON ad_library_records
  FOR EACH ROW EXECUTE FUNCTION fundhub_no_delete();

-- ---------------------------------------------------------------------------
-- G. Row locks — declared, with keys attached
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ad_watch_advertisers', 'ad_library_records', 'ad_creatives_seen',
    'ad_creative_classification', 'ad_creative_signals'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

    -- READ: staff, or any caller inside a partner-scoped transaction. The board
    -- is shared reference data — see the header for why this is not
    -- fundhub_apply_partner_rls().
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_shared_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT
         USING (fundhub_is_staff() OR fundhub_current_partner() IS NOT NULL)',
      t || '_shared_read', t);

    -- WRITE: staff only. The ingest job and the classifier run as staff; a
    -- partner session cannot put a row into the competitor pile.
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_staff_write', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL
         USING (fundhub_is_staff()) WITH CHECK (fundhub_is_staff())',
      t || '_staff_write', t);
  END LOOP;
END $$;

DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    FOREACH t IN ARRAY ARRAY['ad_watch_advertisers', 'ad_creatives_seen'] LOOP
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

COMMENT ON TABLE ad_library_records IS
  'Append-only observation log of competitor ads bought from vendor APIs. One row per (platform, external_ad_id, observed_on). Never updated, never deleted — six of the ten derived signals are questions about the sequence. Contains NO spend column and must never gain one: nobody publishes commercial competitor spend, so any value there would be a guess printed on a paid screen.';

COMMENT ON TABLE ad_creative_signals IS
  'Ten derived signals plus the Winner Score, one row per creative per ISO week, kept forever. Every signal column is nullable on purpose: NULL means unknown and the score renormalises over the signals that exist. Never default a missing signal to 0.';

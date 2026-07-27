-- 022_marketing_warehouse.sql — Marketing Data Warehouse, Phase 1.
-- Source of truth: fundhub-docs /sources/marketing-data-warehouse.md.
--
-- WHY: we currently rent mailing lists at $0.10–$0.40/name. The same business
-- universe is published by the federal government for free under FOIA. This is
-- the warehouse those free records land in, so the list becomes an owned asset
-- instead of a recurring per-name rental.
--
-- Phase 1 loads three federal sources:
--   ppp      — PPP loan FOIA release (data.sba.gov)          ~8.5M records
--   sba_7a   — SBA 7(a) loan FOIA release (data.sba.gov)     ~1.6M records
--   sba_504  — SBA 504 loan FOIA release (data.sba.gov)      ~0.3M records
--   fmcsa    — FMCSA motor carrier census (FMCSA open data)  ~2.2M records
-- FMCSA is the only free federal file that carries PHONE + EMAIL, which is why
-- it is tagged as the highest-value source: it is the one that can turn a
-- mail-only record into a multi-channel one.
--
-- ── TWO NAMING NOTES, both deliberate ───────────────────────────────────────
--
-- 1. This lives in its own `marketing` SCHEMA, not in `public`.
--    001_init.sql already defines `public.businesses` — a CRM table with a
--    NOT NULL client_id, one row per business belonging to an existing client.
--    That is a different thing from a cold prospect universe of 12.6M records.
--    Rather than edit 001_init.sql (explicitly out of scope) or settle for a
--    prefixed name, the warehouse gets a namespace: `marketing.businesses` is
--    the master table the spec asks for, and there is no collision.
--
-- 2. Rule 7 still applies: org_id on every table. The white-label play means a
--    future org must be able to hold its own prospect universe.
--
-- Convention (001_init.sql): every table has org_id, created_at, updated_at,
-- with updated_at maintained by the shared public.set_updated_at() trigger.
--
-- DEPENDS ON: 001_init.sql (orgs, set_updated_at()).

CREATE SCHEMA IF NOT EXISTS marketing;

-- pg_trgm powers the fuzzy-dedup pass (finding near-miss names that exact key
-- matching leaves behind). It is a nice-to-have, not load-bearing: exact dedup
-- below uses plain btree. Managed Postgres providers vary on whether an
-- unprivileged role may CREATE EXTENSION, so this is best-effort and must not
-- abort the migration.
DO $$
BEGIN
  EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_trgm';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '022: pg_trgm unavailable (%). Exact dedup unaffected; the fuzzy-dedup index is skipped.', SQLERRM;
END $$;

-- ---------------------------------------------------------------------------
-- sources — the provenance registry. Provenance is the whole point of this
-- warehouse: every record must be able to answer "where did you come from, and
-- what did that source actually say about you". New sources (Phase 2: state
-- SoS registrations, USDOT inspections, IRS 990s) get a row here, not a schema
-- change.
-- ---------------------------------------------------------------------------
CREATE TABLE marketing.sources (
  key           text PRIMARY KEY,          -- 'ppp' | 'sba_7a' | 'sba_504' | 'fmcsa'
  name          text NOT NULL,
  authority     text NOT NULL,             -- publishing agency
  landing_url   text,                      -- where a human goes to verify
  has_contact   boolean NOT NULL DEFAULT false,  -- carries phone/email?
  est_records   bigint,                    -- expected full-scale row count
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO marketing.sources (key, name, authority, landing_url, has_contact, est_records) VALUES
  ('ppp',     'PPP Loan Data (FOIA)',        'U.S. Small Business Administration',
   'https://data.sba.gov/dataset/ppp-foia',        false, 8500000),
  ('sba_7a',  'SBA 7(a) Loan Data (FOIA)',   'U.S. Small Business Administration',
   'https://data.sba.gov/dataset/7-a-504-foia',    false, 1600000),
  ('sba_504', 'SBA 504 Loan Data (FOIA)',    'U.S. Small Business Administration',
   'https://data.sba.gov/dataset/7-a-504-foia',    false,  300000),
  ('fmcsa',   'FMCSA Motor Carrier Census',  'Federal Motor Carrier Safety Administration',
   'https://data.transportation.gov',               true, 2200000)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- businesses — the master record. One row per real-world business, no matter
-- how many federal sources mention it.
--
-- The identity of a row is (org_id, name_key, address_key): the CANONICALIZED
-- name and address produced by scripts/marketing/lib/normalize.mjs. That is
-- what makes "ABC LLC" and "A.B.C., L.L.C." at the same street address collapse
-- into one record instead of two rented names.
--
-- Display columns (name, address_line1, …) keep the source's original casing
-- and punctuation, because that is what goes on the mail piece. The _key
-- columns are machine-only.
-- ---------------------------------------------------------------------------
CREATE TABLE marketing.businesses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id),

  -- identity, as published (display form)
  name           text NOT NULL,
  dba_name       text,                     -- FMCSA carries a separate DBA

  -- identity, canonicalized (dedup form). NOT NULL so the unique index below
  -- actually constrains: in Postgres NULLs are distinct, so a nullable dedup
  -- key would silently let duplicates back in. Missing address => ''.
  name_key       text NOT NULL,
  address_key    text NOT NULL,

  -- address, as published (display form)
  address_line1  text,
  city           text,
  state          char(2),
  zip5           char(5),

  -- contact. FMCSA is the only Phase 1 source that supplies any of these.
  phone          text,                     -- 10-digit NANP, digits only
  phone_cell     text,
  email          text,                     -- lowercased

  -- firmographics
  naics          text,                     -- up to 6 digits, as published
  fleet_size     integer,                  -- FMCSA power units
  employees      integer,                  -- PPP JobsReported / SBA JobsSupported

  -- money. See the idempotency note below: this is the LARGEST single loan
  -- observed, never a running sum. Totals come from the view at the bottom.
  loan_amount    numeric(14,2),
  lender         text,                     -- most recently observed lender
  loan_status    text,

  -- provenance rollup. Denormalized from business_sources for fast filtering
  -- ("every record that has an FMCSA phone number"). Maintained by the upsert.
  source_tags    text[] NOT NULL DEFAULT '{}',

  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT businesses_source_tags_not_empty CHECK (cardinality(source_tags) > 0)
);

-- ── dedup indexes ───────────────────────────────────────────────────────────
-- The unique index IS the dedup mechanism: it is the ON CONFLICT target for
-- every ingester, which is what makes re-running an ingest update instead of
-- duplicate. Everything else here is for reading.
CREATE UNIQUE INDEX ux_mkt_businesses_dedup
  ON marketing.businesses (org_id, name_key, address_key);

-- Name-only blocking: find candidate matches for a business whose address is
-- missing or differs (suite vs no suite, PO box vs street).
CREATE INDEX ix_mkt_businesses_name_key
  ON marketing.businesses (org_id, name_key);

-- Address-only blocking: two names at one address (a rename, or parent/DBA).
CREATE INDEX ix_mkt_businesses_address_key
  ON marketing.businesses (org_id, address_key) WHERE address_key <> '';

-- Fuzzy dedup for the near-misses exact keys miss ("SMITH & SONS TRUCKING" vs
-- "SMITH AND SON TRUCKING"). Skipped if pg_trgm could not be installed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX ix_mkt_businesses_name_trgm
               ON marketing.businesses USING gin (name_key gin_trgm_ops)';
  END IF;
END $$;

-- ── targeting indexes (what a campaign actually selects on) ─────────────────
CREATE INDEX ix_mkt_businesses_source_tags
  ON marketing.businesses USING gin (source_tags);

CREATE INDEX ix_mkt_businesses_geo
  ON marketing.businesses (org_id, state, zip5);

CREATE INDEX ix_mkt_businesses_naics
  ON marketing.businesses (org_id, naics) WHERE naics IS NOT NULL;

-- The money shot: records we can actually phone or email. Small partial index
-- over a huge table — this is the FMCSA slice plus anything Phase 2 enriches.
CREATE INDEX ix_mkt_businesses_contactable
  ON marketing.businesses (org_id, state)
  WHERE phone IS NOT NULL OR email IS NOT NULL;

-- Mailable = has a usable address. Drives the direct-mail pull.
CREATE INDEX ix_mkt_businesses_mailable
  ON marketing.businesses (org_id, state)
  WHERE address_key <> '';

CREATE INDEX ix_mkt_businesses_loan_amount
  ON marketing.businesses (org_id, loan_amount DESC) WHERE loan_amount IS NOT NULL;

-- ---------------------------------------------------------------------------
-- business_sources — one row per (source, source record). This is the
-- provenance ledger and the reason the warehouse is auditable: a business
-- tagged 'ppp' can be traced to the exact LoanNumber, in the exact published
-- file, that put it there.
--
-- It is also the idempotency anchor. The natural key (org_id, source,
-- source_record_id) means re-ingesting the same federal file updates these
-- rows in place. Aggregates that CANNOT be computed idempotently by an upsert
-- — loan totals, loan counts — are derived from here rather than incremented
-- on the master row, so a re-run can never double-count.
-- ---------------------------------------------------------------------------
CREATE TABLE marketing.business_sources (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES orgs(id),
  business_id       uuid NOT NULL REFERENCES marketing.businesses(id) ON DELETE CASCADE,
  source            text NOT NULL REFERENCES marketing.sources(key),
  source_record_id  text NOT NULL,     -- PPP LoanNumber / SBA loan no. / FMCSA DOT_NUMBER
  source_file       text,              -- the published file this row came from
  source_row        bigint,            -- 1-based data row within that file

  -- the source-specific facts, kept per-source rather than flattened onto the
  -- master, so conflicting claims from two agencies stay distinguishable.
  loan_amount       numeric(14,2),
  lender            text,
  loan_status       text,
  naics             text,
  fleet_size        integer,
  approved_on       date,

  -- everything else the source said, verbatim-ish. Kept small on purpose; set
  -- MARKETING_KEEP_RAW=1 at ingest to store the full original row instead.
  attrs             jsonb NOT NULL DEFAULT '{}'::jsonb,

  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  ingested_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, source, source_record_id)
);

CREATE INDEX ix_mkt_bizsrc_business ON marketing.business_sources (business_id);
CREATE INDEX ix_mkt_bizsrc_source   ON marketing.business_sources (org_id, source);

-- ---------------------------------------------------------------------------
-- ingest_runs — operational log. At full scale a PPP load is a multi-hour job
-- over ~1.8GB of CSV; when it dies at 3am you need to know which file, which
-- row, and what the error was. Also the audit trail for "where did this list
-- come from" when a mailing gets challenged.
-- ---------------------------------------------------------------------------
CREATE TABLE marketing.ingest_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id),
  source         text NOT NULL REFERENCES marketing.sources(key),
  source_file    text,
  status         text NOT NULL DEFAULT 'running',  -- running | completed | failed
  rows_read      bigint NOT NULL DEFAULT 0,
  rows_skipped   bigint NOT NULL DEFAULT 0,        -- unusable (no name, etc.)
  rows_inserted  bigint NOT NULL DEFAULT 0,        -- new master records
  rows_updated   bigint NOT NULL DEFAULT 0,        -- merged into existing
  bytes_read     bigint NOT NULL DEFAULT 0,
  error          text,
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_mkt_runs_source ON marketing.ingest_runs (org_id, source, started_at DESC);

-- ---------------------------------------------------------------------------
-- Derived views. These exist because they are the aggregates an upsert cannot
-- compute idempotently — summing on ON CONFLICT would double on every re-run.
-- Computed from the provenance ledger, they are correct after any number of
-- re-ingests.
-- ---------------------------------------------------------------------------

-- Per-business loan totals across every loan source.
CREATE VIEW marketing.business_loan_totals AS
SELECT
  bs.org_id,
  bs.business_id,
  count(*) FILTER (WHERE bs.loan_amount IS NOT NULL)  AS loan_count,
  sum(bs.loan_amount)                                  AS loan_total,
  max(bs.loan_amount)                                  AS loan_max,
  max(bs.approved_on)                                  AS last_approved_on
FROM marketing.business_sources bs
WHERE bs.source <> 'fmcsa'
GROUP BY bs.org_id, bs.business_id;

-- The export/targeting surface. One row per business with the six columns the
-- CSV export ships, plus the coverage flags a campaign filters on.
CREATE VIEW marketing.mailable_businesses AS
SELECT
  b.id,
  b.org_id,
  b.name,
  b.dba_name,
  b.address_line1,
  b.city,
  b.state,
  b.zip5,
  b.phone,
  b.phone_cell,
  b.email,
  b.naics,
  b.fleet_size,
  b.loan_amount,
  t.loan_total,
  t.loan_count,
  b.source_tags,
  b.first_seen_at,
  (b.address_key <> '')                            AS has_address,
  (b.phone IS NOT NULL OR b.phone_cell IS NOT NULL) AS has_phone,
  (b.email IS NOT NULL)                             AS has_email,
  (cardinality(b.source_tags) > 1)                  AS multi_source
FROM marketing.businesses b
LEFT JOIN marketing.business_loan_totals t
  ON t.business_id = b.id AND t.org_id = b.org_id;

-- Coverage dashboard: how much of the universe each source actually gave us,
-- and — the number that justifies the whole project — how many records carry
-- contact info we would otherwise be renting.
CREATE VIEW marketing.source_coverage AS
SELECT
  s.key                                                          AS source,
  s.name,
  s.est_records                                                  AS projected_full_records,
  count(b.id)                                                    AS businesses,
  count(b.id) FILTER (WHERE b.address_key <> '')                 AS with_address,
  count(b.id) FILTER (WHERE b.phone IS NOT NULL)                 AS with_phone,
  count(b.id) FILTER (WHERE b.email IS NOT NULL)                 AS with_email,
  count(b.id) FILTER (WHERE cardinality(b.source_tags) > 1)      AS shared_with_other_sources
FROM marketing.sources s
LEFT JOIN marketing.businesses b ON b.source_tags @> ARRAY[s.key]
GROUP BY s.key, s.name, s.est_records;

-- ---------------------------------------------------------------------------
-- updated_at triggers (001_init.sql convention).
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sources','businesses','business_sources','ingest_runs']
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_mkt_%1$s_updated BEFORE UPDATE ON marketing.%1$I
         FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();', t);
  END LOOP;
END $$;

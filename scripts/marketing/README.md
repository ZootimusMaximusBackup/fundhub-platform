# Marketing Data Warehouse — Phase 1

Stop renting mailing lists at $0.10–$0.40 a name. The same business universe is
published by the federal government, for free, under FOIA. This pipeline pulls
it, canonicalizes it, dedupes it, and exports it.

Phase 1 loads three federal sources into `marketing.businesses`, source-tagging
every record so provenance is always answerable.

| Source | What it gives | Full-scale records | Contact info |
|---|---|---:|---|
| `ppp` | PPP loan FOIA release — name, address, loan amount, lender, NAICS | ~8,500,000 | — |
| `sba_7a` / `sba_504` | SBA 7(a) + 504 FOIA — name, address, amount, lender, status | ~1,900,000 | — |
| `fmcsa` | FMCSA motor carrier census — name, DBA, address, **phone, cell, email**, power units | ~2,200,000 | **yes** |

**FMCSA is the highest-value source and should be loaded first.** It is the only
free federal file carrying contact information. Every business it shares with
PPP or SBA gets upgraded from a mail-only record to a callable, emailable one —
that merge is the point of the whole warehouse.

---

## Quick start

```bash
# 1. schema
DATABASE_URL=postgres://… node db/migrate.mjs            # 001–005 (platform)
DATABASE_URL=postgres://… node scripts/marketing/migrate.mjs   # 022 (this)

# 2. a 10k-row sample of each source, straight off the wire
DATABASE_URL=postgres://… node scripts/marketing/ingest.mjs fmcsa --limit 10000
DATABASE_URL=postgres://… node scripts/marketing/ingest.mjs ppp   --limit 10000
DATABASE_URL=postgres://… node scripts/marketing/ingest.mjs sba   --limit 10000

# 3. export a campaign list
DATABASE_URL=postgres://… node scripts/marketing/export-csv.mjs \
  --source fmcsa --has-phone --min-fleet 5 --out carriers.csv
```

Re-running any ingest is always safe. See [Idempotency](#idempotency).

---

## Layout

```
db/migrations/022_marketing_warehouse.sql   schema: marketing.businesses + provenance + views
scripts/marketing/
  ingest.mjs          CLI — download, parse, normalize, upsert (one source per run)
  export-csv.mjs      CLI — filtered, streaming CSV export
  migrate.mjs         applies db/migrations/*.sql  (see "Two files I do not own")
  make-sample.mjs     generates synthetic 10k-row fixtures for testing
  lib/
    normalize.mjs     THE shared canonicalizer — name + address dedup keys
    csv.mjs           streaming RFC4180 reader/writer
    fetch.mjs         polite, resumable, rate-limited downloader
    warehouse.mjs     idempotent batched upsert
    sources.mjs       the three source definitions (URLs + field maps)
    *.test.mjs        unit tests;  *.pg.test.mjs needs a live DATABASE_URL
```

---

## Schema

`marketing` is its own Postgres schema. `public.businesses` already exists in
`001_init.sql` as a CRM table (one row per business belonging to an existing
client, `client_id NOT NULL`) — a different thing from a 12.6M-record cold
prospect universe. Namespacing avoids the collision without editing
`001_init.sql`.

- **`marketing.businesses`** — the master record. One row per real business.
  Identity is `(org_id, name_key, address_key)`, the canonicalized name and
  address. Carries `source_tags text[]`, `loan_amount`, `fleet_size`, `phone`,
  `email`, `naics`, `first_seen_at`, `org_id`.
- **`marketing.business_sources`** — one row per *(source, source record)*. The
  provenance ledger: a record tagged `ppp` can be traced to the exact
  `LoanNumber` in the exact published file. Also the idempotency anchor.
- **`marketing.sources`** — the source registry. Phase 2 sources are a row here,
  not a schema change.
- **`marketing.ingest_runs`** — operational log (rows read/skipped/inserted,
  bytes, errors). At full scale a load is a multi-hour job; when it dies you
  need to know where.
- **Views** — `business_loan_totals` (loan sums/counts),
  `mailable_businesses` (the export surface), `source_coverage` (how much each
  source actually contributed).

### Dedup indexes

`UNIQUE (org_id, name_key, address_key)` **is** the dedup mechanism — it is the
`ON CONFLICT` target every ingester writes through. Plus `name_key` and
`address_key` blocking indexes for one-sided matching, a `pg_trgm` GIN index for
fuzzy near-misses, and GIN on `source_tags`.

### The canonicalizer

`lib/normalize.mjs` is what makes `"ABC LLC"` and `"A.B.C., L.L.C."` the same
record. Names: fold diacritics, `&`→`AND`, drop periods/apostrophes without
leaving a gap (so `A.B.C.` → `ABC` and `L.L.C.` → the strippable token `LLC`),
strip legal suffixes repeatedly from the tail, drop a leading article. Addresses:
USPS Publication 28 suffixes, directionals, and all secondary-unit designators
folded to `STE` (so `#200`, `Suite 200` and `Unit 200` converge). The address key
uses **ZIP, not city**, because ZIP is a code and city is a spelling.

Junk is rejected rather than stored: `N/A`, `UNKNOWN`, `555` placeholder phones,
all-zero ZIPs. A row with no usable business name is skipped — a record you
cannot name is a record you cannot mail.

---

## Idempotency

> **Re-running an ingest updates, never duplicates.**

Enforced structurally, not by check-then-write:

1. Master rows upsert on `(org_id, name_key, address_key)`.
2. Provenance rows upsert on `(org_id, source, source_record_id)`.
3. Every merge expression is idempotent under repetition — `COALESCE`,
   `GREATEST`, `LEAST`, set-union. There is no `x = x + …` anywhere in
   `warehouse.mjs`, and a unit test enforces that structurally.
4. Aggregates that genuinely need summing (loan totals, loan counts) are
   **views over the provenance ledger**, so they cannot double-count no matter
   how many times a file is loaded.

`first_seen_at` only moves backwards; `last_seen_at` only forwards.

Verified: loading all three sample sources twice moved zero counts, zero sums and
zero timestamps. See [Verification](#verification).

---

## Running at full scale

**Do not stream 8.5M rows straight from the agency.** Download once, ingest
many times. A retried load then never re-pulls a gigabyte from a government
server.

### 1. Download

```bash
mkdir -p /data/marketing

# See what the agency currently publishes (SBA URLs are discovered from CKAN,
# so they self-correct across quarterly re-releases):
node scripts/marketing/ingest.mjs ppp --list
node scripts/marketing/ingest.mjs sba --list

# Then pull them. curl -C - resumes an interrupted transfer.
curl -C - --retry 5 --retry-delay 5 -o /data/marketing/ppp_1.csv '<url from --list>'
```

Approximate sizes (confirm against `--list`, which reports real byte counts):
PPP ~1.5–2 GB across ~12 CSVs; SBA 7(a)+504 ~250 MB; FMCSA census ~400–500 MB.
Budget ~3 GB of disk for the raw files.

### 2. Ingest, FMCSA first

```bash
export DATABASE_URL=postgres://…

# FMCSA first: it seeds the contact info that later sources merge onto.
node scripts/marketing/ingest.mjs fmcsa --file /data/marketing/fmcsa_census.csv

# then the loan sources
node scripts/marketing/ingest.mjs sba --file /data/marketing/foia_7a.csv
node scripts/marketing/ingest.mjs sba --file /data/marketing/foia_504.csv
for f in /data/marketing/ppp_*.csv; do
  node scripts/marketing/ingest.mjs ppp --file "$f"
done
```

Order only affects which display name wins; the final record set is the same
either way. Each file is safe to re-run after a failure — the overlap is free.

**Tuning.** `--batch` defaults to 2000 rows per transaction. Raise it to
5000–10000 against a local Postgres; lower it to ~1000 against a managed
database where per-round-trip latency dominates. Memory is flat regardless of
file size — everything streams.

**Expected wall time.** Measured here at **~6,000–9,000 rows/s** against a local
Postgres 16 (10,000 rows in 1.5–2.0s including process startup). At that rate
PPP is ~20–25 min, FMCSA ~5 min, SBA ~5 min. Against a *managed* Postgres,
per-batch network latency usually dominates — plan for 2–4× longer and raise
`--batch`.

**Expected results.** 12.6M source records in. Distinct businesses out will be
**fewer** — PPP alone contains multiple draws for the same borrower, and the
three sources overlap. A realistic estimate is 9–11M master rows, but that is a
projection, not a measurement; the real figure comes from
`marketing.source_coverage` after the first full run. Budget roughly 8–12 GB of
Postgres storage including indexes.

The number that matters: FMCSA should contribute on the order of **~2M records
carrying a phone number**. At the $0.10–$0.40/name being paid today, that is the
equivalent of $200k–$800k of rented data, replaced by a free federal file.

### 3. Scheduling

These are quarterly-ish publications, not live feeds. A monthly cron per source
is ample. Because ingests are idempotent, a re-run costs only the time to read
the file.

---

## Export

```bash
node scripts/marketing/export-csv.mjs [filters] --out list.csv
```

Default columns: `name, address_line1, city, state, zip5, phone, email,
source_tags, loan_amount`. Filters: `--source`, `--all-sources`, `--state`,
`--naics` (prefix), `--min-loan`, `--max-loan`, `--min-fleet`, `--has-phone`,
`--has-email`, `--multi-source`, `--limit`, `--columns`.

Mailable records only, unless `--no-address-filter`.

```bash
# callable trucking prospects with 5+ trucks
node scripts/marketing/export-csv.mjs --source fmcsa --has-phone --min-fleet 5 --naics 484,492

# the cross-source win: PPP borrowers we can now phone
node scripts/marketing/export-csv.mjs --all-sources ppp,fmcsa --has-phone
```

Streams with keyset pagination — exporting millions of rows uses flat memory.
Cell values beginning `=`, `+`, `-` or `@` are prefixed with `'` so a business
name cannot execute as a formula when the mail house opens the CSV in Excel.

---

## Politeness

These are public files served by agencies on modest infrastructure. `lib/fetch.mjs`
sends one request at a time with a configurable floor between them (`--rate`,
default 1000ms), identifies itself honestly in the `User-Agent`, backs off
exponentially with jitter, honours `Retry-After` on 429/503, resumes a dropped
transfer with a `Range` request instead of re-pulling from the start, and aborts
the connection the moment `--limit` is satisfied.

If a server ignores a `Range` resume, the download **fails loudly** rather than
replaying already-consumed bytes into the CSV parser and silently corrupting the
load.

---

## Testing

```bash
npm test                                        # platform suite — must stay green
node --test scripts/marketing/lib/*.test.mjs    # this workstream's suite

# include the real-Postgres integration test
DATABASE_URL=postgres://… node --test scripts/marketing/lib/*.test.mjs
```

`*.pg.test.mjs` self-skips without `DATABASE_URL`, matching the repo convention.

`make-sample.mjs` generates deterministic 10,000-row fixtures whose headers are
the real published schemas, with deliberate cross-source and in-file duplicates,
redacted names, missing addresses and placeholder phones.

> ⚠️ **Sample output is SYNTHETIC.** Generated from a seeded PRNG. Not federal
> records. Never mail, dial or email it. `samples/*.csv` is gitignored;
> regenerate with `node scripts/marketing/make-sample.mjs`.

---

## Verification

```sql
-- coverage per source, and how much each shares with the others
SELECT * FROM marketing.source_coverage;

-- the headline: how many records can we actually contact
SELECT count(*) FILTER (WHERE address_key <> '')  AS mailable,
       count(*) FILTER (WHERE phone IS NOT NULL)  AS callable,
       count(*) FILTER (WHERE email IS NOT NULL)  AS emailable,
       count(*) FILTER (WHERE cardinality(source_tags) > 1) AS multi_source
  FROM marketing.businesses;

-- provenance for any single record
SELECT source, source_record_id, source_file, loan_amount, lender
  FROM marketing.business_sources WHERE business_id = '…';

-- did anything fail
SELECT source, status, rows_read, rows_inserted, error, started_at
  FROM marketing.ingest_runs ORDER BY started_at DESC LIMIT 10;
```

To prove idempotency on your own data: snapshot `count(*)` and
`sum(loan_amount)`, re-run any ingest, compare. Both must be unchanged.

---

## ⚠️ Confirm before the first full-scale run

- **FMCSA download URL.** `lib/sources.mjs` carries a documented Socrata dataset
  default. It could not be verified from the build container (see below).
  Confirm it once against the landing page; if it has moved, set
  `MARKETING_FMCSA_URL` rather than editing the file. The SBA sources discover
  their URLs from CKAN at run time, so they self-correct.
- **Column headers.** Field maps are alias lists matched on an
  alphanumeric-only token, so cosmetic header drift is absorbed. A genuinely
  renamed column prints `⚠ columns not found in header: …` at the start of the
  run — **do not ignore that line**, it is how a load "succeeds" with every
  phone number empty. `lib/sources.test.mjs` pins the current headers.
- **Egress.** The federal hosts (`data.sba.gov`, `data.transportation.gov`,
  `ai.fmcsa.dot.gov`) are blocked by the build container's network policy, so
  no live download has been executed. The downloader is proven against a real
  HTTP server on loopback — gzip, retry, `Range` resume, early abort — and the
  full pipeline is proven end to end on real Postgres. The remote hostnames are
  the one unexercised link.

## Two files I do not own

This workstream owns `db/migrations/022_marketing_warehouse.sql` and
`scripts/marketing/`. Two one-line changes elsewhere would tidy things up:

1. **`db/migrate.mjs`** scans `const DIRS = ["schema", "seed"]`, so it never
   sees `db/migrations/`. `scripts/marketing/migrate.mjs` covers the gap and is
   deliberately interoperable — same `schema_migrations` table, same
   `dir/file` key format. Adding `"migrations"` to `DIRS` makes the platform
   runner pick 022 up; it will see the key already applied and skip it, and this
   runner can then be deleted.
2. **`package.json`** runs `node --test src/**/*.test.mjs`, which does not reach
   `scripts/`. Widening that glob (or adding
   `node --test scripts/marketing/lib/*.test.mjs`) puts this suite in the
   default gate. Until then, run it with the command above.

// Idempotent bulk writer for marketing.businesses + marketing.business_sources.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: re-running an ingest updates, never
// duplicates. A federal release gets re-published, a load dies at 60% and gets
// restarted, someone runs the cron twice — none of it may inflate the counts.
//
// Idempotency is achieved structurally, not by checking-then-writing:
//
//   1. Master rows key on (org_id, name_key, address_key) — the canonical
//      identity from normalize.mjs — and land via ON CONFLICT DO UPDATE.
//   2. Provenance rows key on (org_id, source, source_record_id), so the same
//      PPP LoanNumber can only ever occupy one row.
//   3. Every merge expression is IDEMPOTENT under repetition: COALESCE,
//      GREATEST, LEAST, and set-union. There is deliberately no `x = x + 1`
//      and no `x = x + EXCLUDED.x` anywhere in this file. Counts and totals
//      that genuinely need summing are VIEWS over the provenance ledger
//      (marketing.business_loan_totals), which cannot double-count no matter
//      how many times a file is loaded.
//
// Writes go out in batches via unnest(), which keeps the parameter count fixed
// at ~20 regardless of batch size — the difference between one round trip per
// 2,000 rows and 2,000 round trips.

import crypto from "node:crypto";

// Column order for the master upsert. The arrays passed to unnest() are built
// in exactly this order, so the two must never drift apart.
const MASTER_COLS = [
  "name", "dba_name", "name_key", "address_key",
  "address_line1", "city", "state", "zip5",
  "phone", "phone_cell", "email",
  "naics", "fleet_size", "employees",
  "loan_amount", "lender", "loan_status", "source_tags",
];

// How each text[] column is cast back to its real type on the way in.
const MASTER_SELECT = {
  name: "u.name",
  dba_name: "NULLIF(u.dba_name, '')",
  name_key: "u.name_key",
  address_key: "u.address_key",
  address_line1: "NULLIF(u.address_line1, '')",
  city: "NULLIF(u.city, '')",
  state: "NULLIF(u.state, '')::char(2)",
  zip5: "NULLIF(u.zip5, '')::char(5)",
  phone: "NULLIF(u.phone, '')",
  phone_cell: "NULLIF(u.phone_cell, '')",
  email: "NULLIF(u.email, '')",
  naics: "NULLIF(u.naics, '')",
  fleet_size: "NULLIF(u.fleet_size, '')::integer",
  employees: "NULLIF(u.employees, '')::integer",
  loan_amount: "NULLIF(u.loan_amount, '')::numeric(14,2)",
  lender: "NULLIF(u.lender, '')",
  loan_status: "NULLIF(u.loan_status, '')",
  source_tags: "string_to_array(u.source_tags, ',')",
};

// The merge policy, one line per column. Read this as "what happens when two
// federal sources disagree about the same business".
const MASTER_UPDATE = [
  // Identity/display: FIRST writer wins. Stable under re-ingest, and avoids a
  // later source rewriting a good display name with a worse one.
  "name          = COALESCE(b.name, EXCLUDED.name)",
  "address_line1 = COALESCE(b.address_line1, EXCLUDED.address_line1)",
  "city          = COALESCE(b.city, EXCLUDED.city)",
  "state         = COALESCE(b.state, EXCLUDED.state)",
  "zip5          = COALESCE(b.zip5, EXCLUDED.zip5)",

  // Enrichment: NEWEST non-null wins, so an FMCSA pass can layer phone/email
  // onto a record PPP created, and a later FMCSA refresh can correct a number
  // that changed. Re-applying the same value is a no-op, so still idempotent.
  "dba_name      = COALESCE(EXCLUDED.dba_name, b.dba_name)",
  "phone         = COALESCE(EXCLUDED.phone, b.phone)",
  "phone_cell    = COALESCE(EXCLUDED.phone_cell, b.phone_cell)",
  "email         = COALESCE(EXCLUDED.email, b.email)",
  "naics         = COALESCE(EXCLUDED.naics, b.naics)",
  "fleet_size    = COALESCE(EXCLUDED.fleet_size, b.fleet_size)",
  "employees     = COALESCE(EXCLUDED.employees, b.employees)",
  "lender        = COALESCE(EXCLUDED.lender, b.lender)",
  "loan_status   = COALESCE(EXCLUDED.loan_status, b.loan_status)",

  // Money: the LARGEST single loan ever observed, never a running sum — a sum
  // here would double on every re-ingest. Postgres GREATEST ignores NULLs.
  // Portfolio totals live in marketing.business_loan_totals.
  "loan_amount   = GREATEST(b.loan_amount, EXCLUDED.loan_amount)",

  // Provenance: set union. Idempotent by definition, and the reason a record
  // found in both PPP and FMCSA ends up tagged with both.
  "source_tags   = (SELECT array_agg(DISTINCT t ORDER BY t) " +
  "                   FROM unnest(b.source_tags || EXCLUDED.source_tags) AS t)",

  // Timestamps: first_seen_at only ever moves backwards, last_seen_at only
  // forwards. Both survive replay.
  "first_seen_at = LEAST(b.first_seen_at, EXCLUDED.first_seen_at)",
  "last_seen_at  = GREATEST(b.last_seen_at, EXCLUDED.last_seen_at)",
];

const SOURCE_COLS = [
  "business_id", "source", "source_record_id", "source_file", "source_row",
  "loan_amount", "lender", "loan_status", "naics", "fleet_size", "approved_on", "attrs",
];

const SOURCE_SELECT = {
  business_id: "u.business_id::uuid",
  source: "u.source",
  source_record_id: "u.source_record_id",
  source_file: "NULLIF(u.source_file, '')",
  source_row: "NULLIF(u.source_row, '')::bigint",
  loan_amount: "NULLIF(u.loan_amount, '')::numeric(14,2)",
  lender: "NULLIF(u.lender, '')",
  loan_status: "NULLIF(u.loan_status, '')",
  naics: "NULLIF(u.naics, '')",
  fleet_size: "NULLIF(u.fleet_size, '')::integer",
  approved_on: "NULLIF(u.approved_on, '')::date",
  attrs: "COALESCE(NULLIF(u.attrs, '')::jsonb, '{}'::jsonb)",
};

function buildMasterSql() {
  const selects = MASTER_COLS.map((c) => `${MASTER_SELECT[c]} AS ${c}`).join(",\n         ");
  const arrays = MASTER_COLS.map((_, i) => `$${i + 3}::text[]`).join(", ");
  return `
    INSERT INTO marketing.businesses AS b (
      org_id, ${MASTER_COLS.join(", ")}, first_seen_at, last_seen_at
    )
    SELECT $1::uuid,
         ${selects},
         $2::timestamptz, $2::timestamptz
      FROM unnest(${arrays}) AS u(${MASTER_COLS.join(", ")})
    ON CONFLICT (org_id, name_key, address_key) DO UPDATE SET
      ${MASTER_UPDATE.join(",\n      ")}
    RETURNING id, name_key, address_key, (xmax = 0) AS inserted`;
}

function buildSourceSql() {
  const selects = SOURCE_COLS.map((c) => `${SOURCE_SELECT[c]} AS ${c}`).join(",\n         ");
  const arrays = SOURCE_COLS.map((_, i) => `$${i + 3}::text[]`).join(", ");
  return `
    INSERT INTO marketing.business_sources AS s (
      org_id, ${SOURCE_COLS.join(", ")}, first_seen_at, ingested_at
    )
    SELECT $1::uuid,
         ${selects},
         $2::timestamptz, $2::timestamptz
      FROM unnest(${arrays}) AS u(${SOURCE_COLS.join(", ")})
    ON CONFLICT (org_id, source, source_record_id) DO UPDATE SET
      business_id = EXCLUDED.business_id,
      source_file = EXCLUDED.source_file,
      source_row  = EXCLUDED.source_row,
      loan_amount = EXCLUDED.loan_amount,
      lender      = EXCLUDED.lender,
      loan_status = EXCLUDED.loan_status,
      naics       = EXCLUDED.naics,
      fleet_size  = EXCLUDED.fleet_size,
      approved_on = EXCLUDED.approved_on,
      attrs       = EXCLUDED.attrs,
      ingested_at = EXCLUDED.ingested_at`;
      // first_seen_at is deliberately NOT updated: it records when this exact
      // source record first entered the warehouse.
}

const MASTER_SQL = buildMasterSql();
const SOURCE_SQL = buildSourceSql();

/** Resolve the org to load into. Rule 7: everything is scoped to an org. */
export async function resolveOrgId(db, slug = process.env.MARKETING_ORG_SLUG) {
  const sql = slug
    ? { text: `SELECT id FROM orgs WHERE slug = $1`, values: [slug] }
    : { text: `SELECT id FROM orgs WHERE is_default ORDER BY created_at LIMIT 1`, values: [] };
  const { rows } = await db.query(sql.text, sql.values);
  if (!rows.length) {
    throw new Error(slug ? `no org with slug '${slug}'` : "no default org — run db/migrate.mjs first");
  }
  return rows[0].id;
}

/**
 * Stable synthetic record id, for sources whose rows carry no natural key.
 *
 * Derived from the record's own content rather than its position in the file,
 * so re-ingesting a re-published file (same data, shuffled row order) still
 * lands on the same provenance row instead of creating a second one.
 */
export function syntheticRecordId(parts) {
  return crypto.createHash("sha1").update(parts.filter(Boolean).join(" ")).digest("hex").slice(0, 32);
}

const dedupKeyOf = (r) => `${r.nameKey} ${r.addressKey}`;

/**
 * Collapse duplicates WITHIN one batch.
 *
 * Required for correctness, not just speed: Postgres raises "ON CONFLICT DO
 * UPDATE cannot affect row a second time" if a single statement presents the
 * same conflict key twice, and federal files absolutely do contain the same
 * business twice (multiple PPP draws, a carrier re-filing its MCS-150).
 *
 * The merge mirrors MASTER_UPDATE exactly, so a pair of rows produces the same
 * result whether they arrive in one batch or two.
 */
export function mergeBatch(records) {
  const merged = new Map();

  for (const r of records) {
    const key = dedupKeyOf(r);
    const prior = merged.get(key);
    if (!prior) {
      merged.set(key, { ...r, sourceTags: new Set([r.source]) });
      continue;
    }
    prior.sourceTags.add(r.source);
    prior.name ??= r.name;
    prior.addressLine1 ??= r.addressLine1;
    prior.city ??= r.city;
    prior.state ??= r.state;
    prior.zip5 ??= r.zip5;
    // Newest non-null wins, matching the SQL merge policy.
    if (r.dbaName != null) prior.dbaName = r.dbaName;
    if (r.phone != null) prior.phone = r.phone;
    if (r.phoneCell != null) prior.phoneCell = r.phoneCell;
    if (r.email != null) prior.email = r.email;
    if (r.naics != null) prior.naics = r.naics;
    if (r.fleetSize != null) prior.fleetSize = r.fleetSize;
    if (r.employees != null) prior.employees = r.employees;
    if (r.lender != null) prior.lender = r.lender;
    if (r.loanStatus != null) prior.loanStatus = r.loanStatus;
    if (r.loanAmount != null) {
      prior.loanAmount = prior.loanAmount == null ? r.loanAmount : Math.max(prior.loanAmount, r.loanAmount);
    }
  }

  return [...merged.values()];
}

const str = (v) => (v === null || v === undefined ? null : String(v));

/**
 * Warehouse writer bound to one org and one ingest run.
 *
 * Each batch commits in its own transaction, so a load that dies at row 4.2M
 * keeps everything before it and can simply be re-run — the ON CONFLICT paths
 * make the overlap free.
 */
export class Warehouse {
  constructor(pool, { orgId, batchSize = 2000 } = {}) {
    this.pool = pool;
    this.orgId = orgId;
    this.batchSize = batchSize;
    this.runId = null;
    this.stats = { read: 0, skipped: 0, inserted: 0, updated: 0, bytes: 0 };
  }

  async startRun({ source, sourceFile }) {
    const { rows } = await this.pool.query(
      `INSERT INTO marketing.ingest_runs (org_id, source, source_file)
       VALUES ($1, $2, $3) RETURNING id`,
      [this.orgId, source, sourceFile ?? null]
    );
    this.runId = rows[0].id;
    return this.runId;
  }

  /**
   * Write one batch. `records` are normalize.mjs outputs decorated with
   * {source, sourceRecordId, sourceFile, sourceRow, attrs}.
   *
   * Returns {inserted, updated} for this batch.
   */
  async writeBatch(records) {
    if (!records.length) return { inserted: 0, updated: 0 };

    const merged = mergeBatch(records);
    const client = await this.pool.connect();
    const now = new Date().toISOString();

    try {
      await client.query("BEGIN");

      // ── master rows ──────────────────────────────────────────────────────
      const cols = Object.fromEntries(MASTER_COLS.map((c) => [c, []]));
      for (const r of merged) {
        cols.name.push(r.name ?? r.nameKey);
        cols.dba_name.push(str(r.dbaName));
        cols.name_key.push(r.nameKey);
        cols.address_key.push(r.addressKey);
        cols.address_line1.push(str(r.addressLine1));
        cols.city.push(str(r.city));
        cols.state.push(str(r.state));
        cols.zip5.push(str(r.zip5));
        cols.phone.push(str(r.phone));
        cols.phone_cell.push(str(r.phoneCell));
        cols.email.push(str(r.email));
        cols.naics.push(str(r.naics));
        cols.fleet_size.push(str(r.fleetSize));
        cols.employees.push(str(r.employees));
        cols.loan_amount.push(str(r.loanAmount));
        cols.lender.push(str(r.lender));
        cols.loan_status.push(str(r.loanStatus));
        cols.source_tags.push([...r.sourceTags].sort().join(","));
      }

      const res = await client.query(MASTER_SQL, [
        this.orgId, now, ...MASTER_COLS.map((c) => cols[c]),
      ]);

      let inserted = 0;
      const idByKey = new Map();
      for (const row of res.rows) {
        idByKey.set(`${row.name_key} ${row.address_key}`, row.id);
        if (row.inserted) inserted += 1;
      }
      const updated = res.rows.length - inserted;

      // ── provenance rows ──────────────────────────────────────────────────
      // Deduped on the natural key so one statement never presents the same
      // (source, source_record_id) twice; last occurrence wins, matching the
      // DO UPDATE branch.
      const provenance = new Map();
      for (const r of records) {
        const businessId = idByKey.get(dedupKeyOf(r));
        if (!businessId) continue;   // merged away; cannot happen, but never write a dangling FK
        provenance.set(`${r.source} ${r.sourceRecordId}`, { r, businessId });
      }

      if (provenance.size) {
        const scols = Object.fromEntries(SOURCE_COLS.map((c) => [c, []]));
        for (const { r, businessId } of provenance.values()) {
          scols.business_id.push(businessId);
          scols.source.push(r.source);
          scols.source_record_id.push(r.sourceRecordId);
          scols.source_file.push(str(r.sourceFile));
          scols.source_row.push(str(r.sourceRow));
          scols.loan_amount.push(str(r.loanAmount));
          scols.lender.push(str(r.lender));
          scols.loan_status.push(str(r.loanStatus));
          scols.naics.push(str(r.naics));
          scols.fleet_size.push(str(r.fleetSize));
          scols.approved_on.push(str(r.approvedOn));
          scols.attrs.push(r.attrs ? JSON.stringify(r.attrs) : null);
        }
        await client.query(SOURCE_SQL, [
          this.orgId, now, ...SOURCE_COLS.map((c) => scols[c]),
        ]);
      }

      await client.query("COMMIT");
      this.stats.inserted += inserted;
      this.stats.updated += updated;
      return { inserted, updated };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async heartbeat() {
    if (!this.runId) return;
    await this.pool.query(
      `UPDATE marketing.ingest_runs
          SET rows_read = $2, rows_skipped = $3, rows_inserted = $4, rows_updated = $5, bytes_read = $6
        WHERE id = $1`,
      [this.runId, this.stats.read, this.stats.skipped, this.stats.inserted, this.stats.updated, this.stats.bytes]
    );
  }

  async finishRun({ status = "completed", error = null } = {}) {
    if (!this.runId) return;
    await this.pool.query(
      `UPDATE marketing.ingest_runs
          SET status = $2, error = $3, finished_at = now(),
              rows_read = $4, rows_skipped = $5, rows_inserted = $6, rows_updated = $7, bytes_read = $8
        WHERE id = $1`,
      [this.runId, status, error, this.stats.read, this.stats.skipped,
       this.stats.inserted, this.stats.updated, this.stats.bytes]
    );
  }
}

export const __sql = { MASTER_SQL, SOURCE_SQL, MASTER_COLS, SOURCE_COLS };

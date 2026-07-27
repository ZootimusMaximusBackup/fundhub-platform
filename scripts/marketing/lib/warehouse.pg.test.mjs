// Real-Postgres integration test for the marketing warehouse.
// SKIPS unless DATABASE_URL is set (so `npm test` stays green without a DB).
//
// Run live:
//   DATABASE_URL=postgres://… node db/migrate.mjs
//   DATABASE_URL=postgres://… node scripts/marketing/migrate.mjs
//   DATABASE_URL=postgres://… node --test scripts/marketing/lib/*.test.mjs
//
// Proves at the SQL level the two properties the whole warehouse rests on:
//   • DEDUP — three federal sources spelling one business three ways produce
//     exactly one master row carrying all three source tags.
//   • IDEMPOTENCY — writing the same batch again changes no count, no sum and
//     no first_seen_at. This is the "re-running an ingest updates, never
//     duplicates" rule, verified rather than asserted.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { pool, close } from "../../../src/db.mjs";
import { Warehouse, resolveOrgId } from "./warehouse.mjs";
import { normalizeBusiness } from "./normalize.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const MARK = "ZZPGTEST";           // name prefix so cleanup is surgical

let db, orgId, wh;

const record = (input, source, sourceRecordId) => ({
  ...normalizeBusiness(input),
  source,
  sourceRecordId,
  sourceFile: "pg-test.csv",
  sourceRow: 1,
  attrs: { test: "1" },
});

async function wipe() {
  await db.query(
    `DELETE FROM marketing.business_sources
      WHERE business_id IN (SELECT id FROM marketing.businesses WHERE name_key LIKE $1)`,
    [`${MARK}%`]
  );
  await db.query(`DELETE FROM marketing.businesses WHERE name_key LIKE $1`, [`${MARK}%`]);
  await db.query(`DELETE FROM marketing.ingest_runs WHERE source_file = 'pg-test.csv'`);
}

before(async () => {
  if (!HAS_DB) return;
  db = pool();
  orgId = await resolveOrgId(db);
  wh = new Warehouse(db, { orgId, batchSize: 100 });
  await wipe();
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

// The same real-world business, as each federal source spells it.
const PPP_ROW = {
  name: `${MARK} Rivera Hauling LLC`,
  street: "1420 N. Industrial Blvd. Ste 4", city: "Laredo", state: "TX", zip: "78045",
  loanAmount: "150000", naics: "484121", lender: "Cross River Bank",
  loanStatus: "Paid in Full", approvedOn: "5/7/2021", employees: "12",
};
const SBA_ROW = {
  name: `${MARK} RIVERA HAULING, L.L.C.`,
  street: "1420 North Industrial Boulevard, Suite 4", city: "LAREDO", state: "Texas", zip: "78045-1234",
  loanAmount: "400000", lender: "Zions Bank", approvedOn: "3/1/2023",
};
const FMCSA_ROW = {
  // Article FIRST — only a LEADING article is dropped, so that "Bank of The
  // West" keeps its "The". The test marker has to sit after it.
  name: `The ${MARK} Rivera Hauling Company`,
  street: "1420 North Industrial Blvd #4", city: "Laredo", state: "TX", zip: "78045",
  phone: "(956) 723-0100", phoneCell: "956-723-0199", email: "DISPATCH@Rivera.example",
  fleetSize: "27",
};

test("three sources, three spellings, one business", { skip: !HAS_DB }, async () => {
  await wh.writeBatch([
    record(PPP_ROW, "ppp", "ppp-1"),
    record(SBA_ROW, "sba_7a", "sba-1"),
    record(FMCSA_ROW, "fmcsa", "fmcsa-1"),
  ]);

  const { rows } = await db.query(
    `SELECT * FROM marketing.businesses WHERE name_key LIKE $1`, [`${MARK}%`]
  );
  assert.equal(rows.length, 1, "expected the three spellings to collapse into one record");

  const b = rows[0];
  assert.deepEqual([...b.source_tags].sort(), ["fmcsa", "ppp", "sba_7a"]);
  // Contact info arrived from FMCSA and landed on the shared record.
  assert.equal(b.phone, "9567230100");
  assert.equal(b.phone_cell, "9567230199");
  assert.equal(b.email, "dispatch@rivera.example");
  assert.equal(b.fleet_size, 27);
  // Loan facts came from PPP/SBA; loan_amount is the MAX single loan.
  assert.equal(Number(b.loan_amount), 400000);
  assert.equal(b.naics, "484121");
  // Display name is the first source's spelling, not a canonical key.
  assert.equal(b.name, PPP_ROW.name);

  const prov = await db.query(
    `SELECT source, source_record_id FROM marketing.business_sources
      WHERE business_id = $1 ORDER BY source`, [b.id]
  );
  assert.equal(prov.rows.length, 3, "every source keeps its own provenance row");
});

test("loan totals come from provenance, and count only loan sources", { skip: !HAS_DB }, async () => {
  const { rows } = await db.query(
    `SELECT t.* FROM marketing.business_loan_totals t
       JOIN marketing.businesses b ON b.id = t.business_id
      WHERE b.name_key LIKE $1`, [`${MARK}%`]
  );
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].loan_total), 550000, "150k PPP + 400k SBA");
  assert.equal(Number(rows[0].loan_count), 2, "FMCSA is not a loan");
  assert.equal(Number(rows[0].loan_max), 400000);
});

test("re-writing the same batch changes nothing", { skip: !HAS_DB }, async () => {
  const snapshot = async () => {
    const b = await db.query(
      `SELECT count(*)::int AS n, sum(loan_amount) AS loans, min(first_seen_at) AS seen
         FROM marketing.businesses WHERE name_key LIKE $1`, [`${MARK}%`]
    );
    const s = await db.query(
      `SELECT count(*)::int AS n FROM marketing.business_sources
        WHERE business_id IN (SELECT id FROM marketing.businesses WHERE name_key LIKE $1)`,
      [`${MARK}%`]
    );
    const t = await db.query(
      `SELECT sum(t.loan_total) AS total FROM marketing.business_loan_totals t
         JOIN marketing.businesses b ON b.id = t.business_id WHERE b.name_key LIKE $1`,
      [`${MARK}%`]
    );
    return {
      businesses: b.rows[0].n, loans: String(b.rows[0].loans),
      firstSeen: b.rows[0].seen.toISOString(),
      provenance: s.rows[0].n, loanTotal: String(t.rows[0].total),
    };
  };

  const before = await snapshot();

  // Same three records, twice more.
  for (let i = 0; i < 2; i++) {
    await wh.writeBatch([
      record(PPP_ROW, "ppp", "ppp-1"),
      record(SBA_ROW, "sba_7a", "sba-1"),
      record(FMCSA_ROW, "fmcsa", "fmcsa-1"),
    ]);
  }

  assert.deepEqual(await snapshot(), before, "a re-ingest must not move a single number");
});

test("a batch containing the same identity twice does not error", { skip: !HAS_DB }, async () => {
  // Postgres raises "cannot affect row a second time" if one statement
  // presents a conflict key twice — real files DO contain repeat rows
  // (multiple PPP draws), so mergeBatch has to collapse them first.
  const before = await db.query(
    `SELECT count(*)::int AS n FROM marketing.businesses WHERE name_key LIKE $1`, [`${MARK}%`]
  );
  await wh.writeBatch([
    record({ ...PPP_ROW, loanAmount: "10000" }, "ppp", "ppp-draw-1"),
    record({ ...PPP_ROW, loanAmount: "20000" }, "ppp", "ppp-draw-2"),
    record({ ...PPP_ROW, loanAmount: "30000" }, "ppp", "ppp-draw-3"),
  ]);
  const after = await db.query(
    `SELECT count(*)::int AS n FROM marketing.businesses WHERE name_key LIKE $1`, [`${MARK}%`]
  );
  assert.equal(after.rows[0].n, before.rows[0].n, "repeat draws must not create new businesses");

  const prov = await db.query(
    `SELECT count(*)::int AS n FROM marketing.business_sources
      WHERE business_id IN (SELECT id FROM marketing.businesses WHERE name_key LIKE $1)`,
    [`${MARK}%`]
  );
  assert.equal(prov.rows[0].n, 6, "each draw keeps its own provenance row");
});

test("the dedup index physically prevents a duplicate", { skip: !HAS_DB }, async () => {
  const { rows } = await db.query(
    `SELECT name_key, address_key FROM marketing.businesses WHERE name_key LIKE $1 LIMIT 1`,
    [`${MARK}%`]
  );
  await assert.rejects(
    () => db.query(
      `INSERT INTO marketing.businesses (org_id, name, name_key, address_key, source_tags)
       VALUES ($1, 'dupe', $2, $3, ARRAY['ppp'])`,
      [orgId, rows[0].name_key, rows[0].address_key]
    ),
    /duplicate key value|ux_mkt_businesses_dedup/,
    "the unique index is the dedup guarantee — it must reject this"
  );
});

test("source_tags cannot be empty — an untagged record is unprovenanced", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => db.query(
      `INSERT INTO marketing.businesses (org_id, name, name_key, address_key, source_tags)
       VALUES ($1, 'untagged', $2, '', ARRAY[]::text[])`,
      [orgId, `${MARK}UNTAGGED`]
    ),
    /businesses_source_tags_not_empty|violates check constraint/
  );
});

test("ingest runs are logged with their outcome", { skip: !HAS_DB }, async () => {
  const w = new Warehouse(db, { orgId });
  await w.startRun({ source: "ppp", sourceFile: "pg-test.csv" });
  w.stats.read = 5;
  await w.finishRun({ status: "completed" });

  const { rows } = await db.query(
    `SELECT status, rows_read FROM marketing.ingest_runs WHERE id = $1`, [w.runId]
  );
  assert.equal(rows[0].status, "completed");
  assert.equal(Number(rows[0].rows_read), 5);
});

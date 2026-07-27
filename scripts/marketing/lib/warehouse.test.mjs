// In-batch merge semantics. Pure functions — no database needed.
//
// mergeBatch() must produce the same answer the SQL ON CONFLICT path produces,
// because whether two rows land in one batch or two is an accident of batch
// size, and the warehouse must not care.

import { test } from "node:test";
import assert from "node:assert";
import { mergeBatch, syntheticRecordId, __sql } from "./warehouse.mjs";

const rec = (over = {}) => ({
  name: "Acme Trucking LLC",
  nameKey: "ACME TRUCKING",
  addressKey: "1 MAIN ST|89502",
  dbaName: null, addressLine1: "1 Main St", city: "Reno", state: "NV", zip5: "89502",
  phone: null, phoneCell: null, email: null, naics: null,
  fleetSize: null, employees: null, loanAmount: null, lender: null, loanStatus: null,
  approvedOn: null, source: "ppp", sourceRecordId: "1", attrs: {},
  ...over,
});

test("mergeBatch: same identity collapses to one row", () => {
  const out = mergeBatch([rec({ sourceRecordId: "1" }), rec({ sourceRecordId: "2" })]);
  assert.equal(out.length, 1);
});

test("mergeBatch: different identities stay separate", () => {
  const out = mergeBatch([rec(), rec({ nameKey: "OTHER" }), rec({ addressKey: "2 MAIN ST|89502" })]);
  assert.equal(out.length, 3);
});

test("mergeBatch: source tags union across sources", () => {
  const out = mergeBatch([
    rec({ source: "ppp" }),
    rec({ source: "fmcsa", sourceRecordId: "x" }),
    rec({ source: "sba_7a", sourceRecordId: "y" }),
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual([...out[0].sourceTags].sort(), ["fmcsa", "ppp", "sba_7a"]);
});

test("mergeBatch: contact info from one source lands on a record from another", () => {
  // The core value proposition: PPP gives the business, FMCSA gives the phone.
  const out = mergeBatch([
    rec({ source: "ppp", loanAmount: 150000 }),
    rec({ source: "fmcsa", sourceRecordId: "d", phone: "7754770100", email: "a@b.example", fleetSize: 12 }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].phone, "7754770100");
  assert.equal(out[0].email, "a@b.example");
  assert.equal(out[0].fleetSize, 12);
  assert.equal(out[0].loanAmount, 150000);
});

test("mergeBatch: loan amount takes the MAX, never a sum", () => {
  // A sum would double on every re-ingest. Totals come from the SQL view.
  const out = mergeBatch([
    rec({ loanAmount: 100000, sourceRecordId: "1" }),
    rec({ loanAmount: 250000, sourceRecordId: "2" }),
    rec({ loanAmount: 50000, sourceRecordId: "3" }),
  ]);
  assert.equal(out[0].loanAmount, 250000);
});

test("mergeBatch: is idempotent — merging a batch twice changes nothing", () => {
  const batch = [
    rec({ source: "ppp", loanAmount: 100000 }),
    rec({ source: "fmcsa", sourceRecordId: "d", phone: "7754770100" }),
  ];
  const once = mergeBatch(batch);
  const twice = mergeBatch([...batch, ...batch]);

  assert.equal(once.length, twice.length);
  assert.equal(once[0].loanAmount, twice[0].loanAmount);
  assert.equal(once[0].phone, twice[0].phone);
  assert.deepEqual([...once[0].sourceTags].sort(), [...twice[0].sourceTags].sort());
});

test("mergeBatch: first non-null display fields win, later nulls never erase", () => {
  const out = mergeBatch([
    rec({ name: "Acme Trucking LLC", city: "Reno" }),
    rec({ name: "ACME TRUCKING, L.L.C.", city: null, sourceRecordId: "2" }),
  ]);
  assert.equal(out[0].name, "Acme Trucking LLC");
  assert.equal(out[0].city, "Reno");
});

test("mergeBatch: a later non-null enrichment value overwrites an earlier one", () => {
  const out = mergeBatch([
    rec({ source: "fmcsa", phone: "7754770100" }),
    rec({ source: "fmcsa", phone: "7754779999", sourceRecordId: "2" }),
  ]);
  assert.equal(out[0].phone, "7754779999", "newest non-null wins, matching the SQL policy");
});

test("the generated SQL contains no accumulating expression", () => {
  // A structural guard on the idempotency rule: any `col = col + …` in the
  // upsert would double the value on re-ingest.
  for (const sql of [__sql.MASTER_SQL, __sql.SOURCE_SQL]) {
    assert.equal(/\b(\w+)\s*=\s*(b|s)\.\1\s*\+/.test(sql), false, "found an accumulating assignment");
    assert.equal(/\bsum\s*\(/i.test(sql), false, "found a sum() in an upsert");
  }
  assert.match(__sql.MASTER_SQL, /ON CONFLICT \(org_id, name_key, address_key\) DO UPDATE/);
  assert.match(__sql.SOURCE_SQL, /ON CONFLICT \(org_id, source, source_record_id\) DO UPDATE/);
});

test("master upsert column list and its cast list stay in step", () => {
  // The unnest() parameter order is positional; a drift here silently shifts
  // every column by one.
  assert.equal(__sql.MASTER_COLS.length, 18);
  const arrays = __sql.MASTER_SQL.match(/\$\d+::text\[\]/g) || [];
  assert.equal(arrays.length, __sql.MASTER_COLS.length);
  const sourceArrays = __sql.SOURCE_SQL.match(/\$\d+::text\[\]/g) || [];
  assert.equal(sourceArrays.length, __sql.SOURCE_COLS.length);
});

test("syntheticRecordId: stable, short, hex", () => {
  const id = syntheticRecordId(["Acme LLC", "1 Main St", "89502"]);
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.equal(id, syntheticRecordId(["Acme LLC", "1 Main St", "89502"]));
});

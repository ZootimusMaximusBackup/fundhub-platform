// Does the recurring-bills read have an index it can actually use?
//
// *** WHAT THIS FILE IS ANSWERING. ***
//
// listRecurringBills() (src/banking/store.mjs) filters on `org_id` on EVERY
// call — the other three filters are optional and default to null — and then
// sorts by `typical_amount_cents, merchant_key` and takes a LIMIT.
//
// 086 shipped four indexes on `recurring_bills` and not one of them leads with
// `org_id`:
//
//   uq_recurring_bills_account_merchant_cadence (bank_account_id, merchant_key, cadence)
//   idx_recurring_bills_client                  (client_id, typical_amount_cents) partial
//   idx_recurring_bills_due_confident           (bank_account_id, next_expected_on) partial
//
// So the one predicate that is always there has nothing to stand on: Postgres
// reads the whole table, filters it, sorts what survives in memory, and only
// then applies the LIMIT. The page size added for M21 bounds what is SENT; it
// does not bound what is READ. One row per account × merchant × cadence across
// every client is 36,000 rows for 3,000 clients at 12 bills each, every one of
// them read and sorted inside a 10-second function budget, to return 500.
//
// THIS IS A TEST ABOUT THE MIGRATION TEXT, NOT ABOUT A LIVE DATABASE. It reads
// db/**/*.sql and answers "is the index declared, and does it match the read?"
// It deliberately does not claim what a planner will choose — that needs real
// Postgres and real statistics. What it CAN pin, and what was missing, is that
// the index exists at all and that its columns line up with the query in
// store.mjs, so the two cannot drift apart in silence.

import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB = path.join(HERE, "..", "..", "db");
const STORE = path.join(HERE, "store.mjs");

/** Every CREATE INDEX on recurring_bills, from every .sql file db/migrate.mjs applies. */
function recurringBillIndexes() {
  const found = [];
  const re =
    /CREATE\s+(UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\s+(?:public\.)?recurring_bills\s*\(([^)]*)\)([^;]*);/gi;

  for (const d of ["schema", "migrations", "seed"]) {
    const dir = path.join(DB, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
      const sql = fs.readFileSync(path.join(dir, f), "utf8");
      // Comment lines would otherwise match the regex; this table's migrations
      // quote their own DDL in prose.
      const code = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
      for (const m of code.matchAll(re)) {
        found.push({
          file: `${d}/${f}`,
          name: m[2],
          unique: Boolean(m[1]),
          columns: m[3].split(",").map((c) => c.trim().split(/\s+/)[0]),
          partial: /\bWHERE\b/i.test(m[4] ?? "")
        });
      }
    }
  }
  return found;
}

/** The ORDER BY of listRecurringBills(), read out of the source it will ship with. */
function readOrderBy() {
  const src = fs.readFileSync(STORE, "utf8");
  const fn = src.slice(src.indexOf("export async function listRecurringBills("));
  const m = /ORDER BY ([^\n]+)\n/.exec(fn);
  assert.ok(m, "listRecurringBills no longer has an ORDER BY — this test is out of date");
  return m[1].split(",").map((c) => c.trim().split(/\s+/)[0]);
}

test("the recurring-bills read has an index that leads with the column it always filters on",
  () => {
    const indexes = recurringBillIndexes();
    assert.ok(indexes.length > 0, "no CREATE INDEX on recurring_bills was found at all");

    // Unconditional: the read runs with all three optional filters null, so an
    // index with a WHERE clause on client_id or confidence cannot serve it.
    const leading = indexes.filter((i) => i.columns[0] === "org_id" && !i.partial);

    assert.ok(
      leading.length > 0,
      "*** every listRecurringBills() call filters on org_id and no index leads with it, " +
      "so the database reads the whole table and sorts it in memory. Indexes present: " +
      indexes.map((i) => `${i.name}(${i.columns.join(", ")})${i.partial ? " partial" : ""}`)
        .join("; ") + " ***"
    );
  });

test("that index carries the sort, so a bounded read does not sort the whole table", () => {
  const order = readOrderBy();
  const leading = recurringBillIndexes().filter((i) => i.columns[0] === "org_id" && !i.partial);

  const covering = leading.filter((i) =>
    order.every((col, n) => i.columns[n + 1] === col));

  assert.ok(
    covering.length > 0,
    `*** the read orders by ${order.join(", ")} and takes a LIMIT. No org_id index continues ` +
    `into those columns, so the LIMIT bounds what is SENT and not what is READ — the sort ` +
    `still has to see every row of the org. org_id indexes present: ` +
    leading.map((i) => `${i.name}(${i.columns.join(", ")})`).join("; ") + " ***"
  );
});

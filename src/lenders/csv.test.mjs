import test from "node:test";
import assert from "node:assert/strict";
import { parseLenderCsv, serializeLenderCsv } from "./csv.mjs";

test("parseLenderCsv requires name and lender_table", () => {
  const empty = parseLenderCsv("foo,bar\n1,2\n");
  assert.ok(empty.errors.some((e) => /name/i.test(e)));
});

test("parseLenderCsv accepts Airtable table names and round-trips", () => {
  const csv = [
    "lender_table,name,bureaus_pulled,priority_tier,active,product_name",
    "OnlineBizCC,Example Bank,EX/EQ,1,true,Biz Card"
  ].join("\n");
  const { rows, errors } = parseLenderCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Example Bank");
  assert.equal(rows[0].lender_table, "OnlineBizCC");
  assert.equal(rows[0].priority_tier, 1);
  assert.equal(rows[0].active, true);
  assert.equal(rows[0].product_name, "Biz Card");
  assert.ok(!errors.some((e) => /skipped/i.test(e)));

  const out = serializeLenderCsv(rows);
  assert.match(out, /OnlineBizCC/);
  assert.match(out, /Example Bank/);
  assert.match(out, /product_name/);
});

test("parseLenderCsv skips invented invalid lender_table", () => {
  const csv = "lender_table,name\nNotATable,X\n";
  const { rows, errors } = parseLenderCsv(csv);
  assert.equal(rows.length, 0);
  assert.ok(errors.some((e) => /invalid lender_table/i.test(e)));
});

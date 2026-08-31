/* The Decline Autopsy boundary — the tests that decide whether this offer can
 * ship at all.
 *
 * The people described in a broker's upload never agreed to give FundHub
 * anything. So the product is built so FundHub CANNOT learn who they are, even
 * if the broker is careless — and "cannot" has to be a test, not a paragraph in
 * the terms.
 *
 * Pure unit tests: no database, no storage, no clock.
 */
import { test, describe } from "node:test";
import assert from "node:assert";

import {
  monthOnly,
  normalizeAutopsyRow,
  normalizeBureaus,
  parseAutopsyCsv,
  parseAutopsyRows
} from "./parse.mjs";
import { MAX_ROWS, isRefusedHeader, scanCellForPii, ficoMidpoint } from "./fields.mjs";
import { splitCsvLine } from "../lenders/csv.mjs";

const HEADER = "row_label,fico_band,state,business_age_months,highest_revolving_limit_usd,revolving_opened_month";
const goodCsv = (body) => `${HEADER}\n${body}`;

describe("identity never crosses the boundary", () => {
  test("*** A SOCIAL SECURITY NUMBER REFUSES THE WHOLE UPLOAD ***", () => {
    const out = parseAutopsyCsv(goodCsv("123-45-6789,680-719,TX,30,9000,2019-01"));
    assert.equal(out.ok, false, "an SSN was accepted");
    assert.equal(out.error, "personal_details_found");
    assert.match(out.message, /Social Security number/);
    assert.match(out.message, /only need the numbers/);
  });

  test("*** AN E-MAIL ADDRESS REFUSES THE WHOLE UPLOAD ***", () => {
    const out = parseAutopsyCsv(goodCsv("jones@example.com,600-639,FL,12,6000,2018-03"));
    assert.equal(out.ok, false, "an e-mail was accepted");
    assert.equal(out.error, "personal_details_found");
    assert.match(out.message, /e-mail address/);
  });

  test("*** A PHONE NUMBER REFUSES THE WHOLE UPLOAD ***", () => {
    const out = parseAutopsyCsv(goodCsv("(555) 867-5309,720+,CA,48,12000,2015-06"));
    assert.equal(out.ok, false, "a phone number was accepted");
    assert.equal(out.error, "personal_details_found");
    assert.match(out.message, /phone number/);
  });

  test("the refusal names the column and the row, so it can be fixed", () => {
    const out = parseAutopsyCsv(`${HEADER}\nA-1,680-719,TX,30,9000,2019-01\n555-11-2222,600-639,TX,30,9000,2019-01`);
    assert.equal(out.ok, false);
    assert.equal(out.column, "row_label");
    assert.equal(out.row, 2);
  });

  test("ONE bad row kills the whole upload — no partial write is offered", () => {
    const out = parseAutopsyCsv(`${HEADER}\nA-1,680-719,TX,30,9000,2019-01\nB-2@broker.com,600-639,TX,30,9000,2019-01`);
    assert.equal(out.ok, false);
    assert.equal(out.rows, undefined, "a partial row set was handed back after a refusal");
  });

  test("identity COLUMNS are dropped before anything is read, and counted", () => {
    const out = parseAutopsyCsv(
      "row_label,client_name,ssn,Primary E-Mail,mobile,fico_band\n" +
      "A-1,Jane Jones,123-45-6789,jane@x.com,5558675309,680-719"
    );
    assert.equal(out.ok, true, out.message);
    assert.deepEqual(out.droppedColumns, ["client_name", "ssn", "Primary E-Mail", "mobile"]);
    // The values in those columns were never read, so their SSN and e-mail did
    // not trigger the value scan — and, more importantly, are not in the result.
    const serialized = JSON.stringify(out.rows);
    assert.doesNotMatch(serialized, /Jane|123-45-6789|jane@x\.com|5558675309/);
  });

  test("a notes column is refused by name — that is where a name always ends up", () => {
    for (const h of ["notes", "Note", "Comments", "internal note"]) {
      assert.equal(isRefusedHeader(h), true, `${h} was allowed through`);
    }
  });

  test("the refused-header list catches the shapes that actually arrive", () => {
    for (const h of ["Client Name", "SSN", "social security", "DOB", "Date of Birth",
                     "Street Address", "E-Mail", "e mail", "Phone", "Mobile #", "Account Number"]) {
      assert.equal(isRefusedHeader(h), true, `${h} was allowed through`);
    }
    for (const h of ["fico_band", "state", "open_tradelines", "declined_on", "requested_amount_usd"]) {
      assert.equal(isRefusedHeader(h), false, `${h} was wrongly dropped`);
    }
  });

  test("a 9-digit run is treated as an SSN — deliberate over-refusal", () => {
    assert.equal(scanCellForPii("123456789")?.kind, "ssn");
    // ...but a numeric FIELD is exempted by the caller, so revenue still works.
    const out = parseAutopsyRows({ rows: [{ row_label: "A-1", fico_band: "720+", annual_revenue_usd: "123456789" }] });
    assert.equal(out.ok, true, out.message);
    assert.equal(out.rows[0].annual_revenue_cents, 12345678900);
  });

  test("an empty cell is not personal details", () => {
    assert.equal(scanCellForPii(""), null);
    assert.equal(scanCellForPii(null), null);
    assert.equal(scanCellForPii("A-14"), null);
  });
});

describe("minimisation — what is kept is narrower than what was sent", () => {
  test("declined_on is reduced to month and year, never a full date", () => {
    assert.equal(monthOnly("2026-03-17"), "2026-03-01");
    assert.equal(monthOnly("03/2026"), "2026-03-01");
    assert.equal(monthOnly("2026-03"), "2026-03-01");
    assert.equal(monthOnly("not a date"), null);
    assert.equal(monthOnly("2026-13"), null);
  });

  test("row_label is truncated to 32 characters — it is the broker's key, not prose", () => {
    const out = normalizeAutopsyRow({ row_label: "x".repeat(80), fico_band: "720+" });
    assert.equal(out.ok, true);
    assert.equal(out.row.row_label.length, 32);
  });

  test("an exact FICO score is never accepted — an unrecognised band becomes unknown", () => {
    const out = normalizeAutopsyRow({ row_label: "A-1", fico_band: "712" });
    assert.equal(out.row.fico_band, "unknown");
    assert.equal(ficoMidpoint(out.row.fico_band), null, "unknown must not have a midpoint");
  });

  test("columns we do not accept are ignored rather than stored", () => {
    const out = parseAutopsyCsv("row_label,fico_band,lucky_number\nA-1,720+,7");
    assert.equal(out.ok, true);
    assert.deepEqual(out.ignoredColumns, ["lucky_number"]);
    assert.equal("lucky_number" in out.rows[0], false);
  });

  test("bureau text is matched loosely and unknown text is dropped, never invented", () => {
    assert.equal(normalizeBureaus("EX, TU"), "EX, TU");
    assert.equal(normalizeBureaus("experian and transunion"), "EX, TU");
    assert.equal(normalizeBureaus("some other bureau"), null);
  });
});

describe("NULL means unknown and it survives the parser", () => {
  test("a missing count is null, never zero", () => {
    const out = normalizeAutopsyRow({ row_label: "A-1", fico_band: "720+" });
    assert.equal(out.row.open_tradelines, null);
    assert.equal(out.row.business_age_months, null);
    assert.equal(out.row.annual_revenue_cents, null);
    assert.equal(out.row.highest_revolving_limit_cents, null);
    for (const [k, v] of Object.entries(out.row)) {
      assert.notEqual(v, 0, `${k} turned an absent value into zero`);
    }
  });

  test("an unparseable number is unknown, not zero", () => {
    const out = normalizeAutopsyRow({ row_label: "A-1", fico_band: "720+", open_tradelines: "lots" });
    assert.equal(out.row.open_tradelines, null);
  });

  test("utilisation is percent units and out-of-range is unknown", () => {
    assert.equal(normalizeAutopsyRow({ row_label: "A", fico_band: "720+", revolving_utilization_pct: "45%" }).row.revolving_utilization_pct, 45);
    assert.equal(normalizeAutopsyRow({ row_label: "A", fico_band: "720+", revolving_utilization_pct: "180" }).row.revolving_utilization_pct, null);
  });
});

describe("the cap, the shape, and the one CSV splitter", () => {
  test("over the row cap is refused with a number the broker can act on", () => {
    const body = Array.from({ length: MAX_ROWS + 1 }, (_, i) => `A-${i},720+,TX,30,9000,2019-01`).join("\n");
    const out = parseAutopsyCsv(goodCsv(body));
    assert.equal(out.ok, false);
    assert.equal(out.error, "too_many_rows");
    assert.match(out.message, new RegExp(String(MAX_ROWS)));
  });

  test("exactly the cap is accepted", () => {
    const body = Array.from({ length: MAX_ROWS }, (_, i) => `A-${i},720+,TX,30,9000,2019-01`).join("\n");
    assert.equal(parseAutopsyCsv(goodCsv(body)).ok, true);
  });

  test("a row with no label is refused — the broker owns the key", () => {
    const out = parseAutopsyCsv(goodCsv(",720+,TX,30,9000,2019-01"));
    assert.equal(out.ok, false);
    assert.equal(out.error, "row_label_required");
  });

  test("a header row and nothing else is refused", () => {
    assert.equal(parseAutopsyCsv(HEADER).ok, false);
  });

  test("*** the parser uses the ONE CSV splitter this repo has ***", () => {
    // Reuse, not a second implementation (CLAUDE.md §8). If splitCsvLine ever
    // stopped being exported, this file would not import and this test fails.
    assert.equal(typeof splitCsvLine, "function");
    assert.deepEqual(splitCsvLine('a,"b,c",d'), ["a", "b,c", "d"]);
    const out = parseAutopsyCsv('row_label,fico_band,declined_by\n"A,1",720+,"Big, Bank"');
    assert.equal(out.ok, true);
    assert.equal(out.rows[0].row_label, "A,1");
    assert.equal(out.rows[0].declined_by, "Big, Bank");
  });

  test("CSV and the manual grid go through the same rules", () => {
    const viaCsv = parseAutopsyRows({ csvText: goodCsv("A-1,680-719,tx,30,9000,2019-01") });
    const viaGrid = parseAutopsyRows({
      rows: [{ row_label: "A-1", fico_band: "680-719", state: "tx", business_age_months: "30",
               highest_revolving_limit_usd: "9000", revolving_opened_month: "2019-01" }]
    });
    assert.equal(viaCsv.ok, true);
    assert.equal(viaGrid.ok, true);
    assert.deepEqual(viaCsv.rows[0], viaGrid.rows[0]);
    assert.equal(viaGrid.rows[0].state, "TX");
  });

  test("neither a file nor rows is refused rather than treated as empty", () => {
    assert.equal(parseAutopsyRows({}).ok, false);
    assert.equal(parseAutopsyRows({ rows: [] }).ok, false);
  });
});

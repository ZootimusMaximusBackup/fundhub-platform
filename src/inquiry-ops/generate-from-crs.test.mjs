import { test } from "node:test";
import assert from "node:assert/strict";
import { generateFromCrs } from "./generate-from-crs.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const CASE = "33333333-3333-4333-8333-333333333333";

const SAMPLE_INQUIRIES = [
  { inquiry: "Capital One", bureau: "EX", date: "2024-01-15" },
  { inquiry: "Chase", bureau: "EX", date: "2024-02-01" },
  { inquiry: "Amex", bureau: "EX", date: "2024-03-10" },
  { inquiry: "Discover", bureau: "EX", date: "2024-04-02" },
  { inquiry: "Wells Fargo", bureau: "EQ", date: "2024-05-01" },
  { inquiry: "Citi", bureau: "EQ", date: "2024-06-11" },
  { inquiry: "Navy Fed", bureau: "TU", date: "2024-07-08" }
];

function fakeDb({
  /* A case names the bureau its letter is addressed to. This fixture names all
     three, which is why every count below is still the whole sample: the
     bureau filter added on 2026-09-06 keeps every bureau a case names. The
     single-bureau tests at the bottom of this file are the ones that pin the
     filter itself. */
  caseRow = {
    id: CASE,
    org_id: ORG,
    client_id: CLIENT,
    case_status: "Queued",
    selected_bureaus_raw: "EX/EQ/TU",
    open_inquiry_count: 0
  },
  crsRow = {
    id: "crs-1",
    result: { inquiries: SAMPLE_INQUIRIES },
    created_at: "2026-08-27T00:00:00Z"
  },
  log = []
} = {}) {
  const state = {
    caseRow: caseRow ? { ...caseRow } : null,
    crsRow,
    log: log.map((r) => ({ ...r })),
    calls: []
  };
  let seq = 1;

  return {
    state,
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, " ");
      state.calls.push(s);
      if (/repair/i.test(s)) throw new Error("must not call repair");

      if (s.includes("UPDATE inquiry_removal_cases") && s.includes("open_inquiry_count")) {
        const caseId = params[0];
        const n = state.log.filter((r) => r.case_id === caseId && r.is_open).length;
        if (state.caseRow && state.caseRow.id === caseId) {
          state.caseRow.open_inquiry_count = n;
          return { rows: [{ ...state.caseRow }] };
        }
        return { rows: [] };
      }

      if (s.includes("UPDATE inquiry_log") && s.includes("case_id = NULL")) {
        const [org, caseId, keep] = params;
        const freed = state.log.filter((r) =>
          r.org_id === org && r.case_id === caseId
          && !(keep || []).includes(String(r.bureau || "").toUpperCase()));
        for (const r of freed) { r.case_id = null; r.inquiry_removal_case_id = null; }
        return { rows: freed.map((r) => ({ id: r.id })) };
      }

      if (s.includes("UPDATE inquiry_log")) {
        const id = params[0];
        const row = state.log.find((r) => r.id === id);
        if (row) {
          row.case_id = params[1] ?? row.case_id;
          row.bureau = params[2] ?? row.bureau;
          row.inquiry = params[3] ?? row.inquiry;
          row.inquiry_name = params[4] ?? row.inquiry_name;
          row.status = params[6] ?? row.status;
          row.is_open = params[7];
        }
        return { rows: row ? [{ ...row }] : [] };
      }

      if (s.includes("INSERT INTO inquiry_log")) {
        const row = {
          id: `log-${seq++}`,
          org_id: params[0],
          client_id: params[1],
          case_id: params[2],
          inquiry_removal_case_id: params[2],
          bureau: params[4],
          inquiry: params[5],
          inquiry_name: params[6],
          status: params[8],
          is_open: params[9]
        };
        state.log.push(row);
        return { rows: [{ ...row }] };
      }

      if (s.includes("FROM inquiry_removal_cases")) {
        const id = params[0];
        const org = params[1];
        if (state.caseRow && state.caseRow.id === id && state.caseRow.org_id === org) {
          return { rows: [{ ...state.caseRow }] };
        }
        return { rows: [] };
      }

      if (s.includes("FROM crs_results")) {
        return { rows: state.crsRow ? [state.crsRow] : [] };
      }

      if (s.includes("FROM inquiry_log") && s.includes("external_inquiry_id")) {
        return { rows: [] };
      }

      if (s.includes("FROM inquiry_log") && /WHERE id =/.test(s)) {
        const row = state.log.find((r) => r.id === params[0]);
        return { rows: row ? [{ ...row }] : [] };
      }

      if (s.includes("FROM inquiry_log")) {
        return {
          rows: state.log.filter((r) => r.org_id === params[0] && r.client_id === params[1])
        };
      }

      return { rows: [] };
    }
  };
}

test("generateFromCrs: writes items from result.inquiries, not PII, not repair", async () => {
  const db = fakeDb({
    crsRow: {
      id: "crs-1",
      result: {
        inquiries: SAMPLE_INQUIRIES,
        personalInfo: { EX: { names: ["John A Smith"] } }
      },
      created_at: "2026-08-27T00:00:00Z"
    }
  });
  const out = await generateFromCrs(db, { orgId: ORG, caseId: CASE });
  assert.equal(out.ok, true);
  assert.equal(out.written, 7);
  assert.equal(out.open_inquiry_count, 7);
  assert.equal(db.state.log.length, 7);
  assert.equal(db.state.log.every((r) => r.case_id === CASE && r.is_open === true), true);
  assert.equal(db.state.log.some((r) => /john|smith|name:/i.test(r.inquiry_name || "")), false);
  assert.equal(db.state.calls.some((s) => /repair/i.test(s)), false);
});

test("generateFromCrs: second Generate stays at 7, not 14", async () => {
  const db = fakeDb();
  const first = await generateFromCrs(db, { orgId: ORG, caseId: CASE });
  const second = await generateFromCrs(db, { orgId: ORG, caseId: CASE });
  assert.equal(first.written, 7);
  assert.equal(second.written, 0);
  assert.equal(second.skipped, 7);
  assert.equal(db.state.log.length, 7);
  assert.equal(second.open_inquiry_count, 7);
});

test("generateFromCrs: attaches an unmatched existing row instead of inserting a duplicate", async () => {
  const db = fakeDb({
    log: [{
      id: "orphan-1",
      org_id: ORG,
      client_id: CLIENT,
      case_id: null,
      bureau: "EX",
      inquiry: "Capital One",
      inquiry_name: "Capital One",
      is_open: true
    }]
  });
  const out = await generateFromCrs(db, { orgId: ORG, caseId: CASE });
  assert.equal(out.ok, true);
  assert.equal(out.attached, 1);
  assert.equal(out.written, 6);
  assert.equal(db.state.log.length, 7);
  const attached = db.state.log.find((r) => r.id === "orphan-1");
  assert.equal(attached.case_id, CASE);
});

test("generateFromCrs: no credit file is a 200 refusal", async () => {
  const db = fakeDb({ crsRow: null });
  const out = await generateFromCrs(db, { orgId: ORG, caseId: CASE });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "no_credit_file");
  assert.equal(out.httpStatus, undefined);
  assert.equal(db.state.log.length, 0);
});

test("generateFromCrs: credit file with no inquiries is a 200 refusal", async () => {
  const db = fakeDb({
    crsRow: { id: "crs-empty", result: { inquiries: [] }, created_at: "2026-08-27T00:00:00Z" }
  });
  const out = await generateFromCrs(db, { orgId: ORG, caseId: CASE });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "no_inquiries");
  assert.equal(db.state.log.length, 0);
});

test("generateFromCrs: missing case is 404", async () => {
  const db = fakeDb({ caseRow: null });
  const out = await generateFromCrs(db, { orgId: ORG, caseId: CASE });
  assert.equal(out.ok, false);
  assert.equal(out.httpStatus, 404);
  assert.equal(out.reason, "not_found");
});

/* ── each inquiry belongs to the bureau that reported it ───────────────────
 * Measured on the funding walkthrough client, 2026-09-06: pressing Generate on
 * the Experian case staged all four of that client's inquiries onto Experian —
 * the Equifax one and the TransUnion one included — and the item count on the
 * screen went from 2 to 4. Experian cannot delete a TransUnion inquiry, so a
 * letter listing one is a letter thrown away.
 */

const EX_CASE = { id: CASE, org_id: ORG, client_id: CLIENT, case_status: "Queued",
                  selected_bureaus_raw: "EX", open_inquiry_count: 0 };

test("generateFromCrs: an Experian case stages Experian inquiries only", async () => {
  const db = fakeDb({ caseRow: EX_CASE });
  const out = await generateFromCrs(db, { orgId: ORG, caseId: CASE });
  assert.equal(out.ok, true);
  assert.equal(out.written, 4, "the four Experian inquiries, and only those");
  assert.equal(out.open_inquiry_count, 4);
  assert.deepEqual(out.bureaus, ["EX"]);
  assert.equal(db.state.log.every((r) => r.bureau === "EX"), true);
  assert.equal(db.state.log.some((r) => /wells fargo|citi|navy fed/i.test(r.inquiry_name || "")), false);
});

test("generateFromCrs: a TransUnion case stages the one TransUnion inquiry", async () => {
  const db = fakeDb({
    caseRow: { ...EX_CASE, selected_bureaus_raw: "TU" }
  });
  const out = await generateFromCrs(db, { orgId: ORG, caseId: CASE });
  assert.equal(out.written, 1);
  assert.equal(db.state.log[0].inquiry_name, "Navy Fed");
});

test("generateFromCrs: a case naming two bureaus keeps both, and no third", async () => {
  const db = fakeDb({
    caseRow: { ...EX_CASE, selected_bureaus_raw: "EQ, TU" }
  });
  const out = await generateFromCrs(db, { orgId: ORG, caseId: CASE });
  assert.equal(out.written, 3);
  assert.equal(db.state.log.some((r) => r.bureau === "EX"), false);
});

test("generateFromCrs: a case with no bureau on it refuses instead of staging everything", async () => {
  const db = fakeDb({
    caseRow: { ...EX_CASE, selected_bureaus_raw: null }
  });
  const out = await generateFromCrs(db, { orgId: ORG, caseId: CASE });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "no_bureau_on_case");
  assert.match(out.message, /no credit bureau/i);
  assert.equal(db.state.log.length, 0, "nothing may be staged onto a case with no bureau");
});

test("generateFromCrs: rows an earlier run put on the wrong case are released, not deleted", async () => {
  const db = fakeDb({
    caseRow: EX_CASE,
    log: [{
      id: "wrong-1", org_id: ORG, client_id: CLIENT, case_id: CASE,
      inquiry_removal_case_id: CASE,
      bureau: "TU", inquiry: "Navy Fed", inquiry_name: "Navy Fed", is_open: true
    }]
  });
  const out = await generateFromCrs(db, { orgId: ORG, caseId: CASE });
  assert.equal(out.released, 1);
  const freed = db.state.log.find((r) => r.id === "wrong-1");
  assert.ok(freed, "the row is still there — nothing is deleted");
  assert.equal(freed.case_id, null, "it is no longer counted on the Experian case");
  assert.equal(out.open_inquiry_count, 4, "four Experian rows, and not the TransUnion one");
});

test("generateFromCrs: a bureau the case names but the file has nothing for says so", async () => {
  const db = fakeDb({
    caseRow: { ...EX_CASE, selected_bureaus_raw: "EQ" },
    crsRow: {
      id: "crs-ex-only",
      result: { inquiries: [{ inquiry: "Capital One", bureau: "EX", date: "2024-01-15" }] },
      created_at: "2026-08-27T00:00:00Z"
    }
  });
  const out = await generateFromCrs(db, { orgId: ORG, caseId: CASE });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "no_inquiries");
  assert.match(out.message, /No EQ inquiries/);
  assert.equal(db.state.log.length, 0);
});

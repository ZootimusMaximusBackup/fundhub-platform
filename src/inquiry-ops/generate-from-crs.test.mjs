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
  caseRow = {
    id: CASE,
    org_id: ORG,
    client_id: CLIENT,
    case_status: "Queued",
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

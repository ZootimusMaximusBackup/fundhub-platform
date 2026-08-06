import { test } from "node:test";
import assert from "node:assert/strict";
import { SendGateError, sendCase } from "./send.mjs";

function fakeDb({ caseRow, docs = [], inquiries = [], prep = [] } = {}) {
  const attempts = [];
  const updates = [];
  return {
    attempts,
    updates,
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, " ");
      if (s.includes("FROM inquiry_removal_cases") && s.includes("WHERE id")) {
        return { rows: caseRow ? [caseRow] : [] };
      }
      if (s.includes("FROM documents")) {
        return { rows: docs };
      }
      if (s.includes("FROM inquiry_log") && s.includes("is_open")) {
        return { rows: inquiries };
      }
      if (s.includes("FROM inquiry_prep")) {
        return { rows: prep };
      }
      if (s.includes("INSERT INTO inquiry_log")) {
        const id = `inq-${inquiries.length + 1}`;
        inquiries.push({ id });
        return { rows: [{ id }] };
      }
      if (s.includes("INSERT INTO inquiry_attempts")) {
        attempts.push({ sql, params });
        return { rows: [] };
      }
      if (s.includes("UPDATE inquiry_removal_cases") || s.includes("UPDATE inquiry_log") || s.includes("UPDATE inquiry_prep")) {
        updates.push({ sql: s.slice(0, 80), params });
        if (s.includes("RETURNING *") || s.includes("WHERE id = $1")) {
          return { rows: [{ ...caseRow, case_status: "In Progress" }] };
        }
        return { rows: [] };
      }
      if (s.includes("FROM pipeline_stages") || s.includes("FROM cards") || s.includes("INSERT INTO cards")) {
        return { rows: [{ stage_id: "s1", pipeline_id: "p1", id: "c1" }] };
      }
      if (s.includes("SELECT id, org_id FROM inquiry_log")) {
        return { rows: inquiries.map((i) => ({ id: i.id, org_id: caseRow.org_id })) };
      }
      if (s.includes("UPDATE inquiry_log") && s.includes("call_attempts")) {
        return { rows: [{ id: params[0], call_attempts: 1, org_id: caseRow.org_id }] };
      }
      if (s.includes("BEGIN") || s.includes("COMMIT") || s.includes("ROLLBACK")) {
        return { rows: [] };
      }
      return { rows: [] };
    },
    async connect() {
      return {
        query: (...a) => this.query(...a),
        release() {}
      };
    }
  };
}

test("sendCase refuses when docs blocked", async () => {
  const db = fakeDb({
    caseRow: {
      id: "11111111-1111-4111-8111-111111111111",
      org_id: "22222222-2222-4222-8222-222222222222",
      client_id: "33333333-3333-4333-8333-333333333333",
      selected_bureaus_raw: "EX",
      case_status: "Blocked"
    }
  });
  await assert.rejects(
    () => sendCase(db, {
      caseId: "11111111-1111-4111-8111-111111111111",
      staffId: "44444444-4444-4444-8444-444444444444",
      orgId: "22222222-2222-4222-8222-222222222222",
      mail: true
    }),
    (err) => err instanceof SendGateError && err.code === "docs_blocked"
  );
  assert.equal(db.attempts.length, 0);
});

test("sendCase requires portal confirmation for Experian portal", async () => {
  const docs = [
    { kind: "client_upload", subtype: "id_document" },
    { kind: "client_upload", subtype: "proof_of_address" },
    { kind: "authorization", subtype: "soft_pull_consent" }
  ];
  const db = fakeDb({
    caseRow: {
      id: "11111111-1111-4111-8111-111111111111",
      org_id: "22222222-2222-4222-8222-222222222222",
      client_id: "33333333-3333-4333-8333-333333333333",
      selected_bureaus_raw: "EX",
      case_status: "Queued"
    },
    docs,
    inquiries: [{ id: "55555555-5555-4555-8555-555555555555" }]
  });
  await assert.rejects(
    () => sendCase(db, {
      caseId: "11111111-1111-4111-8111-111111111111",
      staffId: "44444444-4444-4444-8444-444444444444",
      orgId: "22222222-2222-4222-8222-222222222222",
      portal: true
    }),
    (err) => err instanceof SendGateError && err.code === "portal_confirmation_required"
  );
});

test("sendCase rejects portal for non-Experian", async () => {
  const db = fakeDb({
    caseRow: {
      id: "11111111-1111-4111-8111-111111111111",
      org_id: "22222222-2222-4222-8222-222222222222",
      client_id: "33333333-3333-4333-8333-333333333333",
      selected_bureaus_raw: "TU",
      case_status: "Queued"
    },
    docs: [
      { kind: "client_upload", subtype: "id_document" },
      { kind: "client_upload", subtype: "bank_statement" },
      { kind: "authorization", subtype: "soft_pull_consent" }
    ]
  });
  await assert.rejects(
    () => sendCase(db, {
      caseId: "11111111-1111-4111-8111-111111111111",
      staffId: "44444444-4444-4444-8444-444444444444",
      orgId: "22222222-2222-4222-8222-222222222222",
      portal: true,
      portalConfirmation: "REF123"
    }),
    (err) => err instanceof SendGateError && err.code === "portal_ex_only"
  );
});

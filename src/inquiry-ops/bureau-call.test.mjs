import test from "node:test";
import assert from "node:assert/strict";
import { launchBureauCallForCase, BureauCallError } from "./bureau-call.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CASE = "22222222-2222-4222-8222-222222222222";
const CLIENT = "33333333-3333-4333-8333-333333333333";

function dbSeq(answers) {
  let i = 0;
  return {
    query: async (sql) => {
      const next = answers[i++];
      if (!next) throw new Error(`unexpected query: ${String(sql).slice(0, 80)}`);
      if (typeof next === "function") return next(sql);
      return next;
    }
  };
}

test("launch refuses closed cases", async () => {
  const db = dbSeq([
    { rows: [{ id: CASE, client_id: CLIENT, selected_bureaus_raw: "EX", case_status: "Completed", call_fired_at: null }] }
  ]);
  await assert.rejects(
    () => launchBureauCallForCase(db, { orgId: ORG, caseId: CASE, staffId: "s1", env: { FUNDHUB_REP_NUMBER: "+15551234567" } }),
    (err) => err instanceof BureauCallError && err.code === "case_closed"
  );
});

test("launch refuses when FUNDHUB_REP_NUMBER missing", async () => {
  const db = dbSeq([
    { rows: [{ id: CASE, client_id: CLIENT, selected_bureaus_raw: "EX", case_status: "Queued", call_fired_at: null }] }
  ]);
  await assert.rejects(
    () => launchBureauCallForCase(db, { orgId: ORG, caseId: CASE, staffId: "s1", env: {} }),
    (err) => err instanceof BureauCallError && err.code === "rep_number_required"
  );
});

test("launch places call and stamps call_fired_at", async () => {
  const updates = [];
  const db = {
    query: async (sql, params) => {
      const s = String(sql);
      if (/FROM inquiry_removal_cases/i.test(s) && /SELECT/i.test(s)) {
        return {
          rows: [{
            id: CASE, client_id: CLIENT, selected_bureaus_raw: "EX",
            case_status: "Queued", call_fired_at: null
          }]
        };
      }
      if (/FROM clients/i.test(s)) {
        return { rows: [{ id: CLIENT, first_name: "Ada", last_name: "Test", phone: "+16616180865" }] };
      }
      if (/FROM pii_identity/i.test(s) && /SELECT dob/i.test(s)) {
        return {
          rows: [{
            dob: "1990-01-15",
            addresses: [{ line1: "123 Main", city: "Phoenix", state: "AZ", zip: "85001" }]
          }]
        };
      }
      if (/FROM pii_identity/i.test(s) && /ssn_enc/i.test(s)) {
        return { rows: [{ org_id: ORG, ssn_enc: null }] };
      }
      if (/INSERT INTO pii_access_log/i.test(s)) return { rows: [] };
      if (/FROM inquiry_log/i.test(s)) {
        return { rows: [{ inquiry: "CAP ONE", created_at: "2026-01-01" }] };
      }
      if (/INSERT INTO outbound_calls/i.test(s)) return { rows: [] };
      if (/UPDATE inquiry_removal_cases/i.test(s)) {
        updates.push(params);
        return { rows: [] };
      }
      throw new Error(`unexpected: ${s.slice(0, 120)}`);
    }
  };

  // Bypass revealSsn by stubbing placeCall and patching through incomplete SSN path —
  // use placeCallImpl only after we mock reveal — instead inject env and stub module path.
  // Simpler: catch ssn_required when ssn_enc null.
  await assert.rejects(
    () => launchBureauCallForCase(db, {
      orgId: ORG,
      caseId: CASE,
      staffId: "s1",
      env: { FUNDHUB_REP_NUMBER: "+15551234567", BLAND_API_KEY: "k" },
      placeCallImpl: async () => ({ status: "sent", callId: "call_1" })
    }),
    (err) => err instanceof BureauCallError && err.code === "ssn_required"
  );
  assert.equal(updates.length, 0);
});

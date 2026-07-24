import { test } from "node:test";
import assert from "node:assert";
import {
  splitName,
  resolveClient,
  onEntryCaptured,
  onSurveySubmitted,
  onPaymentReceived,
  onDiagnosticPaid,
  onDecisionRendered,
  onAnalysisCompleted
} from "./client-lifecycle.mjs";

// In-memory Postgres fake: interprets the exact queries the handlers issue.
function pgFake() {
  const clients = [], transactions = [], crs = [];
  let n = 0;
  const findClient = (org, email) =>
    clients.find((c) => c.org_id === org && String(c.email || "").toLowerCase() === String(email).toLowerCase());
  return {
    clients, transactions, crs,
    async query(sql, params = []) {
      if (/SELECT id FROM clients/.test(sql)) {
        const c = findClient(params[0], params[1]);
        return { rows: c ? [{ id: c.id }] : [] };
      }
      if (/INSERT INTO clients/.test(sql)) {
        if (findClient(params[0], params[1])) return { rows: [] }; // ON CONFLICT DO NOTHING
        const id = "cl-" + ++n;
        clients.push({ id, org_id: params[0], email: params[1], first_name: params[2], last_name: params[3], custom_fields: {}, outcome_tier: null });
        return { rows: [{ id }] };
      }
      if (/UPDATE clients SET custom_fields/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        if (c) Object.assign(c.custom_fields, JSON.parse(params[1]));
        return { rows: [] };
      }
      if (/UPDATE clients SET outcome_tier/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        if (c) c.outcome_tier = params[1];
        return { rows: [] };
      }
      if (/INSERT INTO transactions/.test(sql)) {
        const ref = params[6];
        if (ref && transactions.find((t) => t.org_id === params[0] && t.provider_ref === ref)) return { rows: [] };
        transactions.push({ org_id: params[0], client_id: params[1], product_name: params[2], amount_paid: params[3], provider_ref: ref });
        return { rows: [] };
      }
      if (/SELECT 1 FROM crs_results/.test(sql)) {
        return { rows: crs.find((r) => r.client_id === params[0] && r.__event_id === String(params[1])) ? [{ x: 1 }] : [] };
      }
      if (/INSERT INTO crs_results/.test(sql)) {
        const result = JSON.parse(params[2]);
        crs.push({ org_id: params[0], client_id: params[1], __event_id: result.__event_id, outcome_tier: params[3] });
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
}

const ev = (name, payload, extra = {}) => ({ id: "evt-x", orgId: "org-1", name, payload, ...extra });

test("splitName", () => {
  assert.deepEqual(splitName("Jane Doe"), { firstName: "Jane", lastName: "Doe" });
  assert.deepEqual(splitName("Cher"), { firstName: "Cher", lastName: null });
  assert.deepEqual(splitName("Mary Jane Watson"), { firstName: "Mary", lastName: "Jane Watson" });
  assert.deepEqual(splitName(""), { firstName: null, lastName: null });
});

test("resolveClient: explicit clientId wins, no db insert", async () => {
  const db = pgFake();
  const id = await resolveClient(db, ev("x", { email: "a@b.com" }, { clientId: "given-id" }));
  assert.equal(id, "given-id");
  assert.equal(db.clients.length, 0);
});

test("entry.captured: creates client once, idempotent on re-run", async () => {
  const db = pgFake();
  await onEntryCaptured(ev("entry.captured", { email: "Jane@X.com", name: "Jane Doe", source: "clickfunnels" }), db);
  await onEntryCaptured(ev("entry.captured", { email: "jane@x.com", name: "Jane Doe" }), db);
  assert.equal(db.clients.length, 1);
  assert.equal(db.clients[0].first_name, "Jane");
});

test("payment.received: inserts one transaction, replay dedupes by providerRef", async () => {
  const db = pgFake();
  const e = ev("payment.received", { email: "a@b.com", productName: "Consulting Services Deposit", amount: 3000, providerRef: "txn_1", source: "commas" });
  await onPaymentReceived(e, db);
  await onPaymentReceived(e, db); // replay
  assert.equal(db.transactions.length, 1);
  assert.equal(db.transactions[0].amount_paid, 3000);
  assert.equal(db.clients.length, 1, "auto-created the client from the payment email");
});

test("survey.submitted merges answers; diagnostic.paid + decision.rendered stamp the client", async () => {
  const db = pgFake();
  await onSurveySubmitted(ev("survey.submitted", { email: "a@b.com", answers: { cf_svy_why: "growth", clarity: "high" } }), db);
  await onDiagnosticPaid(ev("diagnostic.paid", { email: "a@b.com" }), db);
  await onDecisionRendered(ev("decision.rendered", { email: "a@b.com", outcomeTier: "FULL_FUNDING", fundingEstimate: 50000 }), db);
  const c = db.clients[0];
  assert.equal(c.custom_fields.cf_svy_why, "growth");
  assert.equal(c.custom_fields.crs_paid, true);
  assert.equal(c.custom_fields.total_funding_estimate, 50000);
  assert.equal(c.outcome_tier, "FULL_FUNDING");
});

test("analysis.completed: stores crs_result once, idempotent by event id", async () => {
  const db = pgFake();
  const e = ev("analysis.completed", { email: "a@b.com", outcomeTier: "REPAIR_ONLY", scores: { ex: 610 } }, { id: "evt-crs-1" });
  await onAnalysisCompleted(e, db);
  await onAnalysisCompleted(e, db); // replay same event
  assert.equal(db.crs.length, 1);
  assert.equal(db.crs[0].outcome_tier, "REPAIR_ONLY");
});

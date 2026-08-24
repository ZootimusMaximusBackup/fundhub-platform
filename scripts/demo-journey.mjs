// Demo journey — drives one sample client end-to-end through the event bus so the
// dashboard reflects the full journey (lead → booked → paid → analysis → decision → sale).
// Idempotent: wipes the demo client first, safe to re-run.
// Run: DATABASE_URL=postgres://... node scripts/demo-journey.mjs
import { db, close } from "../src/db.mjs";
import { emit, _resetOrgCache } from "../src/events/bus.mjs";
import { register as registerLifecycle } from "../src/handlers/client-lifecycle.mjs";
import { register as registerComms } from "../src/handlers/comms.mjs";
import clientsHandler from "../api/dashboard/clients.mjs";

const EMAIL = "demo.journey@fundhub.ai";

async function wipe() {
  await db.query(`DELETE FROM transactions WHERE client_id IN (SELECT id FROM clients WHERE email=$1)`, [EMAIL]);
  await db.query(`DELETE FROM crs_results WHERE client_id IN (SELECT id FROM clients WHERE email=$1)`, [EMAIL]);
  await db.query(`DELETE FROM messages WHERE client_id IN (SELECT id FROM clients WHERE email=$1)`, [EMAIL]);
  await db.query(`DELETE FROM tasks WHERE client_id IN (SELECT id FROM clients WHERE email=$1)`, [EMAIL]);
  await db.query(`DELETE FROM events WHERE idempotency_key LIKE 'demo:%'`);
  await db.query(`DELETE FROM clients WHERE email=$1`, [EMAIL]);
}

const steps = [
  ["entry.captured",     { email: EMAIL, name: "Demo Client", phone: "+15551230000", source: "clickfunnels" }],
  ["survey.submitted",   { email: EMAIL, answers: { cf_svy_why: "expand my business", clarity: "high" } }],
  ["booking.created",    { email: EMAIL, name: "Demo Client", bookingUid: "demo_bk_1", startTime: "2026-08-05T17:00:00Z", source: "clickfunnels" }],
  ["payment.received",   { email: EMAIL, productName: "Business Financial Assessment", amount: 32, providerRef: "demo_txn_32", source: "commas" }],
  ["diagnostic.paid",    { email: EMAIL }],
  ["analysis.completed", { email: EMAIL, outcomeTier: "FULL_FUNDING", scores: { ex: 735, eq: 728, tu: 740 }, utilization: 12, reasonCodes: ["low_util", "seasoned_tradelines"] }],
  ["decision.rendered",  { email: EMAIL, outcomeTier: "FULL_FUNDING", fundingEstimate: 150000 }],
  ["payment.received",   { email: EMAIL, productName: "Consulting Services Deposit", amount: 3000, providerRef: "demo_txn_dep", source: "commas" }],
  ["deposit.paid",       { email: EMAIL }],
  ["sale.closed",        { email: EMAIL }],
  ["call.completed",     { callId: "demo_call_1", status: "completed", disposition: "booked_followup", source: "bland", email: EMAIL }]
];

async function main() {
  _resetOrgCache();
  registerLifecycle();
  registerComms();
  await wipe();
  let i = 0;
  for (const [name, payload] of steps) {
    await emit(db, name, payload, { idempotencyKey: `demo:${i}:${name}` });
    console.log(`  ✔ ${name}`);
    i++;
  }
  const res = { status(c) { this._c = c; return this; }, json(b) { this._b = b; return this; } };
  await clientsHandler({ query: {} }, res);
  const row = (res._b.clients || []).find((c) => c.email === EMAIL);
  console.log("\nDashboard row for demo client:");
  console.log(JSON.stringify(row, null, 2));
  await close();
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });

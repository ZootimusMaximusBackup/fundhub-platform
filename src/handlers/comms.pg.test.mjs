// Real-Postgres integration test for the comms/booking handlers.
// SKIPS unless DATABASE_URL is set. Proves message.inbound/call.completed →
// messages, mail.response → bank_inbox, booking.created → tasks, all persisted to
// a real DB and replay-safe (no double-writes).

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { emit, replay, _resetOrgCache } from "../events/bus.mjs";
import { clearHandlers } from "../events/registry.mjs";
import { register as registerLifecycle } from "./client-lifecycle.mjs";
import { register as registerComms } from "./comms.mjs";
import { listBankInbox } from "../../api/read/bank-inbox.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "comms_pg_test@example.com";
const PHONE = "+15550000001";

async function wipe() {
  await db.query(`DELETE FROM messages WHERE provider_ref IN ('SM_pg1','call_pg1')`);
  await db.query(`DELETE FROM tasks WHERE body = 'bk_pg1'`);
  await db.query(`DELETE FROM bank_inbox WHERE raw->>'from' = $1`, [EMAIL]);
  await db.query(`DELETE FROM messages WHERE client_id IN (SELECT id FROM clients WHERE email=$1)`, [EMAIL]);
  await db.query(`DELETE FROM tasks WHERE client_id IN (SELECT id FROM clients WHERE email=$1)`, [EMAIL]);
  await db.query(`DELETE FROM bank_inbox WHERE client_id IN (SELECT id FROM clients WHERE email=$1)`, [EMAIL]);
  await db.query(`DELETE FROM events WHERE idempotency_key LIKE 'cpg:%'`);
  await db.query(`DELETE FROM clients WHERE email=$1`, [EMAIL]);
}

before(async () => {
  if (!HAS_DB) return;
  _resetOrgCache();
  clearHandlers();
  registerLifecycle();
  registerComms();
  await wipe();
});
after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

test("comms events persist to Postgres and replay is idempotent", { skip: !HAS_DB }, async () => {
  await emit(db, "entry.captured", { email: EMAIL, name: "Comms Tester", phone: PHONE, source: "clickfunnels" }, { idempotencyKey: "cpg:entry" });
  await emit(db, "message.inbound", { from: PHONE, body: "yes please", sid: "SM_pg1", channel: "sms", source: "twilio" }, { idempotencyKey: "cpg:sms" });
  await emit(db, "call.completed", { callId: "call_pg1", status: "completed", disposition: "transferred", source: "bland" }, { idempotencyKey: "cpg:call" });
  await emit(db, "mail.response", { from: EMAIL, subject: "Approved", classification: "APPROVED", source: "mailgun" }, { idempotencyKey: "cpg:mail" });
  await emit(db, "booking.created", { email: EMAIL, name: "Comms Tester", bookingUid: "bk_pg1", startTime: "2026-08-01T15:00:00Z", source: "clickfunnels" }, { idempotencyKey: "cpg:booking" });

  const clientId = (await db.query(`SELECT id FROM clients WHERE email=$1`, [EMAIL])).rows[0].id;

  const sms = (await db.query(`SELECT * FROM messages WHERE provider_ref='SM_pg1'`)).rows;
  assert.equal(sms.length, 1);
  assert.equal(sms[0].channel, "sms");
  assert.equal(sms[0].client_id, clientId, "sms linked to client by phone");

  const voice = (await db.query(`SELECT * FROM messages WHERE provider_ref='call_pg1'`)).rows;
  assert.equal(voice.length, 1);
  assert.equal(voice[0].channel, "voice");

  const inbox = (await db.query(`SELECT * FROM bank_inbox WHERE raw->>'from'=$1`, [EMAIL])).rows;
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].classification, "APPROVED");
  assert.equal(inbox[0].client_id, clientId, "bank email linked to client by email");

  const tasks = (await db.query(`SELECT * FROM tasks WHERE body='bk_pg1'`)).rows;
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].source_workflow, "clickfunnels");

  // replay every stored event — no duplicates
  await replay(db, {});
  const n = async (q, p) => (await db.query(q, p)).rows[0].n;
  assert.equal(await n(`SELECT count(*)::int n FROM messages WHERE provider_ref IN ('SM_pg1','call_pg1')`), 2, "no duplicate messages");
  assert.equal(await n(`SELECT count(*)::int n FROM bank_inbox WHERE raw->>'from'=$1`, [EMAIL]), 1, "no duplicate bank_inbox");
  assert.equal(await n(`SELECT count(*)::int n FROM tasks WHERE body='bk_pg1'`), 1, "no duplicate task");
});

/* THE BANK'S OWN FIGURE, ALL THE WAY TO THE SCREEN'S READ — on a real database.
   The bank states the approved amount in its email. The classifier has always
   found that figure and thrown it away, so a funding advisor retyped it by
   hand and a forgotten box meant an approval that could never be billed. This
   proves the figure survives the event bus, the bank_inbox row and the read the
   client panel actually calls — and that the preview column no longer holds a
   second copy of the subject line, which is what destroyed the evidence. */
test("a bank approval email keeps its dollar figures and a real preview", { skip: !HAS_DB }, async () => {
  await emit(db, "mail.response", {
    from: EMAIL,
    to: "monitor+x@fundhub.ai",
    subject: "Your application decision",
    classification: "APPROVED",
    bodyPreview: "Congratulations! Your credit limit is $7,500. The annual fee is $95.",
    amountCandidates: ["7500.00", "95.00"],
    amountCandidatesFound: 2,
    source: "mailgun"
  }, { idempotencyKey: "cpg:mail-amounts" });

  const row = (await db.query(
    `SELECT * FROM bank_inbox WHERE raw->>'from'=$1 AND raw->>'__event_id' IS NOT NULL
       AND subject='Your application decision'`, [EMAIL])).rows[0];
  assert.ok(row, "the bank email was filed");
  assert.notEqual(row.body_preview, row.subject, "the preview is not the subject a second time");
  assert.ok(row.body_preview.indexOf("$7,500") !== -1, "the sentence stating the amount survived");

  const read = await listBankInbox(db.query.bind(db), {
    orgId: row.org_id, clientId: row.client_id, limit: 25, offset: 0
  });
  const item = read.rows.find((r) => r.id === row.id);
  assert.ok(item, "the client panel's read returns it");
  assert.deepEqual(item.amount_candidates, ["7500.00", "95.00"], "both figures are offered");
  assert.equal(Number(item.amount_candidates_found), 2, "and the screen is told there were two");
  assert.equal("raw" in item, false, "the whole email never leaves the process");
});

test("a bank DENIAL is filed with no amount to suggest", { skip: !HAS_DB }, async () => {
  await emit(db, "mail.response", {
    from: EMAIL,
    subject: "Your application outcome",
    classification: "DENIED",
    bodyPreview: "Unfortunately, you were not approved for the requested $10,000.",
    source: "mailgun"
  }, { idempotencyKey: "cpg:mail-denied" });

  const row = (await db.query(
    `SELECT * FROM bank_inbox WHERE raw->>'from'=$1 AND subject='Your application outcome'`,
    [EMAIL])).rows[0];
  assert.ok(row);
  assert.equal(row.classification, "DENIED");

  const read = await listBankInbox(db.query.bind(db), {
    orgId: row.org_id, clientId: row.client_id, limit: 25, offset: 0
  });
  const item = read.rows.find((r) => r.id === row.id);
  // NULL, not an empty list and above all not a zero. The figure in a denial
  // letter is the limit being refused — the most dangerous number in the inbox.
  assert.equal(item.amount_candidates, null);
  assert.equal(item.amount_candidates_found, null);
});

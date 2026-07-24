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
  await emit(db, "booking.created", { email: EMAIL, name: "Comms Tester", bookingUid: "bk_pg1", startTime: "2026-08-01T15:00:00Z", source: "calcom" }, { idempotencyKey: "cpg:booking" });

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
  assert.equal(tasks[0].source_workflow, "calcom");

  // replay every stored event — no duplicates
  await replay(db, {});
  const n = async (q, p) => (await db.query(q, p)).rows[0].n;
  assert.equal(await n(`SELECT count(*)::int n FROM messages WHERE provider_ref IN ('SM_pg1','call_pg1')`), 2, "no duplicate messages");
  assert.equal(await n(`SELECT count(*)::int n FROM bank_inbox WHERE raw->>'from'=$1`, [EMAIL]), 1, "no duplicate bank_inbox");
  assert.equal(await n(`SELECT count(*)::int n FROM tasks WHERE body='bk_pg1'`), 1, "no duplicate task");
});

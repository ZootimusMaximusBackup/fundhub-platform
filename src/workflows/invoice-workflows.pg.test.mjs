// End-to-end tests for the two workflows that write invoices, against REAL
// Postgres rather than pgFake.
//
// WHY. Both workflows were dead against a real database — createInvoice raised
// SQLSTATE 42703 on the columns 031_invoices.sql renamed — and both workflows'
// existing test files were green throughout, because pgFake models the schema
// the code expects rather than the schema that exists. The failure lands
// mid-workflow, so it is worse than a plain error: F-07 sends the client the
// "funding locked" email and SMS and THEN throws, and DS-02 takes a $1,000
// payment, sets diy_status='Processing' and THEN throws, leaving the client
// stuck there with no letters.
//
// These drive handle() with each workflow's OWN fixture shape (copied from its
// passing unit test, per the rule that an invented fixture usually never reaches
// the branch it claims to cover) but against a real database, and assert the
// steps AFTER the invoice actually ran.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { handle as f07, EMAIL_TEMPLATE_KEY as F07_EMAIL, SMS_TEMPLATE_KEY as F07_SMS }
  from "./f-07-funding-locked.mjs";
import { handle as ds02, EMAIL_TEMPLATE_KEY as DS02_EMAIL } from "./ds-02-diy-letters.mjs";
import { fakeStep, ev } from "./test-support.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
/* DS-02 delivers letters through the adapters fence, which defaults to blocked
   and reads the process environment here because handle() takes no env. This
   test asserts delivery happens, so it has to declare the fence down. */
process.env.ADAPTERS_DRY_RUN = "0";

// text() is required: outbound calls read the body once as text.
const okFetch = async () => ({ ok: true, status: 200, text: async () => "{}" });

describe("invoice-writing workflows against real Postgres",
  { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, fundingClient, diyClient;
  const EMAILS = ["f07.pgfixture@example.com", "ds02.pgfixture@example.com"];

  async function purge() {
    const ids = (await db.query(
      `SELECT id FROM clients WHERE org_id = $1 AND lower(email) = ANY($2)`, [org, EMAILS]
    )).rows.map((r) => r.id);
    if (!ids.length) return;
    await db.query(`ALTER TABLE invoices DISABLE TRIGGER trg_invoices_no_delete`);
    try {
      await db.query(`DELETE FROM invoices WHERE client_id = ANY($1)`, [ids]);
    } finally {
      await db.query(`ALTER TABLE invoices ENABLE TRIGGER trg_invoices_no_delete`);
    }
    await db.query(`DELETE FROM tasks WHERE client_id = ANY($1)`, [ids]);
    await db.query(`DELETE FROM messages WHERE client_id = ANY($1)`, [ids]);
    // Queueing a message now emits message.queued, and events.client_id has a
    // foreign key to clients — so the event rows have to go before the client
    // does, or the delete below fails and takes the whole file's teardown with
    // it.
    await db.query(`DELETE FROM events WHERE client_id = ANY($1)`, [ids]);
    await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
  }

  async function ensureTemplate(key, channel, body) {
    await db.query(
      `INSERT INTO message_templates (org_id, template_key, channel, body, compliance_passed)
       VALUES ($1,$2,$3,$4,true)
       ON CONFLICT (org_id, template_key) DO UPDATE SET compliance_passed = true`,
      [org, key, channel, body]);
  }

  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();
    const mk = async (email, tier) => (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email, outcome_tier, custom_fields)
       VALUES ($1,'Wf','Fixture',$2,$3,'{}'::jsonb) RETURNING id`,
      [org, email, tier])).rows[0].id;
    fundingClient = await mk(EMAILS[0], "FULL_FUNDING");
    diyClient = await mk(EMAILS[1], "REPAIR_ONLY");
    await ensureTemplate(F07_EMAIL, "email", "Locked email");
    await ensureTemplate(F07_SMS, "sms", "Locked sms");
    await ensureTemplate(DS02_EMAIL, "email", "letters ready");
  });

  after(async () => { await purge(); await close(); });

  const invoicesFor = async (clientId) =>
    (await db.query(`SELECT * FROM invoices WHERE client_id = $1`, [clientId])).rows;

  // ── F-07 ───────────────────────────────────────────────────────────────────

  test("F-07 completes: the success-fee invoice is written and the run reaches its end", async () => {
    const res = await f07({
      event: ev("round.funded", { approvedAmount: 25000, feePercent: 12 },
        { clientId: fundingClient, orgId: org, id: "00000000-0000-4000-8000-0000000f0701" }),
      db, step: fakeStep()
    });
    assert.equal(res.done, true);
    assert.equal(res.feeReady, true);

    const inv = await invoicesFor(fundingClient);
    assert.equal(inv.length, 1, "no invoice row was written");
    assert.equal(Number(inv[0].amount_due), 3000, "25000 @ 12% should be 3000");
    assert.equal(inv[0].source, "funding_success_fee");

    // The step AFTER the invoice. This is what silently never ran before.
    assert.ok(res.invoiceTask, "the invoice task step did not run");
    const tasks = (await db.query(
      `SELECT * FROM tasks WHERE client_id = $1`, [fundingClient])).rows;
    assert.ok(tasks.length >= 1, "no follow-up task was created");
  });

  test("F-07 replayed writes one invoice, not two", async () => {
    const event = ev("round.funded", { approvedAmount: 25000, feePercent: 12 },
      { clientId: fundingClient, orgId: org, id: "00000000-0000-4000-8000-0000000f0702" });
    await f07({ event, db, step: fakeStep() });
    const after1 = (await invoicesFor(fundingClient)).length;
    await f07({ event, db, step: fakeStep() });
    assert.equal((await invoicesFor(fundingClient)).length, after1,
      "replaying round.funded billed the success fee twice");
  });

  // ── DS-02 ──────────────────────────────────────────────────────────────────

  test("DS-02 completes: invoice written AND the letters/email/tag steps after it run", async () => {
    const res = await ds02({
      event: ev("payment.received", { productName: "Consulting Services Package", amount: 1000 },
        { clientId: diyClient, orgId: org, id: "00000000-0000-4000-8000-00000000d201" }),
      db, step: fakeStep(), fetchImpl: okFetch
    });
    assert.equal(res.done, true);

    const inv = await invoicesFor(diyClient);
    assert.equal(inv.length, 1, "no invoice row was written");
    assert.equal(inv[0].source, "diy_letters",
      "source should be canonical, not derived to 'other' from invoiceType");

    // Everything downstream of the invoice step — none of this ran before.
    assert.equal(res.delivery.delivered, true, "letters were never delivered");
    assert.ok(res.email, "the ready email step never ran");
    const { rows: [c] } = await db.query(
      `SELECT tags, custom_fields FROM clients WHERE id = $1`, [diyClient]);
    assert.ok((c.tags || []).includes("client:diy-letters"), "the client was never tagged");
    assert.equal(c.custom_fields.diy_status, "Delivered",
      "client was left stuck at the status the workflow set before the invoice step");
  });

  test("DS-02 replayed does not bill the client twice, even with no saleId", async () => {
    // The regression this guards: with no saleId the idempotency key was NULL,
    // so the targeted ON CONFLICT never fired and a redelivered webhook invoiced
    // the client again. source_event_id is the second dimension that catches it.
    const event = ev("payment.received", { productName: "Consulting Services Package", amount: 1000 },
      { clientId: diyClient, orgId: org, id: "00000000-0000-4000-8000-00000000d202" });
    await ds02({ event, db, step: fakeStep(), fetchImpl: okFetch });
    const after1 = (await invoicesFor(diyClient)).length;
    await ds02({ event, db, step: fakeStep(), fetchImpl: okFetch });
    assert.equal((await invoicesFor(diyClient)).length, after1,
      "a replayed payment.received invoiced the client twice");
  });
});

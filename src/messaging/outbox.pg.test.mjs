// The outbound queue actually draining — for every feature, not just contracts.
//
// THE DEFECT THIS FILE EXISTS FOR. Twenty-six workflows call sendTemplated();
// every one writes a queued `messages` row; and nothing ever drained the queue.
// The dispatcher's own header recorded it: "dispatchDue() runs when something
// calls it, and today nothing does." So every client email this platform had
// ever composed was sitting in a table, invisibly, forever.
//
// These tests drive the REAL path — settings, cap, gate, claim, route, provider
// — against the `memory` provider, which records what it was handed and makes no
// network call. A test that could reach Mailgun is a test that eventually emails
// somebody real.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs.

import { test, before, after, beforeEach, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import {
  settingsFor, setSettings, outboxStatus, drain, drainAll, alertOnFailures, DEFAULTS
} from "./outbox.mjs";
import { emailInvoice, unemailedInvoices, emailOutstandingInvoices, formatAmount } from "../invoices/notify.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const ORG_SLUG = "outbox-test-co";
const CLIENT_EMAIL = "outbox.test.client@example.com";

describe("the outbound queue", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, client, staff;

  const queueOne = async ({ to = CLIENT_EMAIL, ref, status = "queued", scheduledAt = null } = {}) =>
    (await db.query(
      `INSERT INTO messages
         (org_id, client_id, direction, channel, template_key, rendered_body,
          provider_ref, status, compliance_check_passed, to_address, subject, scheduled_at)
       VALUES ($1,$2,'outbound','email','TEST','Hello.',$3,$4,true,$5,'Test',$6)
       RETURNING id`,
      [org, client, ref || `outbox-test:${Math.random()}`, status, to, scheduledAt])).rows[0].id;

  /* INVOICES FIRST. invoices.email_message_id references messages (119), so
     the record of what was emailed outlives a naive message prune — which is
     correct for a financial record and just means the fixture unwinds in
     dependency order. */
  /* Invoices block DELETE by trigger (016's posture, applied to money), and
     invoices.email_message_id references messages (119) — so the fixture unwinds
     in dependency order with the guard off. No application path can do either of
     these, which is the point of both. */
  /* ONE TRANSACTION, ON ONE CONNECTION, ON PURPOSE.
     `ALTER TABLE … DISABLE TRIGGER USER` is table-wide DDL, not a session
     setting. Run on the pool it commits immediately, so for the length of this
     wipe EVERY OTHER CONNECTION sees the invoice no-delete guard switched off —
     including a concurrently running test asserting that the guard holds.
     Inside a transaction the ALTER takes an ACCESS EXCLUSIVE lock and is
     invisible until COMMIT: a concurrent deleter waits and then meets the
     re-enabled trigger. Same effect here, none anywhere else. */
  const wipe = async () => {
    const client = await (await import("../db.mjs")).pool().connect();
    try {
      await client.query("BEGIN");
      await client.query(`ALTER TABLE invoices DISABLE TRIGGER USER`);
      await client.query(`DELETE FROM invoices WHERE org_id = $1`, [org]);
      await client.query(`ALTER TABLE invoices ENABLE TRIGGER USER`);
      // Alert tasks filed by alertOnFailures — org-level, so no client_id.
      await client.query(
        `DELETE FROM tasks WHERE org_id = $1 AND source_workflow = 'message-dispatch-sweeper'`, [org]);
      await client.query(`DELETE FROM messages WHERE org_id = $1`, [org]);
      await client.query("COMMIT");
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch { /* the original error matters */ }
      throw e;
    } finally { client.release(); }
  };

  before(async () => {
    /* Its own company, so pointing the email channel at the memory provider
       cannot overwrite the seeded routing other messaging tests assert against.
       Tests that share global state fail in whichever order the runner picks. */
    org = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1,'Outbox Test Co')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [ORG_SLUG])).rows[0].id;
    /* staff's unique index is on (org_id, lower(email)) — an EXPRESSION index,
       which ON CONFLICT (org_id, email) does not match. Select-then-insert
       instead of guessing at the constraint's shape. */
    const existingStaff = await db.query(
      `SELECT id FROM staff WHERE org_id = $1 AND lower(email) = $2 LIMIT 1`,
      [org, "outbox.test.owner@example.com"]);
    staff = existingStaff.rows[0]
      ? existingStaff.rows[0].id
      : (await db.query(
          `INSERT INTO staff (org_id, name, role, email, status)
           VALUES ($1,'Outbox Owner','owner','outbox.test.owner@example.com','active')
           RETURNING id`, [org])).rows[0].id;
    /* Select-then-insert, so a previous run that died before its teardown does
       not make every later run fail on a duplicate. Same expression-index
       reason as staff above. */
    const existingClient = await db.query(
      `SELECT id FROM clients WHERE org_id = $1 AND lower(email) = $2 LIMIT 1`, [org, CLIENT_EMAIL]);
    client = existingClient.rows[0]
      ? existingClient.rows[0].id
      : (await db.query(
          `INSERT INTO clients (org_id, first_name, last_name, email)
           VALUES ($1,'Outbox','Client',$2) RETURNING id`, [org, CLIENT_EMAIL])).rows[0].id;
    await db.query(
      `INSERT INTO message_channel_routing (org_id, channel, provider, enabled)
       VALUES ($1,'email','memory',true)
       ON CONFLICT (org_id, channel) DO UPDATE SET provider = 'memory', enabled = true`, [org]);
    await db.query(
      `INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
       VALUES ($1,'INVOICE-SENT-EMAIL','email','Your invoice — {{invoice.amount}}',
               'Hi {{contact.first_name}}, {{invoice.kind}} for {{invoice.amount}}, due {{invoice.due}}.',true)
       ON CONFLICT (org_id, template_key) DO UPDATE SET compliance_passed = true`, [org]);
  });

  beforeEach(async () => {
    await wipe();
    await setSettings(db, { orgId: org, staffId: staff, outboundEnabled: true, dailySendCap: 500 });
  });

  after(async () => {
    await wipe();
    await db.query(`DELETE FROM messaging_settings WHERE org_id = $1`, [org]);
    await db.query(`DELETE FROM message_channel_routing WHERE org_id = $1`, [org]);
    await db.query(`DELETE FROM message_templates WHERE org_id = $1`, [org]);
    await db.query(`DELETE FROM clients WHERE org_id = $1`, [org]);
    await db.query(`DELETE FROM staff WHERE org_id = $1`, [org]);
    await db.query(`DELETE FROM orgs WHERE id = $1`, [org]);
    await close();
  });

  // ── the thing that was missing ────────────────────────────────────────────

  describe("drain — the call nothing was making", () => {
    test("A QUEUED MESSAGE ACTUALLY GOES OUT", async () => {
      const id = await queueOne();
      const out = await drain(db, { orgId: org });
      assert.equal(out.ran, true, `drain declined: ${out.reason}`);
      assert.equal(out.sent, 1);
      const row = (await db.query(`SELECT * FROM messages WHERE id = $1`, [id])).rows[0];
      assert.equal(row.status, "sent");
      assert.ok(row.provider_message_id, "no provider recorded a message id");
    });

    test("it drains a whole backlog, bounded by the batch size", async () => {
      for (let i = 0; i < 5; i++) await queueOne({ ref: `outbox-batch-${i}` });
      const out = await drain(db, { orgId: org, limit: 3 });
      assert.equal(out.sent, 3, "the batch bound was not honoured");
      const left = (await db.query(
        `SELECT count(*)::int AS n FROM messages WHERE org_id = $1 AND status = 'queued'`, [org])).rows[0].n;
      assert.equal(left, 2, "the rest must stay queued, not be lost");
    });

    test("a message scheduled for later is left alone", async () => {
      const later = new Date(Date.now() + 3600_000);
      const id = await queueOne({ scheduledAt: later });
      await drain(db, { orgId: org });
      const row = (await db.query(`SELECT status FROM messages WHERE id = $1`, [id])).rows[0];
      assert.equal(row.status, "queued");
    });

    test("draining twice does not send the same message twice", async () => {
      await queueOne({ ref: "outbox-once" });
      await drain(db, { orgId: org });
      const second = await drain(db, { orgId: org });
      assert.equal(second.sent, 0);
      const n = (await db.query(
        `SELECT count(*)::int AS n FROM messages WHERE org_id = $1 AND status = 'sent'`, [org])).rows[0].n;
      assert.equal(n, 1);
    });
  });

  // ── the switch ────────────────────────────────────────────────────────────

  describe("the switch is a row, not an environment variable", () => {
    test("IT DEFAULTS TO ON — a system that looks like it sends must send", async () => {
      assert.equal(DEFAULTS.outbound_enabled, true);
      const fresh = (await db.query(
        `INSERT INTO orgs (slug, name) VALUES ('outbox-fresh-co','Fresh')
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`)).rows[0].id;
      const s = await settingsFor(db, fresh);
      assert.equal(s.outbound_enabled, true);
      await db.query(`DELETE FROM messaging_settings WHERE org_id = $1`, [fresh]);
      await db.query(`DELETE FROM orgs WHERE id = $1`, [fresh]);
    });

    test("a company with no row at all still sends", async () => {
      await db.query(`DELETE FROM messaging_settings WHERE org_id = $1`, [org]);
      const s = await settingsFor(db, org);
      assert.equal(s.outbound_enabled, true);
      assert.equal(s.missing, true);
      const id = await queueOne();
      const out = await drain(db, { orgId: org });
      assert.equal(out.sent, 1, "a company with no settings row silently stopped sending");
      assert.equal((await db.query(`SELECT status FROM messages WHERE id=$1`, [id])).rows[0].status, "sent");
    });

    test("PAUSING REALLY PAUSES, and nothing is lost", async () => {
      const id = await queueOne();
      await setSettings(db, { orgId: org, staffId: staff, outboundEnabled: false });
      const out = await drain(db, { orgId: org });
      assert.equal(out.ran, false);
      assert.equal(out.reason, "paused");
      const row = (await db.query(`SELECT status FROM messages WHERE id = $1`, [id])).rows[0];
      assert.equal(row.status, "queued", "a paused message must stay queued, not fail");

      // …and turning it back on sends it.
      await setSettings(db, { orgId: org, staffId: staff, outboundEnabled: true });
      const again = await drain(db, { orgId: org });
      assert.equal(again.sent, 1);
    });

    test("the switch records who changed it", async () => {
      const saved = await setSettings(db, { orgId: org, staffId: staff, outboundEnabled: false });
      assert.equal(saved.updated_by, staff);
    });

    test("THE DAILY CAP STOPS A RUNAWAY", async () => {
      await setSettings(db, { orgId: org, staffId: staff, dailySendCap: 2 });
      for (let i = 0; i < 4; i++) await queueOne({ ref: `outbox-cap-${i}` });
      const first = await drain(db, { orgId: org });
      assert.equal(first.sent, 2, "the cap did not bound the pass");
      const second = await drain(db, { orgId: org });
      assert.equal(second.ran, false);
      assert.equal(second.reason, "daily_cap_reached");
      const left = (await db.query(
        `SELECT count(*)::int AS n FROM messages WHERE org_id = $1 AND status = 'queued'`, [org])).rows[0].n;
      assert.equal(left, 2, "capped messages must stay queued");
    });

    test("a cap of zero means no ceiling, never 'block everything'", async () => {
      await setSettings(db, { orgId: org, staffId: staff, dailySendCap: 0 });
      await queueOne();
      const out = await drain(db, { orgId: org });
      assert.equal(out.sent, 1, "a cap of 0 silently stopped all mail");
    });
  });

  // ── what an operator sees ─────────────────────────────────────────────────

  describe("outboxStatus — an operator can finally see the queue", () => {
    test("counts what is waiting and says so in plain language", async () => {
      await queueOne(); await queueOne({ ref: "outbox-status-2" });
      const st = await outboxStatus(db, { orgId: org });
      assert.equal(st.counts.queued, 2);
      assert.equal(st.counts.due, 2);
      assert.match(st.summary, /2 messages waiting/);
    });

    test("says so when sending is paused", async () => {
      await queueOne();
      await setSettings(db, { orgId: org, staffId: staff, outboundEnabled: false });
      const st = await outboxStatus(db, { orgId: org });
      assert.match(st.summary, /paused/i);
    });

    test("SAYS SO WHEN THERE IS NO WAY TO SEND AT ALL — the silent failure", async () => {
      await db.query(`UPDATE message_channel_routing SET enabled = false WHERE org_id = $1`, [org]);
      try {
        await queueOne();
        const st = await outboxStatus(db, { orgId: org });
        assert.match(st.summary, /no way to send has been set up/);
      } finally {
        await db.query(`UPDATE message_channel_routing SET enabled = true WHERE org_id = $1`, [org]);
      }
    });

    test("reports being caught up rather than saying nothing", async () => {
      const st = await outboxStatus(db, { orgId: org });
      assert.match(st.summary, /caught up/);
    });
  });

  describe("drainAll — every company, on the schedule", () => {
    test("sweeps this company and reports what it did", async () => {
      await queueOne();
      const out = await drainAll(db, {});
      assert.ok(out.orgs >= 1);
      assert.ok(out.sent >= 1);
    });

    test("a paused company is counted, not skipped silently", async () => {
      await queueOne();
      await setSettings(db, { orgId: org, staffId: staff, outboundEnabled: false });
      const out = await drainAll(db, {});
      assert.ok(out.paused >= 1);
    });
  });

  // ── invoices ──────────────────────────────────────────────────────────────

  describe("invoices reach the client", () => {
    const makeInvoice = async (over = {}) => (await db.query(
      `INSERT INTO invoices (org_id, client_id, source, invoice_type, status, amount_due, due_at)
       VALUES ($1,$2,'diy_letters','deposit',$3,$4,$5) RETURNING *`,
      [org, client, over.status || "sent", over.amount || 997, over.due_at || new Date("2026-09-01")]
    )).rows[0];

    test("AN INVOICE ACTUALLY GETS EMAILED — it never was before", async () => {
      const inv = await makeInvoice();
      assert.equal(inv.emailed_at, null, "a fresh invoice must start un-emailed");

      const out = await emailInvoice(db, { orgId: org, invoiceId: inv.id });
      assert.equal(out.ok, true, `not emailed: ${out.reason}`);

      const msg = (await db.query(`SELECT * FROM messages WHERE id = $1`, [out.messageId])).rows[0];
      assert.equal(msg.to_address, CLIENT_EMAIL);
      assert.equal(msg.status, "sent");
      assert.match(msg.subject, /\$997\.00/);
      assert.match(msg.rendered_body, /Hi Outbox/);
      assert.ok(!msg.rendered_body.includes("{{"), "merge braces reached a client's inbox");

      const after = (await db.query(`SELECT * FROM invoices WHERE id = $1`, [inv.id])).rows[0];
      assert.ok(after.emailed_at, "emailed_at was not stamped");
      assert.equal(after.email_message_id, out.messageId);
    });

    test("money is formatted for a person, never printed raw", () => {
      assert.equal(formatAmount(997), "$997.00");
      assert.equal(formatAmount("1234.5"), "$1,234.50");
      assert.equal(formatAmount(50, "GBP"), "50.00 GBP");
    });

    test("the same invoice is not emailed twice", async () => {
      const inv = await makeInvoice();
      await emailInvoice(db, { orgId: org, invoiceId: inv.id });
      const second = await emailInvoice(db, { orgId: org, invoiceId: inv.id });
      assert.equal(second.ok, false);
      assert.equal(second.reason, "already_emailed");
    });

    test("a voided invoice is never emailed", async () => {
      const inv = await makeInvoice({ status: "void" });
      const out = await emailInvoice(db, { orgId: org, invoiceId: inv.id });
      assert.equal(out.ok, false);
      assert.equal(out.reason, "voided");
    });

    test("a client with no email address is reported, not crashed on", async () => {
      const noMail = (await db.query(
        `INSERT INTO clients (org_id, first_name, last_name) VALUES ($1,'No','Mail') RETURNING id`,
        [org])).rows[0].id;
      const inv = (await db.query(
        `INSERT INTO invoices (org_id, client_id, source, invoice_type, status, amount_due)
         VALUES ($1,$2,'diy_letters','deposit','sent',100) RETURNING id`, [org, noMail])).rows[0];
      const out = await emailInvoice(db, { orgId: org, invoiceId: inv.id });
      assert.equal(out.ok, false);
      assert.equal(out.reason, "no_email");
      // Same delete guard as the shared wipe above — invoices are never deleted
      // by any application path, so the fixture has to lift it explicitly.
      await db.query(`ALTER TABLE invoices DISABLE TRIGGER USER`);
      try { await db.query(`DELETE FROM invoices WHERE client_id = $1`, [noMail]); }
      finally { await db.query(`ALTER TABLE invoices ENABLE TRIGGER USER`); }
      await db.query(`DELETE FROM clients WHERE id = $1`, [noMail]);
    });

    test("THE BACKLOG IS VISIBLE — every invoice nobody was ever told about", async () => {
      await makeInvoice(); await makeInvoice({ amount: 2500 });
      const backlog = await unemailedInvoices(db, { orgId: org });
      assert.equal(backlog.length, 2);

      const out = await emailOutstandingInvoices(db, { orgId: org });
      assert.equal(out.emailed, 2);
      assert.equal((await unemailedInvoices(db, { orgId: org })).length, 0);
    });

    test("a draft invoice is not in the backlog — it was never sent to anybody", async () => {
      await makeInvoice({ status: "draft" });
      assert.equal((await unemailedInvoices(db, { orgId: org })).length, 0);
    });

    test("an invoice email obeys the pause button like everything else", async () => {
      const inv = await makeInvoice();
      await setSettings(db, { orgId: org, staffId: staff, outboundEnabled: false });
      const out = await emailInvoice(db, { orgId: org, invoiceId: inv.id });
      // The row is written and stamped; the delivery is what waits.
      assert.equal(out.ok, true);
      assert.equal(out.delivery.reason, "paused");
      const msg = (await db.query(`SELECT status FROM messages WHERE id = $1`, [out.messageId])).rows[0];
      assert.equal(msg.status, "queued");
    });
  });

  // ── alert_email stops being a field nobody reads ──────────────────────────

  describe("somebody gets told when mail stops going out", () => {
    const fail = (n) => Array.from({ length: n }, (_, i) => ({
      id: `m${i}`, outcome: "rejected", detail: "mailbox does not exist"
    }));

    test("enough failures files a task — not an email", async () => {
      /* Deliberately NOT an email. The alert fires exactly when sending is
         broken, so an emailed alert is the one message guaranteed not to
         arrive. */
      await setSettings(db, { orgId: org, staffId: staff, alertEmail: "boss@example.com" });
      const out = await alertOnFailures(db, {
        orgId: org, settings: await settingsFor(db, org), results: fail(3)
      });
      assert.equal(out.alerted, true, `no alert filed: ${out.reason}`);

      const task = (await db.query(
        `SELECT title, body, assignee_role FROM tasks WHERE id = $1`, [out.taskId])).rows[0];
      assert.match(task.title, /Emails are not going out/);
      assert.equal(task.assignee_role, "owner");
      // The address is carried, so it stops being collected and never read.
      assert.match(task.body, /boss@example\.com/);
    });

    test("one failure is a bad address, not an outage — no alert", async () => {
      const out = await alertOnFailures(db, {
        orgId: org, settings: await settingsFor(db, org), results: fail(1)
      });
      assert.equal(out.alerted, false);
      assert.equal(out.reason, "below_threshold");
    });

    test("one alert per day, however often the sweep runs", async () => {
      const settings = await settingsFor(db, org);
      const first = await alertOnFailures(db, { orgId: org, settings, results: fail(4) });
      const second = await alertOnFailures(db, { orgId: org, settings, results: fail(9) });
      assert.equal(first.alerted, true);
      assert.equal(second.alerted, false, "the sweep runs every five minutes — 288 tasks a day is not an alert");
      assert.equal(second.reason, "already_alerted_today");
    });

    test("tomorrow's outage is its own task, not a silent duplicate", async () => {
      const settings = await settingsFor(db, org);
      await alertOnFailures(db, { orgId: org, settings, results: fail(3), now: "2026-08-02T12:00:00Z" });
      const next = await alertOnFailures(db, { orgId: org, settings, results: fail(3), now: "2026-08-03T12:00:00Z" });
      assert.equal(next.alerted, true);
    });

    test("no alert address set is said plainly rather than left blank", async () => {
      await setSettings(db, { orgId: org, staffId: staff, alertEmail: "" });
      const out = await alertOnFailures(db, {
        orgId: org, settings: await settingsFor(db, org), results: fail(3)
      });
      const task = (await db.query(`SELECT body FROM tasks WHERE id = $1`, [out.taskId])).rows[0];
      assert.match(task.body, /No alert address is set/);
    });

    test("a broken alert never takes the drain down with it", async () => {
      // The mail is the point; the alert is the commentary.
      const broken = { query: async () => { throw new Error("tasks table is on fire"); } };
      const out = await alertOnFailures(broken, { orgId: org, settings: DEFAULTS, results: fail(5) });
      assert.equal(out.alerted, false);
      assert.equal(out.reason, "error");
    });
  });
});

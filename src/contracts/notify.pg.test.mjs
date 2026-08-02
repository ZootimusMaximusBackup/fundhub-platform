// The contract actually going out, and being chased — against real Postgres.
//
// WHAT THIS FILE IS FOR. Before it, the answer to "does it send the contract?"
// was no: every piece of the outbound path existed and nothing called it
// (src/messaging/dispatch.mjs says so in its own header). These tests assert
// that pressing Send now produces a message row addressed to each signer, hands
// it to the dispatcher, and — when a provider is routed — records it as sent.
//
// THE PROVIDER IS THE `memory` ONE, ALWAYS. It records what it was given and
// makes no network call (`transmits: false`). A test that could reach Mailgun is
// a test that eventually emails somebody real.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs.

import { test, before, after, beforeEach, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { createTemplate } from "./templates.mjs";
import { createDraft, send, mintLinks } from "./send.mjs";
import { sign } from "./sign.mjs";
import { listSigners } from "./signers.mjs";
import { verifyContractUrl } from "./signed-link.mjs";
import {
  queueSignerMessages, deliverQueued, notifySigners, outstandingContracts,
  SEND_TEMPLATE_KEY, REMIND_TEMPLATE_KEY
} from "./notify.mjs";
import { runChase } from "../workflows/contract-chaser.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const SECRET = "N".repeat(48);
const CLIENT_EMAIL_LIKE = "contract.notify.test.%@example.com";
const STAFF_EMAIL_LIKE = "contract_notify_test_%@example.com";
const KEY_LIKE = "CTNOTIFY-%";
/* THESE TESTS GET THEIR OWN COMPANY, and that is not tidiness.
   They have to point the org's email channel at the memory provider, and
   message_channel_routing is per-org — so doing that on the default org would
   overwrite the seeded mailgun routing that src/messaging/*.pg.test.mjs assert
   against, and delete it on the way out. Tests that run in parallel and share
   global state fail in whichever order the runner picks, which is the worst kind
   of red. A separate org has neither problem. */
const ORG_SLUG = "ctnotify-test-co";

async function withTriggerDisabled(table, trigger, fn) {
  await db.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
  try { return await fn(); } finally { await db.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`); }
}

describe("contracts — sending and chasing", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, staff, client, n = 0;

  const messagesFor = async (contractId) => (await db.query(
    `SELECT * FROM messages WHERE provider_ref LIKE $1 ORDER BY created_at`,
    [`contract:${contractId}:%`])).rows;

  const purge = async () => {
    const ids = (await db.query(`SELECT id FROM clients WHERE email LIKE $1`, [CLIENT_EMAIL_LIKE]))
      .rows.map((r) => r.id);
    if (ids.length) {
      await db.query(`DELETE FROM messages WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM tasks WHERE client_id = ANY($1)`, [ids]);
      await withTriggerDisabled("contract_signers", "trg_contract_signers_no_delete", () =>
        db.query(`DELETE FROM contract_signers WHERE contract_id IN (SELECT id FROM contracts WHERE client_id = ANY($1))`, [ids]));
      await withTriggerDisabled("contracts", "trg_contracts_no_delete", () =>
        db.query(`DELETE FROM contracts WHERE client_id = ANY($1)`, [ids]));
      await withTriggerDisabled("documents", "trg_documents_no_delete", () =>
        withTriggerDisabled("document_versions", "trg_document_versions_no_delete", async () => {
          await db.query(`UPDATE documents SET current_version_id = NULL WHERE client_id = ANY($1)`, [ids]);
          await db.query(`DELETE FROM document_versions WHERE document_id IN (SELECT id FROM documents WHERE client_id = ANY($1))`, [ids]);
          await db.query(`DELETE FROM documents WHERE client_id = ANY($1)`, [ids]);
        }));
      await db.query(`DELETE FROM events WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
    }
    await db.query(`DELETE FROM messages WHERE provider_ref LIKE 'contract:%'`);
    await db.query(
      `DELETE FROM tasks WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`, [ORG_SLUG]);
    await withTriggerDisabled("contract_templates", "trg_contract_templates_no_delete", () =>
      db.query(`DELETE FROM contract_templates WHERE template_key LIKE $1`, [KEY_LIKE]));
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
  };

  before(async () => {
    await purge();
    org = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1,'Contract Notify Test Co')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [ORG_SLUG])).rows[0].id;
    staff = (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,'Dana Sender','owner','contract_notify_test_owner@example.com','active')
       RETURNING id`, [org])).rows[0].id;
    client = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Marcus','Webb','contract.notify.test.marcus@example.com') RETURNING id`,
      [org])).rows[0].id;

    /* Route email at the MEMORY provider for this org. It records and makes no
       network call, so these tests exercise the whole real path — gate, claim,
       route, provider, outcome — with nothing able to leave the building. */
    await db.query(
      `INSERT INTO message_channel_routing (org_id, channel, provider, enabled)
       VALUES ($1,'email','memory',true)
       ON CONFLICT (org_id, channel) DO UPDATE SET provider = 'memory', enabled = true`,
      [org]);

    /* db/seed/008 seeds the two contract emails against the DEFAULT org. This
       one is its own company, so it needs its own copies — which is also a fair
       test of the real multi-tenant case: a second company's contract emails are
       its own rows, not the first company's. */
    for (const [key, subject, body] of [
      ["CONTRACT-SEND-EMAIL", "Please sign: {{contract.title}}",
       "Hi {{contact.first_name}},\n\n{{contract.sender}} has sent you {{contract.title}}.\n{{contract.link}}"],
      ["CONTRACT-REMIND-EMAIL", "Still waiting on your signature: {{contract.title}}",
       "Hi {{contact.first_name}},\n\nReminder about {{contract.title}}.\n{{contract.link}}"]
    ]) {
      await db.query(
        `INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
         VALUES ($1,$2,'email',$3,$4,true)
         ON CONFLICT (org_id, template_key) DO UPDATE
           SET body = EXCLUDED.body, subject = EXCLUDED.subject, compliance_passed = true`,
        [org, key, subject, body]);
    }
  });

  after(async () => {
    await purge();
    if (org) {
      await db.query(`DELETE FROM message_channel_routing WHERE org_id = $1`, [org]);
      await db.query(`DELETE FROM message_templates WHERE org_id = $1`, [org]);
      await db.query(`DELETE FROM orgs WHERE id = $1`, [org]);
    }
    await close();
  });

  async function sentContract({ signerCount = 1, order = "sequential" } = {}) {
    n += 1;
    const t = await createTemplate(db, {
      orgId: org, staffId: staff, templateKey: `CTNOTIFY-${n}`, name: `Notify ${n}`,
      body: "Agreement for {{contact.full_name}}, dated {{today}}."
    });
    const signers = Array.from({ length: signerCount }, (_, i) => ({
      role_label: i === 0 ? "Client" : `Party ${i + 1}`,
      name: i === 0 ? "Marcus Webb" : `Counterparty ${i}`,
      email: i === 0 ? "contract.notify.test.marcus@example.com" : `party${i}.notify@example.com`,
      client_id: i === 0 ? client : null
    }));
    const draft = await createDraft(db, {
      orgId: org, staffId: staff, clientId: client, templateId: t.id, signers, signingOrder: order
    });
    return send(db, { orgId: org, staffId: staff, id: draft.id, secret: SECRET, baseUrl: "https://fh.test" });
  }

  // ── the thing that was missing ────────────────────────────────────────────

  describe("pressing Send really sends", () => {
    test("A MESSAGE IS QUEUED AND DELIVERED, addressed to the signer", async () => {
      const out = await sentContract();
      const rows = await messagesFor(out.contract.id);

      assert.equal(rows.length, 1, "no message was queued for the signer");
      const m = rows[0];
      assert.equal(m.to_address, "contract.notify.test.marcus@example.com");
      assert.equal(m.channel, "email");
      assert.equal(m.direction, "outbound");
      assert.equal(m.template_key, SEND_TEMPLATE_KEY);
      // The dispatcher ran and the memory provider accepted it.
      assert.equal(m.status, "sent", `expected sent, got ${m.status} (${m.last_error || "no error"})`);
      assert.ok(m.provider_message_id, "the provider recorded no message id");
      assert.equal(out.notified.delivery.sent, 1);
    });

    test("the email carries THAT signer's own link, and the real wording", async () => {
      const out = await sentContract();
      const m = (await messagesFor(out.contract.id))[0];
      assert.match(m.subject, /Please sign/);
      assert.ok(m.rendered_body.includes(out.links[0].url),
        "the signer's link is not in the email that was sent to them");
      assert.match(m.rendered_body, /Hi Marcus,/, "the merge tags did not render");
      assert.ok(!m.rendered_body.includes("{{"), "merge braces reached a client's inbox");
      assert.match(m.rendered_body, /Dana Sender/, "the sender's name did not render");
    });

    test("UNDER A SIGNING ORDER, ONLY THE PERSON WHOSE TURN IT IS IS EMAILED", async () => {
      const out = await sentContract({ signerCount: 2 });
      const rows = await messagesFor(out.contract.id);
      assert.equal(rows.length, 1, "the second signer was emailed before it was their turn");
      assert.equal(rows[0].to_address, "contract.notify.test.marcus@example.com");
      assert.ok(out.notified.skipped.some((s) => s.reason === "not_their_turn_yet"));
    });

    test("under a parallel contract everybody is emailed at once", async () => {
      const out = await sentContract({ signerCount: 2, order: "parallel" });
      const rows = await messagesFor(out.contract.id);
      assert.equal(rows.length, 2);
    });

    test("a signer with no email is skipped and named, not silently dropped", async () => {
      n += 1;
      const t = await createTemplate(db, {
        orgId: org, staffId: staff, templateKey: `CTNOTIFY-NE${n}`, name: "No email", body: "Words." });
      const draft = await createDraft(db, {
        orgId: org, staffId: staff, clientId: client, templateId: t.id,
        signers: [{ role_label: "Client", name: "No Email Person" }]
      });
      const out = await send(db, { orgId: org, staffId: staff, id: draft.id, secret: SECRET });
      assert.equal(out.contract.status, "sent", "the contract must still send");
      assert.ok(out.notified.skipped.some((s) => s.reason === "no_email" && s.name === "No Email Person"));
    });

    test("pressing Send twice does not email the same person twice", async () => {
      const out = await sentContract();
      // A resend is a DELIBERATE second email and carries its own purpose, so
      // this asserts the accidental case: the same purpose cannot duplicate.
      const again = await queueSignerMessages(db, {
        orgId: org, contract: out.contract,
        signers: await listSigners(db, out.contract.id), links: out.links, purpose: "send"
      });
      assert.equal(again.queued.length, 0);
      assert.ok(again.skipped.some((s) => s.reason === "already_queued"));
      assert.equal((await messagesFor(out.contract.id)).length, 1);
    });

    test("a deliberate RESEND does go out again", async () => {
      const out = await sentContract();
      const resent = await send(db, { orgId: org, staffId: staff, id: out.contract.id, secret: SECRET });
      assert.equal(resent.resent, true);
      const rows = await messagesFor(out.contract.id);
      assert.equal(rows.length, 2, "a resend should produce a second email");
      assert.ok(rows[1].provider_ref.includes(":resend1"));
    });

    /* THE PROPERTY THAT MATTERS MOST. A contract that is legally sent must never
       be reported as failed because an email did not go. */
    test("WITH NO EMAIL ROUTE AT ALL, THE CONTRACT STILL SENDS", async () => {
      await db.query(`UPDATE message_channel_routing SET enabled = false WHERE org_id = $1 AND channel = 'email'`, [org]);
      try {
        const out = await sentContract();
        assert.equal(out.contract.status, "sent");
        assert.ok(out.links.length, "the link is the fallback and must still be minted");
        const m = (await messagesFor(out.contract.id))[0];
        // Queued, attempted, and honestly recorded as having nowhere to go.
        assert.notEqual(m.status, "sent");
      } finally {
        await db.query(`UPDATE message_channel_routing SET enabled = true WHERE org_id = $1 AND channel = 'email'`, [org]);
      }
    });

    test("unapproved copy is not sent, and the contract still goes", async () => {
      await db.query(
        `UPDATE message_templates SET compliance_passed = false WHERE org_id = $1 AND template_key = $2`,
        [org, SEND_TEMPLATE_KEY]);
      try {
        const out = await sentContract();
        assert.equal(out.contract.status, "sent");
        assert.equal((await messagesFor(out.contract.id)).length, 0);
        assert.ok(out.notified.skipped.some((s) => s.reason === "template_not_approved"));
      } finally {
        await db.query(
          `UPDATE message_templates SET compliance_passed = true WHERE org_id = $1 AND template_key = $2`,
          [org, SEND_TEMPLATE_KEY]);
      }
    });

    test("a counterparty's email is never filed against the client's record", async () => {
      const out = await sentContract({ signerCount: 2, order: "parallel" });
      const rows = await messagesFor(out.contract.id);
      const theirs = rows.find((r) => r.to_address.startsWith("party1."));
      assert.equal(theirs.client_id, null,
        "a counterparty's correspondence was filed on a consumer's record");
      const clients = rows.find((r) => r.to_address.startsWith("contract.notify"));
      assert.equal(clients.client_id, client);
    });

    test("deliverQueued sends nothing when handed nothing", async () => {
      assert.deepEqual(await deliverQueued(db, []), { sent: 0, blocked: 0, failed: 0, outcomes: [] });
    });
  });

  // ── chasing ───────────────────────────────────────────────────────────────

  describe("chasing the unsigned", () => {
    /* Pretending a contract was sent days ago means moving sent_at, which 117's
       freeze trigger correctly refuses — a sent contract's send time is part of
       what was agreed. The fixture goes around the guard the way only a test
       can; no application path could do this, which is the point of the guard. */
    const backdate = (id, days) =>
      withTriggerDisabled("contracts", "trg_contracts_frozen", () =>
        db.query(
          `UPDATE contracts SET sent_at = now() - ($2 || ' days')::interval WHERE id = $1`,
          [id, String(days)]));

    test("a contract sent today is NOT chased", async () => {
      const out = await sentContract();
      const due = await outstandingContracts(db, { orgId: org });
      assert.equal(due.some((d) => d.contract.id === out.contract.id), false);
    });

    test("A CONTRACT LEFT UNSIGNED IS CHASED, and a task is raised for the sender", async () => {
      const out = await sentContract();
      await backdate(out.contract.id, 5);

      const res = await runChase(db, { orgId: org, baseUrl: "https://fh.test", secret: SECRET });
      assert.ok(res.reminded >= 1, `nothing was reminded: ${JSON.stringify(res)}`);
      assert.ok(res.tasked >= 1, "no task was raised for the staff member");

      const rows = await messagesFor(out.contract.id);
      const chase = rows.find((r) => r.provider_ref.includes(":chase1"));
      assert.ok(chase, "no reminder was queued");
      assert.equal(chase.template_key, REMIND_TEMPLATE_KEY);
      assert.equal(chase.status, "sent");
      assert.match(chase.subject, /Still waiting/);

      const task = (await db.query(
        `SELECT * FROM tasks WHERE client_id = $1 AND source_workflow = 'contract-chaser'
          ORDER BY created_at DESC LIMIT 1`, [client])).rows[0];
      assert.ok(task, "no task row");
      assert.match(task.title, /Contract not signed/);
      assert.equal(task.assignee_staff_id, staff, "the task did not go to whoever sent it");
    });

    test("the reminder carries a RE-MINTED link, never one closer to expiry", async () => {
      const out = await sentContract();
      await backdate(out.contract.id, 5);
      await runChase(db, { orgId: org, baseUrl: "https://fh.test", secret: SECRET });
      const chase = (await messagesFor(out.contract.id)).find((r) => r.provider_ref.includes(":chase1"));
      const url = chase.rendered_body.match(/https:\/\/fh\.test\/contract\.html\?[^\s]+/)[0];

      /* The link is minted fresh, so its 30 days run from the reminder rather
         than from the original send. A reminder carrying a link that is about to
         die is worse than no reminder at all.

         It is NOT asserted to be a DIFFERENT string: the signature is a pure
         function of (contract, signer, expiry), so a reminder produced in the
         same second as the send is legitimately byte-identical. What matters is
         that the expiry did not go backwards and the link still verifies. */
      const fresh = new URL(url).searchParams;
      const original = new URL(out.links[0].url).searchParams;
      assert.ok(Number(fresh.get("exp")) >= Number(original.get("exp")),
        "the reminder's link expires sooner than the one already sent");
      assert.equal(verifyContractUrl({
        contractId: out.contract.id, signerId: fresh.get("s"),
        expiresAt: fresh.get("exp"), sig: fresh.get("sig"), secret: SECRET
      }).valid, true, "the reminder carried a link that does not work");
    });

    test("IT DOES NOT CHASE THE SAME CONTRACT TWICE IN ONE DAY", async () => {
      const out = await sentContract();
      await backdate(out.contract.id, 5);
      await runChase(db, { orgId: org, secret: SECRET });
      const after1 = (await messagesFor(out.contract.id)).length;
      await runChase(db, { orgId: org, secret: SECRET });
      assert.equal((await messagesFor(out.contract.id)).length, after1,
        "a second sweep on the same day sent another reminder");
    });

    test("IT GIVES UP after enough reminders rather than emailing forever", async () => {
      const out = await sentContract();
      await backdate(out.contract.id, 30);
      // Four sweeps, each pretending enough time has passed since the last.
      for (let i = 0; i < 6; i++) {
        await db.query(
          `UPDATE messages SET created_at = created_at - interval '10 days'
            WHERE provider_ref LIKE $1`, [`contract:${out.contract.id}:%chase%`]);
        await runChase(db, { orgId: org, secret: SECRET });
      }
      const chases = (await messagesFor(out.contract.id))
        .filter((r) => r.provider_ref.includes(":chase"));
      assert.ok(chases.length <= 4, `sent ${chases.length} reminders; the cap is 4`);
      assert.ok(chases.length >= 2, "it gave up far too early");
    });

    test("a SIGNED contract is never chased", async () => {
      const out = await sentContract();
      const [s1] = await listSigners(db, out.contract.id);
      await sign(db, { contractId: out.contract.id, signerId: s1.id, signerName: "Marcus Webb", agreed: true });
      await backdate(out.contract.id, 30);
      const due = await outstandingContracts(db, { orgId: org });
      assert.equal(due.some((d) => d.contract.id === out.contract.id), false);
    });

    test("under a signing order, the reminder goes to whoever is holding it up", async () => {
      const out = await sentContract({ signerCount: 2 });
      const [s1] = await listSigners(db, out.contract.id);
      await sign(db, { contractId: out.contract.id, signerId: s1.id, signerName: "Marcus Webb", agreed: true });
      await backdate(out.contract.id, 5);

      await runChase(db, { orgId: org, secret: SECRET });
      const chase = (await messagesFor(out.contract.id)).find((r) => r.provider_ref.includes(":chase1"));
      assert.ok(chase, "nobody was chased");
      assert.equal(chase.to_address, "party1.notify@example.com",
        "the reminder went to the person who had already signed");
    });

    test("another company's contracts are never touched by this org's sweep", async () => {
      const out = await sentContract();
      await backdate(out.contract.id, 5);
      const other = (await db.query(
        `INSERT INTO orgs (slug, name) VALUES ('ctnotify-other','Other')
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`)).rows[0].id;
      const res = await runChase(db, { orgId: other, secret: SECRET });
      assert.equal(res.considered, 0);
      assert.equal((await messagesFor(out.contract.id)).some
        ? (await messagesFor(out.contract.id)).filter((r) => r.provider_ref.includes("chase")).length : 0, 0);
    });
  });
});

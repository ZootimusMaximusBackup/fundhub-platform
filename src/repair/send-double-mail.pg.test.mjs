// COMPLIANCE REVIEW REQUIRED — dispute logic and fee timing.
//
// Postgres-backed proof that posting the same send payload twice produces
// EXACTLY ONE mailing and ONE letter row.
//
// WHY THIS CANNOT BE A UNIT TEST. The whole claim is about what the database
// adjudicates. src/repair/send.test.mjs drives a fake db that answers every
// query with no rows, so it can prove the loop calls a mailer and nothing more.
// Only a real Postgres can show that the second POST is refused by
// dispute_letters itself — by the conditional claim, and by
// uq_dispute_letters_one_mailing (db/migrations/332).
//
// WHAT WAS BROKEN. src/repair/send.mjs set status='sent' with no check of the
// current status, and dispute_letters had no unique index. A retry, a second
// browser tab, or curl mailed the letter again: two envelopes to the consumer,
// two to the bureau, and two PostGrid bills. The only thing in the way was a
// disabled button.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs (CLAUDE.md §12).

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { sendRepairLetters } from "./send.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const CLIENT_EMAIL_LIKE = "doublemail.pg.test.%@example.com";
const STAFF_EMAIL_LIKE = "doublemail_pg_test_%@example.com";

const FROM = {
  first_name: "Pat",
  last_name: "Client",
  address_line1: "12 Oak St",
  address_city: "Dallas",
  address_state: "TX",
  address_zip: "75201"
};

describe("repair send — one press, one mailing", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, client, staffId, caseId;

  async function purge() {
    const ids = (await db.query(`SELECT id FROM clients WHERE email LIKE $1`, [CLIENT_EMAIL_LIKE]))
      .rows.map((r) => r.id);
    if (ids.length) {
      // A successful send fires repair.letters.sent, and the handler behind it
      // writes rows that hold a plain (non-cascading) reference to the client.
      // They have to go first or the client delete is refused. dispute_cases,
      // dispute_letters and dispute_items all cascade and need no help.
      for (const t of ["messages", "events", "cards", "tasks"]) {
        await db.query(`DELETE FROM ${t} WHERE client_id = ANY($1)`, [ids]).catch(() => {});
      }
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
    }
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
  }

  const mkLetter = async ({ bureau = "EX", round = "R1", target = "bureau" } = {}) => (await db.query(
    `INSERT INTO dispute_letters (case_id, org_id, client_id, bureau, round, status, body_text, target)
     VALUES ($1,$2,$3,$4,$5,'ready','Dear sir or madam,',$6) RETURNING *`,
    [caseId, org, client, bureau, round, target]
  )).rows[0];

  const letterRow = async (id) => (await db.query(
    `SELECT * FROM dispute_letters WHERE id = $1`, [id]
  )).rows[0];

  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();
    staffId = (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,'Doublemail Pgtest Closer','closer',$2,'active') RETURNING id`,
      [org, "doublemail_pg_test_closer@example.com"]
    )).rows[0].id;
    client = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Doublemail','Subject',$2) RETURNING id`,
      [org, "doublemail.pg.test.subject@example.com"]
    )).rows[0].id;
    caseId = (await db.query(
      `INSERT INTO dispute_cases (org_id, client_id, bureau, round)
       VALUES ($1,$2,'EX','R1') RETURNING id`,
      [org, client]
    )).rows[0].id;
  });

  after(async () => {
    await purge();
    await close();
  });

  test("the same payload posted twice mails once and leaves one letter row", async () => {
    const letter = await mkLetter({ bureau: "EX" });
    const mailed = [];
    const payload = {
      orgId: org,
      clientId: client,
      staffId,
      mail: true,
      from: FROM,
      letters: [{ bureau: "EX", letterId: letter.id, html: "<html>round one</html>", caseId }],
      mailSender: async (l) => {
        mailed.push(l.letterId);
        return { ok: true, providerId: `ltr_${mailed.length}`, outcome: "sent" };
      }
    };

    const first = await sendRepairLetters(db, payload);
    const second = await sendRepairLetters(db, payload);

    assert.equal(first.ok, true, "the first press mails");
    assert.equal(mailed.length, 1, "the mailer was called exactly once across both presses");
    assert.equal(second.ok, false, "the second press mails nothing");
    assert.equal(second.results[0].error, "already_mailed");

    const rows = (await db.query(
      `SELECT id, status, postgrid_letter_id, mailed_at FROM dispute_letters
        WHERE client_id = $1 AND bureau = 'EX' AND round = 'R1'`,
      [client]
    )).rows;
    assert.equal(rows.length, 1, "exactly one letter row");
    assert.equal(rows[0].status, "sent");
    assert.equal(rows[0].postgrid_letter_id, "ltr_1", "the provider id is the FIRST send's, not a second one");
    assert.ok(rows[0].mailed_at, "the claim stamped mailed_at");
  });

  test("a duplicate letter row for the same case, bureau, round and target cannot also be mailed", async () => {
    const a = await mkLetter({ bureau: "TU", round: "R2" });
    const b = await mkLetter({ bureau: "TU", round: "R2" }); // a regenerate
    const mailed = [];
    const send = (letterId) => sendRepairLetters(db, {
      orgId: org, clientId: client, staffId, mail: true, from: FROM,
      letters: [{ bureau: "TU", letterId, html: "<html>round two</html>", caseId }],
      mailSender: async (l) => {
        mailed.push(l.letterId);
        return { ok: true, providerId: `dup_${mailed.length}`, outcome: "sent" };
      }
    });

    const first = await send(a.id);
    const second = await send(b.id);

    assert.equal(first.ok, true);
    assert.equal(second.ok, false, "the duplicate row must not produce a second envelope");
    assert.equal(second.results[0].error, "already_mailed_duplicate_letter");
    assert.equal(mailed.length, 1, "the mailer was called once, for one physical letter");

    assert.equal((await letterRow(a.id)).status, "sent");
    const loser = await letterRow(b.id);
    assert.equal(loser.mailed_at, null, "the refused row keeps NULL — it was never mailed");
    assert.notEqual(loser.status, "sent");
  });

  test("a refusal that happened before transmission gives the letter back", async () => {
    const letter = await mkLetter({ bureau: "EQ", round: "R1" });
    const attempt = (sender) => sendRepairLetters(db, {
      orgId: org, clientId: client, staffId, mail: true, from: FROM,
      letters: [{ bureau: "EQ", letterId: letter.id, html: "<html>x</html>", caseId }],
      mailSender: sender
    });

    const refused = await attempt(async () => ({ ok: false, error: "POSTGRID_API_KEY unset — letter not sent" }));
    assert.equal(refused.ok, false);
    const afterRefusal = await letterRow(letter.id);
    assert.equal(afterRefusal.mailed_at, null, "nothing was transmitted, so the claim is released");
    assert.equal(afterRefusal.status, "ready", "and the letter is back in the state it started in");

    // Now it can genuinely be sent.
    let calls = 0;
    const ok = await attempt(async () => { calls += 1; return { ok: true, providerId: "ltr_eq", outcome: "sent" }; });
    assert.equal(ok.ok, true);
    assert.equal(calls, 1);
    assert.equal((await letterRow(letter.id)).status, "sent");
  });

  test("a call that may have transmitted KEEPS the claim and is never auto-retried", async () => {
    const letter = await mkLetter({ bureau: "EX", round: "R3" });
    const attempt = (sender) => sendRepairLetters(db, {
      orgId: org, clientId: client, staffId, mail: true, from: FROM,
      letters: [{ bureau: "EX", letterId: letter.id, html: "<html>x</html>", caseId }],
      mailSender: sender
    });

    // An HTTP error from the provider. We do not know whether the letter went.
    const failed = await attempt(async () => ({ ok: false, error: "postgrid_http_502" }));
    assert.equal(failed.ok, false);
    const stuck = await letterRow(letter.id);
    assert.equal(stuck.status, "sending", "the row stays claimed for a human to reconcile");
    assert.ok(stuck.mailed_at);

    let calls = 0;
    const retry = await attempt(async () => { calls += 1; return { ok: true, providerId: "ltr_retry", outcome: "sent" }; });
    assert.equal(calls, 0, "a retry must not call the provider on a claim we cannot account for");
    assert.equal(retry.results[0].error, "already_mailed");
  });

  test("mail_cost_cents starts NULL and NULL means unknown, not free", async () => {
    const letter = await mkLetter({ bureau: "EQ", round: "R2" });
    assert.equal(letter.mail_cost_cents, null);
    await assert.rejects(
      () => db.query(`UPDATE dispute_letters SET mail_cost_cents = -1 WHERE id = $1`, [letter.id]),
      /dispute_letters_mail_cost_ck/
    );
  });
});

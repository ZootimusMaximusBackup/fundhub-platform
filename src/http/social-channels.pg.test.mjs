// The Social Studio reads, executed for real: GET /api/social/channels and
// GET /api/social/settings.
//
// THIS FILE LIVES UNDER src/http/, NOT NEXT TO THE HANDLERS. package.json's test
// glob is "src/**/*.test.mjs" and "scripts/**/*.test.mjs"; a test placed in api/
// is never collected and passes forever by never running.
//
// WHY IT EXISTS. Both endpoints are thin — a query and some wiring — and "thin"
// is not "correct". social_channels had no read at all until now, so nothing has
// ever checked that these column names are the ones the table has. A mistyped
// column parses fine and fails only when a partner opens the screen.
//
// Two assertions carry the most weight:
//
//   ISOLATION — every query is run twice, once as the partner that owns the rows
//   and once as a partner that owns none. The second must come back empty. That
//   is the row-level policy being exercised through the query the product ships.
//
//   NO TOKEN — the channels read must not carry token ciphertext in any form,
//   before or after redaction. The fixture stores a recognisable string and the
//   whole response is searched for it.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { asStaff, asPartner } from "../partners/rls.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const SLUG = "social-ch-test-";
// A string no real ciphertext would contain, so a leak is unmistakable.
const FAKE_CIPHERTEXT = "v1:SOCIALCHANNELSUPERSECRET:aaa:bbb";

describe("social studio reads", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, owner, stranger;

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    await cleanup();
    owner = await seed("owner");
    // The stranger is a real, active partner that owns NOTHING. Seeding it with
    // its own channels would make every isolation assertion vacuous.
    stranger = await barePartner("stranger");
  });
  after(async () => { await cleanup(); await close(); });

  // ------------------------------------------------------- /api/social/channels

  test("the channels SQL runs and returns this partner's accounts", async () => {
    const { fetchRows } = await import("../../api/social/channels.mjs");
    const rows = await asPartner(owner, (tx) =>
      fetchRows(tx, { limit: 50, offset: 0, query: {}, partnerId: owner }));
    assert.ok(Array.isArray(rows), "channels should return rows");
    assert.strictEqual(rows.length, 2, "the fixture seeds two channels");
  });

  test("channels return nothing for a partner who owns none of them", async () => {
    const { fetchRows } = await import("../../api/social/channels.mjs");
    const rows = await asPartner(stranger, (tx) =>
      fetchRows(tx, { limit: 50, offset: 0, query: {}, partnerId: stranger }));
    assert.deepStrictEqual(rows, [], "channels leaked rows across partners");
  });

  test("channels never carry token ciphertext, before or after redaction", async () => {
    /* THE ENDPOINT'S OWN MAPPER, not a redactor this test picked for itself. The
       screen never sees the raw rows — it sees mapRow(row) — so every assertion
       about what the owner is told has to be made against that. Asserting the
       presence booleans on the RAW row is trivially true (the SQL computes them
       right there) and cannot fail however broken the mapper is. */
    const { fetchRows, mapRow } = await import("../../api/social/channels.mjs");
    const rows = await asPartner(owner, (tx) =>
      fetchRows(tx, { limit: 50, offset: 0, query: {}, partnerId: owner }));
    const shipped = rows.map(mapRow);

    const both = JSON.stringify(rows) + JSON.stringify(shipped);
    assert.ok(!both.includes("SOCIALCHANNELSUPERSECRET"),
      "token ciphertext reached the response");
    for (const r of [...rows, ...shipped]) {
      assert.strictEqual(r.encrypted_access_token, undefined);
      assert.strictEqual(r.encrypted_refresh_token, undefined);
      assert.strictEqual(typeof r.has_access_token, "boolean");
      assert.strictEqual(typeof r.has_refresh_token, "boolean");
    }

    /* The account card reads has_access_token to decide whether it says the
       account is signed in or has no sign-in key. A false here is a working
       account reported as broken, and somebody re-connecting accounts that were
       fine. */
    const active = shipped.find((r) => r.connection_state === "active");
    assert.ok(active, "the fixture seeds one active channel");
    assert.strictEqual(active.has_access_token, true,
      "an active channel has a stored key and the shipped row must say so");
    assert.strictEqual(active.has_refresh_token, true,
      "the fixture stores a refresh key too, and the shipped row must say so");

    // The other direction, so a mapper that hard-coded true would not pass
    // either: the pending channel really was seeded with neither key.
    const pending = shipped.find((r) => r.connection_state === "pending");
    assert.ok(pending, "the fixture seeds one pending channel");
    assert.strictEqual(pending.has_access_token, false);
    assert.strictEqual(pending.has_refresh_token, false);
  });

  test("every field the account card walks is the shape it expects", async () => {
    // public/app/social-studio.html calls c.scopes.length and c.scopes.map with
    // no guard, and walks Object.keys(c.best_times). A null in either would stop
    // the whole grid rendering, not just one card.
    const { fetchRows } = await import("../../api/social/channels.mjs");
    const rows = await asPartner(owner, (tx) =>
      fetchRows(tx, { limit: 50, offset: 0, query: {}, partnerId: owner }));
    for (const r of rows) {
      assert.ok(Array.isArray(r.scopes), "scopes must always be an array");
      assert.ok(r.best_times && typeof r.best_times === "object",
        "best_times must always be an object");
      assert.strictEqual(typeof r.timezone, "string");
      assert.strictEqual(typeof r.channel, "string");
      assert.strictEqual(typeof r.external_account_id, "string");
      assert.strictEqual(typeof r.can_post, "boolean");
    }
  });

  test("?state filters, and an unknown state is refused rather than ignored", async () => {
    const { fetchRows } = await import("../../api/social/channels.mjs");
    const active = await asPartner(owner, (tx) =>
      fetchRows(tx, { limit: 50, offset: 0, query: { state: "active" }, partnerId: owner }));
    assert.strictEqual(active.length, 1);
    assert.strictEqual(active[0].connection_state, "active");

    await assert.rejects(
      () => asPartner(owner, (tx) =>
        fetchRows(tx, { limit: 50, offset: 0, query: { state: "nonsense" }, partnerId: owner })),
      /unknown state/,
      "a typo in the filter must not silently show the unfiltered list");
  });

  // ------------------------------------------------------- /api/social/settings

  test("settings say when nothing has been saved, and still give the safe answer", async () => {
    const { readSettings } = await import("../../api/social/settings.mjs");
    const bare = await barePartnerWithoutSettings("nosettings");
    const s = await asPartner(bare, (tx) => readSettings(tx, bare));
    assert.strictEqual(s.stored, false, "no row means nothing has been saved");
    assert.strictEqual(s.approve_before_launch, true,
      "with nothing saved the answer must match what the sender falls back to");
  });

  test("settings read the saved approval switch", async () => {
    const { readSettings } = await import("../../api/social/settings.mjs");
    const on = await asPartner(owner, (tx) => readSettings(tx, owner));
    assert.strictEqual(on.stored, true);
    assert.strictEqual(on.approve_before_launch, true);
    assert.strictEqual(typeof on.weekly_asset_target, "number");

    await asStaff((tx) => tx.query(
      `UPDATE partner_module_settings SET approve_before_launch = false WHERE partner_id = $1`,
      [owner]));
    const off = await asPartner(owner, (tx) => readSettings(tx, owner));
    assert.strictEqual(off.stored, true);
    assert.strictEqual(off.approve_before_launch, false,
      "a saved false must survive the read — the screen tells the owner about it");

    await asStaff((tx) => tx.query(
      `UPDATE partner_module_settings SET approve_before_launch = true WHERE partner_id = $1`,
      [owner]));
  });

  test("one partner cannot read another partner's settings", async () => {
    const { readSettings } = await import("../../api/social/settings.mjs");
    const seen = await asPartner(stranger, (tx) => readSettings(tx, owner));
    assert.strictEqual(seen.stored, false,
      "the policy must hide the row, so it reads as nothing saved");
  });

  test("the approval switch writes and reads back", async () => {
    const { writeApproval, readSettings } = await import("../../api/social/settings.mjs");
    const target = await barePartnerWithoutSettings("writeback");
    await asStaff((tx) => writeApproval(tx, { orgId: org, partnerId: target, approve: false }));
    const s = await asStaff((tx) => readSettings(tx, target));
    assert.strictEqual(s.stored, true);
    assert.strictEqual(s.approve_before_launch, false);

    // The upsert must leave every other column on the row alone.
    await asStaff((tx) => writeApproval(tx, { orgId: org, partnerId: target, approve: true }));
    const back = await asStaff((tx) => readSettings(tx, target));
    assert.strictEqual(back.approve_before_launch, true);
    assert.strictEqual(back.marketing_suite_enabled, false,
      "the approval write must not touch the marketing suite switch");
  });

  // ------------------------------------------------------------------ fixture

  async function newPartner(name) {
    const { rows } = await db.query(
      `INSERT INTO partners (org_id, name, slug, status, agreement_signed_at)
       VALUES ($1,$2,$3,'active',now()) RETURNING id`, [org, name, `${SLUG}${name}`]);
    return rows[0].id;
  }

  async function barePartner(name) {
    const partnerId = await newPartner(name);
    await asStaff((tx) => tx.query(
      `INSERT INTO partner_module_settings (org_id, partner_id) VALUES ($1,$2)`, [org, partnerId]));
    return partnerId;
  }

  async function barePartnerWithoutSettings(name) {
    return newPartner(name);
  }

  async function seed(name) {
    const partnerId = await barePartner(name);
    await asStaff(async (tx) => {
      await tx.query(
        `INSERT INTO social_channels
           (org_id, partner_id, channel, external_account_id, handle, connection_state,
            encrypted_access_token, encrypted_refresh_token, scopes, best_times, timezone)
         VALUES ($1,$2,'facebook','fb-page-1','@fixture','active',$3,$4,
                 '["pages_manage_posts"]'::jsonb, '{"mon":["09:00"]}'::jsonb, 'UTC')`,
        [org, partnerId, FAKE_CIPHERTEXT, FAKE_CIPHERTEXT]);
      await tx.query(
        `INSERT INTO social_channels
           (org_id, partner_id, channel, external_account_id, connection_state, last_error)
         VALUES ($1,$2,'linkedin','li-org-1','pending','the sign-in never finished')`,
        [org, partnerId]);
    });
    return partnerId;
  }

  /* The fixture rows only. social_channels and partner_module_settings carry the
     partner policy, so the tidy-up runs in a staff scope — a bare db.query()
     matches no rows when the suite connects as the unprivileged app role, and the
     partner delete then trips its foreign key. */
  async function cleanup() {
    const ids = (await db.query(
      `SELECT id FROM partners WHERE slug LIKE $1`, [`${SLUG}%`])).rows.map((r) => r.id);
    if (!ids.length) return;
    await asStaff(async (tx) => {
      await tx.query(`DELETE FROM social_channels WHERE partner_id = ANY($1)`, [ids]);
      await tx.query(`DELETE FROM partner_module_settings WHERE partner_id = ANY($1)`, [ids]);
    });
    await db.query(`DELETE FROM partners WHERE id = ANY($1)`, [ids]);
  }
});

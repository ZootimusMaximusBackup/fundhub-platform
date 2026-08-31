// GET /api/adintel/board — the Winner's Board endpoint, driven for real.
//
// Skipped without DATABASE_URL.
//
// THIS FILE LIVES UNDER src/ ON PURPOSE. `npm test`'s glob is `src/**` and
// `scripts/**` only, so a test placed next to the handler under `api/` never
// runs and reports nothing while looking green (CLAUDE.md §12).
//
// WHAT IT COVERS THAT THE MODULE TESTS DO NOT:
//
//   - the auth gate. requirePrincipal(["partner","staff"]) — a client or
//     affiliate session must be refused, and a staff session with no
//     ?partner_id= must be refused too, because "everything" is a different
//     endpoint from "this partner's view".
//   - the empty state. On a fresh install no week has been rolled up, and the
//     response has to SAY that rather than render an empty board that reads as
//     "no competitor is running anything".
//   - the stated limitation, in the body of every response.
//   - every view's SQL, executed.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import handler, { VIEWS } from "../../api/adintel/board.mjs";
import { computeWeek } from "../creative-intel/weekly.mjs";
import { pullAll } from "../creative-intel/ingest.mjs";
import { pendingCreatives } from "../creative-intel/classify.mjs";
import { TAXONOMY_VERSION } from "../creative-intel/taxonomy.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const SLUG = "adintel-ep";
const EMAIL = `${SLUG}+partner@fundhub.ai`;
const WEEKS = ["2026-W31", "2026-W32", "2026-W33", "2026-W34", "2026-W35"];
const LIVE_WEEK = "2026-W35";

const res = () => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

async function call(query, token) {
  const r = res();
  await handler({ method: "GET", query, headers: { authorization: `Bearer ${token}` } }, r, { db });
  return r;
}

describe("GET /api/adintel/board", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let org, partnerId, partnerToken, staffToken, clientToken, clientAccountId;

  before(async () => {
    org = await resolveDefaultOrg(db);
    await cleanup();

    // A staff session first: 044_accounts.sql makes a partner account
    // invite-only, so invited_by has to name a real staff row.
    const { createSession } = await import("../auth/session.mjs");
    const s = await db.query(
      `SELECT id, org_id FROM staff WHERE org_id = $1 AND status = 'active'
        ORDER BY created_at LIMIT 1`, [org]);
    if (!s.rows[0]) throw new Error("no active staff — run scripts/seed-staff.mjs");
    const staffId = s.rows[0].id;
    staffToken = (await createSession(db, { staffId, orgId: org })).token;

    partnerId = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status, agreement_signed_at)
       VALUES ($1,$2,$3,'active',now())
       ON CONFLICT (org_id, slug) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [org, "Adintel EP Partner", `${SLUG}-partner`])).rows[0].id;

    const { createAccount, createAccountSession } = await import("../auth/account-session.mjs");
    const existing = await db.query(`SELECT id FROM accounts WHERE email = $1`, [EMAIL]);
    const accountId = existing.rows[0]
      ? existing.rows[0].id
      : (await createAccount(db, {
          orgId: org, kind: "partner", email: EMAIL, name: "Adintel EP",
          password: `Adintel-${SLUG}-passw0rd!`, partnerId, invitedBy: staffId
        })).id;
    partnerToken = (await createAccountSession(db, { accountId, orgId: org })).token;

    // A CLIENT session, to prove the gate refuses a kind the endpoint did not
    // name. This is the failure the gate exists for.
    const clientId = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Adintel','Client',$2) RETURNING id`,
      [org, `${SLUG}+client@fundhub.ai`])).rows[0].id;
    const clientAccount = await createAccount(db, {
      orgId: org, kind: "client", email: `${SLUG}+client@fundhub.ai`, name: "Adintel Client",
      password: `Adintel-${SLUG}-client0rd!`, clientId, invitedBy: staffId
    });
    clientAccountId = clientAccount.id;
    clientToken = (await createAccountSession(db, { accountId: clientAccount.id, orgId: org })).token;
  });

  after(async () => { await cleanup(); await close(); });

  describe("before anything has been rolled up", () => {
    test("answers with an explicit empty state, not an empty board", async () => {
      // An empty grid with no explanation reads as "no competitor is running
      // anything", which is false and is the worst thing a paid board can say.
      const r = await call({}, partnerToken);
      assert.equal(r.code, 200);
      assert.equal(r.body.ok, true);
      assert.equal(r.body.week, null);
      assert.deepEqual(r.body.items, []);
      assert.equal(r.body.meta.reason, "no_weeks_rolled_up");
      assert.match(r.body.meta.message, /No week has been rolled up/i);
    });

    test("the stated limitation travels even in the empty state", async () => {
      const r = await call({}, partnerToken);
      assert.match(r.body.notes.rankBasis, /how long ads run/);
      assert.match(r.body.notes.spend, /No competitor spend/);
    });
  });

  describe("the auth gate", () => {
    test("no session at all is 401", async () => {
      const r = res();
      await handler({ method: "GET", query: {}, headers: {} }, r, { db });
      assert.equal(r.code, 401);
    });

    test("a client session is 403 — the gate refuses a kind it did not name", async () => {
      const r = await call({}, clientToken);
      assert.equal(r.code, 403);
      assert.equal(r.body.ok, false);
    });

    test("a staff session with no partner_id is 400, not 'everything'", async () => {
      // Answering with the union would make the same endpoint mean two
      // different things depending on who called it.
      const r = await call({}, staffToken);
      assert.equal(r.code, 400);
      assert.equal(r.body.error, "partner_id_required");
    });

    test("a POST is refused — this is a read endpoint", async () => {
      const r = res();
      await handler({ method: "POST", query: {}, headers: { authorization: `Bearer ${partnerToken}` } }, r, { db });
      assert.equal(r.code, 405);
    });
  });

  describe("with a rolled-up board", () => {
    before(async () => {
      const { asStaff } = await import("../partners/rls.mjs");
      await asStaff(async (tx) => {
        await pullAll(tx, { orgId: org, vendorKey: "fixture" });
        const pending = await pendingCreatives(tx, org, { limit: 500 });
        for (const c of pending) {
          await tx.query(
            `INSERT INTO ad_creative_classification
               (org_id, content_hash, taxonomy_version, angle, ad_format, promise_shape,
                compliance_risk, funnel, hook_line, model, screen_state)
             VALUES ($1,$2,$3,'speed_of_money','talking_head_ugc','specific_dollar',
                     $4,'call_booking',$5,'test-fixture','passed')
             ON CONFLICT DO NOTHING`,
            [org, c.content_hash, TAXONOMY_VERSION,
             /guaranteed approval/i.test(c.body_text || "") ? "implies_guaranteed_approval" : "clean",
             (c.body_text || "").slice(0, 80)]);
        }
        for (const week of WEEKS) await computeWeek(tx, { orgId: org, week });
      });
    });

    test("every view answers 200 and returns an array", async () => {
      for (const view of VIEWS) {
        const r = await call({ view, week: LIVE_WEEK }, partnerToken);
        assert.equal(r.code, 200, `${view} did not answer 200`);
        assert.equal(r.body.view, view);
        assert.ok(Array.isArray(r.body.items), `${view} did not return items`);
      }
    });

    test("the default view is the movers list and it is ranked", async () => {
      const r = await call({ week: LIVE_WEEK }, partnerToken);
      assert.equal(r.body.view, "movers");
      assert.ok(r.body.items.length > 0, "the board is empty for the partner who bought it");
      assert.ok(r.body.items.every((i) => i.winner_score_rank));
    });

    test("no response body anywhere contains the raw Winner Score", async () => {
      // The one regression that would hand the moat away. Asserted on the
      // SERIALISED body, because that is what actually reaches a browser.
      for (const view of VIEWS) {
        const r = await call({ view, week: LIVE_WEEK }, partnerToken);
        const body = JSON.stringify(r.body);
        assert.ok(!/"winner_score":/.test(body), `${view} leaked the raw score`);
        assert.ok(!/"weights_version":/.test(body), `${view} leaked the weights version`);
        assert.ok(!/"cost_cents":/.test(body), `${view} leaked FundHub's model bill`);
        assert.ok(!/"vendor_run_id":/.test(body), `${view} leaked the vendor run id`);
      }
    });

    test("a staff session reading with ?partner_id= sees the same board", async () => {
      const mine = await call({ week: LIVE_WEEK }, partnerToken);
      const theirs = await call({ week: LIVE_WEEK, partner_id: partnerId }, staffToken);
      assert.equal(theirs.code, 200);
      assert.deepEqual(
        theirs.body.items.map((i) => i.content_hash),
        mine.body.items.map((i) => i.content_hash));
    });

    test("a nonsense week is ignored rather than showing a different week's data", async () => {
      // Silently showing another week would be worse than any error: the
      // heading would say one thing and the rows would be another.
      const r = await call({ week: "banana" }, partnerToken);
      assert.equal(r.code, 200);
      assert.equal(r.body.week, WEEKS[WEEKS.length - 1]);
    });

    test("an unknown view falls back to movers rather than erroring", async () => {
      const r = await call({ view: "spend", week: LIVE_WEEK }, partnerToken);
      assert.equal(r.body.view, "movers");
    });

    test("cosmetic filters narrow, and a stray value does not blank the board", async () => {
      const all = await call({ week: LIVE_WEEK }, partnerToken);
      const filtered = await call({ week: LIVE_WEEK, band: "hot" }, partnerToken);
      assert.ok(filtered.body.items.every((i) => i.winner_score_band === "hot"));
      const stray = await call({ week: LIVE_WEEK, angle: "not_an_angle" }, partnerToken);
      assert.equal(stray.body.count, all.body.count);
    });

    test("paging reports hasMore rather than making a screen guess", async () => {
      const r = await call({ week: LIVE_WEEK, limit: 2 }, partnerToken);
      assert.equal(r.body.count, 2);
      assert.equal(r.body.hasMore, true);
    });

    test("the saturation view carries the angle totals the territory work reads", async () => {
      const r = await call({ view: "saturation", week: LIVE_WEEK }, partnerToken);
      assert.ok(Array.isArray(r.body.meta.angles));
      assert.ok(r.body.meta.angles.length >= 10, "every taxonomy angle must appear");
      assert.ok(r.body.meta.totals.totalCells > 0);
    });

    test("every row carries a do-not-copy decision, never an absent one", async () => {
      // An undefined badge renders as "safe" in every templating language there
      // is, so the field must always be present and boolean.
      const r = await call({ week: LIVE_WEEK }, partnerToken);
      assert.ok(r.body.items.every((i) => typeof i.do_not_copy === "boolean"));
    });
  });

  async function cleanup() {
    if (!org) return;
    await db.query(`ALTER TABLE ad_library_records DISABLE TRIGGER trg_ad_library_records_no_delete`);
    try {
      await db.query(`DELETE FROM ad_creative_signals WHERE org_id = $1`, [org]);
      await db.query(`DELETE FROM ad_creative_classification WHERE org_id = $1`, [org]);
      await db.query(`DELETE FROM ad_creatives_seen WHERE org_id = $1`, [org]);
      await db.query(`DELETE FROM ad_library_records WHERE org_id = $1`, [org]);
    } finally {
      await db.query(`ALTER TABLE ad_library_records ENABLE TRIGGER trg_ad_library_records_no_delete`);
    }
    await db.query(`DELETE FROM account_sessions WHERE account_id IN
                      (SELECT id FROM accounts WHERE email LIKE $1)`, [`${SLUG}%`]);
    await db.query(`DELETE FROM accounts WHERE email LIKE $1`, [`${SLUG}%`]);
    await db.query(`DELETE FROM clients WHERE email LIKE $1`, [`${SLUG}%`]);
  }
});

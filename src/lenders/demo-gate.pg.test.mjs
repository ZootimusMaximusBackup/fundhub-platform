/* Demo Mode gate on the lender surfaces, against a real Postgres.
 *
 * The property under test is NOT "zero lenders when Demo Mode is off" — a real
 * org has real lenders and should keep seeing them. It is:
 *
 *   Demo Mode OFF → the result contains no demo row, and is exactly the result
 *                   you would get if the demo rows did not exist at all.
 *   Demo Mode ON  → the result is strictly larger.
 *
 * That is the claim that protects a real client on a real call.
 *
 * Runs in its own scratch org so it cannot disturb the default org's Demo Mode
 * toggle, which other pg suites read.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { listLenders, exportLendersCsv, matchForClient } from "./store.mjs";
import { matchLenders, parseBureaus } from "./match.mjs";
import { DEMO_LENDERS } from "../demo/roster.mjs";

const hasDb = !!process.env.DATABASE_URL;
const SLUG = "w3-demo-gate-test";

let orgId = null;
let clientId = null;
let realLenderId = null;

/* Expectations are derived from the roster, not hardcoded, so this suite stays
   honest if someone adds or retunes a sample lender later. */
const demoTotal = DEMO_LENDERS.length;
const demoWithoutTu = DEMO_LENDERS.filter((L) => !parseBureaus(L.bureaus).includes("TU")).length;

async function setDemo(enabled) {
  await db.query(`UPDATE orgs SET demo_mode_enabled = $2 WHERE id = $1`, [orgId, enabled]);
}

before(async () => {
  if (!hasDb) return;
  await db.query(`DELETE FROM lenders WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`, [SLUG]);
  await db.query(`DELETE FROM inquiry_log WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`, [SLUG]);
  await db.query(`DELETE FROM clients WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`, [SLUG]);
  await db.query(`DELETE FROM orgs WHERE slug = $1`, [SLUG]);

  orgId = (await db.query(
    `INSERT INTO orgs (slug, name, demo_mode_enabled) VALUES ($1, $2, false) RETURNING id`,
    [SLUG, "W3 demo gate test org"]
  )).rows[0].id;

  clientId = (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name) VALUES ($1, 'Gate', 'Fixture') RETURNING id`,
    [orgId]
  )).rows[0].id;

  // One real lender. Equifax-only, so a TransUnion block leaves it standing.
  realLenderId = (await db.query(
    `INSERT INTO lenders (org_id, lender_table, name, active, priority_tier, bureaus_pulled, eligible_states, external_row_id, is_demo)
     VALUES ($1, 'OnlineBizCC', 'W3 Real Bank', true, 1, 'EQ', 'All States', 'W3-REAL-1', false) RETURNING id`,
    [orgId]
  )).rows[0].id;

  // The sample lenders, written exactly as the Demo Mode seeder writes them.
  for (const L of DEMO_LENDERS) {
    await db.query(
      `INSERT INTO lenders (org_id, lender_table, name, product_name, active, priority_tier,
                            bureaus_pulled, eligible_states, typical_approval_range, external_row_id, notes, is_demo)
       VALUES ($1, $2::lender_table, $3, $4, true, $5, $6, $7, $8, $9, 'demo', true)`,
      [orgId, L.table, L.name, L.product, L.tier, L.bureaus, L.states, L.typical, L.key]
    );
  }
});

after(async () => {
  if (!hasDb || !orgId) return;
  await db.query(`DELETE FROM inquiry_log WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM lenders WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM clients WHERE org_id = $1`, [orgId]);
  await db.query(`DELETE FROM orgs WHERE id = $1`, [orgId]);
  await close().catch(() => {});
});

test("roster covers all seven product types and every sample row names its bureaus",
  { skip: !hasDb }, async () => {
    const r = await db.query(
      `SELECT lender_table::text AS t, count(*)::int AS n,
              count(*) FILTER (WHERE bureaus_pulled IS NULL OR btrim(bureaus_pulled) = '')::int AS blank
         FROM lenders WHERE org_id = $1 AND is_demo GROUP BY 1 ORDER BY 1`,
      [orgId]
    );
    assert.equal(r.rows.length, 7, "all seven lender_table values seeded");
    for (const row of r.rows) {
      assert.ok(row.n >= 1, `${row.t} has rows`);
      // A NULL here is the original defect: matchLenders reads it as "pulls no
      // bureau", so the row survives every inquiry and the list never shrinks.
      assert.equal(row.blank, 0, `${row.t} sample rows all declare bureaus_pulled`);
    }
    assert.equal(
      r.rows.reduce((s, x) => s + x.n, 0), demoTotal,
      "every roster row landed"
    );
  });

test("listLenders: Demo Mode OFF hides samples, ON reveals them",
  { skip: !hasDb }, async () => {
    await setDemo(false);
    const off = await listLenders(db, { orgId, limit: 500 });
    assert.equal(off.length, 1, "only the real lender is visible");
    assert.equal(off.every((L) => L.is_demo === false), true);
    assert.deepEqual(off.map((L) => L.id), [realLenderId]);

    await setDemo(true);
    const on = await listLenders(db, { orgId, limit: 500 });
    assert.equal(on.length, demoTotal + 1);
    assert.ok(on.length > off.length, "Demo Mode on is strictly larger");
    // Every sample is labelled, so nobody mistakes one for a real lender.
    assert.equal(on.filter((L) => L.is_demo).every((L) => L.name.startsWith("DEMO · ")), true);
  });

test("matchForClient: Demo Mode OFF equals the real-lender-only result",
  { skip: !hasDb }, async () => {
    await setDemo(false);
    const gated = await matchForClient(db, { orgId, clientId });

    // What the answer would be if the sample rows had never been written.
    const realOnly = matchLenders({
      lenders: [{
        id: realLenderId, name: "W3 Real Bank", lender_table: "OnlineBizCC",
        active: true, priority_tier: 1, bureaus_pulled: "EQ", eligible_states: "All States"
      }]
    });

    assert.deepEqual(gated.matches.map((m) => m.id), realOnly.matches.map((m) => m.id));
    assert.equal(gated.summary.match_count, realOnly.summary.match_count);
    assert.equal(gated.matches.some((m) => m.is_demo), false);
    // Absent, not refused — a demo name in `skipped` is still a disclosure.
    assert.equal(gated.skipped.length, 0, "no sample lender is named as skipped");
  });

test("matchForClient: Demo Mode ON is strictly larger",
  { skip: !hasDb }, async () => {
    await setDemo(false);
    const off = await matchForClient(db, { orgId, clientId });
    await setDemo(true);
    const on = await matchForClient(db, { orgId, clientId });

    assert.ok(on.summary.match_count > off.summary.match_count,
      `expected more matches with Demo Mode on (${on.summary.match_count} vs ${off.summary.match_count})`);
    assert.equal(on.summary.match_count, demoTotal + 1);
  });

test("a TransUnion-blocked client still matches Equifax-only and Experian-only lenders",
  { skip: !hasDb }, async () => {
    await setDemo(true);
    const clean = await matchForClient(db, { orgId, clientId });

    await db.query(
      `INSERT INTO inquiry_log (org_id, client_id, bureau, status) VALUES ($1, $2, 'TU', 'open')`,
      [orgId, clientId]
    );
    const blocked = await matchForClient(db, { orgId, clientId });
    await db.query(`DELETE FROM inquiry_log WHERE org_id = $1`, [orgId]);

    assert.ok(blocked.summary.match_count < clean.summary.match_count,
      "an inquiry-heavy file gets a visibly shorter list");
    assert.equal(blocked.summary.match_count, demoWithoutTu + 1);

    const bureausLeft = blocked.matches.map((m) => m.bureaus);
    assert.equal(bureausLeft.some((b) => b.includes("TU")), false,
      "nothing that pulls TransUnion survived");
    assert.ok(bureausLeft.some((b) => b.length === 1 && b[0] === "EQ"),
      "Equifax-only lenders still match");
    assert.ok(bureausLeft.some((b) => b.length === 1 && b[0] === "EX"),
      "Experian-only lenders still match");
  });

test("the CSV export never carries a sample lender, even with Demo Mode ON",
  { skip: !hasDb }, async () => {
    await setDemo(true);
    const csv = await exportLendersCsv(db, { orgId });
    assert.ok(csv.includes("W3 Real Bank"), "the real lender is exported");
    for (const L of DEMO_LENDERS) {
      assert.equal(csv.includes(L.name), false, `${L.name} must not reach an export`);
    }
  });

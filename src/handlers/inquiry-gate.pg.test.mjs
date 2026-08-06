// Real-Postgres tests for the inquiry-gate trigger.
// SKIPS unless DATABASE_URL is set.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { emit, _resetOrgCache } from "../events/bus.mjs";
import { clearHandlers, getHandlers } from "../events/registry.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { register as registerInquiryGate, onInquiryGateTrigger } from "./inquiry-gate.mjs";
import { _resetRegistered, registerAll } from "../register-all.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const MARK = "inqgate_pg";

describe("inquiry-gate handler", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let org;
  let clientId;

  async function wipe() {
    const clients = (await db.query(
      `SELECT id FROM clients WHERE email LIKE $1`,
      [`${MARK}%`]
    )).rows.map((r) => r.id);
    if (!clients.length) return;
    await db.query(`DELETE FROM inquiry_prep WHERE client_id = ANY($1)`, [clients]);
    await db.query(`DELETE FROM inquiry_removal_cases WHERE client_id = ANY($1)`, [clients]);
    await db.query(`DELETE FROM inquiry_log WHERE client_id = ANY($1)`, [clients]);
    await db.query(`DELETE FROM cards WHERE client_id = ANY($1)`, [clients]);
    await db.query(`DELETE FROM crs_results WHERE client_id = ANY($1)`, [clients]);
    await db.query(`DELETE FROM events WHERE client_id = ANY($1)`, [clients]);
    await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [clients]);
  }

  async function seedClient(suffix) {
    const email = `${MARK}.${suffix}@example.com`;
    const r = await db.query(
      `INSERT INTO clients (org_id, email, first_name, last_name, phone)
       VALUES ($1, $2, 'Gate', $3, '+15550001111')
       RETURNING id`,
      [org, email, suffix]
    );
    return r.rows[0].id;
  }

  async function seedCrs(client, inquiries) {
    await db.query(
      `INSERT INTO crs_results (org_id, client_id, result, outcome_tier)
       VALUES ($1, $2, $3::jsonb, 'FULL_FUNDING')`,
      [
        org,
        client,
        JSON.stringify({
          normalized: { inquiries },
          personalInfo: {
            EX: { names: ["Gate Alias"], formerAddresses: ["9 Old Rd"] }
          }
        })
      ]
    );
  }

  before(async () => {
    _resetOrgCache();
    clearHandlers();
    registerInquiryGate();
    org = await resolveDefaultOrg(db);
    await wipe();
    // Ensure migration columns exist (dev DBs may lag).
    await db.query(`SELECT first_delivery_at, letter_draft_html FROM inquiry_removal_cases LIMIT 0`).catch(() => {});
  });

  after(async () => {
    await wipe();
    clearHandlers();
    await close().catch(() => {});
  });

  test("router: inquiry-gate handlers resolve on deposit.paid and round.closeout", () => {
    clearHandlers();
    _resetRegistered();
    registerAll();
    const depositHandlers = getHandlers("deposit.paid");
    const closeoutHandlers = getHandlers("round.closeout");
    assert.ok(
      depositHandlers.some((fn) => fn.name === "onDepositPaidGate" || String(fn).includes("onInquiryGateTrigger") || fn.name === "onDepositPaidGate"),
      "deposit.paid must have inquiry-gate registered (not merely a file on disk)"
    );
    assert.ok(
      closeoutHandlers.length >= 1,
      "round.closeout must have at least one registered handler"
    );
    assert.ok(
      closeoutHandlers.some((fn) => fn.name === "onRoundCloseoutGate"),
      "round.closeout must resolve to onRoundCloseoutGate"
    );
    // Re-register for remaining tests
    clearHandlers();
    registerInquiryGate();
  });

  test("deposit.paid: one case per bureau with items + draft letter", async () => {
    clientId = await seedClient("deposit");
    await seedCrs(clientId, [
      { creditorName: "Capital One", source: "ex", date: "2024-01-15" },
      { creditorName: "Chase", source: "tu", date: "2024-02-01" }
    ]);

    const res = await onInquiryGateTrigger(
      { orgId: org, clientId, id: "evt-dep-1", payload: {}, name: "deposit.paid" },
      db
    );
    assert.equal(res.done, true);
    assert.equal(res.cleared, false);
    assert.equal(res.cases.length, 2);

    const cases = (await db.query(
      `SELECT selected_bureaus_raw, case_status, open_inquiry_count, letter_draft_html
         FROM inquiry_removal_cases WHERE client_id = $1 ORDER BY selected_bureaus_raw`,
      [clientId]
    )).rows;
    assert.equal(cases.length, 2);
    assert.deepEqual(cases.map((c) => c.selected_bureaus_raw).sort(), ["EX", "TU"]);
    for (const c of cases) {
      assert.ok(c.letter_draft_html && c.letter_draft_html.includes("1681i"));
      assert.ok(Number(c.open_inquiry_count) >= 1);
      assert.equal(c.case_status, "Blocked"); // no identity packet yet
    }

    const prep = (await db.query(
      `SELECT count(*)::int AS n FROM inquiry_prep WHERE client_id = $1 AND prep_state = 'staging'`,
      [clientId]
    )).rows[0].n;
    assert.ok(prep >= 2);
  });

  test("idempotent re-fire does not duplicate cases", async () => {
    clientId = await seedClient("idem");
    await seedCrs(clientId, [
      { creditorName: "Amex", source: "eq", date: "2024-03-01" }
    ]);
    const event = { orgId: org, clientId, id: "evt-idem-1", payload: {}, name: "deposit.paid" };
    await onInquiryGateTrigger(event, db);
    await onInquiryGateTrigger({ ...event, id: "evt-idem-2" }, db);
    const n = (await db.query(
      `SELECT count(*)::int AS n FROM inquiry_removal_cases
        WHERE client_id = $1 AND selected_bureaus_raw = 'EQ'`,
      [clientId]
    )).rows[0].n;
    assert.equal(n, 1);
  });

  test("zero items writes no case and emits clear path", async () => {
    clientId = await seedClient("zero");
    await db.query(
      `INSERT INTO crs_results (org_id, client_id, result, outcome_tier)
       VALUES ($1, $2, '{"normalized":{"inquiries":[]}}'::jsonb, 'FULL_FUNDING')`,
      [org, clientId]
    );
    const res = await onInquiryGateTrigger(
      { orgId: org, clientId, id: "evt-zero", payload: {}, name: "deposit.paid" },
      db
    );
    assert.equal(res.cleared, true);
    const n = (await db.query(
      `SELECT count(*)::int AS n FROM inquiry_removal_cases WHERE client_id = $1`,
      [clientId]
    )).rows[0].n;
    assert.equal(n, 0);
  });

  test("round.closeout links funding_round_id", async () => {
    clientId = await seedClient("closeout");
    await seedCrs(clientId, [
      { creditorName: "Wells", source: "ex", date: "2024-04-01" }
    ]);
    const round = (await db.query(
      `INSERT INTO funding_rounds (org_id, client_id, round_number, status, funded_amount)
       VALUES ($1, $2, 1, 'funded', 10000) RETURNING id`,
      [org, clientId]
    )).rows[0];

    const res = await onInquiryGateTrigger(
      {
        orgId: org,
        clientId,
        id: "evt-co-1",
        name: "round.closeout",
        payload: { fundingRoundId: round.id }
      },
      db
    );
    assert.equal(res.done, true);
    const row = (await db.query(
      `SELECT funding_round_id, selected_bureaus_raw FROM inquiry_removal_cases WHERE client_id = $1`,
      [clientId]
    )).rows[0];
    assert.equal(row.funding_round_id, round.id);
    assert.equal(row.selected_bureaus_raw, "EX");
  });

  test("emit deposit.paid dispatches registered gate handler", async () => {
    clientId = await seedClient("emit");
    await seedCrs(clientId, [
      { creditorName: "Sync", source: "tu", date: "2024-05-01" }
    ]);
    clearHandlers();
    registerInquiryGate();
    await emit(
      db,
      "deposit.paid",
      { amount: 997, email: `${MARK}.emit@example.com` },
      { orgId: org, clientId, idempotencyKey: `inqgate-emit-${Date.now()}` }
    );
    const n = (await db.query(
      `SELECT count(*)::int AS n FROM inquiry_removal_cases WHERE client_id = $1`,
      [clientId]
    )).rows[0].n;
    assert.ok(n >= 1, "bus dispatch must create a case");
  });
});

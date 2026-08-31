// GET /api/read/partner-production — the payload, not the plumbing.
//
// The gate (requirePrincipal, withPartnerScope, staff must name a ?partner_id=) is
// partnerReadHandler's and is tested with the rest of the partner read APIs. What
// is tested here is the one thing this endpoint decides for itself: that a partner
// who has never been evaluated does not render as a partner in good standing.
//
// It lives under src/ because npm test's glob is src/** and scripts/** only — a
// test under api/ silently never runs (CLAUDE.md §12).

import { test, describe } from "node:test";
import assert from "node:assert";
import { fetchRows, nextFirstOfMonth, FLOOR_PER_MONTH, FLOOR_WINDOW_DAYS }
  from "../../api/read/partner-production.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";
import { FLOOR_CLIENTS_PER_MONTH, WINDOW_DAYS } from "../partners/floors.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const PARTNER = "22222222-2222-4222-8222-222222222222";

function stubTx(script) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      for (const [needle, reply] of script) {
        if (sql.includes(needle)) return typeof reply === "function" ? reply(params) : reply;
      }
      throw new Error(`stubTx: no scripted reply for: ${sql.slice(0, 90)}`);
    }
  };
}

const partnerRow = (over = {}) => ({
  rows: [{
    id: PARTNER, org_id: ORG, status: "active", revenue_share_pct: "50",
    activated_at: "2025-01-01T00:00:00.000Z", ...over
  }]
});

describe("the route exists", () => {
  test("a handler file is not a route — this one is in the ROUTES map", () => {
    assert.equal(typeof ROUTES["read/partner-production"], "function");
  });
});

describe("the payload", () => {
  test("carries the owner's floor, not a copy invented by the screen", async () => {
    const tx = stubTx([
      ["FROM partners WHERE id = $1", partnerRow()],
      ["ORDER BY window_end DESC", { rows: [] }],
      ["WITH surviving", { rows: [{ funding_clients: 12 }] }]
    ]);
    const [row] = await fetchRows(tx, { partnerId: PARTNER, query: {} });
    assert.equal(row.floor_per_month, FLOOR_CLIENTS_PER_MONTH);
    assert.equal(row.floor_clients, 30);
    assert.equal(row.window_days, WINDOW_DAYS);
    assert.equal(FLOOR_PER_MONTH, FLOOR_CLIENTS_PER_MONTH);
    assert.equal(FLOOR_WINDOW_DAYS, WINDOW_DAYS);
    assert.equal(row.grace_days, 90);
    assert.equal(row.downgraded_share_pct, 20);
    assert.equal(row.cure_days, 30);
  });

  test("never evaluated is null with a reason — never a silent pass", async () => {
    const tx = stubTx([
      ["FROM partners WHERE id = $1", partnerRow({ activated_at: null })],
      ["ORDER BY window_end DESC", { rows: [] }],
      ["WITH surviving", { rows: [{ funding_clients: 3 }] }]
    ]);
    const [row] = await fetchRows(tx, { partnerId: PARTNER, query: {} });
    assert.equal(row.latest, null);
    assert.equal(row.evaluable, false);
    assert.equal(row.not_evaluated_reason, "no_activation_date");
    // NULL survives as NULL. It is a real state of this database, not a zero.
    assert.equal(row.activated_at, null);
  });

  test("the live window is reported so a warned partner can see today's number", async () => {
    const tx = stubTx([
      ["FROM partners WHERE id = $1", partnerRow()],
      ["ORDER BY window_end DESC", {
        rows: [{
          window_end: "2026-09-01T00:00:00.000Z", outcome: "warning",
          funding_clients: 4, floor_clients: 30, met: false, consecutive_misses: 1
        }]
      }],
      ["WITH surviving", { rows: [{ funding_clients: 9 }] }]
    ]);
    const [row] = await fetchRows(tx, { partnerId: PARTNER, query: {} });
    assert.equal(row.latest.outcome, "warning");
    assert.equal(row.current.fundingClients, 9);
    assert.equal(row.current.shortBy, 21);
    assert.equal(row.not_evaluated_reason, null);
    assert.ok(row.next_review_at instanceof Date);
  });

  test("a partner the scope cannot see yields no row rather than an error", async () => {
    const tx = stubTx([["FROM partners WHERE id = $1", { rows: [] }]]);
    assert.deepEqual(await fetchRows(tx, { partnerId: PARTNER, query: {} }), []);
  });

  test("?history is passed through, and floors.mjs clamps it", async () => {
    const tx = stubTx([
      ["FROM partners WHERE id = $1", partnerRow()],
      ["ORDER BY window_end DESC", { rows: [] }],
      ["WITH surviving", { rows: [{ funding_clients: 0 }] }]
    ]);
    await fetchRows(tx, { partnerId: PARTNER, query: { history: "500" } });
    const call = tx.calls.find((c) => c.sql.includes("LIMIT $3"));
    assert.equal(call.params[2], 24);
  });
});

describe("nextFirstOfMonth", () => {
  test("is the 1st of the next UTC month", () => {
    assert.equal(nextFirstOfMonth(new Date("2026-09-14T09:00:00Z")).toISOString(),
      "2026-10-01T00:00:00.000Z");
    assert.equal(nextFirstOfMonth(new Date("2026-12-31T23:59:59Z")).toISOString(),
      "2027-01-01T00:00:00.000Z");
    // The 1st itself points at the NEXT check, not at today's.
    assert.equal(nextFirstOfMonth(new Date("2026-09-01T00:00:00Z")).toISOString(),
      "2026-10-01T00:00:00.000Z");
  });
});

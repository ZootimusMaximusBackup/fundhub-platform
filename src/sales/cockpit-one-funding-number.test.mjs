// ONE FUNDING NUMBER, AND A SHIFT THAT STOPS COUNTING.
//
// Walk findings 9, 25 and 30, 2026-09-06. All three are the same shape: the
// call screen stating something with confidence that the rest of the system
// disagrees with, or refusing to state something it already knows.
//
//   9.  THE CALL SCREEN AND THE CLIENT CONTROL PANEL DISAGREED ABOUT MONEY.
//       Walk1 Funding read $636,000 here and $212,000 there, at the same
//       moment, for the same person. Neither calculation was broken; there
//       were two of them. The Client Control Panel prints what was stored
//       when credit was pulled. This screen re-ran the underwriting engine
//       over the tradeline rows and printed that. A closer reads the number
//       here out loud. Chris: "Nobody gets 600K in funding."
//
//   25. "DEROGATORIES: —" ON A CLEAN FILE. Four accounts, nothing negative,
//       and the one fact that IS the pitch printed as unknown — because the
//       summary looked for a key named exactly `derogatories` on the raw
//       bureau payload and Walk1's file does not carry that name.
//
//   30. "ON SHIFT · 370H 28M" — fifteen and a half days, counted off a shifts
//       row started on 22 August that nobody ever closed.
//
// Same stub-database shape as cockpit-honest-money.test.mjs, on purpose: it
// answers by table rather than by call order, so adding a query to buildCockpit
// does not shift every fixture by one and turn these into nonsense that still
// passes.

import { test, describe } from "node:test";
import assert from "node:assert";
import { buildCockpit, storedFunding, describeShift } from "./cockpit.mjs";

const ORG = "11111111-1111-1111-1111-111111111111";
const STAFF = "22222222-2222-2222-2222-222222222222";
const CLIENT = "33333333-3333-3333-3333-333333333333";

function stubDb(overrides = {}) {
  const rows = {
    clients: [{
      id: CLIENT, first_name: "Ada", last_name: "Byron", email: "ada@example.com",
      custom_fields: {}, tags: [], business_name: null, age_months: null
    }],
    staff: [{ name: "A Closer" }],
    ...overrides
  };
  return {
    async query(sql) {
      const flat = String(sql).replace(/\s+/g, " ");
      if (/FROM clients c\b/.test(flat) && /WHERE c\.id/.test(flat)) return { rows: rows.clients };
      if (/FROM staff\b/.test(flat)) return { rows: rows.staff };
      if (/FROM shifts\b/.test(flat)) return { rows: rows.shifts || [] };
      if (/FROM funding_rounds fr\b/.test(flat)) return { rows: rows.funding_rounds || [] };
      if (/FROM tasks nt\b/.test(flat)) return { rows: rows.next_task || [] };
      if (/FROM tasks t\b/.test(flat)) return { rows: rows.tasks || [] };
      if (/FROM transactions\b/.test(flat)) return { rows: rows.transactions || [] };
      if (/FROM crs_results\b/.test(flat)) return { rows: rows.crs_results || [] };
      if (/FROM tradelines\b/.test(flat)) return { rows: rows.tradelines || [] };
      if (/FROM call_outcomes\b/.test(flat)) return { rows: [{}] };
      return { rows: [] };
    }
  };
}

/* The shape Walk1 Funding actually has in the database: a stored pre-approval
   of $212,000 personal, $0 business — no company on file, which is correct —
   and a measured negatives count of zero. */
const WALK1_CRS = {
  created_at: "2026-09-05T12:00:00.000Z",
  result: {
    scores: { ex: 771, eq: 778, tu: 766 },
    preapprovals: { totalPersonal: 212000, totalBusiness: 0, totalCombined: 212000 }
  }
};
const WALK1_CUSTOM_FIELDS = {
  crs_negative_items_count: 0,
  analyzer_prequal_amount: 212000,
  total_funding_estimate: 212000
};

function walk1Db(extra = {}) {
  return stubDb({
    clients: [{
      id: CLIENT, first_name: "Walk1", last_name: "Funding", email: null,
      custom_fields: WALK1_CUSTOM_FIELDS, tags: [], business_name: null, age_months: null
    }],
    crs_results: [WALK1_CRS],
    ...extra
  });
}

describe("the funding number has one source", () => {
  test("the stored pre-approval is what the screen gets, not a second calculation", async () => {
    const out = await buildCockpit(walk1Db(), { orgId: ORG, staffId: STAFF, clientId: CLIENT });
    assert.equal(out.funding.personal, 212000);
    assert.equal(out.funding.business, 0, "no company on file, so nothing stacks");
    assert.equal(out.funding.total, 212000);
    assert.equal(out.funding.source, "crs_preapprovals");
  });

  test("the totals the screen reads are the stored ones, and say so", async () => {
    const out = await buildCockpit(walk1Db(), { orgId: ORG, staffId: STAFF, clientId: CLIENT });
    assert.equal(out.underwrite.totals.total_personal_funding, 212000,
      "this is the field public/app/closer-call.js paints. It read the engine's own " +
      "re-run and printed $636,000 beside a Client Control Panel showing $212,000.");
    assert.equal(out.underwrite.totals.total_combined_funding, 212000);
    assert.equal(out.underwrite.totals.source, "stored_preapprovals",
      "the payload has to say which of the two numbers it is carrying");
  });

  test("with nothing stored the engine's own figures are left alone", async () => {
    const out = await buildCockpit(stubDb(), { orgId: ORG, staffId: STAFF, clientId: CLIENT });
    assert.equal(out.funding.available, false);
    assert.equal(out.funding.total, null, "unknown stays unknown — it never becomes $0");
    assert.match(out.funding.reason, /pull credit/i);
    assert.equal(out.underwrite.totals.source, "engine");
  });

  test("an older file with only the stamped estimate reads the same two fields as the Client Control Panel", () => {
    const f = storedFunding({
      crsResult: { scores: {} },
      customFields: { analyzer_prequal_amount: 150000, total_funding_estimate: 999 }
    });
    assert.equal(f.total, 150000, "analyzer_prequal_amount wins, exactly as it does on the panel");
    assert.equal(f.source, "client_custom_fields");
    assert.equal(f.personal, null, "the split was never stored, so it is not invented here");
  });

  test("two known numbers fill the third by arithmetic, never by a second opinion", () => {
    const f = storedFunding({
      crsResult: { preapprovals: { totalPersonal: 100000, totalBusiness: 50000 } }
    });
    assert.equal(f.total, 150000);
    const g = storedFunding({
      crsResult: { preapprovals: { totalCombined: 150000, totalBusiness: 50000 } }
    });
    assert.equal(g.personal, 100000);
  });
});

describe("a clean file is allowed to say it is clean", () => {
  test("zero negatives reaches the screen as zero, not as a dash", async () => {
    const out = await buildCockpit(walk1Db(), { orgId: ORG, staffId: STAFF, clientId: CLIENT });
    assert.equal(out.credit.available, true);
    assert.equal(out.credit.derogatories, 0,
      "the system knows the answer. On a call where the clean file is the pitch, " +
      'the screen refusing to say so is the defect.');
    assert.equal(out.credit.derogatories_source, "clients.custom_fields.crs_negative_items_count");
  });

  test("a count nobody entered still reads as unknown", async () => {
    const db = stubDb({
      clients: [{
        id: CLIENT, first_name: "Ada", last_name: "Byron", email: null,
        custom_fields: {}, tags: [], business_name: null, age_months: null
      }],
      crs_results: [{ created_at: "2026-09-05T12:00:00.000Z", result: { scores: { ex: 700 } } }]
    });
    const out = await buildCockpit(db, { orgId: ORG, staffId: STAFF, clientId: CLIENT });
    assert.equal(out.credit.derogatories, null,
      "CLAUDE.md §12 — an unknown count must never be coalesced into a confident zero");
  });
});

describe("the shift chip stops counting when nobody clocked out", () => {
  const now = new Date("2026-09-06T12:00:00.000Z");

  test("a shift open since August is reported, not counted", () => {
    const s = describeShift({ started_at: "2026-08-22T01:32:00.000Z" }, now);
    assert.equal(s.on_shift, false);
    assert.equal(s.never_closed, true);
    assert.equal(s.reason, "Shift open since Aug 22 — never clocked out",
      '"ON SHIFT · 370H 28M" is fifteen and a half days and tells a closer nothing');
    assert.equal(s.started_at, "2026-08-22T01:32:00.000Z", "the open row is still on the payload");
  });

  test("a shift started this morning still counts", () => {
    const s = describeShift({ started_at: "2026-09-06T09:00:00.000Z" }, now);
    assert.equal(s.on_shift, true);
    assert.equal(s.elapsed_ms, 3 * 60 * 60 * 1000);
  });

  test("no open row is still the plain empty answer", () => {
    assert.deepEqual(describeShift(null, now), { on_shift: false, reason: "No open shift" });
  });

  test("buildCockpit hands the screen the same answer", async () => {
    const out = await buildCockpit(
      walk1Db({ shifts: [{ id: "s-1", started_at: "2026-08-22T01:32:00.000Z" }] }),
      { orgId: ORG, staffId: STAFF, clientId: CLIENT, now }
    );
    assert.equal(out.staff.shift.on_shift, false);
    assert.match(out.staff.shift.reason, /never clocked out/);
  });
});

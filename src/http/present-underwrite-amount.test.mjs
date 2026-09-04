// COMPLIANCE REVIEW REQUIRED — funding / pre-approval amounts.
//
// F15, owner-set 2026-09-03. This file used to require the OPPOSITE of what it
// now checks: that Present (the closer deck) recomputed the UnderwriteIQ stack
// at render time so its headline matched api/read/underwrite. That recompute is
// exactly the defect. On 2026-09-03 Present showed a customer "PRE-APPROVED FOR
// APPROXIMATELY $939,500" while the engine had stored $199,350 and the client's
// own portal was showing $199,350 — two client-facing screens, one person, one
// minute, 4.7x apart. Chris: "fix the deck to the portal, not the reverse."
//
// So Present quotes the STORED estimate and does no funding arithmetic of its
// own. api/read/underwrite is the engine surface and still computes. They are
// two different questions and are no longer required to give one answer.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import readCloserDeck from "../../api/read/closer-deck.mjs";
import readUnderwrite from "../../api/read/underwrite.mjs";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TRADELINE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function makeRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
    setHeader(k, v) { res.headers[k.toLowerCase()] = v; return res; },
    end() { return res; }
  };
  return res;
}

function dollarsToCents(n) {
  return Math.round(Number(n) * 100);
}

const CLIENT_ROW = {
  id: CLIENT,
  first_name: "Sim",
  last_name: "Fund",
  email: "sim@example.com",
  phone: "555",
  outcome_tier: "FULL_FUNDING",
  business_name: "Fund LLC",
  custom_fields: {
    crs_inquiries_ex: 4, crs_inquiries_eq: 1, crs_inquiries_tu: 0,
    crs_negative_items_count: 0,
    crs_late_payments_count: 0,
    business_age_months: 30,
    total_funding_estimate: 125000
  }
};

const TRADELINE_ROW = {
  id: TRADELINE, org_id: ORG, client_id: CLIENT,
  lender: "Chase", kind: "revolving",
  credit_limit_cents: 2_000_000,
  balance_cents: 400_000,
  apr: "0.1899", closed_at: null,
  opened_on: "2018-01-01"
};

const CRS_ROW = {
  outcome_tier: "FULL_FUNDING",
  created_at: "2026-01-02T00:00:00Z",
  result: {
    environment: "production",
    outcome: "FULL_FUNDING",
    preapprovals: { totalCombined: 125000 },
    scores: { perBureau: { ex: 720, tu: 710, eq: 705 }, ex: 720, tu: 710, eq: 705 }
  }
};

function makeDb({ businesses = [{ age_months: 30 }] } = {}) {
  return {
    async query(sql) {
      if (sql.includes("UPDATE sessions")) {
        return {
          rows: [{
            session_id: "sess", expires_at: "2099-01-01T00:00:00Z",
            staff_id: "staff-1", org_id: ORG, role: "closer",
            email: "closer@example.com", name: "A Closer", status: "active",
            active_flag: "true"
          }]
        };
      }
      if (sql.includes("FROM clients")) return { rows: [CLIENT_ROW] };
      if (sql.includes("FROM tradelines")) return { rows: [TRADELINE_ROW] };
      if (sql.includes("FROM card_liabilities")) return { rows: [] };
      if (sql.includes("FROM crs_results")) return { rows: [CRS_ROW] };
      if (sql.includes("FROM businesses")) return { rows: businesses };
      if (sql.includes("FROM payment_links")) return { rows: [] };
      if (sql.includes("FROM soft_pull_requests")) return { rows: [] };
      if (sql.includes("FROM client_consents")) return { rows: [] };
      throw new Error("stub db: unexpected query:\n" + sql);
    }
  };
}

const staff = {
  id: "staff-1",
  org_id: ORG,
  role: "closer",
  name: "A Closer",
  email: "closer@example.com",
  status: "active"
};

async function presentTotal(businesses) {
  const res = makeRes();
  await readCloserDeck(
    { method: "GET", query: { client_id: CLIENT } },
    res,
    { db: makeDb({ businesses }), requireAuth: async () => staff }
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body.engine.total;
}

async function underwriteTotal(businesses) {
  const res = makeRes();
  await readUnderwrite(
    {
      method: "GET",
      headers: { authorization: "Bearer test-token" },
      query: { client_id: CLIENT }
    },
    res,
    { db: makeDb({ businesses }) }
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body.underwrite.totals.total_combined_funding;
}

describe("Present quotes the stored estimate, and only the stored estimate", () => {
  test("the deck headline is the stored figure, not a render-time recalculation", async () => {
    const present = await presentTotal([{ age_months: 30 }]);
    const underwrite = await underwriteTotal([{ age_months: 30 }]);
    assert.equal(dollarsToCents(present), 12500000, "the stored preapprovals.totalCombined");
    assert.ok(Number.isFinite(underwrite) && underwrite > 0, "the engine surface still computes");
  });

  test("adding companies does not move the deck figure — only the engine can", async () => {
    const oneBiz = [{ age_months: 30 }];
    const threeBiz = [{ age_months: 30 }, { age_months: 30 }, { age_months: 30 }];
    const presentOne = await presentTotal(oneBiz);
    const presentThree = await presentTotal(threeBiz);
    assert.equal(dollarsToCents(presentOne), dollarsToCents(presentThree));

    // The engine surface is where a company count legitimately changes money.
    const underwriteOne = await underwriteTotal(oneBiz);
    const underwriteThree = await underwriteTotal(threeBiz);
    assert.ok(underwriteThree > underwriteOne);
  });

  test("no company on file means no business money anywhere", async () => {
    // The live 2026-09-03 case: business_age_months 30 on the client, zero
    // company rows. The loose field alone used to stack a business slice.
    const underwrite = await underwriteTotal([]);
    assert.ok(Number.isFinite(underwrite));
    const oneBiz = await underwriteTotal([{ age_months: 30 }]);
    assert.ok(oneBiz > underwrite, "the company is what adds business funding");
  });
});

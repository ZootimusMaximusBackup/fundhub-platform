// COMPLIANCE REVIEW REQUIRED — closer-deck pay link, letters, disposition.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import readCloserDeck, { CLOSER_DECK_ROLES } from "../../api/read/closer-deck.mjs";
import closerDeckWrite from "../../api/closer-deck.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CID = "22222222-2222-4222-8222-222222222222";

function resCapture() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; }
  };
}

function staff(role, orgId = ORG) {
  return { id: "staff-1", org_id: orgId, role, name: role, email: role + "@x.test", status: "active" };
}

function dbWithClient(client = { id: CID, first_name: "A", last_name: "B", outcome_tier: null, custom_fields: {}, business_name: null }) {
  return {
    async query(sql) {
      const s = String(sql);
      if (/SELECT 1 FROM clients/i.test(s)) return { rows: [{ "?column?": 1 }] };
      if (/FROM clients c/i.test(s)) return { rows: [client] };
      if (/FROM crs_results/i.test(s)) return { rows: [] };
      return { rows: [] };
    }
  };
}

async function get(opts = {}) {
  const res = resCapture();
  const role = opts.role ?? "closer";
  await readCloserDeck(
    { method: "GET", query: opts.query ?? { client_id: CID } },
    res,
    {
      db: opts.db ?? dbWithClient(),
      requireAuth: opts.requireAuth ?? (async () => staff(role, opts.orgId))
    }
  );
  return res;
}

async function post(body, opts = {}) {
  const res = resCapture();
  const role = opts.role ?? "closer";
  await closerDeckWrite(
    { method: "POST", body },
    res,
    {
      db: opts.db ?? dbWithClient(),
      requireAuth: opts.requireAuth ?? (async () => staff(role, opts.orgId))
    }
  );
  return res;
}

describe("GET /api/read/closer-deck", () => {
  test("unsigned is 401", async () => {
    const res = await get({
      requireAuth: async (_req, r) => {
        r.status(401).json({ ok: false, error: "unauthorized" });
        return null;
      }
    });
    assert.equal(res.statusCode, 401);
  });

  test("a setter is refused", async () => {
    const res = await get({ role: "setter" });
    assert.equal(res.statusCode, 403);
  });

  for (const role of CLOSER_DECK_ROLES) {
    test(`a ${role} can read the deck payload`, async () => {
      const res = await get({ role });
      assert.equal(res.statusCode, 200, role + " " + JSON.stringify(res.body));
      assert.equal(res.body.ok, true);
      assert.equal(res.body.engine.available, false);
      assert.equal(res.body.engine.reason, "engine data unavailable");
      assert.ok(Array.isArray(res.body.offers));
      assert.ok(res.body.offers.some((o) => o.key === "FUNDING_DFY"));
    });
  }

  test("contact= is accepted as the client id", async () => {
    const res = await get({ query: { contact: CID } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.client_id, CID);
  });

  test("missing client is 404, not a demo person", async () => {
    const res = await get({
      db: { async query() { return { rows: [] }; } }
    });
    assert.equal(res.statusCode, 404);
  });
});

describe("POST /api/closer-deck", () => {
  let savedEnv;
  beforeEach(() => {
    savedEnv = process.env.COMMAS_CHECKOUT_BASE_URL;
    delete process.env.COMMAS_CHECKOUT_BASE_URL;
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.COMMAS_CHECKOUT_BASE_URL;
    else process.env.COMMAS_CHECKOUT_BASE_URL = savedEnv;
  });

  test("letters on the qualified funding offer are 409", async () => {
    const res = await post({
      action: "generate_letters",
      client_id: CID,
      offer_key: "FUNDING_DFY",
      tier: "FULL_FUNDING"
    });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, "letters_blocked_funding_route");
  });

  test("pay link without Commas config is 503, not an invented URL", async () => {
    const res = await post({
      action: "send_pay_link",
      client_id: CID,
      offer_key: "REPAIR_DFY"
    });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error, "commas_not_configured");
  });

  test("soft pull without Commas config is 503", async () => {
    const res = await post({
      action: "send_soft_pull",
      client_id: CID
    });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error, "commas_not_configured");
  });

  test("ebook without amount is 400", async () => {
    process.env.COMMAS_CHECKOUT_BASE_URL = "https://pay.example/checkout";
    const res = await post({
      action: "send_ebook",
      client_id: CID
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "bad_ebook_amount");
  });

  test("a setter cannot fire cockpit actions", async () => {
    const res = await post({
      action: "log_disposition",
      client_id: CID,
      offer_key: "REPAIR_DFY"
    }, { role: "setter" });
    assert.equal(res.statusCode, 403);
  });
});

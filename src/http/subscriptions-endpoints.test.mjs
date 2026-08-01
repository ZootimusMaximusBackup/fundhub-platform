/* The two Finance OS subscription endpoints, driven end to end.
 *
 *   api/finance/subscriptions.mjs — what plan a client is on
 *   api/finance/cards.mjs         — what pays for it
 *
 * WHY THIS FILE EXISTS AND WHERE IT LIVES. package.json's test glob walks src/
 * and scripts/ ONLY (CLAUDE.md, traps), so a test placed next to the handler
 * under api/ never runs and reports nothing while doing it. It lives here and
 * imports the handlers from api/.
 *
 * WHY IT NEEDS NO DATABASE. src/db.mjs exports `db` as a plain object with one
 * `query` method, so both the session lookup and every store call are stubbed
 * and the handlers run exactly as they do in production. Same approach as
 * src/http/finance-os-endpoints.test.mjs, and for the same reason: the tenancy
 * rules these endpoints turn on are INVISIBLE on a one-org database, and every
 * database this repo has is a one-org database.
 *
 * THE FOUR THINGS THIS FILE IS ACTUALLY GUARDING.
 *
 *   1. ORG COMES FROM THE SESSION. Every read and every write must carry
 *      staff.org_id and must never carry an org id from the query string or the
 *      body. A session with no org must match nothing rather than everything.
 *
 *   2. A CARD NUMBER MUST NOT BE STORABLE. The add form is the one place a
 *      person could type one, so the tests here send a PAN, a CVV and a
 *      card-shaped "token" and assert that each is refused BEFORE any write and
 *      that the answer names the field.
 *
 *   3. AN UNKNOWN PRICE IS NOT ZERO. price_cents null must reach the screen as
 *      price_display null, so it renders as an em dash. "0.00" is a claim about
 *      somebody's money that nobody made.
 *
 *   4. A REFUSAL IS NOT A CRASH. Six things the caller can get wrong used to
 *      leave these handlers as unhandled throws, which api.mjs:334 renders as
 *      HTTP 500 "the server broke": a negative price, a 13th month, a two-digit
 *      year, an overlapping signup, a card belonging to someone else, and a
 *      plan change that raced another one. Each is asserted to be a 400 or a
 *      409 carrying a sentence.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

import { db } from "../db.mjs";
import subscriptions from "../../api/finance/subscriptions.mjs";
import cards from "../../api/finance/cards.mjs";
import { ROLE_SETS } from "./read-api.mjs";

/* Two orgs, deliberately. The caller belongs to ORG_A. ORG_B is the tenant
   whose ids get handed in. On a single-org database these are the same value
   and every scoping bug below is unobservable. */
const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const CID = "f3263bdb-45da-4056-8d6c-7c999d944fee";
const OTHER_CLIENT = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const CARD_ID = "cccccccc-1111-4111-8111-cccccccccccc";
const OTHER_CARD = "dddddddd-1111-4111-8111-dddddddddddd";
const SUB_ID = "55555555-1111-4111-8111-555555555555";

let savedQuery = null;
beforeEach(() => { savedQuery = db.query; });
afterEach(() => { db.query = savedQuery; });

const makeRes = () => ({
  statusCode: 0,
  body: null,
  headers: {},
  setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; }
});

/* A subscription row as the columns actually come back. price_cents is a bigint
   and node-postgres hands bigints over as STRINGS — the handler has to survive
   that, so the fixture is a string on purpose rather than a tidy number. */
const SUB_ROW = {
  id: SUB_ID, org_id: ORG_A, client_id: CID, tier: "gold", status: "active",
  price_cents: "4900", currency: "USD", card_id: CARD_ID,
  provider: "commas", provider_ref: null,
  current_period_start: null, current_period_end: null, cancelled_at: null,
  effective_from: "2026-01-01T00:00:00.000Z", effective_to: null,
  notes: null, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z"
};

const CARD_ROW = {
  id: CARD_ID, org_id: ORG_A, client_id: CID, provider: "commas",
  provider_token: "tok_live_do_not_leak_me", brand: "Visa", last4: "4242",
  exp_month: 11, exp_year: 2029, removed_at: null,
  created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z"
};

/* THE STUB IS A ROUTER, NOT A SINGLE MATCHER, because these handlers issue
   several different statements per request and the point of most of the tests
   below is WHICH statements ran and what they were bound to. Every query is
   recorded — SQL text and parameters — and the recording is what tenancy is
   proved against. An unmatched statement throws rather than returning an empty
   result: a silent `{rows:[]}` for a query nobody anticipated is how a test
   passes while asserting nothing. */
function stubDb({
  role = "owner",
  orgId = ORG_A,
  authenticated = true,
  ownsClient = true,
  handlers = {}
} = {}) {
  const queries = [];
  db.query = async (sql, params) => {
    const text = String(sql);
    // verifySession's CTE — anything that is not one of ours.
    const isSession = /FROM\s+sessions/i.test(text) || /session/i.test(text) && !/subscriptions|client_cards|clients/i.test(text);
    if (isSession) {
      if (!authenticated) return { rows: [] };
      return {
        rows: [{
          session_id: "sess-1",
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
          staff_id: "staff-1",
          org_id: orgId,
          role,
          email: `${role}@fundhub.ai`,
          name: role,
          status: "active",
          active_flag: "true"
        }]
      };
    }

    queries.push({ sql: text, params });

    for (const [name, spec] of Object.entries(ROUTES)) {
      if (!spec.re.test(text)) continue;
      const h = handlers[name];
      if (typeof h === "function") return h(params, text);
      if (h && h.throws) throw h.throws;
      if (h) return { rows: h.rows || [] };
      return { rows: spec.rows ? spec.rows() : [] };
    }
    throw new Error(`test stub: no route for SQL: ${text.slice(0, 90)}`);
  };
  // ownsClient's SELECT 1 is answered by the default below unless overridden.
  if (!("ownsClient" in handlers)) handlers.ownsClient = { rows: ownsClient ? [{ "?column?": 1 }] : [] };
  return queries;
}

/* THE ORDER OF THIS OBJECT IS LOAD-BEARING and it is the thing this harness got
   wrong first, so the reasoning is written down rather than left to be
   rediscovered. Several of these statements match more than one pattern:

     changeTier's SQL is `WITH closed AS (UPDATE …) INSERT INTO subscriptions …`
     — it matches `subChange` AND `subInsert`. Listing subInsert first made a
     lost-race test (subChange returns no rows) come back 200, because the
     INSERT route answered with a row before the change route was reached.

     cancelSubscription's SQL carries a `SELECT … FROM subscriptions … LIMIT 1`
     inside its `already` CTE — it matches `subCancel` AND `subGetAt`.

   The rule is: the most specific statement wins, so the multi-statement CTEs
   come first and the bare SELECTs come last. Object key order in JS is
   insertion order for string keys, which is what makes this dependable.

   `ran(queries, name)` counts by the same regexes, so a test that wants "no
   second INSERT ran" has to exclude the CTE explicitly — see the change test. */
const ROUTES = {
  ownsClient:   { re: /SELECT\s+1\s+FROM\s+clients/i, rows: () => [{ "?column?": 1 }] },
  subChange:    { re: /WITH\s+closed\s+AS/i, rows: () => [SUB_ROW] },
  subCancel:    { re: /WITH\s+cancelled\s+AS/i, rows: () => [SUB_ROW] },
  cardAttach:   { re: /UPDATE\s+subscriptions\s+s/i, rows: () => [SUB_ROW] },
  subInsert:    { re: /INSERT\s+INTO\s+subscriptions/i, rows: () => [SUB_ROW] },
  subGetAt:     { re: /SELECT[\s\S]*FROM\s+subscriptions[\s\S]*LIMIT\s+1/i, rows: () => [SUB_ROW] },
  subList:      { re: /SELECT[\s\S]*FROM\s+subscriptions/i, rows: () => [SUB_ROW] },
  cardInsert:   { re: /INSERT\s+INTO\s+client_cards/i, rows: () => [CARD_ROW] },
  cardRemove:   { re: /UPDATE\s+client_cards/i, rows: () => [{ ...CARD_ROW, removed_at: "2026-07-31T00:00:00.000Z" }] },
  cardList:     { re: /FROM\s+client_cards/i, rows: () => [CARD_ROW] }
};

async function call(handler, {
  method = "GET", query = {}, body = undefined, ...opts
} = {}) {
  const queries = stubDb(opts);
  const res = makeRes();
  const req = { method, headers: { authorization: "Bearer session-token" }, query, body };
  const thrown = await handler(req, res).then(() => null, (e) => e);
  return { status: res.statusCode, body: res.body, headers: res.headers, queries, thrown };
}

const ran = (queries, name) => queries.filter((q) => ROUTES[name].re.test(q.sql));

/* ════════════════════════════════════════════════════════════════════════════
   GET /api/finance/subscriptions
   ════════════════════════════════════════════════════════════════════════ */

describe("GET /api/finance/subscriptions", () => {

  test("no session is a 401 and reads nothing", async () => {
    const r = await call(subscriptions, { query: { client_id: CID }, authenticated: false });
    assert.equal(r.status, 401);
    assert.deepEqual(r.queries, []);
  });

  for (const role of [...ROLE_SETS.FINANCE]) {
    test(`a ${role} gets the plan and the version chain`, async () => {
      const r = await call(subscriptions, { query: { client_id: CID }, role });
      assert.equal(r.status, 200, `${role} is in ROLE_SETS.FINANCE and was refused`);
      assert.equal(r.body.ok, true);
      assert.ok(r.body.current, "no current plan in the response");
      assert.ok(Array.isArray(r.body.history), "no version chain in the response");
    });
  }

  for (const role of ["closer", "setter", "funding_advisor", "client", "", null]) {
    test(`a ${JSON.stringify(role)} is refused and reads nothing`, async () => {
      const r = await call(subscriptions, { query: { client_id: CID }, role });
      assert.equal(r.status, 403,
        "a price is money, and the gate on money is deny-by-default");
      assert.deepEqual(r.queries, [], "refused, and the subscription was read anyway");
    });
  }

  test("a session with no org matches nothing — it does not fall back to a default", async () => {
    const r = await call(subscriptions, { query: { client_id: CID }, orgId: null });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "org_required");
    assert.deepEqual(r.queries, []);
  });

  test("a malformed client_id is a 400 before any query, not a 500 after one", async () => {
    const r = await call(subscriptions, { query: { client_id: "not-a-uuid" } });
    assert.equal(r.status, 400);
    assert.deepEqual(r.queries, []);
  });

  test("a client in ANOTHER org is a 403 and the subscription is never read", async () => {
    const r = await call(subscriptions, { query: { client_id: OTHER_CLIENT }, ownsClient: false });
    assert.equal(r.status, 403);
    assert.equal(ran(r.queries, "subList").length, 0,
      "the ownership check failed and the plan was read anyway");
  });

  test("both reads carry the SESSION's org, never one from the query string", async () => {
    const r = await call(subscriptions, {
      query: { client_id: CID, org_id: ORG_B }
    });
    assert.equal(r.status, 200);
    const reads = r.queries.filter((q) => /subscriptions/i.test(q.sql));
    assert.ok(reads.length >= 2, "expected the live-version read and the version chain");
    for (const q of reads) {
      assert.ok(q.params.includes(ORG_A),
        "a subscription read did not carry the caller's org — one company could read another's prices");
      assert.ok(!q.params.includes(ORG_B), "an org id from the query string reached the database");
    }
  });

  test("the live version is READ, not guessed from the newest row in the chain", async () => {
    // A change dated in the future makes history[0] the wrong answer: it is the
    // newest by effective_from and is not the one in force. The endpoint must
    // ask the store, which applies the half-open window.
    const future = { ...SUB_ROW, id: "future", effective_from: "2099-01-01T00:00:00.000Z" };
    const r = await call(subscriptions, {
      query: { client_id: CID },
      handlers: {
        subGetAt: { rows: [SUB_ROW] },
        subList: { rows: [future, SUB_ROW] }
      }
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.current.id, SUB_ID,
      "current was taken from the top of the history list, which is the future row");
    assert.equal(r.body.history.length, 2);
  });

  test("an unknown price reaches the screen as null, NEVER as 0.00", async () => {
    const r = await call(subscriptions, {
      query: { client_id: CID },
      handlers: {
        subGetAt: { rows: [{ ...SUB_ROW, price_cents: null }] },
        subList: { rows: [{ ...SUB_ROW, price_cents: null }] }
      }
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.current.price_display, null,
      "an unrecorded price was formatted as a figure — the screen would print it as money");
    assert.equal(r.body.current.price_cents, null);
  });

  test("a known price is formatted once, on the server, as a 2dp string", async () => {
    const r = await call(subscriptions, { query: { client_id: CID } });
    assert.equal(r.body.current.price_display, "49.00",
      "19.90 as a float is not 19.90 — the formatting is fromCents() and it is not the browser's job");
  });

  test("a client with no subscription at all is a 200 saying so, not a 404", async () => {
    const r = await call(subscriptions, {
      query: { client_id: CID },
      handlers: { subGetAt: { rows: [] }, subList: { rows: [] } }
    });
    assert.equal(r.status, 200, "no plan yet is a fact about the client, not a broken request");
    assert.equal(r.body.current, null);
    assert.deepEqual(r.body.history, []);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   POST /api/finance/subscriptions
   ════════════════════════════════════════════════════════════════════════ */

describe("POST /api/finance/subscriptions", () => {

  const post = (body, opts = {}) =>
    call(subscriptions, { method: "POST", body, query: {}, ...opts });

  test("an org_id in the body is refused outright — it is not ignored", async () => {
    const r = await post({ action: "start", client_id: CID, org_id: ORG_B, tier: "gold" });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "org_id_not_accepted");
    assert.deepEqual(r.queries, []);
  });

  test("an unknown action is a 400 and writes nothing", async () => {
    const r = await post({ action: "upgrade_everyone", client_id: CID });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "invalid_action");
    assert.equal(ran(r.queries, "subInsert").length, 0);
  });

  test("start converts DOLLARS to integer cents once, at the boundary", async () => {
    const r = await post({ action: "start", client_id: CID, tier: "gold", price: "49.00" });
    assert.equal(r.status, 200);
    const ins = ran(r.queries, "subInsert")[0];
    assert.ok(ins, "nothing was inserted");
    assert.ok(ins.params.includes(4900),
      "the price did not reach the database as integer cents — it was bound as " +
      JSON.stringify(ins.params));
    assert.ok(!ins.params.includes("49.00"), "a dollar string reached a cents column");
  });

  test("start files the row under the SESSION's org", async () => {
    const r = await post({ action: "start", client_id: CID, tier: "gold", price: "49.00" });
    const ins = ran(r.queries, "subInsert")[0];
    assert.equal(ins.params[0], ORG_A);
  });

  test("start with no price records UNKNOWN, not free", async () => {
    const r = await post({ action: "start", client_id: CID, tier: "gold" });
    assert.equal(r.status, 200);
    const ins = ran(r.queries, "subInsert")[0];
    assert.ok(!ins.params.includes(0),
      "an unrecorded price was written as 0 — the client is now on a plan that reads as free");
  });

  test("start with an empty price string records unknown, not zero", async () => {
    const r = await post({ action: "start", client_id: CID, tier: "gold", price: "" });
    assert.equal(r.status, 200);
    const ins = ran(r.queries, "subInsert")[0];
    assert.equal(ins.params[4], null, "an empty price box became a real number");
  });

  test("a NEGATIVE price is a 400 with the reason, not a 500", async () => {
    const r = await post({ action: "start", client_id: CID, tier: "gold", price: "-49.00" });
    assert.equal(r.status, 400,
      "assertPriceCents throws RangeError; without that branch this was HTTP 500 'the server broke'");
    assert.match(String(r.body.error), /negative/i);
    assert.equal(ran(r.queries, "subInsert").length, 0);
  });

  test("a fractional price_cents is refused rather than rounded", async () => {
    const r = await post({ action: "start", client_id: CID, tier: "gold", price_cents: 49.5 });
    assert.equal(r.status, 400, "49.5 cents is not a price; rounding it charges the wrong amount");
    assert.equal(ran(r.queries, "subInsert").length, 0);
  });

  test("price and price_cents together are refused, not silently resolved", async () => {
    const r = await post({ action: "start", client_id: CID, tier: "gold", price: "49.00", price_cents: 4901 });
    assert.equal(r.status, 400);
    assert.match(String(r.body.error), /not both/i);
    assert.equal(ran(r.queries, "subInsert").length, 0);
  });

  test("a missing tier is a 400 naming the field", async () => {
    const r = await post({ action: "start", client_id: CID, price: "49.00" });
    assert.equal(r.status, 400);
    assert.match(String(r.body.error), /tier/i);
  });

  test("an overlapping signup answers 409 with the sentence, not a constraint name", async () => {
    const overlap = Object.assign(new Error("conflicting key value violates exclusion constraint"),
      { code: "23P01", constraint: "subscriptions_no_overlap" });
    const r = await post({ action: "start", client_id: CID, tier: "gold", price: "49.00" },
      { handlers: { subInsert: { throws: overlap } } });
    assert.equal(r.status, 409, "'somebody else got here first' is not a server fault");
    assert.match(String(r.body.error), /already has a subscription/i);
    assert.ok(!/23P01|constraint/i.test(String(r.body.error)),
      "the caller was shown a Postgres constraint name");
  });

  test("change closes the old version and opens the new one in ONE statement", async () => {
    const r = await post({ action: "change", client_id: CID, tier: "platinum", price: "99.00" });
    assert.equal(r.status, 200);
    assert.equal(ran(r.queries, "subChange").length, 1);
    assert.equal(ran(r.queries, "subCancel").length, 0,
      "the change was split into a cancel plus a start — that leaves a window with no plan");
    // The change statement IS an INSERT (inside the CTE), so a bare count of
    // INSERTs would always be 1. What must not exist is a SECOND, standalone one.
    const standaloneInserts = r.queries.filter(
      (q) => /INSERT\s+INTO\s+subscriptions/i.test(q.sql) && !/WITH\s+closed\s+AS/i.test(q.sql));
    assert.equal(standaloneInserts.length, 0,
      "a separate INSERT ran alongside the change statement — the client was briefly on two plans");
  });

  test("change binds the new price as cents and carries the session org", async () => {
    const r = await post({ action: "change", client_id: CID, tier: "platinum", price: "99.00" });
    const q = ran(r.queries, "subChange")[0];
    assert.ok(q.params.includes(9900), "the new price did not reach the database as cents");
    assert.equal(q.params[0], ORG_A);
  });

  test("change with an EXPLICIT null price is refused rather than quietly keeping the old one", async () => {
    const r = await post({ action: "change", client_id: CID, tier: "platinum", price: null });
    assert.equal(r.status, 400,
      "changeTier's ?? chain turns a deliberate null into 'carry the old price forward', " +
      "which puts a number nobody chose on a live subscription");
    assert.equal(ran(r.queries, "subChange").length, 0);
  });

  test("change with no price field at all still carries the current price forward", async () => {
    const r = await post({ action: "change", client_id: CID, tier: "platinum" });
    assert.equal(r.status, 200, "omitting the price means 'leave it alone' and must still work");
    assert.equal(ran(r.queries, "subChange").length, 1);
  });

  test("a change to identical terms is a 400, not a new version of nothing", async () => {
    // planChange refuses it: a version that changes nothing puts a date on an
    // event that did not happen.
    const r = await post({ action: "change", client_id: CID, tier: "gold", price: "49.00" });
    assert.equal(r.status, 400);
    assert.match(String(r.body.error), /unchanged/i);
    assert.equal(ran(r.queries, "subChange").length, 0);
  });

  test("a change that lost the race answers 409 and says nothing was saved", async () => {
    const r = await post({ action: "change", client_id: CID, tier: "platinum", price: "99.00" },
      { handlers: { subChange: { rows: [] } } });
    assert.equal(r.status, 409);
    assert.match(String(r.body.error), /nothing was saved/i);
  });

  test("cancel passes BOTH dates through — asked-on and ends-on are not the same date", async () => {
    const r = await post({
      action: "cancel", client_id: CID,
      at: "2026-07-31T00:00:00.000Z", ends_at: "2026-08-31T00:00:00.000Z"
    });
    assert.equal(r.status, 200);
    const q = ran(r.queries, "subCancel")[0];
    assert.equal(q.params[2].toISOString(), "2026-07-31T00:00:00.000Z", "cancelled_at was not the asked date");
    assert.equal(q.params[3].toISOString(), "2026-08-31T00:00:00.000Z", "effective_to was not the paid-through date");
  });

  test("cancelling with nothing to cancel is a 404, not a cheerful 200", async () => {
    const r = await post({ action: "cancel", client_id: CID },
      { handlers: { subCancel: { rows: [] } } });
    assert.equal(r.status, 404);
  });

  test("a client in another org cannot be written to", async () => {
    const r = await post({ action: "start", client_id: OTHER_CLIENT, tier: "gold", price: "49.00" },
      { ownsClient: false });
    assert.equal(r.status, 403);
    assert.equal(ran(r.queries, "subInsert").length, 0);
  });

  test("a PUT is a 405 with an allow header and touches nothing", async () => {
    const r = await call(subscriptions, { method: "PUT", body: {}, query: {} });
    assert.equal(r.status, 405);
    assert.equal(r.headers.allow, "GET, POST");
    assert.deepEqual(r.queries, []);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   /api/finance/cards
   ════════════════════════════════════════════════════════════════════════ */

describe("GET /api/finance/cards", () => {

  test("the provider token NEVER leaves the server", async () => {
    const r = await call(cards, { query: { client_id: CID } });
    assert.equal(r.status, 200);
    const body = JSON.stringify(r.body);
    assert.ok(!body.includes("tok_live_do_not_leak_me"),
      "the live processor token was serialised into the response — that string is a chargeable credential");
    assert.equal(r.body.cards[0].token_present, true,
      "the screen still has to be able to say a token is on file");
    assert.equal(r.body.cards[0].last4, "4242");
  });

  test("include_removed=0 means OFF, not 'any value is truthy'", async () => {
    for (const raw of ["0", "false", "no", ""]) {
      const r = await call(cards, { query: { client_id: CID, include_removed: raw } });
      assert.equal(r.body.include_removed, false, `include_removed=${JSON.stringify(raw)} turned it on`);
      assert.equal(ran(r.queries, "cardList")[0].params[2], false);
    }
    for (const raw of ["1", "true", "yes"]) {
      const r = await call(cards, { query: { client_id: CID, include_removed: raw } });
      assert.equal(r.body.include_removed, true, `include_removed=${JSON.stringify(raw)} did not turn it on`);
      assert.equal(ran(r.queries, "cardList")[0].params[2], true);
    }
  });

  test("the card read carries the session org, never one from the query string", async () => {
    const r = await call(cards, { query: { client_id: CID, org_id: ORG_B } });
    const q = ran(r.queries, "cardList")[0];
    assert.equal(q.params[0], ORG_A);
    assert.ok(!q.params.includes(ORG_B));
  });

  for (const role of ["closer", "setter", "funding_advisor", "client"]) {
    test(`a ${role} cannot list payment instruments`, async () => {
      const r = await call(cards, { query: { client_id: CID }, role });
      assert.equal(r.status, 403);
      assert.deepEqual(r.queries, []);
    });
  }
});

describe("POST /api/finance/cards — add", () => {

  const add = (body, opts = {}) =>
    call(cards, { method: "POST", query: {}, body: { action: "add", client_id: CID, ...body }, ...opts });

  test("a token reference is stored, with brand, last four and expiry", async () => {
    const r = await add({ provider_token: "tok_abc123", brand: "Visa", last4: "4242", exp_month: 11, exp_year: 2029 });
    assert.equal(r.status, 200);
    const ins = ran(r.queries, "cardInsert")[0];
    assert.ok(ins, "nothing was written");
    assert.equal(ins.params[0], ORG_A, "the card was not filed under the caller's org");
    assert.equal(ins.params[1], CID);
    assert.equal(ins.params[3], "tok_abc123");
    assert.equal(r.body.card.token_present, true);
    assert.ok(!JSON.stringify(r.body).includes("tok_abc123"),
      "the add response echoed the token back");
  });

  test("add needs no card_id — the regression the moved check exists to prevent", async () => {
    const r = await add({ provider_token: "tok_abc123" });
    assert.equal(r.status, 200,
      "the blanket card_id check rejected an add with a message about a field it must not send");
  });

  /* THE CARD-DATA REFUSALS. Each of these is a person typing something into the
     add form that must never be stored, and each must be refused BEFORE the
     insert, with an answer that names what was wrong. */
  for (const [label, body] of [
    ["a PAN in a field called pan", { provider_token: "tok_ok", pan: "4111111111111111" }],
    ["a PAN in a field called card_number", { provider_token: "tok_ok", card_number: "4111111111111111" }],
    ["a CVV", { provider_token: "tok_ok", cvv: "123" }],
    ["a security_code", { provider_token: "tok_ok", security_code: "123" }],
    ["a card number typed into the token box", { provider_token: "4111 1111 1111 1111" }],
    ["a card number typed into the last4 box", { provider_token: "tok_ok", last4: "4111111111111111" }]
  ]) {
    test(`${label} is refused before anything is written`, async () => {
      const r = await add(body);
      assert.equal(r.status, 400, `${label} was accepted`);
      assert.equal(ran(r.queries, "cardInsert").length, 0,
        `${label} reached the database`);
      assert.ok(String(r.body.error).length > 10,
        "the refusal must say what was wrong — the person who sent it is the person who has to fix it");
      assert.ok(!String(r.body.error).includes("4111"),
        "the error message quoted the card number back, which puts it in the logs");
    });
  }

  test("a missing token is refused — there is nothing else to identify the card by", async () => {
    const r = await add({ brand: "Visa", last4: "4242" });
    assert.equal(r.status, 400);
    assert.match(String(r.body.error), /provider_token/i);
    assert.equal(ran(r.queries, "cardInsert").length, 0);
  });

  test("a 13th month is a 400, not a 500", async () => {
    const r = await add({ provider_token: "tok_ok", exp_month: 13 });
    assert.equal(r.status, 400, "readExpMonth throws RangeError — without that branch this was HTTP 500");
    assert.match(String(r.body.error), /exp_month/i);
  });

  test("a two-digit expiry year is refused rather than expanded", async () => {
    const r = await add({ provider_token: "tok_ok", exp_year: 29 });
    assert.equal(r.status, 400,
      "the rule that reads 29 as 2029 reads 99 as 2099, and a card is not valid for seventy years");
    assert.match(String(r.body.error), /exp_year/i);
  });

  test("a token already on file for ANOTHER client is a 409, not a 500", async () => {
    const r = await add({ provider_token: "tok_abc123" }, {
      handlers: { cardInsert: { rows: [] } }   // the upsert's client guard matched nothing
    });
    assert.equal(r.status, 409);
    assert.match(String(r.body.error), /different client/i);
    assert.ok(!String(r.body.error).startsWith("putClientCard:"),
      "the function name was left on the front of a sentence a person has to read");
  });

  test("a client in another org cannot have a card added to them", async () => {
    const r = await call(cards, {
      method: "POST", query: {}, ownsClient: false,
      body: { action: "add", client_id: OTHER_CLIENT, provider_token: "tok_abc123" }
    });
    assert.equal(r.status, 403);
    assert.equal(ran(r.queries, "cardInsert").length, 0);
  });
});

describe("POST /api/finance/cards — attach and remove", () => {

  const post = (body, opts = {}) =>
    call(cards, { method: "POST", query: {}, body: { client_id: CID, ...body }, ...opts });

  test("attach points the live subscription at the card, scoped to the session org", async () => {
    const r = await post({ action: "attach", card_id: CARD_ID });
    assert.equal(r.status, 200);
    const q = ran(r.queries, "cardAttach")[0];
    assert.deepEqual(q.params, [ORG_A, CID, CARD_ID]);
  });

  test("attaching with no live subscription is a 409 carrying the reason, not a 500", async () => {
    const r = await post({ action: "attach", card_id: CARD_ID },
      { handlers: { cardAttach: { rows: [] } } });
    assert.equal(r.status, 409,
      "attachCard throws a PLAIN Error, which api.mjs renders as 'the server broke'");
    assert.match(String(r.body.error), /no live subscription/i);
    assert.ok(!String(r.body.error).startsWith("attachCard:"));
  });

  test("attach with a malformed card_id is a 400 before the write", async () => {
    const r = await post({ action: "attach", card_id: "nope" });
    assert.equal(r.status, 400);
    assert.equal(ran(r.queries, "cardAttach").length, 0);
  });

  test("remove checks the card belongs to THIS client BEFORE stamping it", async () => {
    // Same org, different client. removeClientCard scopes to the org and not to
    // the client, so checking afterwards would already have removed it.
    const r = await post({ action: "remove", card_id: OTHER_CARD }, {
      handlers: { cardList: { rows: [CARD_ROW] } }   // this client's cards do not include it
    });
    assert.equal(r.status, 404);
    assert.equal(ran(r.queries, "cardRemove").length, 0,
      "another client's card was stamped removed and then reported as not found");
  });

  test("remove retires the card and reports the removal date", async () => {
    const r = await post({ action: "remove", card_id: CARD_ID });
    assert.equal(r.status, 200);
    const q = ran(r.queries, "cardRemove")[0];
    assert.equal(q.params[0], ORG_A);
    assert.equal(q.params[1], CARD_ID);
    assert.equal(r.body.card.removed_at, "2026-07-31T00:00:00.000Z");
    assert.ok(!JSON.stringify(r.body).includes("tok_live_do_not_leak_me"),
      "the remove response handed the token back on the way out");
  });

  test("remove is a stamp, never a delete", async () => {
    const r = await post({ action: "remove", card_id: CARD_ID });
    const q = ran(r.queries, "cardRemove")[0];
    assert.match(q.sql, /UPDATE\s+client_cards/i);
    assert.ok(!/DELETE\s+FROM/i.test(q.sql),
      "a card that paid for something has to stay resolvable from the subscription that used it");
  });

  test("an unknown action is a 400 and writes nothing", async () => {
    const r = await post({ action: "charge_it", card_id: CARD_ID });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "invalid_action");
  });

  test("an org_id in the body is refused outright", async () => {
    const r = await post({ action: "remove", card_id: CARD_ID, org_id: ORG_B });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "org_id_not_accepted");
    assert.deepEqual(r.queries, []);
  });

  test("a session with no org writes nothing", async () => {
    const r = await post({ action: "remove", card_id: CARD_ID }, { orgId: null });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "org_required");
    assert.deepEqual(r.queries, []);
  });
});

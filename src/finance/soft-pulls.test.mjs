// Unit tests for the soft-pull ledger — the rules that hold before Postgres is
// involved at all.
//
// These run in every CI pass, with or without DATABASE_URL. The Postgres half
// (the refusal surviving to the table, and a result landing through
// ingestCrsResult) is in soft-pulls.pg.test.mjs and src/http/finance-soft-pull.pg.test.mjs.
//
// WHAT THIS FILE IS FOR. The rule "an unattributed pull is refused" is only true
// if the refusal happens BEFORE anything is written. A guard that runs after the
// INSERT, or that lets a query go out and relies on a constraint to bounce it,
// is a different and weaker promise. So most of these assert on the fake db's
// call log — "no query was issued" — rather than on the thrown error alone.

import { test, describe } from "node:test";
import assert from "node:assert";

import {
  requestSoftPull,
  fulfilSoftPull,
  closeSoftPull,
  recordPull,
  getLatestPull,
  listSoftPullRequests,
  openRequestFor,
  normalizeRequester,
  normalizeReason,
  normalizeCostCents,
  costDisplay,
  decorate,
  SoftPullError,
  SOFT_PULL_STATUSES,
  REQUESTER_KINDS
} from "./soft-pulls.mjs";

/* fakeDb — records every query and answers from a scripted queue. No pool, so
   withTransaction() runs the callback directly (same seam src/pii/index.mjs
   uses). `rows` is a list of result sets, consumed in order. */
function fakeDb(rows = []) {
  const calls = [];
  const queue = [...rows];
  return {
    calls,
    query: async (text, params) => {
      calls.push({ text, params });
      return queue.length ? queue.shift() : { rows: [] };
    }
  };
}

const ORG = "11111111-1111-1111-1111-111111111111";
const CLIENT = "22222222-2222-2222-2222-222222222222";
const STAFF = "33333333-3333-3333-3333-333333333333";
const ACCOUNT = "44444444-4444-4444-4444-444444444444";

const rowFor = (over = {}) => ({
  id: "55555555-5555-5555-5555-555555555555",
  org_id: ORG, client_id: CLIENT,
  requested_by_kind: "staff", requested_by_staff_id: STAFF, requested_by_account_id: null,
  reason: "closer refreshing the waterfall", cost_cents: null, subscription_id: null,
  crs_result_id: null, status: "queued", state_reason: null, provider: "internal",
  idempotency_key: null, requested_at: new Date(), resolved_at: null,
  created_at: new Date(), updated_at: new Date(),
  ...over
});

const ok = { orgId: ORG, clientId: CLIENT, requestedBy: { kind: "staff", id: STAFF }, reason: "why" };

// ── rule 1: no attribution, no pull ─────────────────────────────────────────

describe("an unattributed soft pull is refused before anything is written", () => {
  const unattributed = [
    ["requestedBy absent", undefined],
    ["requestedBy null", null],
    ["requestedBy empty object", {}],
    ["a kind with no subject", { kind: "staff" }],
    ["a subject with no kind", { id: STAFF }],
    ["an empty-string id", { kind: "staff", id: "" }],
    ["a null id", { kind: "staff", id: null }],
    ["a blank kind", { kind: "   ", id: STAFF }],
    ["a client kind carrying only a staff id", { kind: "client", staffId: STAFF }],
    ["a staff kind carrying only an account id", { kind: "staff", accountId: ACCOUNT }]
  ];

  for (const [label, requestedBy] of unattributed) {
    test(`${label} is a 401 and issues no query`, async () => {
      const db = fakeDb();
      await assert.rejects(
        () => requestSoftPull(db, { ...ok, requestedBy }),
        (e) => {
          assert.ok(e instanceof SoftPullError, `threw ${e.name}, not SoftPullError`);
          assert.equal(e.status, 401, `${label} produced ${e.status}, not 401`);
          assert.match(e.message, /unattributed/);
          return true;
        }
      );
      assert.deepEqual(db.calls, [],
        `${label} reached the database — the refusal must happen before any write`);
    });
  }

  test("401, not 400: this is 'we will not record this', not 'try again with better input'", async () => {
    // Mirrors revealSsn() in src/pii/index.mjs, which raises 401 for a missing
    // accessedBy and 400 for everything else. The status is the distinction
    // between a malformed request and one nobody will stand behind.
    await assert.rejects(() => requestSoftPull(fakeDb(), { ...ok, requestedBy: null }),
      (e) => e.status === 401);
    await assert.rejects(() => requestSoftPull(fakeDb(), { ...ok, requestedBy: { kind: "robot", id: STAFF } }),
      (e) => e.status === 400);
  });

  test("a kind outside the two the table accepts is refused, not coerced", async () => {
    for (const kind of ["robot", "affiliate", "partner", "system", "admin"]) {
      const db = fakeDb();
      await assert.rejects(() => requestSoftPull(db, { ...ok, requestedBy: { kind, id: STAFF } }),
        (e) => e instanceof SoftPullError && e.status === 400);
      assert.deepEqual(db.calls, [], `kind ${kind} reached the database`);
    }
  });

  test("normalizeRequester accepts both natural principal shapes", () => {
    assert.deepEqual(normalizeRequester({ kind: "staff", staffId: STAFF }),
      { kind: "staff", staffId: STAFF, accountId: null });
    assert.deepEqual(normalizeRequester({ kind: "client", accountId: ACCOUNT }),
      { kind: "client", staffId: null, accountId: ACCOUNT });
    // A client principal's subject is the ACCOUNT id, not the client id: 077's
    // FK points at accounts(id), because that is who tapped.
    assert.deepEqual(normalizeRequester({ kind: "CLIENT", id: ACCOUNT }),
      { kind: "client", staffId: null, accountId: ACCOUNT });
  });
});

// ── the reason is required, and a blank one is not a reason ─────────────────

describe("a soft pull with no stated reason is refused before anything is written", () => {
  for (const reason of [undefined, null, "", "   ", "\t", "\n", " \t\n ", 42, 0, true, false, {}, [], ["why"], 3.14]) {
    test(`reason ${JSON.stringify(reason)} is a 400 and issues no query`, async () => {
      const db = fakeDb();
      await assert.rejects(
        () => requestSoftPull(db, { ...ok, reason }),
        (e) => e instanceof SoftPullError && e.status === 400 && /reason is required/.test(e.message)
      );
      assert.deepEqual(db.calls, [],
        `reason ${JSON.stringify(reason)} reached the database`);
    });
  }

  test("a real reason is trimmed and otherwise kept verbatim", () => {
    assert.equal(normalizeReason("   closer working the file — Ramírez (2 of 3)   "),
      "closer working the file — Ramírez (2 of 3)");
  });

  test("a non-string reason is never coerced into the sentence an auditor reads", () => {
    // "42" and "[object Object]" are not explanations. Refusing beats storing
    // something that looks populated and says nothing.
    for (const r of [42, {}, [], true]) {
      assert.throws(() => normalizeReason(r), (e) => e instanceof SoftPullError);
    }
  });
});

// ── money: cents, and NULL means unknown ────────────────────────────────────

describe("cost is integer cents and NULL survives as unknown", () => {
  test("absent cost stays null — it is not read as free", () => {
    for (const v of [null, undefined, ""]) assert.equal(normalizeCostCents(v), null);
  });

  test("a dollars-shaped float is refused rather than rounded", () => {
    // 12.5 from a caller means dollars. Accepting it as cents turns a $12.50
    // charge into 12 cents; rounding it turns it into 13. Both are wrong and
    // only a refusal says so.
    for (const v of [12.5, 0.1, -0.5, "12.50", 1e-3]) {
      assert.throws(() => normalizeCostCents(v), (e) => e instanceof SoftPullError,
        `${v} was accepted as cents`);
    }
  });

  test("a negative cost is refused", () => {
    assert.throws(() => normalizeCostCents(-1), (e) => e instanceof SoftPullError);
  });

  test("integers and integer strings are accepted as cents", () => {
    assert.equal(normalizeCostCents(0), 0);
    assert.equal(normalizeCostCents(1200), 1200);
    assert.equal(normalizeCostCents("1200"), 1200);
  });

  test("costDisplay renders cents as a 2dp string and leaves NULL alone", () => {
    assert.equal(costDisplay(1200), "12.00");
    assert.equal(costDisplay(5), "0.05");
    assert.equal(costDisplay(0), "0.00");
    // The one that matters: unknown must not render as zero on a screen.
    assert.equal(costDisplay(null), null);
    assert.equal(costDisplay(undefined), null);
  });

  test("decorate adds the display value without losing the cents", () => {
    const d = decorate(rowFor({ cost_cents: 1200 }));
    assert.equal(d.cost_cents, 1200);
    assert.equal(d.cost_display, "12.00");
    assert.equal(decorate(rowFor({ cost_cents: null })).cost_display, null);
  });

  test("a cost that cannot be parsed is refused before any query", async () => {
    const db = fakeDb();
    await assert.rejects(() => requestSoftPull(db, { ...ok, costCents: 12.5 }),
      (e) => e instanceof SoftPullError);
    assert.deepEqual(db.calls, []);
  });
});

// ── rule 2: one tap is one pull ────────────────────────────────────────────

describe("one tap is one pull", () => {
  test("a repeated idempotency key returns the first request and inserts nothing", async () => {
    const existing = rowFor({ idempotency_key: "tap-1" });
    const db = fakeDb([{ rows: [existing] }]);
    const out = await requestSoftPull(db, { ...ok, idempotencyKey: "tap-1" });

    assert.equal(out.created, false);
    assert.equal(out.reason, "replay");
    assert.equal(out.request.id, existing.id);
    assert.equal(db.calls.length, 1, "a replayed tap issued more than the lookup");
    assert.ok(!/INSERT/i.test(db.calls[0].text), "a replayed tap issued an INSERT");
  });

  test("an already-open request for the client is returned, not duplicated", async () => {
    const open = rowFor();
    // no idempotency key → first query is the open-request lookup
    const db = fakeDb([{ rows: [open] }]);
    const out = await requestSoftPull(db, ok);

    assert.equal(out.created, false);
    assert.equal(out.reason, "already_open");
    assert.equal(out.request.id, open.id);
    assert.ok(!db.calls.some((c) => /INSERT/i.test(c.text)),
      "a second tap while one was open still inserted a consumer-credit event");
  });

  test("with nothing open, the request is inserted as queued", async () => {
    const db = fakeDb([{ rows: [] }, { rows: [rowFor()] }]);
    const out = await requestSoftPull(db, ok);

    assert.equal(out.created, true);
    const insert = db.calls.find((c) => /INSERT INTO soft_pull_requests/i.test(c.text));
    assert.ok(insert, "no insert was issued");
    assert.match(insert.text, /'queued'/,
      "the row was not written as queued — nothing transmits, so nothing may start elsewhere");
  });

  test("the insert carries the session's attribution, in the columns 077 checks", async () => {
    const db = fakeDb([{ rows: [] }, { rows: [rowFor()] }]);
    await requestSoftPull(db, { ...ok, requestedBy: { kind: "client", id: ACCOUNT } });
    const insert = db.calls.find((c) => /INSERT INTO soft_pull_requests/i.test(c.text));
    // [orgId, clientId, kind, staffId, accountId, reason, ...]
    assert.equal(insert.params[2], "client");
    assert.equal(insert.params[3], null, "a client request named a staff member");
    assert.equal(insert.params[4], ACCOUNT);
  });

  test("provider defaults to 'internal' — the same word a queued message carries", async () => {
    const db = fakeDb([{ rows: [] }, { rows: [rowFor()] }]);
    await requestSoftPull(db, ok);
    const insert = db.calls.find((c) => /INSERT INTO soft_pull_requests/i.test(c.text));
    assert.equal(insert.params[9], "internal");
  });

  test("a blank idempotency key is stored as NULL, not as an empty string", async () => {
    // "" in a unique index is a value, so two unrelated taps that both send ""
    // would collide and the second client would be handed the first one's row.
    const db = fakeDb([{ rows: [] }, { rows: [rowFor()] }]);
    await requestSoftPull(db, { ...ok, idempotencyKey: "   " });
    const insert = db.calls.find((c) => /INSERT INTO soft_pull_requests/i.test(c.text));
    assert.equal(insert.params[8], null);
    assert.ok(!db.calls.some((c) => /idempotency_key = \$2/.test(c.text)),
      "a blank key was looked up as though it were a real one");
  });
});

// ── nothing transmits ──────────────────────────────────────────────────────

describe("nothing transmits", () => {
  test("requesting a pull issues database queries and nothing else", async () => {
    // The guard is structural: if somebody adds an outbound call to this module
    // it will not be a db.query, and a fake db cannot answer it. Asserting the
    // call shape is the cheapest standing check that the seam stayed a seam.
    const db = fakeDb([{ rows: [] }, { rows: [rowFor()] }]);
    await requestSoftPull(db, ok);
    assert.ok(db.calls.length > 0);
    for (const c of db.calls) assert.equal(typeof c.text, "string");
  });

  test("the module exports no state the schema cannot hold", () => {
    // A 'sent' status would be a promise nothing can keep — see 077's header.
    assert.deepEqual(SOFT_PULL_STATUSES, ["queued", "fulfilled", "failed", "cancelled"]);
    assert.ok(!SOFT_PULL_STATUSES.includes("sent"));
    assert.deepEqual(REQUESTER_KINDS, ["staff", "client"]);
  });
});

// ── fulfil: one reader of a pull payload ───────────────────────────────────

describe("fulfilling a request", () => {
  test("a missing request id or crs id is refused before any query", async () => {
    for (const args of [{}, { requestId: "r" }, { crsResultId: "c" }]) {
      const db = fakeDb();
      await assert.rejects(() => fulfilSoftPull(db, args), (e) => e instanceof SoftPullError);
      assert.deepEqual(db.calls, []);
    }
  });

  test("an unknown request is a 404 and nothing is ingested", async () => {
    const db = fakeDb([{ rows: [] }]);
    await assert.rejects(() => fulfilSoftPull(db, { requestId: "r", crsResultId: "c" }),
      (e) => e instanceof SoftPullError && e.status === 404);
    assert.ok(!db.calls.some((c) => /INSERT INTO tradelines/i.test(c.text)));
  });

  test("a request that is already resolved cannot be fulfilled twice", async () => {
    const db = fakeDb([{ rows: [rowFor({ status: "fulfilled" })] }]);
    await assert.rejects(() => fulfilSoftPull(db, { requestId: "r", crsResultId: "c" }),
      (e) => e instanceof SoftPullError && e.status === 409);
    assert.ok(!db.calls.some((c) => /UPDATE soft_pull_requests/i.test(c.text)),
      "a resolved request was re-stamped");
  });

  test("a crs row belonging to another client is refused, and nothing is ingested", async () => {
    // The failure this prevents is not a bad status code. It is one person's
    // credit file being ingested as another person's tradelines.
    const db = fakeDb([
      { rows: [rowFor()] },
      { rows: [{ id: "c", org_id: ORG, client_id: "99999999-9999-9999-9999-999999999999", result: {} }] }
    ]);
    await assert.rejects(() => fulfilSoftPull(db, { requestId: "r", crsResultId: "c" }),
      (e) => e instanceof SoftPullError && e.status === 409 && /different client/.test(e.message));
    assert.ok(!db.calls.some((c) => /INSERT INTO tradelines/i.test(c.text)),
      "another client's tradelines were written");
    assert.ok(!db.calls.some((c) => /UPDATE soft_pull_requests/i.test(c.text)));
  });

  test("the ledger is stamped before the tradelines are written", async () => {
    // Order matters: a failure part-way must not leave a client's cards updated
    // by a pull the ledger says never completed.
    const crs = {
      id: "c", org_id: ORG, client_id: CLIENT, created_at: new Date(),
      result: { tradelines: [{ lender: "Amex", credit_limit: 10000, balance: 2500, apr: 18.99, account_ref: "x1" }] }
    };
    const db = fakeDb([
      { rows: [rowFor()] },
      { rows: [crs] },
      { rows: [rowFor({ status: "fulfilled", crs_result_id: "c", resolved_at: new Date() })] },
      { rows: [{ id: "t1", lender: "Amex" }] }
    ]);
    const out = await fulfilSoftPull(db, { requestId: "r", crsResultId: "c" });

    assert.equal(out.request.status, "fulfilled");
    assert.equal(out.ingested, 1);

    const stampAt = db.calls.findIndex((c) => /UPDATE soft_pull_requests/i.test(c.text));
    const ingestAt = db.calls.findIndex((c) => /INSERT INTO tradelines/i.test(c.text));
    assert.ok(stampAt >= 0 && ingestAt >= 0, "one of the two writes never happened");
    assert.ok(stampAt < ingestAt, "tradelines were written before the ledger was stamped");
  });

  test("the ingest goes through src/tradelines — this module writes no tradeline SQL of its own", async () => {
    // Two readers of one payload is the defect class this repo keeps finding.
    // The upsert must carry store.mjs's conflict target, not one invented here.
    const crs = {
      id: "c", org_id: ORG, client_id: CLIENT, created_at: new Date(),
      result: { tradelines: [{ creditor: "Chase", credit_limit: 5000, balance: 100, account_number: "z9" }] }
    };
    const db = fakeDb([
      { rows: [rowFor()] }, { rows: [crs] },
      { rows: [rowFor({ status: "fulfilled", crs_result_id: "c", resolved_at: new Date() })] },
      { rows: [{ id: "t1" }] }
    ]);
    await fulfilSoftPull(db, { requestId: "r", crsResultId: "c" });
    const ingest = db.calls.find((c) => /INSERT INTO tradelines/i.test(c.text));
    assert.match(ingest.text, /ON CONFLICT \(client_id, account_ref\) WHERE account_ref IS NOT NULL/,
      "the tradeline write did not come from src/tradelines/store.mjs");
  });

  test("a pull that parsed to no tradelines still closes the request", async () => {
    // An empty parse is far more likely to be an unrecognised payload shape than
    // a client with no credit. The request was answered either way, and marking
    // it 'failed' would misreport what happened.
    const db = fakeDb([
      { rows: [rowFor()] },
      { rows: [{ id: "c", org_id: ORG, client_id: CLIENT, result: {}, created_at: new Date() }] },
      { rows: [rowFor({ status: "fulfilled", crs_result_id: "c", resolved_at: new Date() })] }
    ]);
    const out = await fulfilSoftPull(db, { requestId: "r", crsResultId: "c" });
    assert.equal(out.ingested, 0);
    assert.equal(out.request.status, "fulfilled");
  });
});

// ── closing without an answer ──────────────────────────────────────────────

describe("closing a request without an answer", () => {
  test("only failed and cancelled are accepted, and neither is the default", async () => {
    for (const status of [undefined, null, "queued", "fulfilled", "done", ""]) {
      const db = fakeDb();
      await assert.rejects(() => closeSoftPull(db, { requestId: "r", status, reason: "x" }),
        (e) => e instanceof SoftPullError);
      assert.deepEqual(db.calls, [], `status ${String(status)} reached the database`);
    }
  });

  test("closing without a stated reason is refused before any query", async () => {
    for (const reason of [undefined, "", "   ", 7]) {
      const db = fakeDb();
      await assert.rejects(() => closeSoftPull(db, { requestId: "r", status: "failed", reason }),
        (e) => e instanceof SoftPullError && /reason is required/.test(e.message));
      assert.deepEqual(db.calls, []);
    }
  });

  test("closing a request that is not queued is a 409, not a silent no-op", async () => {
    const db = fakeDb([{ rows: [] }]);
    await assert.rejects(() => closeSoftPull(db, { requestId: "r", status: "failed", reason: "provider down" }),
      (e) => e instanceof SoftPullError && e.status === 409);
  });

  test("a close only touches queued rows", async () => {
    const db = fakeDb([{ rows: [rowFor({ status: "failed", state_reason: "provider down", resolved_at: new Date() })] }]);
    const out = await closeSoftPull(db, { requestId: "r", status: "failed", reason: "  provider down  " });
    assert.equal(out.status, "failed");
    assert.match(db.calls[0].text, /status = 'queued'/,
      "the close could overwrite an already-resolved request");
    assert.equal(db.calls[0].params[2], "provider down");
  });
});

// ── reads ──────────────────────────────────────────────────────────────────

describe("reading the ledger", () => {
  test("the history is newest first — the order 'why was this pulled' is asked in", async () => {
    const db = fakeDb([{ rows: [rowFor()] }]);
    await listSoftPullRequests(db, { clientId: CLIENT });
    assert.match(db.calls[0].text, /ORDER BY requested_at DESC/);
  });

  test("limit is clamped at BOTH ends", async () => {
    // A negative limit reaching Postgres is a 500 carrying raw driver text —
    // three routes in this repo already shipped that. Math.min alone does not
    // catch it, because parseInt("-1") is truthy.
    for (const [given, want] of [[undefined, 50], [0, 50], [-1, 50], [5, 5], [999999, 200], ["abc", 50]]) {
      const db = fakeDb([{ rows: [] }]);
      await listSoftPullRequests(db, { clientId: CLIENT, limit: given });
      assert.equal(db.calls[0].params[1], want, `limit ${given} produced ${db.calls[0].params[1]}`);
    }
  });

  test("openRequestFor asks only for queued rows", async () => {
    const db = fakeDb([{ rows: [] }]);
    assert.equal(await openRequestFor(db, { clientId: CLIENT }), null);
    assert.match(db.calls[0].text, /status = 'queued'/);
  });

  test("a read with no client is refused rather than returning everybody's", async () => {
    for (const fn of [listSoftPullRequests, openRequestFor]) {
      await assert.rejects(() => fn(fakeDb(), {}), (e) => e instanceof SoftPullError);
    }
  });
});

// ── recordPull / getLatestPull ─────────────────────────────────────────────

describe("recordPull stores the pull and routes it through the one ingest path", () => {
  test("a missing org or client is refused before any query", async () => {
    for (const args of [{}, { orgId: ORG }, { clientId: CLIENT }]) {
      const db = fakeDb();
      await assert.rejects(() => recordPull(db, { ...args, result: {} }),
        (e) => e instanceof SoftPullError);
      assert.deepEqual(db.calls, []);
    }
  });

  test("a payload that is not an object is refused — an empty pull is not a pull", async () => {
    // Storing `{}` would put a row in the history that reads as "we pulled and
    // they have no credit". That is a different and much worse claim than "the
    // pull failed", which is what closeSoftPull(status:'failed') is for.
    for (const result of [undefined, null, "", "{}", 0, 7, true, []]) {
      const db = fakeDb();
      await assert.rejects(() => recordPull(db, { orgId: ORG, clientId: CLIENT, result }),
        (e) => e instanceof SoftPullError, `result ${JSON.stringify(result)} was accepted`);
      assert.deepEqual(db.calls, [], `result ${JSON.stringify(result)} reached the database`);
    }
  });

  test("with no requestId the pull is still stored and still ingested", async () => {
    // The paid path (diagnostic.paid -> C-00) predates the ledger and files no
    // request. Refusing it here would break a flow that already works.
    const payload = { tradelines: [{ lender: "Amex", credit_limit: 9000, account_ref: "a1" }] };
    const crs = { id: "c1", org_id: ORG, client_id: CLIENT, created_at: new Date(), result: payload };
    const db = fakeDb([{ rows: [crs] }, { rows: [{ id: "t1" }] }]);
    const out = await recordPull(db, { orgId: ORG, clientId: CLIENT, result: payload });

    assert.equal(out.crsResult.id, "c1");
    assert.equal(out.request, null, "a pull with no request invented one");
    assert.equal(out.ingested, 1);
    assert.ok(db.calls.some((c) => /INSERT INTO crs_results/i.test(c.text)));
    assert.ok(!db.calls.some((c) => /soft_pull_requests/i.test(c.text)),
      "a pull with no request still touched the ledger");
  });

  test("with a requestId the pull closes the ledger row, in the same transaction", async () => {
    const payload = { tradelines: [{ lender: "Amex", credit_limit: 9000, account_ref: "a1" }] };
    const crs = { id: "c1", org_id: ORG, client_id: CLIENT, created_at: new Date(), result: payload };
    const db = fakeDb([
      { rows: [crs] },
      { rows: [rowFor()] },
      { rows: [crs] },
      { rows: [rowFor({ status: "fulfilled", crs_result_id: "c1", resolved_at: new Date() })] },
      { rows: [{ id: "t1" }] }
    ]);
    const out = await recordPull(db, { orgId: ORG, clientId: CLIENT, requestId: "r1", result: payload });

    assert.equal(out.request.status, "fulfilled");
    assert.equal(out.request.crs_result_id, "c1");
    assert.equal(out.ingested, 1);
  });

  test("the payload is serialised once, as jsonb, and not read by this module", async () => {
    const payload = { tradelines: [{ creditor: "Chase", credit_limit: 5000, account_number: "z9" }] };
    const crs = { id: "c1", org_id: ORG, client_id: CLIENT, created_at: new Date(), result: payload };
    const db = fakeDb([{ rows: [crs] }, { rows: [{ id: "t1" }] }]);
    await recordPull(db, { orgId: ORG, clientId: CLIENT, result: payload });

    const insert = db.calls.find((c) => /INSERT INTO crs_results/i.test(c.text));
    assert.equal(insert.params[2], JSON.stringify(payload));
    assert.equal(insert.params[3], null, "outcome_tier defaulted to something other than unknown");

    // The cards must come out of src/tradelines/store.mjs, not out of a second
    // parser grown here.
    const ingest = db.calls.find((c) => /INSERT INTO tradelines/i.test(c.text));
    assert.match(ingest.text, /ON CONFLICT \(client_id, account_ref\) WHERE account_ref IS NOT NULL/);
  });
});

describe("getLatestPull", () => {
  test("a read with no client is refused rather than returning somebody's", async () => {
    await assert.rejects(() => getLatestPull(fakeDb(), {}), (e) => e instanceof SoftPullError);
    await assert.rejects(() => getLatestPull(fakeDb()), (e) => e instanceof SoftPullError);
  });

  test("null when the client has never been pulled — not an empty object", async () => {
    assert.equal(await getLatestPull(fakeDb([{ rows: [] }]), { clientId: CLIENT }), null);
  });

  test("ordering breaks ties on id, because created_at defaults to now()", async () => {
    // Two pulls recorded in one transaction share a now(). Ordering on the
    // timestamp alone would make "the latest" arbitrary between them.
    const db = fakeDb([{ rows: [{ id: "c2" }] }]);
    await getLatestPull(db, { clientId: CLIENT });
    assert.match(db.calls[0].text, /ORDER BY created_at DESC, id DESC/);
    assert.match(db.calls[0].text, /LIMIT 1/);
  });

  test("it returns the row as stored and does not normalize the payload", async () => {
    // Callers that want the cards read `tradelines`, which recordPull already
    // populated through the one normalizer. A second parser here is exactly what
    // this module refuses to grow.
    const row = { id: "c1", client_id: CLIENT, result: { tradelines: [{ lender: "Amex" }] } };
    const out = await getLatestPull(fakeDb([{ rows: [row] }]), { clientId: CLIENT });
    assert.deepEqual(out, row);
  });
});

// Unit tests for the soft-pull audit record.
//
// SCOPE, STATED HONESTLY: these use a recording stub, so they prove the
// refusals, the parameters each statement is issued with, and that a missing
// value stays missing. They do NOT prove the SQL means what it says — the
// completed_has_result CHECK and the provider_ref uniqueness are claims about
// Postgres and are tested against Postgres in store.pg.test.mjs.
//
// The refusals are the whole point of this module. Every one of them is a case
// where a plausible-looking value must NOT be accepted, because the consumer is
// an audit record that answers "why did you pull my credit".

import { test } from "node:test";
import assert from "node:assert";
import { recordPull, completePull, getLatestPull, listPulls, SoftPullError } from "./store.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const STAFF = "33333333-3333-4333-8333-333333333333";
const RESULT = "44444444-4444-4444-8444-444444444444";
const DOC = "55555555-5555-4555-8555-555555555555";
const PULL = "66666666-6666-4666-8666-666666666666";

function stubDb({ rows = [{ id: PULL }] } = {}) {
  const calls = [];
  return {
    calls,
    query(sql, params = []) {
      calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      return { rows };
    }
  };
}

const lastParams = (db) => db.calls.at(-1).params;

/* ------------------------------ recordPull -------------------------------- */

test("recordPull requires an org and a client", async () => {
  const db = stubDb();
  await assert.rejects(() => recordPull(db, { clientId: CLIENT }), SoftPullError);
  await assert.rejects(() => recordPull(db, { orgId: ORG }), /clientId is required/);
});

test("recordPull defaults to a soft, consumer-only, requested pull", async () => {
  const db = stubDb();
  await recordPull(db, { orgId: ORG, clientId: CLIENT });
  const p = lastParams(db);
  assert.equal(p[2], "soft");
  assert.equal(p[3], "consumer_only");
  assert.equal(p[4], "requested");
});

test("a hard pull is recorded as hard, never quietly as soft", async () => {
  const db = stubDb();
  await recordPull(db, { orgId: ORG, clientId: CLIENT, pullType: "hard" });
  assert.equal(lastParams(db)[2], "hard",
    "a hard pull stored as soft is a misrepresentation to a consumer");
});

test("recordPull refuses an invented status, type or scope rather than coercing", async () => {
  const db = stubDb();
  await assert.rejects(
    () => recordPull(db, { orgId: ORG, clientId: CLIENT, status: "probably_done" }),
    /unknown pull status/);
  await assert.rejects(
    () => recordPull(db, { orgId: ORG, clientId: CLIENT, pullType: "medium" }),
    /unknown pull type/);
  await assert.rejects(
    () => recordPull(db, { orgId: ORG, clientId: CLIENT, scope: "everything" }),
    /unknown pull scope/);
  assert.equal(db.calls.length, 0, "nothing may be written when the input was refused");
});

test("a reason nobody gave stays null — it is never given a default sentence", async () => {
  const db = stubDb();
  await recordPull(db, { orgId: ORG, clientId: CLIENT });
  assert.equal(lastParams(db)[5], null);

  await recordPull(db, { orgId: ORG, clientId: CLIENT, reason: "   " });
  assert.equal(lastParams(db)[5], null,
    "a blank reason is not a reason — a compliance review must see the gap");
});

test("a reason that was given is stored trimmed", async () => {
  const db = stubDb();
  await recordPull(db, { orgId: ORG, clientId: CLIENT, reason: "  Funding application review  " });
  assert.equal(lastParams(db)[5], "Funding application review");
});

test("an actor nobody named stays null — a workflow has no staff member", async () => {
  const db = stubDb();
  await recordPull(db, { orgId: ORG, clientId: CLIENT });
  assert.equal(lastParams(db)[7], null);

  await recordPull(db, { orgId: ORG, clientId: CLIENT, requestedBy: STAFF });
  assert.equal(lastParams(db)[7], STAFF, "a staff-initiated pull does record its actor");
});

test("a missing consent document stays null — the gap is visible, not filled", async () => {
  const db = stubDb();
  await recordPull(db, { orgId: ORG, clientId: CLIENT });
  assert.equal(lastParams(db)[6], null);

  await recordPull(db, { orgId: ORG, clientId: CLIENT, consentDocumentId: DOC });
  assert.equal(lastParams(db)[6], DOC);
});

test("a completed pull must name the result it completed with", async () => {
  const db = stubDb();
  await assert.rejects(
    () => recordPull(db, { orgId: ORG, clientId: CLIENT, status: "completed" }),
    /must name the result/);
  assert.equal(db.calls.length, 0);
});

test("an uncompleted pull cannot carry a result", async () => {
  const db = stubDb();
  await assert.rejects(
    () => recordPull(db, { orgId: ORG, clientId: CLIENT, status: "requested", resultId: RESULT }),
    /cannot carry a result/);
});

test("completed_at is set by the statement, not by the caller's clock", async () => {
  const db = stubDb();
  await recordPull(db, { orgId: ORG, clientId: CLIENT, status: "completed", resultId: RESULT });
  assert.match(db.calls.at(-1).sql, /CASE WHEN \$5 = 'completed' THEN now\(\) ELSE NULL END/);
});

/* ----------------------------- completePull ------------------------------- */

test("completePull requires an id and refuses an unknown status", async () => {
  const db = stubDb();
  await assert.rejects(() => completePull(db, {}), /id is required/);
  await assert.rejects(() => completePull(db, { id: PULL, status: "maybe" }), /unknown pull status/);
});

test("completePull will not mark a pull complete with no result", async () => {
  const db = stubDb();
  await assert.rejects(() => completePull(db, { id: PULL }), /must name the result/);
});

test("a failure keeps its reason and needs no result", async () => {
  const db = stubDb();
  await completePull(db, { id: PULL, status: "failed", failureReason: "bureau timeout" });
  const p = lastParams(db);
  assert.equal(p[1], "failed");
  assert.equal(p[2], null);
  assert.equal(p[3], "bureau timeout");
});

test("a later update that omits the failure text does not erase it", async () => {
  const db = stubDb();
  await completePull(db, { id: PULL, status: "canceled" });
  assert.match(db.calls.at(-1).sql, /failure_reason = COALESCE\(\$4, failure_reason\)/);
});

test("completePull returns null for a pull nobody recorded", async () => {
  const db = stubDb({ rows: [] });
  assert.equal(await completePull(db, { id: PULL, status: "failed" }), null,
    "a result for an unrecorded pull is a real situation, not an exception");
});

/* ----------------------------- getLatestPull ------------------------------ */

test("getLatestPull requires a client", async () => {
  const db = stubDb();
  await assert.rejects(() => getLatestPull(db, {}), /clientId is required/);
});

test("getLatestPull returns null for a client who has never been pulled", async () => {
  const db = stubDb({ rows: [] });
  assert.equal(await getLatestPull(db, { clientId: CLIENT }), null,
    "never pulled is a normal answer, not an error and not a zero");
});

test("getLatestPull takes the newest row deterministically", async () => {
  const db = stubDb();
  await getLatestPull(db, { clientId: CLIENT });
  const sql = db.calls.at(-1).sql;
  assert.match(sql, /ORDER BY requested_at DESC, id DESC/);
  assert.match(sql, /LIMIT 1/);
});

test("getLatestPull never returns the bureau payload", async () => {
  const db = stubDb();
  await getLatestPull(db, { clientId: CLIENT });
  const sql = db.calls.at(-1).sql;
  assert.doesNotMatch(sql, /\bresult\b(?!_id)/,
    "a latest-pull summary must not carry the bureau file — result_id is enough");
  assert.doesNotMatch(sql, /SELECT \*/);
});

test("getLatestPull can be narrowed to hard pulls, and refuses a made-up type", async () => {
  const db = stubDb();
  await getLatestPull(db, { clientId: CLIENT, pullType: "hard" });
  assert.equal(lastParams(db)[1], "hard");
  await assert.rejects(() => getLatestPull(db, { clientId: CLIENT, pullType: "squishy" }), /unknown pull type/);
});

/* ------------------------------- listPulls -------------------------------- */

test("listPulls bounds its limit so a history read cannot become a firehose", async () => {
  const db = stubDb({ rows: [] });
  await listPulls(db, { clientId: CLIENT, limit: 100000 });
  assert.equal(lastParams(db)[1], 200);

  await listPulls(db, { clientId: CLIENT, limit: 0 });
  assert.equal(lastParams(db)[1], 1);

  await listPulls(db, { clientId: CLIENT, limit: "not a number" });
  assert.equal(lastParams(db)[1], 50);
});

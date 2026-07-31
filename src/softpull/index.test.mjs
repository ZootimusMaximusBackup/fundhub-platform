// Unit tests for the soft-pull request module.
//
// SCOPE, STATED HONESTLY: these use a recording stub, so they prove the argument
// checking, which statement is issued, and what it is issued with. They do NOT
// prove the SQL means what it says — the replay key and the four CHECK
// constraints are claims about Postgres, and they are tested against Postgres in
// index.pg.test.mjs.

import { test } from "node:test";
import assert from "node:assert";
import {
  recordPull, getLatestPull, listPulls, settlePull,
  normalizeReason, isSettled, PULL_STATUSES
} from "./index.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const STAFF = "33333333-3333-4333-8333-333333333333";
const CRS = "44444444-4444-4444-8444-444444444444";
const PULL = "55555555-5555-4555-8555-555555555555";

function stubDb({ insertReturns = [{ id: PULL, status: "requested" }], selectReturns = [] } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      if (/^INSERT INTO soft_pull_requests/i.test(sql.trim())) return { rows: insertReturns };
      if (/^UPDATE soft_pull_requests/i.test(sql.trim())) return { rows: insertReturns };
      return { rows: selectReturns };
    }
  };
}

// ---------------------------------------------------------------------------
// the reason — the compliance-flagged field
// ---------------------------------------------------------------------------

test("a pull with no stated reason is refused, not stored with a blank", async () => {
  for (const bad of [undefined, null, "", "   ", "\n\t"]) {
    assert.throws(() => normalizeReason(bad), /a reason is required/,
      `${JSON.stringify(bad)} is not a reason`);
  }
  await assert.rejects(
    () => recordPull(stubDb(), { orgId: ORG, clientId: CLIENT }),
    /a reason is required/
  );
});

test("the reason is recorded in the words it arrived in, not tidied", () => {
  // Whoever eventually codes these against FCRA permissible purpose needs what
  // was actually written. Lowercasing or truncating makes that job harder.
  assert.equal(normalizeReason("  Client requested funding review  "), "Client requested funding review");
  assert.equal(normalizeReason("CLIENT PAID $32 DIAGNOSTIC"), "CLIENT PAID $32 DIAGNOSTIC");
  const long = "x".repeat(500);
  assert.equal(normalizeReason(long), long, "a long reason is stored whole");
});

// ---------------------------------------------------------------------------
// recordPull
// ---------------------------------------------------------------------------

test("recordPull writes one requested row with the reason bound to it", async () => {
  const db = stubDb();
  await recordPull(db, {
    orgId: ORG, clientId: CLIENT, reason: "Diagnostic paid", scope: "consumer_only",
    sourceEventId: "evt-1"
  });
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /INSERT INTO soft_pull_requests/);
  assert.match(db.calls[0].sql, /'requested'/, "a new request is outstanding, never pre-settled");
  assert.deepEqual(db.calls[0].params.slice(0, 7),
    [ORG, CLIENT, "Diagnostic paid", "consumer_only", "workflow", null, "evt-1"]);
});

test("recordPull defaults the source to workflow and leaves the actor null", async () => {
  // NULL means automated. A service account would read as an attribution, and
  // there is nobody to attribute an event-driven pull to.
  const db = stubDb();
  await recordPull(db, { orgId: ORG, clientId: CLIENT, reason: "Diagnostic paid" });
  assert.equal(db.calls[0].params[4], "workflow");
  assert.equal(db.calls[0].params[5], null);
});

test("a staff-initiated pull must name the person who asked", async () => {
  await assert.rejects(
    () => recordPull(stubDb(), { orgId: ORG, clientId: CLIENT, reason: "Manual review", source: "staff" }),
    /must name the staff member/
  );
  const db = stubDb();
  await recordPull(db, {
    orgId: ORG, clientId: CLIENT, reason: "Manual review", source: "staff", requestedByStaffId: STAFF
  });
  assert.equal(db.calls[0].params[5], STAFF);
});

test("recordPull refuses a vocabulary it does not know instead of storing it", async () => {
  await assert.rejects(
    () => recordPull(stubDb(), { orgId: ORG, clientId: CLIENT, reason: "r", source: "telepathy" }),
    /unknown source/
  );
  await assert.rejects(
    () => recordPull(stubDb(), { orgId: ORG, clientId: CLIENT, reason: "r", scope: "everything" }),
    /unknown scope/
  );
});

test("recordPull requires an org and a client", async () => {
  await assert.rejects(() => recordPull(stubDb(), { clientId: CLIENT, reason: "r" }), /orgId is required/);
  await assert.rejects(() => recordPull(stubDb(), { orgId: ORG, reason: "r" }), /clientId is required/);
});

test("a replayed event reads back the row it already wrote, and writes nothing", async () => {
  const already = { id: PULL, status: "requested", source_event_id: "evt-1" };
  const db = stubDb({ insertReturns: [], selectReturns: [already] });
  const out = await recordPull(db, {
    orgId: ORG, clientId: CLIENT, reason: "Diagnostic paid", sourceEventId: "evt-1"
  });
  assert.deepEqual(out, already);
  assert.match(db.calls[0].sql, /ON CONFLICT \(org_id, source_event_id\).*DO NOTHING/);
  assert.match(db.calls[1].sql, /^SELECT/, "the second statement is a read-back, not a second write");
  assert.equal(db.calls.filter((c) => /INSERT/.test(c.sql)).length, 1,
    "how many times a file was pulled has a legal answer — a replay must not add one");
});

test("a request with no source event is not deduped, because there is no key", async () => {
  // Refusing one would block a staff-initiated pull — the case that HAS an actor
  // and most deserves a row.
  const db = stubDb({ insertReturns: [] });
  await assert.rejects(
    () => recordPull(db, { orgId: ORG, clientId: CLIENT, reason: "Manual review" }),
    /was not written/,
    "with no conflict target, an empty result is a real failure and is reported"
  );
});

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

test("getLatestPull orders by when it was ASKED for, not when the row was made", async () => {
  const db = stubDb({ selectReturns: [{ id: PULL }] });
  await getLatestPull(db, { orgId: ORG, clientId: CLIENT });
  assert.match(db.calls[0].sql, /ORDER BY requested_at DESC/);
  assert.match(db.calls[0].sql, /LIMIT 1/);
});

test("getLatestPull returns null for a client who has never had one requested", async () => {
  const db = stubDb({ selectReturns: [] });
  assert.equal(await getLatestPull(db, { orgId: ORG, clientId: CLIENT }), null,
    "null means never asked — a pull with no answer yet is a 'requested' row, not this");
});

test("listPulls returns the whole history, newest first, with no limit", async () => {
  const db = stubDb({ selectReturns: [{ id: PULL }, { id: "older" }] });
  const out = await listPulls(db, { orgId: ORG, clientId: CLIENT });
  assert.equal(out.length, 2);
  assert.doesNotMatch(db.calls[0].sql, /LIMIT/, "an audit read must not silently truncate");
});

test("both reads are scoped to the org, never to the client alone", async () => {
  for (const fn of [getLatestPull, listPulls]) {
    const db = stubDb({ selectReturns: [] });
    await fn(db, { orgId: ORG, clientId: CLIENT });
    assert.match(db.calls[0].sql, /WHERE org_id = \$1 AND client_id = \$2/);
  }
});

// ---------------------------------------------------------------------------
// settlePull
// ---------------------------------------------------------------------------

test("isSettled knows which states have stopped waiting", () => {
  assert.equal(isSettled("requested"), false);
  assert.equal(isSettled("completed"), true);
  assert.equal(isSettled("failed"), true);
  assert.equal(isSettled("cancelled"), true);
  assert.deepEqual(PULL_STATUSES, ["requested", "completed", "failed", "cancelled"]);
});

test("a completed pull must name the result it completed with", async () => {
  await assert.rejects(
    () => settlePull(stubDb(), { orgId: ORG, id: PULL, status: "completed" }),
    /must name the crs_results row/,
    "otherwise it claims an answer exists and gives no way to find it"
  );
});

test("a failed pull may not name a result, because failing produced none", async () => {
  await assert.rejects(
    () => settlePull(stubDb(), { orgId: ORG, id: PULL, status: "failed", crsResultId: CRS }),
    /only a completed pull may name a result/
  );
});

test("settlePull refuses to settle into a state that is not an outcome", async () => {
  for (const bad of ["requested", "pending", null, undefined]) {
    await assert.rejects(
      () => settlePull(stubDb(), { orgId: ORG, id: PULL, status: bad }),
      /status must be one of/
    );
  }
});

test("settlePull only touches a row that is still outstanding", async () => {
  const db = stubDb();
  await settlePull(db, { orgId: ORG, id: PULL, status: "completed", crsResultId: CRS });
  assert.match(db.calls[0].sql, /status = 'requested'/,
    "a second settlement must not re-stamp the date the first one set");
  assert.deepEqual(db.calls[0].params.slice(0, 5), [ORG, PULL, "completed", CRS, null]);
});

test("settling something already settled returns null rather than pretending", async () => {
  const db = stubDb({ insertReturns: [] });
  assert.equal(
    await settlePull(db, { orgId: ORG, id: PULL, status: "failed", failureReason: "engine timeout" }),
    null
  );
});

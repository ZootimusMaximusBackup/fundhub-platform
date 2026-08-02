// compose — the cases that need no database.
//
// Two kinds live here, and neither is a substitute for compose.pg.test.mjs:
//
//   INPUT VALIDATION. Everything composeAndSend() refuses before it queries
//   anything. These use a db that throws on any call, which is the strongest
//   available statement of "nothing reached the database": not "no rows were
//   returned", but "the connection was never used".
//
//   SOURCE-LEVEL INVARIANTS. The two structural claims this feature rests on,
//   asserted against the file text the way src/http/read-endpoints-org-scope
//   and src/workflows/task-routing.test.mjs do. A behavioural test cannot
//   express "there is no code path that does X"; reading the source can.

import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { composeAndSend, COMPOSE_CHANNELS, MAX_BODY_LENGTH } from "./compose.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* A database that refuses to be used. Any query at all fails the test, which is
   the point: these cases are about requests that must be rejected before one. */
const forbidden = {
  query: () => { throw new Error("the database was queried for a request that should have been refused"); }
};

const ORG = "00000000-0000-4000-8000-0000000000ff";
const STAFF = "00000000-0000-4000-8000-000000000001";
const CONVO = "3f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b";

const isBadRequest = (err) => err && err.code === "BAD_REQUEST";

test("compose: a missing org is refused — tenancy is never optional", async () => {
  await assert.rejects(
    () => composeAndSend(forbidden, { staffId: STAFF, conversationId: CONVO, body: "hi" }),
    isBadRequest
  );
});

test("compose: a missing staff id is refused — an unattributed send is the thing this feature adds", async () => {
  await assert.rejects(
    () => composeAndSend(forbidden, { orgId: ORG, conversationId: CONVO, body: "hi" }),
    isBadRequest
  );
});

test("compose: an empty body is refused, and whitespace is empty", async () => {
  for (const body of [undefined, null, "", "   ", "\n\t ", 42, {}]) {
    await assert.rejects(
      () => composeAndSend(forbidden, { orgId: ORG, staffId: STAFF, conversationId: CONVO, body }),
      isBadRequest,
      `body=${JSON.stringify(body)} was accepted`
    );
  }
});

// Rejected, never truncated: sending half of what somebody wrote is worse than
// telling them it was too long.
test("compose: a body over the length cap is refused rather than cut in half", async () => {
  await assert.rejects(
    () => composeAndSend(forbidden, {
      orgId: ORG, staffId: STAFF, conversationId: CONVO, body: "x".repeat(MAX_BODY_LENGTH + 1)
    }),
    isBadRequest
  );
});

test("compose: neither a conversation nor a client is refused", async () => {
  await assert.rejects(
    () => composeAndSend(forbidden, { orgId: ORG, staffId: STAFF, body: "hi" }),
    isBadRequest
  );
});

test("compose: a channel nobody can type on is refused before any lookup", async () => {
  for (const channel of ["voice", "fax", "", null, "SMS", "whatsapp"]) {
    await assert.rejects(
      () => composeAndSend(forbidden, { orgId: ORG, staffId: STAFF, clientId: STAFF, channel, body: "hi" }),
      isBadRequest,
      `channel=${JSON.stringify(channel)} was accepted`
    );
  }
});

test("compose: the composable channels are exactly sms and email", () => {
  assert.deepEqual([...COMPOSE_CHANNELS].sort(), ["email", "sms"]);
  // Narrower than the gate's set on purpose — a person cannot type a phone call.
  assert.ok(!COMPOSE_CHANNELS.has("voice"));
});

/* ─────────────────────────── source-level invariants ────────────────────── */

const composeSrc = fs.readFileSync(path.join(HERE, "compose.mjs"), "utf8");
const dispatchSrc = fs.readFileSync(path.join(HERE, "dispatch.mjs"), "utf8");

/* Strip comments before matching. Every file in this area carries long prose
   ABOUT the gate, and matching raw source would fail a file for explaining
   itself — which teaches the next person to delete the explanation. */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/* THE INVARIANT THE WHOLE FEATURE RESTS ON.

   A staff reply must reach a provider by exactly one road: dispatch. If
   compose.mjs ever calls the gate itself, or a provider itself, there are two
   verdicts taken at two different instants — which is the sleeping-workflow bug
   src/messaging/gate.mjs is built around, arriving by the front door. */
test("compose: the send path calls the dispatcher and never a provider directly", () => {
  const src = code(composeSrc);
  assert.match(src, /dispatchMessage\(/, "compose no longer goes through the dispatcher");
  assert.ok(!/providers\//.test(src), "compose imports a provider — the only road to a provider is dispatch");
  assert.ok(!/\bfetch\s*\(/.test(src), "compose makes an outbound request of its own (CLAUDE.md §12)");
});

test("compose: the gate is not called from here — one verdict, taken at send time", () => {
  const src = code(composeSrc);
  assert.ok(!/\bgateAndRecord\s*\(/.test(src) && !/\bgate\s*\(/.test(src),
    "compose calls the compliance gate itself. That is a second verdict at a different " +
    "instant from the one that governs the send, and the two disagree the moment a " +
    "message waits. The dispatcher gates; see the header of gate.mjs.");
});

/* The gate's third property is "there is no override". dispatchMessage is a new
   door into the dispatcher, so it needs the same statement made about it. */
test("dispatchMessage: adds no way past the gate, and claims the same way claimDue does", () => {
  const src = code(dispatchSrc);
  const fn = src.slice(src.indexOf("export async function dispatchMessage"));
  assert.ok(fn.length > 0, "dispatchMessage is gone — this test cannot check it");
  // It must go through dispatchOne, which is where the gate is.
  assert.match(fn, /dispatchOne\(/, "dispatchMessage no longer routes through dispatchOne, which is where the gate is");
  for (const bypass of ["force", "skipCompliance", "skipGate", "override", "test_bypass"]) {
    assert.ok(!new RegExp(`\\b${bypass}\\b`).test(fn), `dispatchMessage accepts a ${bypass} option`);
  }

  const claim = src.slice(src.indexOf("async function claimOne"), src.indexOf("export const NOT_CLAIMABLE"));
  // The predicates that stop a re-send. Losing any one turns "send this message"
  // into "send this message again".
  assert.match(claim, /direction\s*=\s*'outbound'/);
  assert.match(claim, /status\s*=\s*'queued'/);
  assert.match(claim, /attempts\s*<\s*\$2/);
  assert.match(claim, /SET\s+status\s*=\s*'sending'/,
    "the claim does not flip the status in the statement that selects it — two callers could both send it");
});

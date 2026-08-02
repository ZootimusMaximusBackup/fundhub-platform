/* POST /api/messages — the door, not the room.
 *
 * What composeAndSend does with a message is tested in src/messaging/. This
 * file is only about who is let in, and it needs no database: every case here
 * is refused before the handler reaches its service call.
 *
 * THE ONE THAT MATTERS IS THE SHIFT GATE, because it is an owner rule applied
 * to an endpoint that did not exist when the rule was written. Verbatim:
 * "Gate writes that affect attribution or pay: claiming a lead, logging a call
 * outcome, moving a pipeline stage, sending client messages." And
 * src/http/middleware/ACTIVE-SHIFT-ROLLOUT.md names client messaging as one of
 * the two categories with no endpoint in this repository at the time. This is
 * that endpoint, so the gate is asserted here rather than assumed from a
 * comment — a gate that is only documented is a gate the next edit removes.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HANDLER = path.resolve(HERE, "../../api/messages.mjs");
const SRC = fs.readFileSync(HANDLER, "utf8");

/* Comments stripped before matching. This file's prose quotes the rule it
   implements, and matching raw source would let the explanation satisfy the
   assertion — which is how a test starts passing for the wrong reason. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

describe("POST /api/messages — the gates", () => {

  test("a GET is 405 and names the method it does accept", async () => {
    const handler = (await import("../../api/messages.mjs")).default;
    for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
      const r = res();
      await handler({ method, headers: {}, query: {}, body: {} }, r);
      assert.equal(r.code, 405, `${method} was not refused`);
      assert.equal(r.headers.allow, "POST");
    }
  });

  // requirePrincipal short-circuits on a missing token before touching the
  // pool, so this holds with or without a database.
  test("no session is a 401, and nothing is sent", async () => {
    const handler = (await import("../../api/messages.mjs")).default;
    const r = res();
    await handler({ method: "POST", headers: {}, query: {}, body: { body: "hello" } }, r);
    assert.equal(r.code, 401);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.message, undefined, "a 401 leaked something about the request");
  });

  test("the endpoint admits staff and nobody else", () => {
    assert.match(CODE, /requirePrincipal\(\s*req,\s*res,\s*\["staff"\]/,
      "the principal kinds are not named — a client or affiliate session reaching this " +
      "endpoint could message another company's clients as the company");
  });

  test("the shift gate is applied, and applied before the body is read", () => {
    assert.match(CODE, /requireActiveShift\(/,
      "sending client messages is one of the four things the owner named as gated on an " +
      "open shift, and this endpoint is the first one in the repository that can do it");
    const gateAt = CODE.indexOf("requireActiveShift(");
    const bodyAt = CODE.indexOf("req.body");
    assert.ok(gateAt < bodyAt,
      "the shift is checked after the payload is read — whether you may write at all is " +
      "not a question about the payload");
  });

  test("the company is the session's; there is no body field that could set it", () => {
    assert.match(CODE, /orgId:\s*principal\.orgId/);
    assert.ok(!/body\.org_id|body\.orgId/.test(CODE),
      "an org id from the request body reached the send — a caller who chooses their own " +
      "tenancy has none");
  });

  test("the staff id comes from the session, never from the request", () => {
    assert.match(CODE, /staffId:\s*principal\.staffId/);
    assert.ok(!/body\.staff_id|body\.staffId|body\.sender/.test(CODE),
      "a staff id from the request body reached the send — the whole point of recording a " +
      "sender is that it is the person who actually sent it");
  });

  test("this file does not send anything itself", () => {
    // CLAUDE.md §12: outbound transmission lives in src/messaging/providers/*
    // and nowhere else. A route that reached a provider directly would also be
    // a route that skipped the gate.
    assert.ok(!/\bfetch\s*\(/.test(CODE));
    assert.ok(!/providers\//.test(CODE));
    assert.match(CODE, /composeAndSend\(/);
  });

  test("a bad request is a 400, not a 500 — the backend did not fall over", () => {
    assert.match(CODE, /code\s*===\s*"BAD_REQUEST"/);
    assert.match(CODE, /status\(400\)/);
  });

  // err.message quotes the DSN on a connection failure. An unauthenticated
  // caller has already been turned away above, but a signed-in employee should
  // not be shown the database host either.
  test("a 500 body is scrubbed the same way health.mjs scrubs it", () => {
    assert.match(CODE, /safeError\(/);
  });
});

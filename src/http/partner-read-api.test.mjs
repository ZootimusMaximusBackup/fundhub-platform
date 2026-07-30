// Tests for the partner read-API plumbing.
//
// The endpoint files under api/creative/ and api/campaigns/ are SQL and wiring;
// every tenancy and redaction decision lives here, so this is where the adversarial
// cases go. (The repo's test glob is src/**/*.test.mjs, so tests must live under
// src/ — which is a reason to keep the endpoint files thin rather than a problem.)
//
// The case that matters most is resolvePartnerId: a partner session passing
// ?partner_id=<someone else> must not get someone else's book.

import { test, describe } from "node:test";
import assert from "node:assert";
import { resolvePartnerId, safeMessage, stateFilter } from "./partner-read-api.mjs";
import { redactConnection } from "../adplatforms/tokens.mjs";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("resolvePartnerId — the tenancy decision", () => {
  test("a partner principal is scoped to its own id", () => {
    assert.strictEqual(resolvePartnerId({ kind: "partner", partnerId: A }, {}), A);
  });

  test("a partner CANNOT widen scope with ?partner_id=", () => {
    // The leak this function exists to prevent.
    assert.strictEqual(resolvePartnerId({ kind: "partner", partnerId: A }, { partner_id: B }), A);
  });

  test("the foreign partner_id is IGNORED, not rejected", () => {
    // Rejecting with an error would tell a prober whether the id they guessed
    // exists. Ignoring means the parameter simply has no effect.
    const out = resolvePartnerId({ kind: "partner", partnerId: A }, { partner_id: "does-not-exist" });
    assert.strictEqual(out, A);
  });

  test("a staff principal must name a partner explicitly", () => {
    assert.strictEqual(resolvePartnerId({ kind: "staff" }, {}), null);
    assert.strictEqual(resolvePartnerId({ kind: "staff" }, { partner_id: B }), B);
  });

  test("a partner principal with no id resolves to null, never to unscoped", () => {
    assert.strictEqual(resolvePartnerId({ kind: "partner" }, {}), null);
  });

  test("client and affiliate principals get nothing", () => {
    // They have their own surfaces; reaching a partner endpoint must not scope
    // them to anything at all.
    assert.strictEqual(resolvePartnerId({ kind: "client", clientId: A }, { partner_id: B }), null);
    assert.strictEqual(resolvePartnerId({ kind: "affiliate", affiliateId: A }, {}), null);
  });

  test("an unknown kind gets nothing", () => {
    assert.strictEqual(resolvePartnerId({ kind: "robot" }, { partner_id: B }), null);
  });
});

describe("stateFilter", () => {
  const ALLOWED = ["draft", "active", "archived"];

  test("no filter matches everything", () => {
    assert.strictEqual(stateFilter({}, "k.status", ALLOWED).sql, "TRUE");
    assert.strictEqual(stateFilter({ state: "all" }, "k.status", ALLOWED).sql, "TRUE");
  });

  test("a known state binds as a parameter, never interpolated", () => {
    const f = stateFilter({ state: "active" }, "k.status", ALLOWED);
    assert.ok(f.sql.includes("$$"), "the placeholder is substituted by the caller");
    assert.ok(!f.sql.includes("active"), "the value must not reach the SQL string");
    assert.deepStrictEqual(f.params, [["active"]]);
  });

  test("comma-separated states are supported", () => {
    assert.deepStrictEqual(stateFilter({ state: "draft,active" }, "k.status", ALLOWED).params,
      [["draft", "active"]]);
  });

  test("an unknown state throws rather than being silently ignored", () => {
    // A screen filtering on a typo would otherwise show the unfiltered list and
    // look like it worked.
    assert.throws(() => stateFilter({ state: "acive" }, "k.status", ALLOWED), /unknown state/);
  });

  test("a SQL injection attempt is rejected by the allowlist", () => {
    assert.throws(() => stateFilter({ state: "active'; DROP TABLE campaigns; --" }, "k.status", ALLOWED),
      /unknown state/);
  });
});

describe("safeMessage", () => {
  test("redacts a DSN out of a connection error", () => {
    const out = safeMessage(new Error("could not connect to postgres://user:pw@host:5432/db"));
    assert.ok(!out.includes("pw@host"));
    assert.ok(out.includes("[redacted]"));
  });

  test("redacts token ciphertext that reached an error message", () => {
    const out = safeMessage(new Error("bad value v1:YWJj:ZGVm:Z2hp in row"));
    assert.ok(!out.includes("YWJj"));
    assert.ok(out.includes("[token redacted]"));
  });

  test("is bounded so a huge error cannot become the response body", () => {
    assert.ok(safeMessage(new Error("x".repeat(5000))).length <= 200);
  });
});

describe("connection redaction", () => {
  test("a connection row never carries token ciphertext out", () => {
    const row = {
      id: "c1", platform: "meta", connection_state: "active",
      encrypted_access_token: "v1:iv:tag:CIPHERTEXT", encrypted_refresh_token: "v1:iv:tag:REFRESH"
    };
    const out = JSON.stringify(redactConnection(row));
    assert.ok(!out.includes("CIPHERTEXT"));
    assert.ok(!out.includes("REFRESH"));
    assert.ok(out.includes('"has_access_token":true'));
  });
});

// Token encryption tests.
//
// The one that matters most is the cross-partner test. Binding the partner id
// into the AAD means a ciphertext copied from one partner's row into another's
// FAILS TO DECRYPT — which is protection the database cannot provide, because a
// bad backfill or a mis-joined UPDATE produces a perfectly valid-looking row. A
// token that decrypted anyway would be a live credential for someone else's ad
// account, and every downstream check would pass because the token really is
// valid.

import { test, describe } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { encryptToken, decryptToken, redactConnection } from "./tokens.mjs";

const env = { AD_TOKEN_ENC_KEY: crypto.randomBytes(32).toString("base64") };
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const TOKEN = "EAAB0sBAaZC-a-real-looking-access-token";

describe("round trip", () => {
  test("encrypts and decrypts for the same partner", () => {
    const ct = encryptToken(TOKEN, { partnerId: A, env });
    assert.strictEqual(decryptToken(ct, { partnerId: A, env }), TOKEN);
  });

  test("the ciphertext does not contain the plaintext", () => {
    const ct = encryptToken(TOKEN, { partnerId: A, env });
    assert.ok(!ct.includes(TOKEN));
    assert.ok(!ct.includes("access-token"));
  });

  test("the same token encrypts differently every time", () => {
    // Random IV per call. Deterministic ciphertext would let anyone with read
    // access tell that two partners hold the same token.
    const a = encryptToken(TOKEN, { partnerId: A, env });
    const b = encryptToken(TOKEN, { partnerId: A, env });
    assert.notStrictEqual(a, b);
  });

  test("null and empty round-trip to null rather than encrypting a blank", () => {
    assert.strictEqual(encryptToken(null, { partnerId: A, env }), null);
    assert.strictEqual(encryptToken("", { partnerId: A, env }), null);
    assert.strictEqual(decryptToken(null, { partnerId: A, env }), null);
  });
});

describe("cross-partner protection", () => {
  test("partner B cannot decrypt partner A's token", () => {
    const ct = encryptToken(TOKEN, { partnerId: A, env });
    assert.throws(() => decryptToken(ct, { partnerId: B, env }), /authentication failed/);
  });

  test("the failure is the same shape whether the partner is wrong or the data is tampered", () => {
    // Distinguishing the two would let an attacker probe which partner a
    // ciphertext belongs to, and the caller's correct response is identical.
    const ct = encryptToken(TOKEN, { partnerId: A, env });
    const wrongPartner = err(() => decryptToken(ct, { partnerId: B, env }));
    const [k, iv, tag, data] = ct.split(":");
    const flipped = [k, iv, tag, Buffer.from(Buffer.from(data, "base64").map((b, i) => (i === 0 ? b ^ 1 : b))).toString("base64")].join(":");
    const tampered = err(() => decryptToken(flipped, { partnerId: A, env }));
    assert.strictEqual(wrongPartner.code, tampered.code);
    assert.strictEqual(wrongPartner.message, tampered.message);
  });

  test("a tampered auth tag fails rather than decrypting to garbage", () => {
    const ct = encryptToken(TOKEN, { partnerId: A, env });
    const [k, iv, , data] = ct.split(":");
    const badTag = crypto.randomBytes(16).toString("base64");
    assert.throws(() => decryptToken([k, iv, badTag, data].join(":"), { partnerId: A, env }),
      /authentication failed/);
  });

  test("encrypting without a partner id is refused", () => {
    // Without it the AAD binding is absent and this whole protection silently
    // does not apply.
    assert.throws(() => encryptToken(TOKEN, { env }), /partnerId is required/);
  });
});

describe("key handling", () => {
  test("an unset key stops the feature rather than storing plaintext", () => {
    assert.throws(() => encryptToken(TOKEN, { partnerId: A, env: {} }),
      /refusing to store an ad platform token unencrypted/);
  });

  test("the error names the env var, never a key value", () => {
    const e = err(() => encryptToken(TOKEN, { partnerId: A, env: {} }));
    assert.ok(e.message.includes("AD_TOKEN_ENC_KEY"));
    assert.ok(!e.message.includes(env.AD_TOKEN_ENC_KEY));
  });

  test("a wrong-length key is rejected", () => {
    assert.throws(() => encryptToken(TOKEN, { partnerId: A, env: { AD_TOKEN_ENC_KEY: "c2hvcnQ=" } }),
      /must be 32 bytes/);
  });

  test("an unknown key id is a hard failure, never a plaintext fallback", () => {
    const ct = encryptToken(TOKEN, { partnerId: A, env });
    const rotated = ct.replace(/^v1:/, "v9:");
    assert.throws(() => decryptToken(rotated, { partnerId: A, env }), /AD_TOKEN_ENC_KEY_V9/);
  });

  test("malformed ciphertext is rejected", () => {
    assert.throws(() => decryptToken("not-a-ciphertext", { partnerId: A, env }), /malformed/);
  });
});

describe("redactConnection", () => {
  test("strips both token columns and replaces them with presence booleans", () => {
    const out = redactConnection({
      id: "c1", platform: "meta",
      encrypted_access_token: "v1:a:b:c", encrypted_refresh_token: "v1:d:e:f",
      token_expires_at: "2026-01-01"
    });
    assert.strictEqual(out.encrypted_access_token, undefined);
    assert.strictEqual(out.encrypted_refresh_token, undefined);
    assert.strictEqual(out.has_access_token, true);
    assert.strictEqual(out.has_refresh_token, true);
    // The screens still need to know when it expires.
    assert.strictEqual(out.token_expires_at, "2026-01-01");
  });

  test("no token means has_access_token is false, not a missing key", () => {
    const out = redactConnection({ id: "c1", encrypted_access_token: null });
    assert.strictEqual(out.has_access_token, false);
  });

  test("no serialisation of a redacted row contains a ciphertext", () => {
    const out = JSON.stringify(redactConnection({
      id: "c1", encrypted_access_token: "v1:secret:ct", encrypted_refresh_token: "v1:secret:rt" }));
    assert.ok(!out.includes("secret"));
  });
});

function err(fn) { try { fn(); return new Error("did not throw"); } catch (e) { return e; } }

// Unit tests for the Plaid seam. No database, no network — there is nothing to
// connect to and that is the point.
//
// What these prove:
//   * the configuration gate answers honestly, and says WHICH piece is missing;
//   * "not configured" and "not implemented" are distinguishable, because a
//     screen must never render a feature that was never turned on as an outage;
//   * the token encryption refuses to work without a key, refuses to fall back
//     to plaintext, and refuses to decrypt a ciphertext that has been moved to
//     another client's row.
//
// That last one is the test worth having. A ciphertext copied between rows is a
// mistake no database constraint can catch, and the consequence is one client
// holding read access to another person's bank account.

import { test } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import {
  isPlaidEnabled, missingConfig, linkAccount, getAccounts,
  encryptAccessToken, decryptAccessToken,
  PlaidError, PlaidNotImplementedError
} from "./plaid.mjs";

const KEY = crypto.randomBytes(32).toString("base64");
const ITEM_ROW = "11111111-1111-4111-8111-111111111111";
const OTHER_ROW = "22222222-2222-4222-8222-222222222222";

const fullEnv = () => ({
  PLAID_CLIENT_ID: "cid",
  PLAID_SECRET: "sec",
  PLAID_ENV: "sandbox",
  PLAID_TOKEN_ENC_KEY: KEY
});

/* ------------------------------ the gate ---------------------------------- */

test("Plaid is disabled when nothing is configured, and that is not an error", () => {
  assert.equal(isPlaidEnabled({ env: {} }), false);
  assert.deepEqual(missingConfig({ env: {} }),
    ["PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_ENV", "PLAID_TOKEN_ENC_KEY"]);
});

test("Plaid is enabled only when every piece is present", () => {
  assert.equal(isPlaidEnabled({ env: fullEnv() }), true);
  for (const k of ["PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_ENV", "PLAID_TOKEN_ENC_KEY"]) {
    const env = fullEnv();
    delete env[k];
    assert.equal(isPlaidEnabled({ env }), false, `${k} alone must be enough to disable it`);
    assert.ok(missingConfig({ env }).some((m) => m.startsWith(k)), `${k} must be named as missing`);
  }
});

test("credentials without a storage key is NOT an enabled state", () => {
  const env = fullEnv();
  delete env.PLAID_TOKEN_ENC_KEY;
  assert.equal(isPlaidEnabled({ env }), false,
    "being able to fetch a token but not store it safely is where somebody writes a plaintext token 'just for now'");
});

test("a blank value counts as missing, not as set", () => {
  assert.equal(isPlaidEnabled({ env: { ...fullEnv(), PLAID_SECRET: "   " } }), false);
});

test("an unrecognised PLAID_ENV is caught here, not by a 400 after a token is minted", () => {
  const m = missingConfig({ env: { ...fullEnv(), PLAID_ENV: "staging" } });
  assert.ok(m.some((x) => x.startsWith("PLAID_ENV")));
  assert.match(m.find((x) => x.startsWith("PLAID_ENV")), /sandbox, development or production/);
});

test("the configuration report names variables and never values", () => {
  const report = missingConfig({ env: { PLAID_CLIENT_ID: "super-secret-id" } }).join(" ");
  assert.doesNotMatch(report, /super-secret-id/, "a config report that echoes a secret is how secrets reach logs");
});

test("isPlaidEnabled reads env every time — no caching, no module state", () => {
  const env = fullEnv();
  assert.equal(isPlaidEnabled({ env }), true);
  delete env.PLAID_SECRET;
  assert.equal(isPlaidEnabled({ env }), false, "a deploy that changes a variable must not need a restart to be noticed");
});

/* ------------------------------ the seams --------------------------------- */

test("linkAccount validates its arguments before anything else", async () => {
  await assert.rejects(() => linkAccount({ env: fullEnv() }), /orgId is required/);
  await assert.rejects(() => linkAccount({ orgId: "o", env: fullEnv() }), /clientId is required/);
  await assert.rejects(() => linkAccount({ orgId: "o", clientId: "c", env: fullEnv() }), /publicToken is required/);
});

test("NOT CONFIGURED AND NOT IMPLEMENTED ARE DIFFERENT ANSWERS", async () => {
  const args = { orgId: "o", clientId: "c", publicToken: "public-sandbox-x" };

  await assert.rejects(
    () => linkAccount({ ...args, env: {} }),
    (e) => e instanceof PlaidError && !(e instanceof PlaidNotImplementedError)
      && e.status === 503 && e.code === "PLAID_NOT_CONFIGURED");

  await assert.rejects(
    () => linkAccount({ ...args, env: fullEnv() }),
    (e) => e instanceof PlaidNotImplementedError && e.status === 501);
});

test("the not-configured error names what is missing", async () => {
  const env = fullEnv();
  delete env.PLAID_SECRET;
  await assert.rejects(
    () => linkAccount({ orgId: "o", clientId: "c", publicToken: "t", env }),
    /PLAID_SECRET not set/);
});

test("getAccounts behaves the same way", async () => {
  await assert.rejects(() => getAccounts({ env: fullEnv() }), /itemRowId is required/);
  await assert.rejects(
    () => getAccounts({ itemRowId: ITEM_ROW, env: {} }),
    (e) => e.status === 503 && e.code === "PLAID_NOT_CONFIGURED");
  await assert.rejects(
    () => getAccounts({ itemRowId: ITEM_ROW, env: fullEnv() }),
    (e) => e instanceof PlaidNotImplementedError);
});

test("the not-implemented message says where to read why", async () => {
  await assert.rejects(
    () => getAccounts({ itemRowId: ITEM_ROW, env: fullEnv() }),
    /src\/banking\/plaid\.mjs/);
});

/* --------------------------- the access token ----------------------------- */

test("a token round-trips through encryption", () => {
  const env = fullEnv();
  const ct = encryptAccessToken("access-sandbox-abc123", { itemRowId: ITEM_ROW, env });
  assert.doesNotMatch(ct, /access-sandbox-abc123/, "the plaintext must not survive in the ciphertext");
  assert.equal(decryptAccessToken(ct, { itemRowId: ITEM_ROW, env }), "access-sandbox-abc123");
});

test("AN UNSET KEY STOPS THE FEATURE AND NEVER FALLS BACK TO PLAINTEXT", () => {
  assert.throws(
    () => encryptAccessToken("access-sandbox-abc123", { itemRowId: ITEM_ROW, env: {} }),
    (e) => e instanceof PlaidError && e.status === 503 && /refusing to store/.test(e.message));
});

test("the key error names the variable and never its value", () => {
  try {
    encryptAccessToken("t", { itemRowId: ITEM_ROW, env: {} });
    assert.fail("should have thrown");
  } catch (e) {
    assert.match(e.message, /PLAID_TOKEN_ENC_KEY/);
    assert.doesNotMatch(e.message, /access-sandbox|[A-Za-z0-9+/]{40,}/);
  }
});

test("a key of the wrong length is refused rather than stretched", () => {
  const env = { ...fullEnv(), PLAID_TOKEN_ENC_KEY: crypto.randomBytes(16).toString("base64") };
  assert.throws(() => encryptAccessToken("t", { itemRowId: ITEM_ROW, env }), /32 bytes/);
});

test("A TOKEN MOVED TO ANOTHER CLIENT'S ROW FAILS TO DECRYPT", () => {
  const env = fullEnv();
  const ct = encryptAccessToken("access-sandbox-abc123", { itemRowId: ITEM_ROW, env });
  assert.throws(
    () => decryptAccessToken(ct, { itemRowId: OTHER_ROW, env }),
    "a mis-joined UPDATE must not silently give one client read access to another person's bank");
});

test("a tampered ciphertext fails rather than decrypting to garbage", () => {
  const env = fullEnv();
  const ct = encryptAccessToken("access-sandbox-abc123", { itemRowId: ITEM_ROW, env });
  const parts = ct.split(":");
  const flipped = Buffer.from(parts[3], "base64");
  flipped[0] ^= 0xff;
  parts[3] = flipped.toString("base64");
  assert.throws(() => decryptAccessToken(parts.join(":"), { itemRowId: ITEM_ROW, env }));
});

test("encryption requires the binding it exists for", () => {
  assert.throws(() => encryptAccessToken("t", { itemRowId: null, env: fullEnv() }),
    /itemRowId is required/);
  assert.throws(() => decryptAccessToken("v1:a:b:c", { itemRowId: null, env: fullEnv() }),
    /itemRowId is required/);
});

test("an empty token is null, not an empty ciphertext", () => {
  const env = fullEnv();
  assert.equal(encryptAccessToken(null, { itemRowId: ITEM_ROW, env }), null);
  assert.equal(encryptAccessToken("", { itemRowId: ITEM_ROW, env }), null);
  assert.equal(decryptAccessToken(null, { itemRowId: ITEM_ROW, env }), null);
});

test("malformed stored values are refused, not partially read", () => {
  const env = fullEnv();
  for (const bad of ["nonsense", "v1:only:three", "v1:a:b:c:d"]) {
    assert.throws(() => decryptAccessToken(bad, { itemRowId: ITEM_ROW, env }), /malformed|Unsupported|Invalid/);
  }
});

test("no thrown error carries a token in its properties", async () => {
  const env = fullEnv();
  try {
    await getAccounts({ itemRowId: ITEM_ROW, env });
  } catch (e) {
    assert.doesNotMatch(JSON.stringify({ m: e.message, c: e.code, s: e.status }), /access-|public-/);
  }
});

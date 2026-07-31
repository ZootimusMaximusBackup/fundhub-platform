// Plaid adapter tests. No database, no network — these run in the default suite.
//
// The three that matter most, and why:
//
//   1. UNCONFIGURED MUST MEAN OFF. AUDIT-FINDINGS.md records the mailgun webhook
//      accepting unsigned requests when its signing key was unset — absent config
//      read as "no check needed" while five sibling adapters failed closed. Every
//      unset/partial/malformed case below pins isPlaidEnabled() to false.
//
//   2. THE SEAMS MUST NOT PRETEND. getAccounts() returns accounts: null, never
//      []. An empty array is a claim about someone's finances; null is the truth,
//      which is that we did not ask.
//
//   3. NOTHING TRANSMITS. The source is read and asserted to contain no outbound
//      call. A test that only checks behaviour would pass the day someone closes
//      the seam with a real fetch.

import { test, describe } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  plaidConfigFromEnv,
  isPlaidEnabled,
  encryptPlaidToken,
  decryptPlaidToken,
  redactPlaidItem,
  linkAccount,
  getAccounts,
  SEAM_REASONS,
  REQUIRED_ENV,
  PlaidConfigError
} from "./plaid.mjs";

const KEY = crypto.randomBytes(32).toString("base64");
const ITEM_A = "11111111-1111-4111-8111-111111111111";
const ITEM_B = "22222222-2222-4222-8222-222222222222";
const TOKEN = "access-sandbox-a-real-looking-plaid-access-token";

/** A fully configured env. Nothing reads process.env in these tests. */
const configured = () => ({
  PLAID_CLIENT_ID: "client-id-value",
  PLAID_SECRET: "secret-value",
  PLAID_TOKEN_ENC_KEY: KEY,
  PLAID_ENV: "sandbox"
});

describe("isPlaidEnabled — configured", () => {
  test("returns true when every credential is present and well-formed", () => {
    assert.strictEqual(isPlaidEnabled(configured()), true);
  });

  test("PLAID_ENV may be omitted and defaults to sandbox", () => {
    const env = configured();
    delete env.PLAID_ENV;
    assert.strictEqual(isPlaidEnabled(env), true);
    assert.strictEqual(plaidConfigFromEnv(env).environment, "sandbox");
  });

  test("development and production are accepted environments", () => {
    for (const e of ["development", "production"]) {
      assert.strictEqual(isPlaidEnabled({ ...configured(), PLAID_ENV: e }), true, e);
    }
  });
});

describe("isPlaidEnabled — unconfigured is OFF, never on", () => {
  test("an entirely empty environment is disabled", () => {
    assert.strictEqual(isPlaidEnabled({}), false);
  });

  test("every single missing credential disables it on its own", () => {
    for (const name of REQUIRED_ENV) {
      const env = configured();
      delete env[name];
      assert.strictEqual(isPlaidEnabled(env), false, `${name} unset must disable Plaid`);
      assert.ok(plaidConfigFromEnv(env).missing.includes(name), `${name} must be reported missing`);
    }
  });

  test("an unset encryption key disables the feature rather than allowing plaintext", () => {
    const env = configured();
    delete env.PLAID_TOKEN_ENC_KEY;
    assert.strictEqual(isPlaidEnabled(env), false);
    // And the storage path refuses outright, it does not degrade to plaintext.
    assert.throws(() => encryptPlaidToken(TOKEN, { itemId: ITEM_A, env }), /PLAID_TOKEN_ENC_KEY is not set/);
  });

  test("a wrong-length encryption key disables it instead of being used", () => {
    const env = { ...configured(), PLAID_TOKEN_ENC_KEY: crypto.randomBytes(16).toString("base64") };
    assert.strictEqual(isPlaidEnabled(env), false);
    assert.ok(plaidConfigFromEnv(env).problems.some((p) => p.includes("32 bytes")));
  });

  test("an unrecognised PLAID_ENV disables it rather than guessing an environment", () => {
    for (const bad of ["prod", "Production", "staging", " "]) {
      assert.strictEqual(isPlaidEnabled({ ...configured(), PLAID_ENV: bad }), false, bad);
    }
  });

  test("isPlaidEnabled never throws, whatever the environment looks like", () => {
    assert.doesNotThrow(() => isPlaidEnabled({}));
    assert.doesNotThrow(() => isPlaidEnabled({ PLAID_TOKEN_ENC_KEY: "!!!not base64!!!" }));
    assert.strictEqual(typeof isPlaidEnabled({}), "boolean");
  });

  test("the config report carries env var NAMES only and never a secret value", () => {
    const cfg = plaidConfigFromEnv(configured());
    const dumped = JSON.stringify(cfg);
    assert.ok(!dumped.includes(KEY), "the encryption key must not appear in the config report");
    assert.ok(!dumped.includes("secret-value"), "PLAID_SECRET's value must not appear in the config report");
    assert.ok(!dumped.includes("client-id-value"));
  });
});

describe("the seams refuse honestly", () => {
  test("linkAccount refuses with not_configured when credentials are absent", async () => {
    const r = await linkAccount({ clientId: "c1", publicToken: "public-sandbox-xyz", env: {} });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, SEAM_REASONS.NOT_CONFIGURED);
    assert.strictEqual(r.item, null);
    assert.ok(r.missing.includes("PLAID_CLIENT_ID"));
  });

  test("linkAccount still refuses when fully configured — configured is not implemented", async () => {
    const r = await linkAccount({ clientId: "c1", publicToken: "public-sandbox-xyz", env: configured() });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, SEAM_REASONS.NOT_IMPLEMENTED);
    assert.strictEqual(r.item, null);
  });

  test("linkAccount never echoes the public token it was handed", async () => {
    const r = await linkAccount({ clientId: "c1", publicToken: "public-sandbox-xyz", env: configured() });
    assert.ok(!JSON.stringify(r).includes("public-sandbox-xyz"));
  });

  test("getAccounts returns accounts: null, NOT an empty array", async () => {
    // The whole point. [] means "this client has no bank accounts" — a finding a
    // funding decision would act on. null means "we did not ask".
    for (const env of [{}, configured()]) {
      const r = await getAccounts({ itemId: ITEM_A, env });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.accounts, null, "a refusal must never look like an empty account list");
      assert.ok(!Array.isArray(r.accounts));
    }
  });

  test("getAccounts distinguishes not_configured from not_implemented", async () => {
    assert.strictEqual((await getAccounts({ itemId: ITEM_A, env: {} })).reason, SEAM_REASONS.NOT_CONFIGURED);
    assert.strictEqual((await getAccounts({ itemId: ITEM_A, env: configured() })).reason, SEAM_REASONS.NOT_IMPLEMENTED);
  });

  test("both seams return rather than throw, and neither ever reports ok", async () => {
    const results = [
      await linkAccount({ env: {} }),
      await linkAccount({ env: configured() }),
      await getAccounts({ env: {} }),
      await getAccounts({ env: configured() })
    ];
    for (const r of results) assert.strictEqual(r.ok, false);
  });
});

describe("nothing transmits", () => {
  const SRC = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "plaid.mjs"),
    "utf8"
  );
  // Comments describe where a client WOULD go, so strip them before looking for
  // a real call. Otherwise the prose that documents the seam trips its own test.
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  test("the adapter contains no outbound HTTP call", () => {
    for (const pattern of [/\bfetch\s*\(/, /node:https?/, /\baxios\b/, /XMLHttpRequest/, /\.request\s*\(/]) {
      assert.ok(!pattern.test(CODE), `outbound call found: ${pattern}`);
    }
  });

  test("the adapter imports nothing but node built-ins", () => {
    const imports = [...CODE.matchAll(/^\s*import[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
    for (const spec of imports) {
      assert.ok(
        spec.startsWith("node:") || spec.startsWith("./") || spec.startsWith("../"),
        `unexpected dependency: ${spec}`
      );
    }
    assert.ok(!imports.some((s) => s.includes("plaid")), "the Plaid SDK must not be a dependency");
  });
});

describe("access token encryption", () => {
  const env = { PLAID_TOKEN_ENC_KEY: KEY };

  test("round-trips for the same item", () => {
    const ct = encryptPlaidToken(TOKEN, { itemId: ITEM_A, env });
    assert.strictEqual(decryptPlaidToken(ct, { itemId: ITEM_A, env }), TOKEN);
  });

  test("the ciphertext does not contain the token", () => {
    const ct = encryptPlaidToken(TOKEN, { itemId: ITEM_A, env });
    assert.ok(!ct.includes(TOKEN));
    assert.ok(!ct.includes("access-sandbox"));
  });

  test("the same token encrypts differently every time", () => {
    assert.notStrictEqual(
      encryptPlaidToken(TOKEN, { itemId: ITEM_A, env }),
      encryptPlaidToken(TOKEN, { itemId: ITEM_A, env })
    );
  });

  test("one client's bank credential cannot be decrypted onto another item", () => {
    // The protection the database cannot provide: a mis-joined UPDATE produces a
    // perfectly valid-looking row, and a token that decrypted anyway would be
    // live read access to a different person's bank account.
    const ct = encryptPlaidToken(TOKEN, { itemId: ITEM_A, env });
    assert.throws(() => decryptPlaidToken(ct, { itemId: ITEM_B, env }), /authentication failed/);
  });

  test("a tampered ciphertext fails instead of decrypting to garbage", () => {
    const [k, iv, tag, data] = encryptPlaidToken(TOKEN, { itemId: ITEM_A, env }).split(":");
    const bytes = Buffer.from(data, "base64");
    bytes[0] ^= 1;
    const flipped = [k, iv, tag, bytes.toString("base64")].join(":");
    assert.throws(() => decryptPlaidToken(flipped, { itemId: ITEM_A, env }), /authentication failed/);
  });

  test("encrypting without an item id is refused — the binding is not optional", () => {
    assert.throws(() => encryptPlaidToken(TOKEN, { itemId: null, env }), /itemId is required/);
  });

  test("an unset key throws a 503-shaped error rather than storing plaintext", () => {
    try {
      encryptPlaidToken(TOKEN, { itemId: ITEM_A, env: {} });
      assert.fail("must not encrypt without a key");
    } catch (e) {
      assert.ok(e instanceof PlaidConfigError);
      assert.strictEqual(e.status, 503);
      assert.ok(!String(e.message).includes(TOKEN), "the error must not carry the token");
    }
  });

  test("null and empty round-trip to null rather than encrypting a blank", () => {
    assert.strictEqual(encryptPlaidToken(null, { itemId: ITEM_A, env }), null);
    assert.strictEqual(encryptPlaidToken("", { itemId: ITEM_A, env }), null);
    assert.strictEqual(decryptPlaidToken(null, { itemId: ITEM_A, env }), null);
  });

  test("the plaid key is separate from the ad-token and PII keys", () => {
    // Shared keys mean one rotation forces three, and one leak costs three.
    const wrongKeyEnv = { AD_TOKEN_ENC_KEY: KEY, PII_ENC_KEY: KEY };
    assert.throws(() => encryptPlaidToken(TOKEN, { itemId: ITEM_A, env: wrongKeyEnv }), /PLAID_TOKEN_ENC_KEY is not set/);
  });
});

describe("redaction", () => {
  test("a plaid_items row loses its ciphertext and keeps only has_access_token", () => {
    const safe = redactPlaidItem({
      id: ITEM_A, client_id: "c1", link_state: "active",
      encrypted_access_token: "v1:aa:bb:cc"
    });
    assert.strictEqual(safe.encrypted_access_token, undefined);
    assert.strictEqual(safe.has_access_token, true);
    assert.strictEqual(safe.link_state, "active");
    assert.ok(!JSON.stringify(safe).includes("v1:aa:bb:cc"));
  });

  test("a row with no credential reports has_access_token false", () => {
    assert.strictEqual(redactPlaidItem({ id: ITEM_A, encrypted_access_token: null }).has_access_token, false);
  });
});

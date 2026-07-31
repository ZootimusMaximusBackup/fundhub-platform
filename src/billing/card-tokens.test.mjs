// Unit tests for stored-credential encryption. No database, no network.
//
// What these prove: the ciphertext is bound to one client, a PAN is refused
// before it can be encrypted, an unset key stops the feature instead of writing
// plaintext, and the envelope matches the shape the 076 CHECK constraint
// enforces in the database.

import { test } from "node:test";
import assert from "node:assert";
import {
  encryptCardToken, decryptCardToken, looksLikePan, redactCard, TOKEN_ENVELOPE_RE
} from "./card-tokens.mjs";

// A test key, generated for this file. Not a secret: it protects nothing.
const env = { CARD_TOKEN_ENC_KEY: Buffer.alloc(32, 7).toString("base64") };
const CLIENT_A = "11111111-1111-1111-1111-111111111111";
const CLIENT_B = "22222222-2222-2222-2222-222222222222";

test("a token round-trips for the client it was encrypted for", () => {
  const ct = encryptCardToken("tok_live_abc123", { clientId: CLIENT_A, env });
  assert.ok(Buffer.isBuffer(ct), "must be a Buffer — the column is bytea");
  assert.equal(decryptCardToken(ct, { clientId: CLIENT_A, env }), "tok_live_abc123");
});

test("the stored envelope matches the shape the database CHECK enforces", () => {
  const ct = encryptCardToken("tok_live_abc123", { clientId: CLIENT_A, env });
  assert.match(ct.toString("utf8"), TOKEN_ENVELOPE_RE);
});

test("a ciphertext moved to another client's row fails to decrypt", () => {
  const ct = encryptCardToken("tok_live_abc123", { clientId: CLIENT_A, env });
  assert.throws(() => decryptCardToken(ct, { clientId: CLIENT_B, env }), /authentication failed/);
});

test("a tampered ciphertext fails rather than decrypting to garbage", () => {
  const ct = encryptCardToken("tok_live_abc123", { clientId: CLIENT_A, env }).toString("utf8");
  const parts = ct.split(":");
  const bytes = Buffer.from(parts[3], "base64");
  bytes[0] ^= 0xff;
  parts[3] = bytes.toString("base64");
  assert.throws(() => decryptCardToken(parts.join(":"), { clientId: CLIENT_A, env }), /authentication failed/);
});

test("an unset key refuses to store rather than falling back to plaintext", () => {
  assert.throws(
    () => encryptCardToken("tok_live_abc123", { clientId: CLIENT_A, env: {} }),
    /CARD_TOKEN_ENC_KEY is not set/
  );
});

test("encrypting without a client id is refused — the binding is not optional", () => {
  assert.throws(() => encryptCardToken("tok_live_abc123", { env }), /clientId is required/);
});

// ------------------------------------------------------------------ PAN refusal

test("a card number is refused, even though we could encrypt it", () => {
  // 4242424242424242 is the industry-standard test PAN. Luhn-valid.
  assert.throws(
    () => encryptCardToken("4242424242424242", { clientId: CLIENT_A, env }),
    /refusing to store a value that looks like a card number/
  );
});

test("a card number with spaces or dashes is refused too", () => {
  for (const formatted of ["4242 4242 4242 4242", "4242-4242-4242-4242"]) {
    assert.throws(() => encryptCardToken(formatted, { clientId: CLIENT_A, env }), /card number/);
  }
});

test("looksLikePan accepts real PANs and rejects processor tokens", () => {
  assert.equal(looksLikePan("4242424242424242"), true, "Visa test PAN");
  assert.equal(looksLikePan("378282246310005"), true, "Amex test PAN, 15 digits");
  assert.equal(looksLikePan("6011111111111117"), true, "Discover test PAN");
  assert.equal(looksLikePan("tok_1PabcDEfGhIjKlMn"), false, "a processor token has letters");
  assert.equal(looksLikePan("pm_card_visa"), false);
  assert.equal(looksLikePan("123456789012"), false, "12 digits is too short to be a PAN");
  assert.equal(looksLikePan(null), false);
  assert.equal(looksLikePan(""), false);
});

test("KNOWN LIMIT: a mistyped card number that fails Luhn is not caught here", () => {
  // Recorded rather than hidden. The Luhn check catches real card numbers, not
  // every 16-digit string. The database's ciphertext CHECK is the backstop: a
  // bare digit string does not match the envelope and cannot be stored.
  assert.equal(looksLikePan("4242424242424243"), false);
});

// ------------------------------------------------------------------- redaction

test("redactCard drops the credential and reports only that one exists", () => {
  const safe = redactCard({ id: "x", brand: "visa", last4: "4242", token_enc: Buffer.from("v1:a:b:c") });
  assert.equal(safe.token_enc, undefined, "the token must never reach a response body");
  assert.equal(safe.has_token, true);
  assert.equal(safe.last4, "4242");
  assert.equal(redactCard({ id: "x", token_enc: null }).has_token, false);
});

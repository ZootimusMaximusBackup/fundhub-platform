// The client link — the only credential standing between an anonymous request
// and somebody's funding agreement.
//
// These are the same properties src/documents/signed-url.test.mjs pins for
// document links, plus the one that is specific to this module: DOMAIN
// SEPARATION. Both signers may share a secret (CONTRACT_URL_SECRET falls back to
// DOCUMENT_URL_SECRET), so the scheme prefix has to make a document link
// unusable as a contract link and vice versa. If that ever stops being true,
// anybody holding a link to any document could sign a contract.

import { test, describe } from "node:test";
import assert from "node:assert";
import {
  signContractUrl, verifyContractUrl, verifyContractRequest, secretFromEnv,
  signature, DEFAULT_TTL_SECONDS, MAX_TTL_SECONDS
} from "./signed-link.mjs";
import { signDocumentUrl, verifyDocumentUrl } from "../documents/signed-url.mjs";

const SECRET = "c".repeat(48);
const ID = "11111111-2222-3333-4444-555555555555";
const AT = (iso) => () => new Date(iso).getTime();

describe("signContractUrl", () => {
  test("mints a link that verifies", () => {
    const link = signContractUrl({ contractId: ID, secret: SECRET, now: AT("2026-08-02T00:00:00Z") });
    const u = new URL(link.url, "http://x.invalid");
    assert.equal(u.pathname, "/contract.html");
    assert.equal(u.searchParams.get("id"), ID);
    const v = verifyContractUrl({
      contractId: ID, expiresAt: u.searchParams.get("exp"), sig: u.searchParams.get("sig"),
      secret: SECRET, now: AT("2026-08-02T00:00:01Z")
    });
    assert.equal(v.valid, true);
  });

  test("defaults to 30 days — a contract sits in an inbox over a weekend", () => {
    assert.equal(DEFAULT_TTL_SECONDS, 60 * 60 * 24 * 30);
    const link = signContractUrl({ contractId: ID, secret: SECRET, now: AT("2026-08-02T00:00:00Z") });
    assert.equal(link.expiresAtIso, "2026-09-01T00:00:00.000Z");
  });

  test("refuses a ttl past the maximum rather than silently clamping it", () => {
    assert.throws(() => signContractUrl({ contractId: ID, secret: SECRET, ttlSeconds: MAX_TTL_SECONDS + 1 }),
      /exceeds/);
  });

  test("refuses a nonsense ttl", () => {
    for (const bad of [0, -1, "soon", NaN]) {
      assert.throws(() => signContractUrl({ contractId: ID, secret: SECRET, ttlSeconds: bad }), /positive/);
    }
  });

  test("refuses to mint a link for nothing", () => {
    assert.throws(() => signContractUrl({ secret: SECRET }), /requires contractId/);
  });

  test("baseUrl makes it absolute, and the trailing slash never doubles", () => {
    const a = signContractUrl({ contractId: ID, secret: SECRET, baseUrl: "https://x.test/" });
    assert.ok(a.url.startsWith("https://x.test/contract.html?"), a.url);
  });
});

describe("verifyContractUrl — every way a link can be wrong", () => {
  const mint = (now = AT("2026-08-02T00:00:00Z")) =>
    signContractUrl({ contractId: ID, secret: SECRET, now });

  test("a forged signature is refused", () => {
    const link = mint();
    const v = verifyContractUrl({ contractId: ID, expiresAt: link.expiresAt, sig: "0".repeat(64), secret: SECRET });
    assert.equal(v.valid, false);
    assert.equal(v.reason, "bad_signature");
  });

  test("a signature for ANOTHER contract does not work on this one", () => {
    const other = signContractUrl({
      contractId: "99999999-8888-7777-6666-555555555555", secret: SECRET, now: AT("2026-08-02T00:00:00Z") });
    const sig = new URL(other.url, "http://x.invalid").searchParams.get("sig");
    const v = verifyContractUrl({ contractId: ID, expiresAt: other.expiresAt, sig, secret: SECRET });
    assert.equal(v.valid, false);
  });

  test("moving the expiry forward breaks the signature", () => {
    const link = mint();
    const sig = new URL(link.url, "http://x.invalid").searchParams.get("sig");
    const v = verifyContractUrl({ contractId: ID, expiresAt: link.expiresAt + 86400, sig, secret: SECRET });
    assert.equal(v.valid, false);
    assert.equal(v.reason, "bad_signature");
  });

  test("an expired link is refused, and expiry is checked AFTER the signature", () => {
    const link = mint();
    const sig = new URL(link.url, "http://x.invalid").searchParams.get("sig");
    const v = verifyContractUrl({
      contractId: ID, expiresAt: link.expiresAt, sig, secret: SECRET,
      now: AT("2027-01-01T00:00:00Z")
    });
    assert.equal(v.reason, "expired");
    // A forged signature on an expired link reports the signature, not the
    // expiry — otherwise the reason is an oracle for which half was wrong.
    const forged = verifyContractUrl({
      contractId: ID, expiresAt: link.expiresAt, sig: "0".repeat(64), secret: SECRET,
      now: AT("2027-01-01T00:00:00Z")
    });
    assert.equal(forged.reason, "bad_signature");
  });

  test("a link that is exactly at its expiry second still works", () => {
    const link = mint();
    const sig = new URL(link.url, "http://x.invalid").searchParams.get("sig");
    const v = verifyContractUrl({
      contractId: ID, expiresAt: link.expiresAt, sig, secret: SECRET,
      now: () => link.expiresAt * 1000
    });
    assert.equal(v.valid, true);
  });

  test("missing pieces are malformed, never a throw", () => {
    for (const arg of [{}, { contractId: ID }, { contractId: ID, sig: "x" },
                       { contractId: ID, sig: "x", expiresAt: "later" }]) {
      const v = verifyContractUrl({ ...arg, secret: SECRET });
      assert.equal(v.valid, false);
      assert.equal(v.reason, "malformed");
    }
  });

  test("fails closed with no secret, and says which failure it was", () => {
    const v = verifyContractUrl({ contractId: ID, expiresAt: 1, sig: "x" }, {});
    assert.equal(v.valid, false);
    // No CONTRACT_URL_SECRET and no DOCUMENT_URL_SECRET in the test environment.
    assert.ok(["no_secret", "bad_signature"].includes(v.reason), v.reason);
  });
});

describe("verifyContractRequest — straight off a URL", () => {
  test("parses and verifies the whole query string", () => {
    const link = signContractUrl({ contractId: ID, secret: SECRET, now: AT("2026-08-02T00:00:00Z") });
    const v = verifyContractRequest(link.path, { secret: SECRET, now: AT("2026-08-02T00:01:00Z") });
    assert.equal(v.valid, true);
    assert.equal(v.contractId, ID);
  });

  test("junk is malformed, not a crash", () => {
    assert.equal(verifyContractRequest("://::", { secret: SECRET }).valid, false);
  });
});

/* ── THE ONE THAT MATTERS MOST ─────────────────────────────────────────────── */
describe("domain separation from document links", () => {
  test("a DOCUMENT link's signature cannot sign a CONTRACT, on the same secret", () => {
    const doc = signDocumentUrl({ documentId: ID, secret: SECRET, ttlSeconds: 900, now: AT("2026-08-02T00:00:00Z") });
    const sig = new URL(doc.url, "http://x.invalid").searchParams.get("sig");
    const v = verifyContractUrl({ contractId: ID, expiresAt: doc.expiresAt, sig, secret: SECRET,
      now: AT("2026-08-02T00:00:01Z") });
    assert.equal(v.valid, false, "a document link verified as a contract link");
  });

  test("and a CONTRACT link cannot fetch a document", () => {
    const link = signContractUrl({ contractId: ID, secret: SECRET, now: AT("2026-08-02T00:00:00Z") });
    const sig = new URL(link.url, "http://x.invalid").searchParams.get("sig");
    const v = verifyDocumentUrl({ documentId: ID, expiresAt: link.expiresAt, sig, secret: SECRET,
      now: AT("2026-08-02T00:00:01Z") });
    assert.equal(v.valid, false, "a contract link verified as a document link");
  });

  test("the exported signer is the one the URL is actually built with", () => {
    // Same inputs, same hex — so a test that exercises signature() directly is
    // testing the thing that guards the endpoint, not a lookalike.
    const link = signContractUrl({ contractId: ID, secret: SECRET, now: () => 0, ttlSeconds: 123 });
    const direct = signature({ contractId: ID, expiresAt: 123, secret: SECRET });
    assert.equal(direct.length, 64);
    assert.equal(new URL(link.url, "http://x.invalid").searchParams.get("sig"), direct);
  });
});

describe("secretFromEnv", () => {
  test("prefers CONTRACT_URL_SECRET and falls back to DOCUMENT_URL_SECRET", () => {
    assert.equal(secretFromEnv({ CONTRACT_URL_SECRET: SECRET, DOCUMENT_URL_SECRET: "d".repeat(48) }), SECRET);
    assert.equal(secretFromEnv({ DOCUMENT_URL_SECRET: SECRET }), SECRET);
  });

  test("refuses a secret that is absent or too short to be one", () => {
    assert.throws(() => secretFromEnv({}), /missing or too short/);
    assert.throws(() => secretFromEnv({ CONTRACT_URL_SECRET: "short" }), /missing or too short/);
  });
});

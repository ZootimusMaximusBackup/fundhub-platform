import { test } from "node:test";
import assert from "node:assert";
import {
  signDocumentUrl, verifyDocumentUrl, verifyDocumentRequest, secretFromEnv,
  DEFAULT_TTL_SECONDS, MAX_TTL_SECONDS
} from "./signed-url.mjs";

const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef";
const DOC = "11111111-1111-1111-1111-111111111111";
const VER = "22222222-2222-2222-2222-222222222222";
const T0 = Date.UTC(2026, 6, 28, 12, 0, 0);
const at = (ms) => () => ms;

// ---------------------------------------------------------------------------
// signing
// ---------------------------------------------------------------------------
test("a signed url carries no storage key — only ids, expiry, signature", () => {
  const { url } = signDocumentUrl({ documentId: DOC, versionId: VER, secret: SECRET, now: at(T0) });
  assert.ok(url.startsWith("/api/documents/"));
  assert.ok(url.includes(`v=${VER}`));
  assert.match(url, /exp=\d+/);
  assert.match(url, /sig=[0-9a-f]{64}/);
  assert.ok(!url.includes("blob.vercel-storage"), url);
  assert.ok(!url.includes("memory://"), url);
});

test("expiry defaults to 15 minutes and is reported back", () => {
  const out = signDocumentUrl({ documentId: DOC, secret: SECRET, now: at(T0) });
  assert.strictEqual(out.expiresAt, Math.floor(T0 / 1000) + DEFAULT_TTL_SECONDS);
  assert.strictEqual(out.expiresAtIso, new Date(out.expiresAt * 1000).toISOString());
});

test("baseUrl produces an absolute link for an email", () => {
  const { url } = signDocumentUrl({
    documentId: DOC, secret: SECRET, baseUrl: "https://app.fundhub.com/", now: at(T0)
  });
  assert.ok(url.startsWith("https://app.fundhub.com/api/documents/"), url);
});

test("ttl is bounded — no accidental permanent link", () => {
  assert.throws(
    () => signDocumentUrl({ documentId: DOC, secret: SECRET, ttlSeconds: MAX_TTL_SECONDS + 1 }),
    /exceeds the .* maximum/);
  assert.throws(
    () => signDocumentUrl({ documentId: DOC, secret: SECRET, ttlSeconds: 0 }), /positive number/);
});

test("signDocumentUrl requires a document id", () => {
  assert.throws(() => signDocumentUrl({ secret: SECRET }), /requires documentId/);
});

// ---------------------------------------------------------------------------
// verification
// ---------------------------------------------------------------------------
function signed(overrides = {}, now = at(T0)) {
  const out = signDocumentUrl({ documentId: DOC, versionId: VER, secret: SECRET, now, ...overrides });
  const q = new URLSearchParams(out.url.split("?")[1]);
  return { documentId: DOC, versionId: VER, expiresAt: Number(q.get("exp")), sig: q.get("sig") };
}

test("a freshly signed url verifies", () => {
  const v = verifyDocumentUrl({ ...signed(), secret: SECRET, now: at(T0) });
  assert.strictEqual(v.valid, true);
  assert.strictEqual(v.documentId, DOC);
  assert.strictEqual(v.versionId, VER);
});

test("it expires", () => {
  const s = signed();
  const v = verifyDocumentUrl({ ...s, secret: SECRET, now: at(T0 + (DEFAULT_TTL_SECONDS + 1) * 1000) });
  assert.strictEqual(v.valid, false);
  assert.strictEqual(v.reason, "expired");
});

test("it is still valid one second before expiry", () => {
  const s = signed();
  const v = verifyDocumentUrl({ ...s, secret: SECRET, now: at(T0 + (DEFAULT_TTL_SECONDS - 1) * 1000) });
  assert.strictEqual(v.valid, true);
});

test("extending the expiry invalidates the signature — exp is signed", () => {
  const s = signed();
  const v = verifyDocumentUrl({ ...s, expiresAt: s.expiresAt + 86400, secret: SECRET, now: at(T0) });
  assert.strictEqual(v.valid, false);
  assert.strictEqual(v.reason, "bad_signature");
});

test("swapping the document id invalidates the signature — no walking to another client's file", () => {
  const s = signed();
  const v = verifyDocumentUrl({
    ...s, documentId: "33333333-3333-3333-3333-333333333333", secret: SECRET, now: at(T0)
  });
  assert.strictEqual(v.valid, false);
  assert.strictEqual(v.reason, "bad_signature");
});

test("swapping the version id invalidates the signature — links are version-pinned", () => {
  const s = signed();
  const v = verifyDocumentUrl({
    ...s, versionId: "44444444-4444-4444-4444-444444444444", secret: SECRET, now: at(T0)
  });
  assert.strictEqual(v.valid, false);
  assert.strictEqual(v.reason, "bad_signature");
});

test("dropping the version id from a version-pinned link is rejected", () => {
  const s = signed();
  const v = verifyDocumentUrl({ ...s, versionId: null, secret: SECRET, now: at(T0) });
  assert.strictEqual(v.valid, false);
  assert.strictEqual(v.reason, "bad_signature");
});

test("a different secret does not verify", () => {
  const s = signed();
  const v = verifyDocumentUrl({ ...s, secret: SECRET.replace("0", "9"), now: at(T0) });
  assert.strictEqual(v.valid, false);
  assert.strictEqual(v.reason, "bad_signature");
});

test("signature is checked before expiry — a forged link cannot be probed", () => {
  const s = signed();
  const v = verifyDocumentUrl({
    ...s, sig: "f".repeat(64), secret: SECRET, now: at(T0 + 86400_000)
  });
  assert.strictEqual(v.reason, "bad_signature", "expired-but-forged must not report 'expired'");
});

test("malformed input is invalid, never a throw", () => {
  for (const bad of [{}, { documentId: DOC }, { documentId: DOC, sig: "x" },
                     { documentId: DOC, sig: "x", expiresAt: "not-a-number" }]) {
    const v = verifyDocumentUrl({ ...bad, secret: SECRET });
    assert.strictEqual(v.valid, false);
    assert.strictEqual(v.reason, "malformed");
  }
});

test("a signature of the wrong length is rejected without throwing", () => {
  const s = signed();
  const v = verifyDocumentUrl({ ...s, sig: "abc", secret: SECRET, now: at(T0) });
  assert.strictEqual(v.valid, false);
  assert.strictEqual(v.reason, "bad_signature");
});

// ---------------------------------------------------------------------------
// request-shaped verification (what the route calls)
// ---------------------------------------------------------------------------
test("verifyDocumentRequest parses and verifies a request url", () => {
  const { path } = signDocumentUrl({ documentId: DOC, versionId: VER, secret: SECRET, now: at(T0) });
  const v = verifyDocumentRequest(path, { secret: SECRET, now: at(T0) });
  assert.strictEqual(v.valid, true);
  assert.strictEqual(v.documentId, DOC);
  assert.strictEqual(v.versionId, VER);
});

test("verifyDocumentRequest rejects a url with no signature", () => {
  const v = verifyDocumentRequest(`/api/documents/${DOC}`, { secret: SECRET, now: at(T0) });
  assert.strictEqual(v.valid, false);
});

// ---------------------------------------------------------------------------
// secret handling — fail closed
// ---------------------------------------------------------------------------
test("a missing or weak secret refuses to sign", () => {
  assert.throws(() => secretFromEnv({}), /DOCUMENT_URL_SECRET is missing/);
  assert.throws(() => secretFromEnv({ DOCUMENT_URL_SECRET: "short" }), /too short/);
  assert.strictEqual(secretFromEnv({ DOCUMENT_URL_SECRET: SECRET }), SECRET);
});

test("verification with no configured secret is invalid, not a crash", () => {
  const saved = process.env.DOCUMENT_URL_SECRET;
  delete process.env.DOCUMENT_URL_SECRET;
  try {
    const v = verifyDocumentUrl({ documentId: DOC, expiresAt: 1, sig: "a".repeat(64) });
    assert.strictEqual(v.valid, false);
    assert.strictEqual(v.reason, "no_secret");
  } finally {
    if (saved !== undefined) process.env.DOCUMENT_URL_SECRET = saved;
  }
});

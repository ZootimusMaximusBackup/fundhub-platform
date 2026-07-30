// End-to-end tests for GET /api/documents/<id> — the signed download link.
//
// src/documents/ has minted links at this path since it was written
// (signDocumentUrl defaults basePath to "/api/documents") and the ROUTE DID NOT
// EXIST, so every link the portal or an email handed out 404'd and there was no
// way to fetch a document's bytes at all. These drive the real Netlify handler
// against real Postgres, because the interesting cases are all at the seam
// between the signer, the router and the database.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { signDocumentUrl } from "./signed-url.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const SECRET = "test-document-url-secret-that-is-long-enough-32";

describe("GET /api/documents/<id>", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, clientId, docId, handler, priorSecret;
  const BLOB = "https://blob.example.com/fundhub/doc-fixture.pdf";
  const EMAIL = "download.fixture@example.com";

  const call = async (pathAndQuery) =>
    handler(new Request("https://site.netlify.app" + pathAndQuery, { headers: { host: "site.netlify.app" } }), {});

  before(async () => {
    priorSecret = process.env.DOCUMENT_URL_SECRET;
    process.env.DOCUMENT_URL_SECRET = SECRET;
    ({ default: handler } = await import("../../netlify/functions/api.mjs"));

    org = await resolveDefaultOrg(db);
    await purge();
    clientId = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Download','Fixture',$2) RETURNING id`, [org, EMAIL])).rows[0].id;
    docId = (await db.query(
      `INSERT INTO documents (org_id, client_id, document_key, storage_key, mime_type,
                              kind, title, delivery_status)
       VALUES ($1,$2,$3,$4,'application/pdf','deliverable','Funding Snapshot','not_delivered')
       RETURNING id`,
      [org, clientId, "download-fixture-key", BLOB])).rows[0].id;
  });

  async function purge() {
    const ids = (await db.query(
      `SELECT id FROM clients WHERE org_id = $1 AND lower(email) = $2`, [org, EMAIL])).rows.map(r => r.id);
    if (!ids.length) return;
    await db.query(`ALTER TABLE documents DISABLE TRIGGER trg_documents_no_delete`);
    try { await db.query(`DELETE FROM documents WHERE client_id = ANY($1)`, [ids]); }
    finally { await db.query(`ALTER TABLE documents ENABLE TRIGGER trg_documents_no_delete`); }
    await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
  }

  after(async () => {
    await purge();
    if (priorSecret === undefined) delete process.env.DOCUMENT_URL_SECRET;
    else process.env.DOCUMENT_URL_SECRET = priorSecret;
    await close();
  });

  const signedPath = (over = {}) =>
    signDocumentUrl({ documentId: docId, secret: SECRET, ...over }).path;

  // ── the route exists and works ─────────────────────────────────────────────

  test("a valid signed link redirects to storage", async () => {
    const r = await call(signedPath());
    assert.equal(r.status, 302, await r.text());
    assert.equal(r.headers.get("location"), BLOB);
  });

  test("HEAD works and returns the mime type without a body", async () => {
    const r = await handler(new Request("https://site.netlify.app" + signedPath(),
      { method: "HEAD", headers: { host: "site.netlify.app" } }), {});
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "application/pdf");
  });

  test("the response is never cached and never sniffed", async () => {
    const r = await call(signedPath());
    assert.match(r.headers.get("cache-control"), /no-store/);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  });

  // ── the signature IS the credential ────────────────────────────────────────

  test("a tampered signature is refused", async () => {
    const p = signedPath();
    const bad = p.replace(/sig=([0-9a-f]{2})/, (m, g) => "sig=" + (g === "ff" ? "ee" : "ff"));
    const r = await call(bad);
    assert.equal(r.status, 404);
  });

  test("an expired link is refused", async () => {
    const past = signDocumentUrl({
      documentId: docId, secret: SECRET, ttlSeconds: 60,
      now: () => Date.now() - 3600_000
    }).path;
    assert.equal((await call(past)).status, 404);
  });

  test("no signature at all is refused", async () => {
    assert.equal((await call(`/api/documents/${docId}`)).status, 404);
  });

  test("a signature for a DIFFERENT document does not open this one", async () => {
    const other = "00000000-0000-4000-8000-0000000000aa";
    const p = signDocumentUrl({ documentId: other, secret: SECRET }).path;
    // Same signature, pointed at our real document id.
    const swapped = p.replace(other, docId);
    assert.equal((await call(swapped)).status, 404);
  });

  // ── everything unknown looks identical: no membership oracle ───────────────

  test("unknown id, bad signature and expired link are indistinguishable", async () => {
    const unknown = signDocumentUrl({
      documentId: "00000000-0000-4000-8000-0000000000bb", secret: SECRET
    }).path;
    const bodies = [];
    for (const p of [unknown, `/api/documents/${docId}`, signedPath().replace(/sig=\w+/, "sig=deadbeef")]) {
      const r = await call(p);
      assert.equal(r.status, 404);
      bodies.push(await r.text());
    }
    assert.equal(new Set(bodies).size, 1, `bodies differ: ${JSON.stringify(bodies)}`);
  });

  test("a malformed id is a 404, not a Postgres error", async () => {
    const r = await call("/api/documents/not-a-uuid?exp=1&sig=x");
    assert.equal(r.status, 404);
    assert.doesNotMatch(await r.text(), /invalid input syntax|uuid/i);
  });

  // ── it never hands back the storage key itself ─────────────────────────────

  test("storage_key never appears in a response body", async () => {
    for (const p of [signedPath(), `/api/documents/${docId}`]) {
      const r = await call(p);
      assert.doesNotMatch(await r.text(), /blob\.example\.com/,
        "the storage key leaked into a body");
    }
  });

  // ── fail closed ────────────────────────────────────────────────────────────

  test("with no DOCUMENT_URL_SECRET the route refuses rather than opening", async () => {
    const saved = process.env.DOCUMENT_URL_SECRET;
    const p = signedPath();          // sign while the secret is still set
    delete process.env.DOCUMENT_URL_SECRET;
    try {
      const r = await call(p);
      assert.equal(r.status, 503, "an unconfigured deploy must not serve documents");
      assert.doesNotMatch(await r.text(), /blob\.example\.com/);
    } finally {
      process.env.DOCUMENT_URL_SECRET = saved;
    }
  });

  test("a non-GET method is 405", async () => {
    const r = await handler(new Request("https://site.netlify.app" + signedPath(),
      { method: "DELETE", headers: { host: "site.netlify.app" } }), {});
    assert.equal(r.status, 405);
  });
});

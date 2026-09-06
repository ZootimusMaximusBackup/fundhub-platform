// GET /api/documents/<id> — stored HTML must never run on this origin.
//
// WHY THIS FILE EXISTS. Contracts are stored as text/html
// (src/contracts/send.mjs:50 CONTRACT_MIME) and this route hands back whatever
// content type the row carries, with no Content-Disposition. So a stored
// contract RENDERED as a page on the app's own origin — the same origin whose
// localStorage holds the session token `fh_token`
// (public/app/client-portal.html:2049) — while merge fields are interpolated
// into that body with no escaping at all
// (src/lib/render-template.mjs:46 is `return String(val);`). One hostile string
// in a CRM field and "open the contract" becomes session theft, staff included.
//
// The guard is two headers, sent ONLY for text/html:
//     Content-Security-Policy: sandbox; default-src 'none'
//     Content-Disposition: attachment
//
// WHAT IS ACTUALLY PROVEN HERE, and why each case is present:
//   1. an HTML document comes back with BOTH headers
//   2. a PDF comes back with NEITHER — PDFs and images still open inline, which
//      is what every screen that links here expects
//   3. the mime type is matched with its charset parameter too
//   4. HEAD gets the guard as well, so a probe cannot see a bare text/html
//   5. the signed-URL auth is UNCHANGED: a wrong signature, an expired link, a
//      tampered id and an unknown id are all still the same 404, and a missing
//      secret is still 503
//
// WHAT IS NOT PROVEN HERE, so the suite name is not read wider than it is.
// "never rendered" covers the BYTE-STREAMING path, which is the only storage
// path this repo can reach. It does NOT cover the 302 branch: when storage_key
// is itself an https URL the route redirects, and headers on a redirect do not
// travel to the object the browser fetches next — so an HTML document served
// that way would still render, on the blob host. Only vercelBlobProvider makes
// an https storage_key and @vercel/blob is not a dependency of this repo
// (src/documents/store.mjs:207), so there is nothing to test against today.
// api/documents/[id].mjs says the same thing above guardHtml(), and
// docs/journeys/deliverables-actual.md §2 records what has to change if that
// provider is ever installed.
//
// LIVES UNDER src/http/, NOT api/. npm test's glob is src/** and scripts/**
// only, so a test placed beside the handler never runs (CLAUDE.md §12).

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { storeAndRegister } from "../documents/register.mjs";
import { storeFromEnv } from "../documents/store.mjs";
import { signDocumentUrl } from "../documents/signed-url.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const SECRET = "test-html-guard-secret-that-is-long-enough-32";
const EMAIL_TAG = "html.guard.fixture";

const HTML_BYTES = Buffer.from(
  "<html><body><h1>Funding Agreement</h1><script>alert(1)</script></body></html>", "utf8");
const PDF_BYTES = Buffer.from("%PDF-1.4\n%html guard fixture\n%%EOF");

describe("stored HTML is sandboxed and downloaded, never rendered",
  { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
    let org, clientId, handler, priorSecret, priorProvider;
    let htmlDoc, htmlCharsetDoc, pdfDoc;

    const call = (path) =>
      handler(new Request("https://site.netlify.app" + path, {
        host: "site.netlify.app", method: "GET"
      }), {});

    const head = (path) =>
      handler(new Request("https://site.netlify.app" + path, {
        host: "site.netlify.app", method: "HEAD"
      }), {});

    /** The real link a real caller gets: signDocumentUrl mints it, unchanged. */
    const linkFor = (doc, opts = {}) => signDocumentUrl({
      documentId: doc.id,
      versionId: doc.current_version_id,
      secret: SECRET,
      ...opts
    }).path;

    // A distinct discriminator per fixture. Without one all three share the
    // kind|subtype|clientId document key and the later ones would append a
    // VERSION to the first rather than becoming their own document.
    async function register(discriminator, title, body, mimeType, filename) {
      const { document } = await storeAndRegister(db, storeFromEnv(), {
        orgId: org,
        clientId,
        kind: "deliverable",
        subtype: "html_guard_fixture",
        discriminator,
        title,
        body,
        mimeType,
        filename,
        generatedBy: EMAIL_TAG
      });
      return document;
    }

    async function purge() {
      await db.query(
        `DELETE FROM clients WHERE org_id = $1 AND email LIKE $2`,
        [org, `${EMAIL_TAG}%`]).catch(() => {});
    }

    before(async () => {
      priorSecret = process.env.DOCUMENT_URL_SECRET;
      priorProvider = process.env.DOCUMENT_STORE_PROVIDER;
      process.env.DOCUMENT_URL_SECRET = SECRET;
      // memory provider — one Map for the life of the process, so the bytes
      // this file stores are the bytes the route reads back.
      delete process.env.DOCUMENT_STORE_PROVIDER;
      ({ default: handler } = await import("../../netlify/functions/api.mjs"));

      org = await resolveDefaultOrg(db);
      clientId = (await db.query(
        `INSERT INTO clients (org_id, email, first_name, last_name)
         VALUES ($1,$2,'Html','Guard') RETURNING id`,
        [org, `${EMAIL_TAG}.${Date.now()}@example.com`])).rows[0].id;

      htmlDoc = await register("html", "Guard HTML", HTML_BYTES, "text/html", "guard.html");
      htmlCharsetDoc = await register("html-charset",
        "Guard HTML charset", HTML_BYTES, "text/html; charset=utf-8", "guard-charset.html");
      pdfDoc = await register("pdf", "Guard PDF", PDF_BYTES, "application/pdf", "guard.pdf");
    });

    after(async () => {
      if (!HAVE_DB) return;
      if (priorSecret === undefined) delete process.env.DOCUMENT_URL_SECRET;
      else process.env.DOCUMENT_URL_SECRET = priorSecret;
      if (priorProvider === undefined) delete process.env.DOCUMENT_STORE_PROVIDER;
      else process.env.DOCUMENT_STORE_PROVIDER = priorProvider;
      await purge();
      await close();
    });

    test("an HTML document is served with the sandbox CSP and as an attachment", async () => {
      const res = await call(linkFor(htmlDoc));
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "text/html");
      assert.equal(res.headers.get("content-security-policy"), "sandbox; default-src 'none'");
      assert.equal(res.headers.get("content-disposition"), "attachment");
      // The bytes are still the document's own. This is a header change, not a
      // content change — nothing is rewritten on the way out.
      assert.equal(await res.text(), HTML_BYTES.toString("utf8"));
    });

    test("text/html with a charset parameter is guarded too", async () => {
      const res = await call(linkFor(htmlCharsetDoc));
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-security-policy"), "sandbox; default-src 'none'");
      assert.equal(res.headers.get("content-disposition"), "attachment");
    });

    test("a PDF gets NEITHER header and still opens inline", async () => {
      const res = await call(linkFor(pdfDoc));
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "application/pdf");
      assert.equal(res.headers.get("content-security-policy"), null);
      assert.equal(res.headers.get("content-disposition"), null);
      assert.equal(Buffer.from(await res.arrayBuffer()).toString(), PDF_BYTES.toString());
    });

    test("the headers PDFs already had are untouched", async () => {
      const res = await call(linkFor(pdfDoc));
      assert.equal(res.headers.get("cache-control"), "private, no-store");
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    });

    test("a HEAD on an HTML document is guarded, a HEAD on a PDF is not", async () => {
      const htmlHead = await head(linkFor(htmlDoc));
      assert.equal(htmlHead.status, 200);
      assert.equal(htmlHead.headers.get("content-security-policy"), "sandbox; default-src 'none'");
      assert.equal(htmlHead.headers.get("content-disposition"), "attachment");

      const pdfHead = await head(linkFor(pdfDoc));
      assert.equal(pdfHead.status, 200);
      assert.equal(pdfHead.headers.get("content-security-policy"), null);
      assert.equal(pdfHead.headers.get("content-disposition"), null);
    });

    // ── the auth path, unchanged ─────────────────────────────────────────────
    // AUTH IS THE SIGNATURE, not a session (the route's own header comment).
    // These four cases are the whole credential, and the guard must not have
    // moved any of them.

    test("a tampered signature is still 404, and the guard does not leak first", async () => {
      const link = linkFor(htmlDoc).replace(/sig=([0-9a-f])/, (m, c) =>
        "sig=" + (c === "0" ? "1" : "0"));
      const res = await call(link);
      assert.equal(res.status, 404);
      assert.equal((await res.json()).error, "not_found");
      assert.equal(res.headers.get("content-disposition"), null);
    });

    test("an expired link is still 404", async () => {
      // The clock is injected rather than slept on: a 60s link minted an hour ago.
      const past = Date.now() - 3600 * 1000;
      const link = linkFor(htmlDoc, { ttlSeconds: 60, now: () => past });
      const res = await call(link);
      assert.equal(res.status, 404);
    });

    test("a signature minted for one document does not open another", async () => {
      // Same exp and sig, different document id in the path.
      const query = linkFor(pdfDoc).split("?")[1];
      const res = await call(`/api/documents/${htmlDoc.id}?${query}`);
      assert.equal(res.status, 404);
      assert.equal(res.headers.get("content-disposition"), null);
    });

    test("an unknown but well-formed id is the same 404", async () => {
      const missing = "00000000-0000-4000-8000-000000000000";
      const res = await call(signDocumentUrl({ documentId: missing, secret: SECRET }).path);
      assert.equal(res.status, 404);
      assert.equal((await res.json()).error, "not_found");
    });

    test("no signing secret is still 503 not_configured, not an open door", async () => {
      const link = linkFor(htmlDoc);
      delete process.env.DOCUMENT_URL_SECRET;
      try {
        const res = await call(link);
        assert.equal(res.status, 503);
        assert.equal((await res.json()).error, "not_configured");
      } finally {
        process.env.DOCUMENT_URL_SECRET = SECRET;
      }
    });
  });

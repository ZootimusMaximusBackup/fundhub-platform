// GET /api/documents/<id>?v=<versionId>&exp=<unix>&sig=<hex>
//
// The endpoint every signed document link points at. src/documents/ has minted
// these links since it was written — signDocumentUrl() defaults basePath to
// "/api/documents" — and THIS ROUTE DID NOT EXIST. So every link the portal,
// an email or a workflow handed out resolved to a 404, and there was no way to
// fetch a document's bytes at all: api/read/documents serves metadata and
// redact() strips storage_key on the way out, deliberately.
//
// AUTH IS THE SIGNATURE, not a session. That is the point of the design: a link
// in an email has to work for a client who is not signed in, so the HMAC and its
// expiry ARE the credential. Consequences, all deliberate:
//
//   - Fail closed with no DOCUMENT_URL_SECRET. No secret, no links, no
//     downloads — never an unauthenticated open door.
//   - Constant-time signature comparison, done inside signed-url.mjs.
//   - A bad signature, an expired link, an unknown id and a version that
//     belongs to another document are ALL 404 with the same body. Distinguishing
//     them turns the endpoint into an oracle for which document ids exist.
//   - storage_key never appears in a response. Under Vercel Blob it is itself a
//     permanent bearer credential, so it is used to fetch and then discarded.

import { db } from "../../src/db.mjs";
import { verifyDocumentUrl } from "../../src/documents/signed-url.mjs";
import { resolveStorageTarget } from "../../src/documents/retrieve.mjs";
import { storeFromEnv } from "../../src/documents/store.mjs";
import { isUuid } from "../../src/http/read-api.mjs";
import { safeError } from "../../src/http/health.mjs";

const GONE = (res) => res.status(404).json({ ok: false, error: "not_found" });

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const q = req.query || {};
  const documentId = q.id;
  const versionId = q.v || null;

  // Shape checks first: a malformed id must not reach Postgres as a 22P02.
  if (!isUuid(documentId)) return GONE(res);
  if (versionId && !isUuid(versionId)) return GONE(res);

  const verdict = verifyDocumentUrl({
    documentId, versionId, expiresAt: q.exp, sig: q.sig
  });
  if (!verdict.valid) {
    // no_secret is OUR misconfiguration, not the caller's — say so, without
    // telling an anonymous caller anything about the document itself.
    if (verdict.reason === "no_secret") {
      return res.status(503).json({ ok: false, error: "not_configured" });
    }
    return GONE(res);
  }

  try {
    const target = await resolveStorageTarget(db, { documentId, versionId });
    if (!target || !target.storage_key) return GONE(res);

    // A document may expire independently of the link that points at it.
    if (target.expires_at && new Date(target.expires_at) < new Date()) return GONE(res);

    res.setHeader("cache-control", "private, no-store");
    res.setHeader("x-content-type-options", "nosniff");
    if (req.method === "HEAD") {
      res.setHeader("content-type", target.mime_type || "application/octet-stream");
      return res.status(200).end("");
    }

    /* Two storage shapes, two ways to serve them:
       - Vercel Blob's storage_key IS the object's public URL, so the cheapest
         correct thing is to hand the caller straight to it with a 302 — never
         put it in a JSON body, since a body is readable by anything that logs
         responses whereas a redirect's Location is spent on the redirect
         itself.
       - Netlify Blobs (the storage decision as of docs/UPLOADS-SPEC.md) and the
         in-memory test provider both use an OPAQUE key with no public URL
         behind it — there is nowhere to redirect to, so this streams the bytes
         itself via the same store.mjs the write path used. That was flagged
         here as the eventual requirement the day this route was written;
         client uploads are what made it actually eventual. */
    const key = String(target.storage_key);
    if (/^https?:\/\//i.test(key)) {
      res.setHeader("location", key);
      return res.status(302).end("");
    }

    const store = storeFromEnv();
    const object = await store.get(key, { expectedChecksum: target.checksum || null });
    if (!object) return GONE(res);
    res.setHeader("content-type", target.mime_type || object.contentType || "application/octet-stream");
    return res.status(200).end(object.body);
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}

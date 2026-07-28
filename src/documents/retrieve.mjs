// src/documents/retrieve.mjs — reads. Newest version by default, history on request.
//
// EVERY function here returns SHAPED rows: storage_key is stripped, and a
// short-lived signed URL is attached in its place. The one exception is
// resolveStorageTarget(), which exists solely for the HTTP route that streams
// bytes and is fenced off at the bottom of this file.
//
// The portal read is listClientLibrary(): "everything this client owns, newest
// version each" in ONE statement. It is a single query because documents already
// carries the current-version snapshot — no per-document follow-up, no N+1. The
// LEFT JOIN is only there to count versions for the "3 versions" affordance.

import { signDocumentUrl, DEFAULT_TTL_SECONDS } from "./signed-url.mjs";

// Columns safe to hand to a caller. storage_key is deliberately absent — under
// Vercel Blob it is a permanent public URL, i.e. a bearer credential.
const PUBLIC_DOC_COLUMNS = `
  d.id, d.org_id, d.client_id, d.document_key, d.kind, d.subtype, d.title,
  d.invoice_id, d.current_version, d.current_version_id,
  d.mime_type, d.byte_size, d.checksum, d.generated_by, d.generated_at,
  d.delivered_at, d.delivery_channel, d.delivery_status,
  d.signature_required, d.signed_at, d.signer_name, d.signature_ref,
  d.expires_at, d.metadata, d.created_at, d.updated_at`;

const PUBLIC_VERSION_COLUMNS = `
  v.id, v.org_id, v.document_id, v.version, v.mime_type, v.byte_size, v.checksum,
  v.generated_by, v.generated_at, v.delivered_at, v.delivery_channel,
  v.delivery_status, v.signed_at, v.signer_name, v.signature_ref,
  v.source_event_id, v.reason, v.metadata, v.created_at, v.updated_at`;

// ---------------------------------------------------------------------------
// shaping
// ---------------------------------------------------------------------------

const isExpired = (expiresAt, now) =>
  Boolean(expiresAt) && new Date(expiresAt).getTime() <= now;

/**
 * shapeDocument — the client-facing view of a registry row.
 *
 * Defence in depth: even though the queries never select storage_key, this
 * deletes it. A future `SELECT *` should not turn into a credential leak.
 */
export function shapeDocument(row, { signing = null, now = Date.now() } = {}) {
  if (!row) return null;
  const { storage_key, ...rest } = row;   // eslint-disable-line no-unused-vars
  const out = {
    ...rest,
    version_count: rest.version_count !== undefined ? Number(rest.version_count) : undefined,
    expired: isExpired(rest.expires_at, now)
  };
  if (out.version_count === undefined) delete out.version_count;
  if (signing) {
    out.download = signDocumentUrl({
      documentId: row.id,
      versionId: row.current_version_id ?? null,
      ...signing
    });
  }
  return out;
}

/** shapeVersion — same guarantee for a history row. */
export function shapeVersion(row, { signing = null } = {}) {
  if (!row) return null;
  const { storage_key, ...rest } = row;   // eslint-disable-line no-unused-vars
  const out = { ...rest };
  if (signing) {
    out.download = signDocumentUrl({
      documentId: row.document_id,
      versionId: row.id,
      ...signing
    });
  }
  return out;
}

// `signing` is passed through to signDocumentUrl: { ttlSeconds, secret, basePath,
// baseUrl }. Omit it entirely and no URLs are minted — which is what an internal
// caller (a dashboard count, an ops query) wants.
const signingOpts = (opts) =>
  opts.sign === false || opts.sign === undefined || opts.sign === null
    ? null
    : { ttlSeconds: DEFAULT_TTL_SECONDS, ...(opts.sign === true ? {} : opts.sign) };

// ---------------------------------------------------------------------------
// the portal read — ONE query
// ---------------------------------------------------------------------------

/**
 * listClientLibrary — everything this client owns, newest version each.
 *
 * The client portal's main read, and the shape entitlements (session G, wave 2)
 * will filter: join on `documents.id`, or pre-filter with the `documentIds`
 * option below so the entitlement check stays a single round trip too.
 *
 * Expired documents are INCLUDED by default and flagged with `expired: true`
 * rather than hidden — an expired soft-pull authorization is still something the
 * client owns and may need to see. Pass includeExpired: false to drop them.
 *
 * @param {object} opts
 * @param {string[]} [opts.kinds]        restrict to these kinds
 * @param {string[]} [opts.documentIds]  restrict to these ids (entitlement pre-filter)
 * @param {boolean}  [opts.includeExpired=true]
 * @param {boolean|object} [opts.sign]   attach signed URLs (see signingOpts)
 */
export async function listClientLibrary(db, {
  orgId,
  clientId,
  kinds = null,
  documentIds = null,
  includeExpired = true,
  sign = false,
  now = Date.now()
} = {}) {
  if (!orgId || !clientId) throw new Error("listClientLibrary requires orgId and clientId");

  const res = await db.query(
    `SELECT ${PUBLIC_DOC_COLUMNS},
            count(v.id)::int AS version_count
       FROM documents d
       LEFT JOIN document_versions v ON v.document_id = d.id
      WHERE d.org_id = $1
        AND d.client_id = $2
        AND ($3::text[] IS NULL OR d.kind = ANY($3))
        AND ($4::uuid[] IS NULL OR d.id = ANY($4))
        AND ($5::boolean OR d.expires_at IS NULL OR d.expires_at > now())
      GROUP BY d.id
      ORDER BY d.kind ASC, d.generated_at DESC`,
    [orgId, clientId, kinds, documentIds, includeExpired]
  );

  const signing = signingOpts({ sign });
  return res.rows.map((r) => shapeDocument(r, { signing, now }));
}

// ---------------------------------------------------------------------------
// by client + kind
// ---------------------------------------------------------------------------

/**
 * getByClientAndKind — the named read: fetch by client + kind, newest version by
 * default, full history on request.
 *
 * Returns { document, version, history } where `history` is null unless
 * history: true. `document` already reflects the newest version, so the default
 * path is one query.
 */
export async function getByClientAndKind(db, {
  orgId,
  clientId,
  kind,
  subtype = null,
  history = false,
  includeExpired = true,
  sign = false,
  now = Date.now()
} = {}) {
  if (!orgId || !clientId || !kind) {
    throw new Error("getByClientAndKind requires orgId, clientId, kind");
  }

  const res = await db.query(
    `SELECT ${PUBLIC_DOC_COLUMNS}
       FROM documents d
      WHERE d.org_id = $1
        AND d.client_id = $2
        AND d.kind = $3
        AND ($4::text IS NULL OR d.subtype = $4)
        AND ($5::boolean OR d.expires_at IS NULL OR d.expires_at > now())
      ORDER BY d.generated_at DESC
      LIMIT 1`,
    [orgId, clientId, kind, subtype, includeExpired]
  );

  const signing = signingOpts({ sign });
  const document = shapeDocument(res.rows[0], { signing, now });
  if (!document) return { document: null, version: null, history: null };

  return {
    document,
    version: document.current_version,
    history: history ? await getHistory(db, { orgId, documentId: document.id, sign }) : null
  };
}

/** All documents of a kind for a client (not just the newest one of that kind). */
export async function listByKind(db, {
  orgId, clientId, kind, includeExpired = true, sign = false, now = Date.now()
} = {}) {
  return listClientLibrary(db, { orgId, clientId, kinds: [kind], includeExpired, sign, now });
}

// ---------------------------------------------------------------------------
// single document + history
// ---------------------------------------------------------------------------

export async function getDocument(db, { orgId, documentId, sign = false, now = Date.now() } = {}) {
  if (!documentId) throw new Error("getDocument requires documentId");
  const res = await db.query(
    `SELECT ${PUBLIC_DOC_COLUMNS} FROM documents d
      WHERE d.id = $1 AND ($2::uuid IS NULL OR d.org_id = $2)`,
    [documentId, orgId ?? null]
  );
  return shapeDocument(res.rows[0], { signing: signingOpts({ sign }), now });
}

/**
 * getHistory — every version, newest first.
 *
 * This is what "clients keep access to what they were actually sent" means in
 * practice: each row carries its own delivery record and its own signed URL, so
 * a client can re-download the exact artifact from any past generation.
 */
export async function getHistory(db, { orgId = null, documentId, sign = false } = {}) {
  if (!documentId) throw new Error("getHistory requires documentId");
  const res = await db.query(
    `SELECT ${PUBLIC_VERSION_COLUMNS} FROM document_versions v
      WHERE v.document_id = $1 AND ($2::uuid IS NULL OR v.org_id = $2)
      ORDER BY v.version DESC`,
    [documentId, orgId]
  );
  const signing = signingOpts({ sign });
  return res.rows.map((r) => shapeVersion(r, { signing }));
}

/** One specific version. */
export async function getVersion(db, { orgId = null, documentId, version, sign = false } = {}) {
  const res = await db.query(
    `SELECT ${PUBLIC_VERSION_COLUMNS} FROM document_versions v
      WHERE v.document_id = $1 AND v.version = $2 AND ($3::uuid IS NULL OR v.org_id = $3)`,
    [documentId, version, orgId]
  );
  return shapeVersion(res.rows[0], { signing: signingOpts({ sign }) });
}

// ---------------------------------------------------------------------------
// ⚠️  the one function that returns a storage key
// ---------------------------------------------------------------------------

/**
 * resolveStorageTarget — storage key + checksum for a verified download.
 *
 * FOR THE DOWNLOAD ROUTE ONLY, and only AFTER verifyDocumentUrl() has returned
 * valid. It returns the raw storage key, which is a credential (see store.mjs).
 * The route reads bytes through store.get() and streams them; it must never put
 * this value in a response body, a redirect Location, a log line, or a template.
 *
 * If you are calling this from anywhere other than that route, you want
 * getDocument()/getHistory() with sign: true instead.
 */
export async function resolveStorageTarget(db, { documentId, versionId = null } = {}) {
  if (!documentId) throw new Error("resolveStorageTarget requires documentId");

  if (versionId) {
    const res = await db.query(
      `SELECT v.id AS version_id, v.document_id, v.storage_key, v.mime_type,
              v.checksum, v.byte_size, v.version, d.client_id, d.org_id, d.title, d.expires_at
         FROM document_versions v
         JOIN documents d ON d.id = v.document_id
        WHERE v.id = $1 AND v.document_id = $2`,
      [versionId, documentId]);
    return res.rows[0] ?? null;
  }

  const res = await db.query(
    `SELECT d.current_version_id AS version_id, d.id AS document_id, d.storage_key,
            d.mime_type, d.checksum, d.byte_size, d.current_version AS version,
            d.client_id, d.org_id, d.title, d.expires_at
       FROM documents d
      WHERE d.id = $1`,
    [documentId]);
  return res.rows[0] ?? null;
}

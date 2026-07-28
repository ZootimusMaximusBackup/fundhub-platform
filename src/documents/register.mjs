// src/documents/register.mjs — record a document. Idempotent on source_event_id.
//
// One entry point matters: registerDocument(). It resolves the document's
// LOGICAL identity (document_key), appends an immutable version, and refreshes
// the current-version snapshot on the registry row.
//
// Three invariants, in order of how easy they are to break:
//
//   1. SAME SOURCE EVENT TWICE = ONE DOCUMENT. Rule 9 — events replay, so the
//      side effects must be idempotent. Guarded twice: a lookup on
//      (org_id, source_event_id) before doing anything, and a unique index that
//      catches the race the lookup cannot.
//
//   2. REGENERATION APPENDS. A new version, never an overwrite — the client
//      keeps access to the bytes they were actually sent. The database enforces
//      this (document_versions is immutable + delete-blocked); this file simply
//      never tries.
//
//   3. THE SNAPSHOT FOLLOWS THE VERSION. documents mirrors its newest version so
//      the portal's read is one query. If a write is interrupted between the two
//      steps, the next call for the same event repairs the snapshot rather than
//      returning a stale row (reconcileSnapshot below).

import { buildDocumentKey, assertKind, titleFor } from "./kinds.mjs";

// ---------------------------------------------------------------------------
// transactions
// ---------------------------------------------------------------------------

/**
 * withTransaction — real transaction when the handle can give us one.
 *
 * A pg Pool gets BEGIN/COMMIT on a pinned connection. A CHECKED-OUT CLIENT runs
 * inline, because the caller already owns a transaction on it — that is how this
 * composes inside a larger unit of work.
 *
 * The `{ query }` wrapper exported by src/db.mjs is neither: its queries may each
 * land on a different pooled connection, so issuing BEGIN through it would be
 * worse than useless. Those steps run unwrapped — safe because each one is
 * individually idempotent and the snapshot self-heals (reconcileSnapshot below).
 *
 * Pass a pool for atomicity, or a client you have already opened a transaction on.
 */
export function isPool(db) {
  if (!db || typeof db.connect !== "function") return false;
  // A checked-out pg PoolClient STILL exposes .connect() — duck-typing on that
  // alone re-connects an in-use client ("Client has already been connected").
  // release() is what actually distinguishes a borrowed client from a pool.
  if (typeof db.release === "function") return false;
  return typeof db.totalCount === "number" || /Pool/.test(db.constructor?.name ?? "");
}

export async function withTransaction(db, fn) {
  if (!isPool(db)) return fn(db, { transactional: false });
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client, { transactional: true });
    await client.query("COMMIT");
    return out;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* the original error is the interesting one */ }
    throw err;
  } finally {
    client.release?.();
  }
}

// ---------------------------------------------------------------------------
// register
// ---------------------------------------------------------------------------

const DOC_COLUMNS = `
  org_id, client_id, document_key, kind, subtype, title, invoice_id,
  current_version, storage_key, mime_type, byte_size, checksum,
  generated_by, generated_at, signature_required, expires_at,
  source_event_id, metadata`;

/**
 * registerDocument — the one call a generator makes after storing bytes.
 *
 * Returns { document, version, created, appended, deduped }:
 *   created   — a new registry row was minted (version 1)
 *   appended  — an existing document gained a version (regeneration)
 *   deduped   — this source event was already registered; nothing was written
 *
 * @param {object} db     pg pool (transactional) or { query } (still idempotent)
 * @param {object} params
 */
export async function registerDocument(db, {
  orgId,
  clientId,
  kind,
  subtype = null,
  title = null,
  // the stored object — as returned by store.put()
  storageKey,
  mimeType,
  byteSize = null,
  checksum = null,
  // provenance
  generatedBy = null,
  generatedAt = null,
  // identity + policy
  documentKey = null,
  discriminator = null,      // per-round / per-invoice documents: keeps versions apart
  invoiceId = null,
  signatureRequired = null,
  expiresAt = null,
  // idempotency (Rule 9)
  sourceEventId = null,
  // audit
  reason = null,             // 'initial' | 'regenerated' | 'corrected' | 'imported'
  metadata = {}
} = {}) {
  assertKind(kind);
  if (!orgId || !clientId) throw new Error("registerDocument requires orgId and clientId");
  if (!storageKey) throw new Error("registerDocument requires storageKey (call store.put first)");
  if (!mimeType) throw new Error("registerDocument requires mimeType");

  const key = documentKey || buildDocumentKey({ kind, subtype, clientId, discriminator });
  const docTitle = title || titleFor(subtype);
  const genAt = generatedAt || new Date();
  const meta = metadata ?? {};

  return withTransaction(db, async (tx) => {
    // ---- 1. find or create the registry row (logical identity) --------------
    // Insert-first: a successful insert proves the document did not exist, so no
    // prior version of it can exist either and the idempotency check below is
    // unnecessary. Only a conflict means there is history to check against.
    const inserted = await tx.query(
      `INSERT INTO documents (${DOC_COLUMNS})
       VALUES ($1,$2,$3,$4,$5,$6,$7,
               1,$8,$9,$10,$11,
               $12,$13,$14,$15,
               $16,$17)
       ON CONFLICT (org_id, document_key) DO NOTHING
       RETURNING *`,
      [orgId, clientId, key, kind, subtype, docTitle, invoiceId,
       storageKey, mimeType, byteSize, checksum,
       generatedBy, genAt, signatureRequired ?? false, expiresAt,
       sourceEventId, JSON.stringify(meta)]
    );

    let document = inserted.rows[0] ?? null;
    const isNew = Boolean(document);

    if (!document) {
      // Existing document — lock it so two concurrent regenerations cannot pick
      // the same version number. UNIQUE (document_id, version) is the backstop.
      const locked = await tx.query(
        `SELECT * FROM documents WHERE org_id = $1 AND document_key = $2 FOR UPDATE`,
        [orgId, key]
      );
      document = locked.rows[0];
      if (!document) throw new Error(`document ${key} vanished between insert and lock`);

      // ---- 2. idempotency: has this event already generated THIS document? --
      // Scoped to the document, not the org: one `analysis.completed` generates
      // all five UnderwriteIQ deliverables, so the same event id legitimately
      // appears on five different documents. What it must never do is append two
      // versions to one of them. Backstopped by
      // document_versions_doc_source_event_uniq.
      if (sourceEventId) {
        const seen = await tx.query(
          `SELECT * FROM document_versions
            WHERE org_id = $1 AND document_id = $2 AND source_event_id = $3`,
          [orgId, document.id, sourceEventId]
        );
        if (seen.rows[0]) {
          const version = seen.rows[0];
          // Repair a snapshot left behind by an interrupted earlier attempt.
          const repaired = await reconcileSnapshot(tx, document, version);
          return { document: repaired, version, created: false, appended: false, deduped: true };
        }
      }
    }

    // ---- 3. append the version ---------------------------------------------
    const next = isNew
      ? 1
      : Number((await tx.query(
          `SELECT coalesce(max(version), 0) + 1 AS next FROM document_versions WHERE document_id = $1`,
          [document.id]
        )).rows[0].next);

    const versionRow = await tx.query(
      `INSERT INTO document_versions
         (org_id, document_id, version, storage_key, mime_type, byte_size, checksum,
          generated_by, generated_at, source_event_id, reason, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [orgId, document.id, next, storageKey, mimeType, byteSize, checksum,
       generatedBy, genAt, sourceEventId, reason || (isNew ? "initial" : "regenerated"),
       JSON.stringify(meta)]
    );
    const version = versionRow.rows[0];

    // ---- 4. point the registry row at the new current version ---------------
    // Delivery + signature reset: this version has not been delivered or signed,
    // and the previous version's state stays intact on its own row.
    const updated = await tx.query(
      `UPDATE documents SET
         current_version    = $2,
         current_version_id = $3,
         storage_key        = $4,
         mime_type          = $5,
         byte_size          = $6,
         checksum           = $7,
         generated_by       = $8,
         generated_at       = $9,
         delivered_at       = NULL,
         delivery_channel   = NULL,
         delivery_status    = 'not_delivered',
         signed_at          = NULL,
         signer_name        = NULL,
         signature_ref      = NULL,
         title              = COALESCE($10, title),
         subtype            = COALESCE($11, subtype),
         invoice_id         = COALESCE($12, invoice_id),
         signature_required = COALESCE($13, signature_required),
         expires_at         = COALESCE($14, expires_at)
       WHERE id = $1
       RETURNING *`,
      [document.id, version.version, version.id,
       storageKey, mimeType, byteSize, checksum, generatedBy, genAt,
       title, subtype, invoiceId, signatureRequired, expiresAt]
    );

    return {
      document: updated.rows[0] ?? document,
      version,
      created: isNew,
      appended: !isNew,
      deduped: false
    };
  });
}

/**
 * storeAndRegister — put the bytes, then record them. What a workflow calls.
 *
 * If register fails after the put, the object is orphaned in the bucket. That is
 * self-healing rather than a leak worth cleaning up: keys are content-addressed,
 * so the retry writes the identical bytes to the identical key and the orphan
 * becomes the real object. Never call store.del() to "tidy up" after a failure.
 */
export async function storeAndRegister(db, store, {
  body, filename = null, ...params
} = {}) {
  const put = await store.put({
    orgId: params.orgId,
    clientId: params.clientId,
    kind: params.kind,
    body,
    mimeType: params.mimeType,
    filename
  });
  return registerDocument(db, {
    ...params,
    storageKey: put.storageKey,
    mimeType: put.mimeType,
    byteSize: put.byteSize,
    checksum: put.checksum
  });
}

// ---------------------------------------------------------------------------
// delivery
// ---------------------------------------------------------------------------

const PROGRESS = Object.freeze({ not_delivered: 0, pending: 1, sent: 2, delivered: 3 });
const FAILURE = Object.freeze(new Set(["failed", "bounced"]));

/**
 * Delivery only moves FORWARD. A replayed `sent` must not walk a `delivered`
 * document backwards, which is exactly what a naive UPDATE would do on replay.
 * Failures are always recordable (a bounce after a send is real news), and a
 * document in a failure state can be retried into any other state.
 */
export function canTransitionDelivery(from, to) {
  if (from === to) return false;                       // already there — nothing to write
  if (FAILURE.has(to) || FAILURE.has(from)) return true;
  return (PROGRESS[to] ?? -1) > (PROGRESS[from] ?? -1);
}

/**
 * markDelivered — record that a version went out.
 *
 * Idempotent: re-recording the same state writes nothing and reports
 * { updated: false }. Targets the current version unless a versionId is given —
 * always pass the version you actually sent when replaying old events.
 */
export async function markDelivered(db, {
  documentId,
  versionId = null,
  channel,
  status = "delivered",
  deliveredAt = null
} = {}) {
  if (!documentId) throw new Error("markDelivered requires documentId");
  if (!channel) throw new Error("markDelivered requires a delivery channel");

  return withTransaction(db, async (tx) => {
    const document = await loadDocument(tx, documentId);
    if (!document) return { document: null, version: null, updated: false, reason: "no_such_document" };

    const target = versionId || document.current_version_id;
    if (!target) return { document, version: null, updated: false, reason: "no_version" };

    const cur = (await tx.query(
      `SELECT * FROM document_versions WHERE id = $1 FOR UPDATE`, [target])).rows[0];
    if (!cur) return { document, version: null, updated: false, reason: "no_such_version" };

    if (!canTransitionDelivery(cur.delivery_status, status)) {
      return { document, version: cur, updated: false, reason: "no_transition" };
    }

    const at = deliveredAt || new Date();
    // delivered_at is stamped on the first send and never moved: it is when the
    // client got it, not when we last touched the row.
    const version = (await tx.query(
      `UPDATE document_versions
          SET delivery_status  = $2,
              delivery_channel = $3,
              delivered_at     = CASE WHEN $2 IN ('sent','delivered')
                                      THEN COALESCE(delivered_at, $4) ELSE delivered_at END
        WHERE id = $1
        RETURNING *`,
      [target, status, channel, at])).rows[0];

    const mirrored = String(target) === String(document.current_version_id)
      ? (await tx.query(
          `UPDATE documents
              SET delivery_status = $2, delivery_channel = $3, delivered_at = $4
            WHERE id = $1 RETURNING *`,
          [documentId, version.delivery_status, version.delivery_channel, version.delivered_at])).rows[0]
      : document;

    return { document: mirrored, version, updated: true, reason: null };
  });
}

// ---------------------------------------------------------------------------
// signature
// ---------------------------------------------------------------------------

/**
 * markSigned — record a signature against a specific version.
 *
 * First signature wins. A second call on an already-signed version writes
 * nothing: overwriting a signature would destroy the record of who signed what,
 * which is the only reason to store one. A genuinely new signature belongs on a
 * new version.
 */
export async function markSigned(db, {
  documentId,
  versionId = null,
  signerName = null,
  signatureRef = null,
  signedAt = null
} = {}) {
  if (!documentId) throw new Error("markSigned requires documentId");

  return withTransaction(db, async (tx) => {
    const document = await loadDocument(tx, documentId);
    if (!document) return { document: null, version: null, updated: false, reason: "no_such_document" };

    const target = versionId || document.current_version_id;
    if (!target) return { document, version: null, updated: false, reason: "no_version" };

    const at = signedAt || new Date();
    const res = await tx.query(
      `UPDATE document_versions
          SET signed_at = $2, signer_name = $3, signature_ref = $4
        WHERE id = $1 AND signed_at IS NULL
        RETURNING *`,
      [target, at, signerName, signatureRef]);

    if (!res.rows[0]) {
      const existing = (await tx.query(
        `SELECT * FROM document_versions WHERE id = $1`, [target])).rows[0] ?? null;
      return {
        document,
        version: existing,
        updated: false,
        reason: existing ? "already_signed" : "no_such_version"
      };
    }

    const version = res.rows[0];
    const mirrored = String(target) === String(document.current_version_id)
      ? (await tx.query(
          `UPDATE documents SET signed_at = $2, signer_name = $3, signature_ref = $4
            WHERE id = $1 RETURNING *`,
          [documentId, version.signed_at, version.signer_name, version.signature_ref])).rows[0]
      : document;

    return { document: mirrored, version, updated: true, reason: null };
  });
}

// ---------------------------------------------------------------------------
// policy
// ---------------------------------------------------------------------------

/**
 * updatePolicy — change document-level policy (title, signature requirement,
 * validity window). Separate from registerDocument because these are the fields
 * a caller may need to CLEAR: registerDocument's COALESCE treats null as "leave
 * alone" so a regeneration cannot wipe policy by omission.
 *
 * expires_at is document validity, not a deletion clock — nothing in this module
 * deletes anything when it passes. See the retention flag in 030_documents.sql.
 */
export async function updatePolicy(db, {
  documentId, title = undefined, signatureRequired = undefined, expiresAt = undefined
} = {}) {
  if (!documentId) throw new Error("updatePolicy requires documentId");
  const sets = [];
  const params = [documentId];
  if (title !== undefined) { params.push(title); sets.push(`title = $${params.length}`); }
  if (signatureRequired !== undefined) {
    params.push(signatureRequired); sets.push(`signature_required = $${params.length}`);
  }
  if (expiresAt !== undefined) { params.push(expiresAt); sets.push(`expires_at = $${params.length}`); }
  if (!sets.length) return loadDocument(db, documentId);

  const res = await db.query(
    `UPDATE documents SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params);
  return res.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

async function loadDocument(db, documentId) {
  const res = await db.query(`SELECT * FROM documents WHERE id = $1`, [documentId]);
  return res.rows[0] ?? null;
}

/**
 * reconcileSnapshot — repair a registry row whose snapshot is behind its own
 * version history. Only possible when a non-transactional handle was
 * interrupted between the version insert and the snapshot update; the dedup
 * path is where that gets noticed, so it is where it gets fixed.
 */
async function reconcileSnapshot(db, document, version) {
  if (!document || !version) return document;
  if (Number(document.current_version) >= Number(version.version)) return document;

  const res = await db.query(
    `UPDATE documents SET
       current_version = $2, current_version_id = $3, storage_key = $4,
       mime_type = $5, byte_size = $6, checksum = $7,
       generated_by = $8, generated_at = $9
     WHERE id = $1 AND current_version < $2
     RETURNING *`,
    [document.id, version.version, version.id, version.storage_key,
     version.mime_type, version.byte_size, version.checksum,
     version.generated_by, version.generated_at]);
  return res.rows[0] ?? document;
}

// src/documents/fake-db.mjs — TEST DOUBLE. Not used in production code.
//
// Mirrors the pg `query(sql, params)` interface for exactly the statements
// register.mjs and retrieve.mjs issue, in the same spirit as the stub in
// src/invoices/index.test.mjs. It enforces the constraints that actually matter
// to these modules — the document_key and source-event unique indexes, plus
// UNIQUE (document_id, version) —
// so idempotency is tested against a real failure mode rather than a permissive
// mock.
//
// It deliberately returns only the columns each real query SELECTs (the public
// column lists exclude storage_key), so a leak test cannot pass by accident.
//
// The authoritative check is documents.pg.test.mjs, which runs the same
// scenarios against real Postgres when DATABASE_URL is set.

const norm = (sql) => sql.replace(/\s+/g, " ").trim();

const DOC_PUBLIC = [
  "id", "org_id", "client_id", "document_key", "kind", "subtype", "title",
  "invoice_id", "current_version", "current_version_id",
  "mime_type", "byte_size", "checksum", "generated_by", "generated_at",
  "delivered_at", "delivery_channel", "delivery_status",
  "signature_required", "signed_at", "signer_name", "signature_ref",
  "expires_at", "metadata", "created_at", "updated_at"
];

const VERSION_PUBLIC = [
  "id", "org_id", "document_id", "version", "mime_type", "byte_size", "checksum",
  "generated_by", "generated_at", "delivered_at", "delivery_channel",
  "delivery_status", "signed_at", "signer_name", "signature_ref",
  "source_event_id", "reason", "metadata", "created_at", "updated_at"
];

const pick = (row, cols) =>
  row ? Object.fromEntries(cols.filter((c) => c in row).map((c) => [c, row[c]])) : row;

class UniqueViolation extends Error {
  constructor(constraint) {
    super(`duplicate key value violates unique constraint "${constraint}"`);
    this.code = "23505";
    this.constraint = constraint;
  }
}

export function makeFakeDb({ now = () => new Date("2026-07-28T12:00:00Z") } = {}) {
  const documents = [];
  const versions = [];
  let seq = 0;
  const uid = (p) => `${p}-${String(++seq).padStart(3, "0")}`;

  const notExpired = (row) => !row.expires_at || new Date(row.expires_at) > now();

  async function query(sql, params = []) {
    const s = norm(sql);

    // -- idempotency lookup (scoped to the document) ------------------------
    if (s.startsWith("SELECT * FROM document_versions WHERE org_id = $1 AND document_id = $2 AND source_event_id = $3")) {
      const hit = versions.find((v) =>
        v.org_id === params[0] && v.document_id === params[1] && v.source_event_id === params[2]);
      return { rows: hit ? [hit] : [] };
    }

    // -- documents insert (ON CONFLICT (org_id, document_key) DO NOTHING) ----
    if (s.startsWith("INSERT INTO documents")) {
      const [orgId, clientId, documentKey, kind, subtype, title, invoiceId,
             storageKey, mimeType, byteSize, checksum,
             generatedBy, generatedAt, signatureRequired, expiresAt,
             sourceEventId, metadata] = params;

      if (documents.some((d) => d.org_id === orgId && d.document_key === documentKey)) {
        return { rows: [] };  // DO NOTHING
      }
      const row = {
        id: uid("doc"), org_id: orgId, client_id: clientId, document_key: documentKey,
        kind, subtype, title, invoice_id: invoiceId,
        current_version: 1, current_version_id: null,
        storage_key: storageKey, mime_type: mimeType, byte_size: byteSize, checksum,
        generated_by: generatedBy, generated_at: generatedAt,
        delivered_at: null, delivery_channel: null, delivery_status: "not_delivered",
        signature_required: signatureRequired ?? false,
        signed_at: null, signer_name: null, signature_ref: null,
        expires_at: expiresAt, source_event_id: sourceEventId,
        metadata: typeof metadata === "string" ? JSON.parse(metadata) : (metadata ?? {}),
        created_at: now(), updated_at: now()
      };
      documents.push(row);
      return { rows: [row] };
    }

    // -- documents lookup by logical key ------------------------------------
    if (s.startsWith("SELECT * FROM documents WHERE org_id = $1 AND document_key = $2")) {
      const hit = documents.find((d) => d.org_id === params[0] && d.document_key === params[1]);
      return { rows: hit ? [hit] : [] };
    }

    // -- next version number ------------------------------------------------
    if (s.includes("coalesce(max(version), 0) + 1")) {
      const max = versions
        .filter((v) => v.document_id === params[0])
        .reduce((m, v) => Math.max(m, v.version), 0);
      return { rows: [{ next: max + 1 }] };
    }

    // -- version insert -----------------------------------------------------
    if (s.startsWith("INSERT INTO document_versions")) {
      const [orgId, documentId, version, storageKey, mimeType, byteSize, checksum,
             generatedBy, generatedAt, sourceEventId, reason, metadata] = params;

      if (versions.some((v) => v.document_id === documentId && v.version === version)) {
        throw new UniqueViolation("document_versions_document_id_version_key");
      }
      if (sourceEventId && versions.some((v) =>
            v.org_id === orgId && v.document_id === documentId && v.source_event_id === sourceEventId)) {
        throw new UniqueViolation("document_versions_doc_source_event_uniq");
      }
      const row = {
        id: uid("ver"), org_id: orgId, document_id: documentId, version,
        storage_key: storageKey, mime_type: mimeType, byte_size: byteSize, checksum,
        generated_by: generatedBy, generated_at: generatedAt,
        delivered_at: null, delivery_channel: null, delivery_status: "not_delivered",
        signed_at: null, signer_name: null, signature_ref: null,
        source_event_id: sourceEventId, reason,
        metadata: typeof metadata === "string" ? JSON.parse(metadata) : (metadata ?? {}),
        created_at: now(), updated_at: now()
      };
      versions.push(row);
      return { rows: [row] };
    }

    // -- reconcileSnapshot (guarded) — must be matched before the full update -
    if (s.startsWith("UPDATE documents SET current_version") && s.includes("AND current_version < $2")) {
      const d = documents.find((x) => x.id === params[0]);
      if (!d || d.current_version >= params[1]) return { rows: [] };
      Object.assign(d, {
        current_version: params[1], current_version_id: params[2], storage_key: params[3],
        mime_type: params[4], byte_size: params[5], checksum: params[6],
        generated_by: params[7], generated_at: params[8], updated_at: now()
      });
      return { rows: [d] };
    }

    // -- snapshot update after a version is appended ------------------------
    if (s.startsWith("UPDATE documents SET current_version")) {
      const d = documents.find((x) => x.id === params[0]);
      if (!d) return { rows: [] };
      Object.assign(d, {
        current_version: params[1], current_version_id: params[2],
        storage_key: params[3], mime_type: params[4], byte_size: params[5], checksum: params[6],
        generated_by: params[7], generated_at: params[8],
        delivered_at: null, delivery_channel: null, delivery_status: "not_delivered",
        signed_at: null, signer_name: null, signature_ref: null,
        title: params[9] ?? d.title,
        subtype: params[10] ?? d.subtype,
        invoice_id: params[11] ?? d.invoice_id,
        signature_required: params[12] ?? d.signature_required,
        expires_at: params[13] ?? d.expires_at,
        updated_at: now()
      });
      return { rows: [d] };
    }

    // -- delivery -----------------------------------------------------------
    if (s.startsWith("UPDATE document_versions SET delivery_status")) {
      const v = versions.find((x) => x.id === params[0]);
      if (!v) return { rows: [] };
      v.delivery_status = params[1];
      v.delivery_channel = params[2];
      if (["sent", "delivered"].includes(params[1])) v.delivered_at = v.delivered_at ?? params[3];
      v.updated_at = now();
      return { rows: [v] };
    }
    if (s.startsWith("UPDATE documents SET delivery_status")) {
      const d = documents.find((x) => x.id === params[0]);
      if (!d) return { rows: [] };
      Object.assign(d, {
        delivery_status: params[1], delivery_channel: params[2],
        delivered_at: params[3], updated_at: now()
      });
      return { rows: [d] };
    }

    // -- signature ----------------------------------------------------------
    if (s.startsWith("UPDATE document_versions SET signed_at")) {
      const v = versions.find((x) => x.id === params[0] && x.signed_at === null);
      if (!v) return { rows: [] };   // WHERE signed_at IS NULL — first signature wins
      Object.assign(v, {
        signed_at: params[1], signer_name: params[2], signature_ref: params[3], updated_at: now()
      });
      return { rows: [v] };
    }
    if (s.startsWith("UPDATE documents SET signed_at")) {
      const d = documents.find((x) => x.id === params[0]);
      if (!d) return { rows: [] };
      Object.assign(d, {
        signed_at: params[1], signer_name: params[2], signature_ref: params[3], updated_at: now()
      });
      return { rows: [d] };
    }

    // -- by-id lookups ------------------------------------------------------
    if (s.startsWith("SELECT * FROM documents WHERE id = $1")) {
      const hit = documents.find((d) => d.id === params[0]);
      return { rows: hit ? [hit] : [] };
    }
    if (s.startsWith("SELECT * FROM document_versions WHERE id = $1")) {
      const hit = versions.find((v) => v.id === params[0]);
      return { rows: hit ? [hit] : [] };
    }

    // -- updatePolicy (dynamic SET list) ------------------------------------
    if (s.startsWith("UPDATE documents SET") && s.includes("WHERE id = $1 RETURNING *")) {
      const d = documents.find((x) => x.id === params[0]);
      if (!d) return { rows: [] };
      const setClause = s.slice(s.indexOf("SET ") + 4, s.indexOf(" WHERE "));
      for (const part of setClause.split(", ")) {
        const [col, ph] = part.split(" = ");
        d[col.trim()] = params[Number(ph.trim().slice(1)) - 1];
      }
      d.updated_at = now();
      return { rows: [d] };
    }

    // -- the portal read (one query) ----------------------------------------
    if (s.includes("FROM documents d LEFT JOIN document_versions v")) {
      const [orgId, clientId, kinds, documentIds, includeExpired] = params;
      const rows = documents
        .filter((d) => d.org_id === orgId && d.client_id === clientId)
        .filter((d) => !kinds || kinds.includes(d.kind))
        .filter((d) => !documentIds || documentIds.includes(d.id))
        .filter((d) => includeExpired || notExpired(d))
        .sort((a, b) => a.kind.localeCompare(b.kind) ||
                        new Date(b.generated_at) - new Date(a.generated_at))
        .map((d) => ({
          ...pick(d, DOC_PUBLIC),
          version_count: versions.filter((v) => v.document_id === d.id).length
        }));
      return { rows };
    }

    // -- by client + kind ---------------------------------------------------
    if (s.includes("FROM documents d") && s.includes("AND d.kind = $3")) {
      const [orgId, clientId, kind, subtype, includeExpired] = params;
      const rows = documents
        .filter((d) => d.org_id === orgId && d.client_id === clientId && d.kind === kind)
        .filter((d) => subtype === null || subtype === undefined || d.subtype === subtype)
        .filter((d) => includeExpired || notExpired(d))
        .sort((a, b) => new Date(b.generated_at) - new Date(a.generated_at))
        .slice(0, 1)
        .map((d) => pick(d, DOC_PUBLIC));
      return { rows };
    }

    // -- resolveStorageTarget (returns storage_key — route-only) ------------
    if (s.includes("v.storage_key") && s.includes("JOIN documents d ON d.id = v.document_id")) {
      const v = versions.find((x) => x.id === params[0] && x.document_id === params[1]);
      if (!v) return { rows: [] };
      const d = documents.find((x) => x.id === v.document_id);
      return { rows: [{
        version_id: v.id, document_id: v.document_id, storage_key: v.storage_key,
        mime_type: v.mime_type, checksum: v.checksum, byte_size: v.byte_size,
        version: v.version, client_id: d.client_id, org_id: d.org_id,
        title: d.title, expires_at: d.expires_at
      }] };
    }
    if (s.includes("d.current_version_id AS version_id")) {
      const d = documents.find((x) => x.id === params[0]);
      if (!d) return { rows: [] };
      return { rows: [{
        version_id: d.current_version_id, document_id: d.id, storage_key: d.storage_key,
        mime_type: d.mime_type, checksum: d.checksum, byte_size: d.byte_size,
        version: d.current_version, client_id: d.client_id, org_id: d.org_id,
        title: d.title, expires_at: d.expires_at
      }] };
    }

    // -- single document ----------------------------------------------------
    if (s.includes("FROM documents d") && s.includes("WHERE d.id = $1")) {
      const hit = documents.find((d) => d.id === params[0] &&
        (params[1] === null || params[1] === undefined || d.org_id === params[1]));
      return { rows: hit ? [pick(hit, DOC_PUBLIC)] : [] };
    }

    // -- one version --------------------------------------------------------
    if (s.includes("FROM document_versions v") && s.includes("AND v.version = $2")) {
      const hit = versions.find((v) => v.document_id === params[0] && v.version === params[1]);
      return { rows: hit ? [pick(hit, VERSION_PUBLIC)] : [] };
    }

    // -- history ------------------------------------------------------------
    if (s.includes("FROM document_versions v") && s.includes("ORDER BY v.version DESC")) {
      const rows = versions
        .filter((v) => v.document_id === params[0])
        .filter((v) => !params[1] || v.org_id === params[1])
        .sort((a, b) => b.version - a.version)
        .map((v) => pick(v, VERSION_PUBLIC));
      return { rows };
    }

    throw new Error(`fake-db: unhandled SQL:\n${s}`);
  }

  return { query, _documents: documents, _versions: versions };
}

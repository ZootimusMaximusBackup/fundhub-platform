// GET /api/read/documents — document METADATA only — storage_key is stripped by redact()
//
// Read-only. Auth + role gate + pagination + redaction all come from
// src/http/read-api.mjs; this file is its SQL and nothing else. See that module
// for why the role default is deny and what redact() strips.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";

const run = readHandler({
  roles: ROLE_SETS.STAFF,
  fetch: (db, { limit, offset, query }) =>
    db.query(`SELECT id, client_id, document_key, kind, subtype, title, invoice_id,
           current_version, mime_type, byte_size, generated_at, delivered_at,
           delivery_channel, delivery_status, signature_required, signed_at,
           signer_name, expires_at, created_at
      FROM documents
     WHERE ($3::uuid IS NULL OR client_id = $3)
       AND ($4::text IS NULL OR kind = $4)
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`, [limit + 1, offset, query.client_id || null, query.kind || null]).then((r) => r.rows)
});

export default (req, res) => run(req, res, { db, requireAuth });

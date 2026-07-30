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
    // client_name is joined here for the same reason as read/inquiries: the
    // screen shows a person, and making the caller do a round-trip per row to
    // turn a uuid into a name is how a 200-row page becomes 201 requests.
    db.query(`SELECT d.id, d.client_id, d.document_key, d.kind, d.subtype, d.title, d.invoice_id,
           d.current_version, d.mime_type, d.byte_size, d.generated_at, d.delivered_at,
           d.delivery_channel, d.delivery_status, d.signature_required, d.signed_at,
           d.signer_name, d.expires_at, d.created_at,
           TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')) AS client_name
      FROM documents d
      LEFT JOIN clients c ON c.id = d.client_id
     WHERE ($3::uuid IS NULL OR d.client_id = $3)
       AND ($4::text IS NULL OR d.kind = $4)
     ORDER BY d.created_at DESC
     LIMIT $1 OFFSET $2`, [limit + 1, offset, query.client_id || null, query.kind || null]).then((r) => r.rows)
});

export default (req, res) => run(req, res, { db, requireAuth });

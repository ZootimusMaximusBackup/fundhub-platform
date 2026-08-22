// GET /api/read/portal-summary — client-safe file summary for the portal.
//
// Returns pre-qual and client-safe document metadata. Clients read their own file
// only; staff may pass ?client_id= when previewing the portal.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid, redact } from "../../src/http/read-api.mjs";
import { safeError } from "../../src/http/health.mjs";
import { prequalFromCustomFields, formatPrequalUsd } from "../../src/http/portal-prequal.mjs";

export default async function handler(req, res) {
  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const principal = await requirePrincipal(req, res, ["staff", "client"], { db });
  if (!principal) return;

  let orgId = null;
  let clientId = null;

  if (principal.kind === "client") {
    clientId = principal.clientId || null;
    orgId = principal.orgId || null;
    if (!clientId || !orgId) {
      return res.status(403).json({
        ok: false,
        error: "forbidden",
        message: "Your login is not attached to a client file."
      });
    }
  } else {
    const staff = principal.staff || { role: principal.role };
    if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;
    orgId = staff.org_id || null;
    if (!orgId) {
      return res.status(400).json({ ok: false, error: "org_required" });
    }
    const qid = req.query && req.query.client_id;
    if (qid != null && qid !== "" && !isUuid(qid)) {
      return res.status(400).json({ ok: false, error: "invalid_client_id" });
    }
    clientId = qid || null;
    if (!clientId) {
      return res.status(400).json({
        ok: false,
        error: "client_id_required",
        message: "Pick a client to load portal summary."
      });
    }
  }

  try {
    const clientRes = await db.query(
      `SELECT id, custom_fields FROM clients WHERE id = $1 AND org_id = $2`,
      [clientId, orgId]
    );
    const client = clientRes.rows[0];
    if (!client) {
      return res.status(404).json({ ok: false, error: "client_not_found" });
    }

    const documentsRes = await db.query(
      `SELECT id, document_key, kind, subtype, title, mime_type, byte_size,
              generated_at, delivered_at, delivery_channel, delivery_status,
              signature_required, signed_at, created_at
         FROM documents
        WHERE org_id = $1::uuid
          AND client_id = $2::uuid
        ORDER BY created_at DESC
        LIMIT 50`,
      [orgId, clientId]
    );

    const cf = client.custom_fields || {};
    const prequalAmount = prequalFromCustomFields(cf);

    return res.status(200).json(redact({
      ok: true,
      prequal_amount: prequalAmount,
      prequal_display: formatPrequalUsd(prequalAmount),
      soft_pull_complete: cf.crs_paid === true
        || String(cf.analyzer_status || "").toLowerCase() === "complete",
      doc_agent_message: cf.doc_agent_message || null,
      documents: documentsRes.rows
    }));
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "read_failed",
      message: "Something went wrong loading your file summary.",
      detail: safeError(err)
    });
  }
}

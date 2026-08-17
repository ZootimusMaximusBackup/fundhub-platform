// GET /api/read/portal-contracts — agreements on the signed-in client's file.
//
// Clients see sent / viewed / signed contracts and a fresh sign link when they
// still owe a signature. Staff may pass ?client_id= for the same list.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid, redact } from "../../src/http/read-api.mjs";
import { safeError } from "../../src/http/health.mjs";
import {
  listContracts, listSigners, mintLinks, getTemplateByKey
} from "../../src/contracts/index.mjs";

const CLIENT_STATUSES = new Set(["sent", "viewed", "signed"]);

function baseUrlFromEnv(env = process.env) {
  return String(env.PUBLIC_BASE_URL || env.URL || "https://fundhub.ai").replace(/\/$/, "");
}

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
        message: "Pick a client to load agreements."
      });
    }
  }

  try {
    /* Confirm the client belongs to this company before listing anything.
       listContracts() already binds org_id, so this is not the only scope — but
       it makes the tenancy check visible at the call site instead of an argued
       property of a store module, and it turns a cross-org ?client_id= into a
       404 rather than a silently empty list. */
    const inOrg = await db.query(
      `SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`,
      [clientId, orgId]
    );
    if (!inOrg.rows.length) {
      return res.status(404).json({ ok: false, error: "client_not_found" });
    }

    const rows = await listContracts(db, { orgId, clientId, limit: 50 });
    const items = [];
    const baseUrl = baseUrlFromEnv(process.env);

    for (const c of rows) {
      if (!CLIENT_STATUSES.has(c.status)) continue;
      const template = c.template_key
        ? await getTemplateByKey(db, { orgId, templateKey: c.template_key })
        : null;
      const signers = await listSigners(db, c.id);
      const mine = signers.find((s) => String(s.client_id) === String(clientId))
        || signers.find((s) => s.signer_index === 0)
        || signers[0];
      let signUrl = null;
      const needsSign = mine && mine.status !== "signed" && mine.status !== "declined"
        && (c.status === "sent" || c.status === "viewed");
      if (needsSign) {
        const { links } = await mintLinks(db, {
          orgId, contract: c, baseUrl
        });
        const link = (links || []).find((l) => String(l.signer_id) === String(mine.id));
        signUrl = (link && link.url) || null;
      }
      items.push({
        id: c.id,
        title: c.title,
        status: c.status,
        template_key: c.template_key,
        template_name: template && template.name ? template.name : c.template_key,
        sent_at: c.sent_at,
        signed_at: c.signed_at,
        needs_signature: !!needsSign,
        sign_url: signUrl
      });
    }

    return res.status(200).json({
      ok: true,
      count: items.length,
      items: redact(items)
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "read_failed",
      message: "Something went wrong loading agreements.",
      detail: safeError(err)
    });
  }
}

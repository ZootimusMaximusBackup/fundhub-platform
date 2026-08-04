// POST /api/proxy/launch — create a geo-targeted Oxylabs session for Apply.
// Roles: owner, funding_advisor. Org-scoped. Session-authed.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requireRole, isUuid } from "../../src/http/read-api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { launchProxySession, ProxySessionError } from "../../src/proxy/launch.mjs";

export const PROXY_ROLES = new Set(["owner", "funding_advisor"]);

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await (deps.requireAuth || requireAuth)(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, PROXY_ROLES)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId) || !isUuid(staff.id)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const body = req.body || {};
  if (!isUuid(body.client_id)) {
    return res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
  }
  if (body.lender_id != null && body.lender_id !== "" && !isUuid(body.lender_id)) {
    return res.status(400).json({ ok: false, error: "lender_id must be a uuid" });
  }
  if (body.application_id != null && body.application_id !== "" && !isUuid(body.application_id)) {
    return res.status(400).json({ ok: false, error: "application_id must be a uuid" });
  }
  if (!body.lender_id && !body.application_id) {
    return res.status(400).json({
      ok: false,
      error: "lender_id or application_id is required"
    });
  }

  try {
    const result = await launchProxySession(database, {
      orgId,
      staffId: staff.id,
      clientId: body.client_id,
      lenderId: body.lender_id || null,
      applicationId: body.application_id || null,
      env,
      fetchFn: deps.fetchFn
    });
    return res.status(200).json({
      ok: true,
      session_id: result.session.id,
      session: {
        id: result.session.id,
        status: result.session.status,
        client_id: result.session.client_id,
        lender_id: result.session.lender_id,
        application_id: result.session.application_id,
        started_at: result.session.started_at
      },
      connection: result.connection,
      verification: result.verification,
      application_url: result.application_url,
      lender: result.lender,
      routing_active: false,
      extension_required: true,
      notice:
        "Exit IP verified server-side. Browser routing is active only if the Fundhub Proxy Chrome extension is installed and confirms ACTIVE. Otherwise use the manual proxy settings below — do not submit the bank application until the exit city matches."
    });
  } catch (err) {
    if (err instanceof ProxySessionError) {
      return res.status(err.status || 400).json({
        ok: false,
        error: err.code,
        message: err.message,
        session_id: err.sessionId || null,
        attempts: err.attempts || undefined
      });
    }
    if (dbDown(res, err)) return;
    throw err;
  }
}

// /api/inquiry — authed proxy to an optional inquiry phone runtime.
//
// Phone inquiry is on hold. There is no default host. Unset INQUIRY_API_BASE
// means this route answers not_configured and never calls out.
//
// The Bearer secret stays server-side; the browser only ever holds a staff
// session. Role-gated: inquiry_specialist / admin (owner passes every gate
// via SUPER_ROLES).
//
//   GET  ?action=cases[&status=&all=1]         → GET  {base}/api/cases
//   GET  ?action=status&call_id=xxx            → GET  {base}/api/call-status
//   POST ?action=schedule  body per schedule-call (case_id, selected_bureaus_raw, ...)
//   POST ?action=launch    body per launch-call
//   POST ?action=update    body { case_id, fields } → case-update (notes/status)
//
// Env: INQUIRY_API_BASE (required to call out; no default), INQUIRY_API_SECRET.

import { requireRole } from "../src/http/middleware/requireRole.mjs";

const ACTIONS = {
  cases:    { method: "GET",  path: "/api/cases",        pass: ["status", "all", "max"] },
  status:   { method: "GET",  path: "/api/call-status",  pass: ["call_id"] },
  schedule: { method: "POST", path: "/api/schedule-call" },
  launch:   { method: "POST", path: "/api/launch-call" },
  update:   { method: "POST", path: "/api/case-update" }
};

export default async function handler(req, res) {
  const staff = await requireRole("inquiry_specialist", "admin")(req, res);
  if (!staff) return;

  const secret = process.env.INQUIRY_API_SECRET;
  const baseRaw = process.env.INQUIRY_API_BASE;
  if (!secret || !baseRaw) {
    /* 503, not 500. Unconfigured is a deployment state, not a crash. Phone
       inquiry is on hold: there is no host to call. A missing secret or base
       must not fall through to a leftover URL. */
    return res.status(503).json({
      ok: false, error: "not_configured",
      message: "Inquiry phone runtime is not configured"
    });
  }
  const base = baseRaw.replace(/\/$/, "");

  const action = ACTIONS[req.query?.action];
  if (!action) {
    return res.status(400).json({ ok: false, error: "unknown_action", allowed: Object.keys(ACTIONS) });
  }
  if (req.method !== action.method) {
    return res.status(405).json({ ok: false, error: "method_not_allowed", expected: action.method });
  }

  const url = new URL(base + action.path);
  for (const k of action.pass || []) {
    const v = req.query?.[k];
    if (v !== undefined && v !== "") url.searchParams.set(k, v);
  }

  try {
    const upstream = await fetch(url, {
      method: action.method,
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json"
      },
      body: action.method === "POST" ? JSON.stringify(req.body || {}) : undefined
    });
    const text = await upstream.text();
    res.setHeader("content-type", upstream.headers.get("content-type") || "application/json");
    return res.status(upstream.status).send(text);
  } catch (err) {
    return res.status(502).json({ ok: false, error: "upstream_unreachable", message: err.message });
  }
}

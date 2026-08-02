// GET/PUT /api/org-brand — this company's brand tokens for the internal CRM.
//
//   GET  → the effective brand for the caller's org (falls back to Fundhub defaults)
//   PUT  { …tokens }  → upsert for the caller's org
//
// TWO LANES — see docs/BRAND-THEMING-SPEC.md. This endpoint is the CRM lane.
// Partner funnel tokens stay on /api/partner-brand. A partner save must never
// rewrite this row, and shell.js applies THIS endpoint to every CRM screen.
//
// ENTRY GATE IS requirePrincipal FOR BOTH METHODS. shell.js calls GET on every
// signed-in app screen (closer, partner, client portal, …), so the read must
// admit every principal kind that can open /app/*. The write narrows further
// inside the PUT branch to owner/admin staff only — checked by role string,
// not requireRole(res, staff, SET), so scripts/journeys/extract.mjs reports the
// principal kinds that can REACH the route (the GET arm) rather than collapsing
// the whole file to the write set.
//
// Scoped to the caller's own org_id only — there is no org_id query param.

import { db } from "../src/db.mjs";
import { requirePrincipal } from "../src/http/middleware/requirePrincipal.mjs";
import { redact, CLIENT_DATA_ERRORS } from "../src/http/read-api.mjs";
import { safeError } from "../src/http/health.mjs";

const WRITABLE = [
  "wordmark_url", "ink", "paper", "ramp", "display_face", "mono_face", "entity_name"
];

const HEX = /^#[0-9a-fA-F]{6}$/;
const FACE = /^[A-Za-z0-9 \-]{1,60}$/;
/* Logo URLs only. https or a data:image — nothing that can smuggle a CSS
   expression into url() when shell.js writes --logo. */
const WORDMARK = /^(https:\/\/[^\s"'<>()]+|data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)$/;

function validate(body) {
  const bad = [];
  if (body.ink != null && !HEX.test(body.ink)) bad.push("ink must be #rrggbb");
  if (body.paper != null && !HEX.test(body.paper)) bad.push("paper must be #rrggbb");
  for (const f of ["display_face", "mono_face"]) {
    if (body[f] != null && !FACE.test(body[f])) {
      bad.push(`${f} must be a Google Fonts family name (letters, digits, spaces, hyphens)`);
    }
  }
  if (body.ramp != null) {
    if (!Array.isArray(body.ramp)) bad.push("ramp must be an array");
    else if (body.ramp.length !== 0 && body.ramp.length !== 6) {
      bad.push("ramp must be exactly six stops, or empty");
    } else if (body.ramp.some((s) => !HEX.test(String(s)))) {
      bad.push("every ramp stop must be #rrggbb");
    }
  }
  const TEXT_MAX = { wordmark_url: 2048, entity_name: 200 };
  for (const [field, max] of Object.entries(TEXT_MAX)) {
    const v = body[field];
    if (v == null) continue;
    if (typeof v !== "string") { bad.push(`${field} must be a string`); continue; }
    if (v.length > max) bad.push(`${field} must be ${max} characters or fewer`);
  }
  if (typeof body.wordmark_url === "string" && body.wordmark_url.trim()) {
    if (!WORDMARK.test(body.wordmark_url.trim())) {
      bad.push("wordmark_url must be an https URL or a data:image base64 value");
    }
  }
  return bad;
}

function canWriteBrand(principal) {
  if (!principal || principal.kind !== "staff") return false;
  const role = String(principal.role || "").trim().toLowerCase();
  return role === "owner" || role === "admin";
}

async function readEffective(orgId) {
  const { rows } = await db.query(
    `SELECT * FROM v_org_brand_effective WHERE org_id = $1`, [orgId]);
  return rows[0] || null;
}

export default async function handler(req, res) {
  const principal = await requirePrincipal(
    req, res, ["staff", "partner", "affiliate", "client"], { db });
  if (!principal) return;

  const orgId = principal.orgId || (principal.staff && principal.staff.org_id);
  if (!orgId) {
    return res.status(400).json({ ok: false, error: "org_required" });
  }

  if (req.method === "GET") {
    try {
      const brand = await readEffective(orgId);
      if (!brand) return res.status(404).json({ ok: false, error: "not_found" });
      return res.status(200).json({ ok: true, brand: redact(brand) });
    } catch (err) {
      if (CLIENT_DATA_ERRORS.has(err && err.code)) {
        return res.status(400).json({ ok: false, error: "invalid_parameter" });
      }
      return res.status(500).json({ ok: false, error: "query_failed", message: safeError(err) });
    }
  }

  if (req.method === "PUT") {
    if (!canWriteBrand(principal)) {
      return res.status(403).json({
        ok: false, error: "forbidden",
        message: "only owner or admin staff may edit the CRM brand"
      });
    }

    const body = req.body || {};
    const problems = validate(body);
    if (problems.length) {
      return res.status(400).json({ ok: false, error: "invalid", problems });
    }

    const cols = WRITABLE.filter((c) => c in body);
    const values = cols.map((c) =>
      (c === "ramp") ? JSON.stringify(body[c]) : body[c]);

    try {
      const names = ["org_id", ...cols];
      const params = [orgId, ...values];
      const holes = names.map((_, i) => `$${i + 1}`);
      const updates = cols.length
        ? cols.map((c, i) => `${c} = $${i + 2}`).join(", ")
        : "updated_at = now()";

      await db.query(
        `INSERT INTO org_brand (${names.join(", ")}) VALUES (${holes.join(", ")})
         ON CONFLICT (org_id) DO UPDATE SET ${updates}, updated_at = now()
         RETURNING org_id`, params);

      const brand = await readEffective(orgId);
      return res.status(200).json({ ok: true, brand: redact(brand) });
    } catch (err) {
      const m = String(err.message || "");
      if (/org_brand_(ink|paper|ramp|display|mono)_ck/.test(m)) {
        return res.status(400).json({ ok: false, error: "invalid", problems: [m] });
      }
      if (CLIENT_DATA_ERRORS.has(err && err.code)) {
        return res.status(400).json({ ok: false, error: "invalid_parameter" });
      }
      return res.status(500).json({ ok: false, error: "write_failed", message: safeError(err) });
    }
  }

  return res.status(405).json({ ok: false, error: "method_not_allowed" });
}

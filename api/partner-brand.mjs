// GET/PUT /api/partner-brand — a white-label partner's brand tokens.
//
//   GET  ?partner_id=<uuid>   → the effective brand (falls back to fundhub's)
//   PUT  { partner_id, ... }  → upsert
//
// WRITABLE ONLY BY THE OWNING PARTNER OR AN ADMIN. Until the accounts table
// exists (Unit 12) there is no partner SESSION, so today that reduces to
// owner/admin — but the check is written against the principal, not against the
// staff role, so it does not need rewriting when partner sessions land.
//
// THE BS-05 COMPLIANCE BLOCKS ARE NOT WRITABLE HERE. The disclosure copy comes
// from a master template with entity_name injected; this endpoint accepts the
// entity fields and refuses anything that looks like disclosure text. The column
// does not exist either — belt and braces, because this is the field somebody
// will try to "just edit for one partner".
//
// GOOGLE FONTS ONLY. Enforced by CHECK in 043 and again here so the caller gets
// a readable error rather than a constraint name.

import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { redact } from "../src/http/read-api.mjs";

// Fields a partner may set. Anything else in the body is ignored rather than
// rejected, so a screen sending extra state does not 400 — but it also cannot
// write a column nobody approved.
const WRITABLE = [
  "wordmark_url", "ink", "paper", "ramp", "display_face", "mono_face", "voice",
  "entity_name", "entity_address", "support_email", "domain", "selected_funnels"
];

// Never writable through this endpoint, even if a column appears later.
const FORBIDDEN = ["disclosure", "disclaimer", "compliance_text", "domain_verified",
                   "approval_status", "approved_at", "approved_by"];

const HEX = /^#[0-9a-fA-F]{6}$/;
const FACE = /^[A-Za-z0-9 \-]{1,60}$/;

function validate(body) {
  const bad = [];
  for (const k of FORBIDDEN) {
    if (k in body) bad.push(`${k} is not writable through this endpoint`);
  }
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
  if (body.selected_funnels != null && !Array.isArray(body.selected_funnels)) {
    bad.push("selected_funnels must be an array");
  }
  return bad;
}

// canWrite — the owning partner, or an admin. Written against a principal so it
// survives Unit 12 unchanged.
function canWrite(staff, partnerId) {
  const role = String(staff && staff.role || "").trim().toLowerCase();
  if (role === "owner" || role === "admin") return true;
  if (role === "partner" && staff.partner_id && staff.partner_id === partnerId) return true;
  return false;
}

export default async function handler(req, res) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;

  if (req.method === "GET") {
    const partnerId = (req.query || {}).partner_id;
    if (!partnerId) return res.status(400).json({ ok: false, error: "partner_id_required" });
    try {
      const { rows } = await db.query(
        `SELECT * FROM v_partner_brand_effective WHERE partner_id = $1`, [partnerId]);
      if (!rows[0]) return res.status(404).json({ ok: false, error: "not_found" });
      return res.status(200).json({ ok: true, brand: redact(rows[0]) });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "query_failed", message: err.message });
    }
  }

  if (req.method === "PUT") {
    const body = req.body || {};
    const partnerId = body.partner_id;
    if (!partnerId) return res.status(400).json({ ok: false, error: "partner_id_required" });
    if (!canWrite(staff, partnerId)) {
      return res.status(403).json({ ok: false, error: "forbidden",
        message: "only the owning partner or an admin may edit this brand" });
    }
    const problems = validate(body);
    if (problems.length) {
      return res.status(400).json({ ok: false, error: "invalid", problems });
    }

    const cols = WRITABLE.filter((c) => c in body);
    const values = cols.map((c) =>
      (c === "ramp" || c === "selected_funnels") ? JSON.stringify(body[c]) : body[c]);

    try {
      const org = (await db.query(`SELECT org_id FROM partners WHERE id = $1`, [partnerId])).rows[0];
      if (!org) return res.status(404).json({ ok: false, error: "partner_not_found" });

      const names = ["org_id", "partner_id", ...cols];
      const params = [org.org_id, partnerId, ...values];
      const holes = names.map((_, i) => `$${i + 1}`);
      const updates = cols.length
        ? cols.map((c, i) => `${c} = $${i + 3}`).join(", ")
        : "updated_at = now()";

      const { rows } = await db.query(
        `INSERT INTO partner_brand (${names.join(", ")}) VALUES (${holes.join(", ")})
         ON CONFLICT (partner_id) DO UPDATE SET ${updates}, updated_at = now()
         RETURNING partner_id`, params);

      const eff = await db.query(
        `SELECT * FROM v_partner_brand_effective WHERE partner_id = $1`, [rows[0].partner_id]);
      return res.status(200).json({ ok: true, brand: redact(eff.rows[0]) });
    } catch (err) {
      const m = String(err.message || "");
      // Turn a constraint name into something a person can act on.
      if (/partner_brand_(ink|paper|ramp|display|mono)_ck/.test(m)) {
        return res.status(400).json({ ok: false, error: "invalid", problems: [m] });
      }
      return res.status(500).json({ ok: false, error: "write_failed", message: m });
    }
  }

  return res.status(405).json({ ok: false, error: "method_not_allowed" });
}

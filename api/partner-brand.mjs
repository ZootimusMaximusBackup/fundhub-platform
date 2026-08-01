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

// THE READ WAS NOT GATED, AND THAT WAS THE HOLE. requireAuth alone admits ANY
// signed-in employee of ANY role, so a setter could pass any partner_id and read
// that partner's trading name, registered address, support email, domain and
// brand tokens. The WRITE was gated the whole time — canWrite() below — which is
// what made this easy to miss: the file looks gated, and half of it was.
//
// Found by docs/journeys/, which reports the gate at the handler's ENTRY. That
// is the honest thing for it to report, and it is why this read went unnoticed:
// an inner per-method check does not protect the method without one.
//
// NOW OWNER AND ADMIN, on both methods. Two calls, because requireAuth forwards
// its third argument to authenticate(), which reads only { db, env } — a `roles`
// key there is silently dropped, which is the bug src/http/auth-gate.test.mjs
// exists to catch and the one api/read/tradelines.mjs shipped.
//
// THIS BREAKS NO SCREEN. public/app/shell.js applyBrand() returns early unless
// staff.partner_id is set; `staff` has no partner_id column (001_init, 020_auth)
// and verifySession does not select one, so it is always undefined and the GET
// is never called from a staff session today. Checked before narrowing, not
// after.

import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { redact, isUuid, requireRole, CLIENT_DATA_ERRORS } from "../src/http/read-api.mjs";
import { safeError } from "../src/http/health.mjs";

/* Spelled out here rather than inherited from ROLE_SETS. This endpoint carries
   another company's registered address and trading identity; widening it should
   cost somebody an edit to this line and a sentence saying why. Narrower than
   ROLE_SETS.STAFF, deliberately — the same call api/finance/soft-pull.mjs makes. */
const PARTNER_BRAND_ROLES = new Set(["owner", "admin"]);

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

  /* The free-text columns had NO validation: an object, a number or a 100kB
     string all went straight to the INSERT. A non-string became Postgres' idea
     of its text form ("[object Object]"), and an unbounded string is a cheap way
     to fill a table. Type and length only — the CONTENT of a trading name or an
     address is the partner's business, not something to second-guess. */
  const TEXT_MAX = {
    wordmark_url: 2048, voice: 2000, entity_name: 200,
    entity_address: 500, support_email: 320, domain: 253
  };
  for (const [field, max] of Object.entries(TEXT_MAX)) {
    const v = body[field];
    if (v == null) continue;
    if (typeof v !== "string") { bad.push(`${field} must be a string`); continue; }
    if (v.length > max) bad.push(`${field} must be ${max} characters or fewer`);
  }
  if (typeof body.support_email === "string" && body.support_email.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.support_email.trim())) {
    bad.push("support_email must be an email address");
  }
  return bad;
}

/* canWrite — the owning partner, or an admin. Kept as defence in depth behind
   the entry gate above, which already limits this handler to owner and admin.
   It is not redundant paranoia: it is the check that has to widen, not narrow,
   when partner sessions land.

   ITS `partner` BRANCH IS UNREACHABLE TODAY. `staff` comes from requireAuth,
   which returns a row from `staff` — a table with no partner_id column, and
   verifySession does not select one. So staff.partner_id is always undefined and
   that branch never fires. It is left in place because it is the correct rule
   for Unit 12; whoever lands partner sessions must widen PARTNER_BRAND_ROLES or
   move the entry gate to requirePrincipal, or this branch stays dead. */
function canWrite(staff, partnerId) {
  const role = String(staff && staff.role || "").trim().toLowerCase();
  if (role === "owner" || role === "admin") return true;
  if (role === "partner" && staff.partner_id && staff.partner_id === partnerId) return true;
  return false;
}

export default async function handler(req, res) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;

  // THE SECOND CALL. This is the one that gates, and it covers BOTH methods —
  // the read included, which is what was missing.
  if (!requireRole(res, staff, PARTNER_BRAND_ROLES)) return;

  if (req.method === "GET") {
    const partnerId = (req.query || {}).partner_id;
    if (!partnerId) return res.status(400).json({ ok: false, error: "partner_id_required" });
    // A malformed id is a 400. Letting it reach Postgres produced a 500 quoting
    // the raw type error, which reads to a screen as "the backend is down".
    if (!isUuid(partnerId)) return res.status(400).json({ ok: false, error: "invalid_partner_id" });
    try {
      const { rows } = await db.query(
        `SELECT * FROM v_partner_brand_effective WHERE partner_id = $1`, [partnerId]);
      if (!rows[0]) return res.status(404).json({ ok: false, error: "not_found" });
      return res.status(200).json({ ok: true, brand: redact(rows[0]) });
    } catch (err) {
      if (CLIENT_DATA_ERRORS.has(err && err.code)) {
        return res.status(400).json({ ok: false, error: "invalid_parameter" });
      }
      return res.status(500).json({ ok: false, error: "query_failed", message: safeError(err) });
    }
  }

  if (req.method === "PUT") {
    const body = req.body || {};
    const partnerId = body.partner_id;
    if (!partnerId) return res.status(400).json({ ok: false, error: "partner_id_required" });
    if (!isUuid(partnerId)) return res.status(400).json({ ok: false, error: "invalid_partner_id" });
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
      if (CLIENT_DATA_ERRORS.has(err && err.code)) {
        return res.status(400).json({ ok: false, error: "invalid_parameter" });
      }
      return res.status(500).json({ ok: false, error: "write_failed", message: safeError(err) });
    }
  }

  return res.status(405).json({ ok: false, error: "method_not_allowed" });
}

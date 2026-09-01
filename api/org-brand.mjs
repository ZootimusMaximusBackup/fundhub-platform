// GET/PUT /api/org-brand — the brand tokens the internal CRM paints with.
//
//   GET  → the effective brand for THE CALLER (see "who gets whose brand")
//   PUT  { …tokens }  → upsert the ORG row, owner/admin staff only
//
// ── WHO GETS WHOSE BRAND (owner-set 2026-08-31) ───────────────────────────
//
// A PARTNER principal gets their OWN partner_brand row. Everybody else — staff,
// affiliate, client — gets the org row, exactly as before.
//
// THIS REVERSES A WRITTEN DECISION, so the old one is stated rather than
// deleted. From 2026-08-02 until 2026-08-31 docs/BRAND-THEMING-SPEC.md and
// db/migrations/128_org_brand.sql said: "partners theme only their funnels; the
// internal CRM has its own theme." The reasoning was sound for the shape the
// product had then — every partner sits in the SHARED default org, so an
// org-keyed lookup returns one answer for all of them, and letting a partner
// edit that one answer would have recolored Fundhub staff screens. The owner
// reversed the OUTCOME, not that reasoning: a white-label partner signing in and
// seeing Fundhub's colours, type and wordmark on every screen is the thing
// white-label is sold to prevent.
//
// Resolving from the PRINCIPAL rather than the org is what makes both true at
// once. The org row is untouched, so a partner still cannot repaint a Fundhub
// staff screen; the partner row is theirs alone, so partner A can never receive
// partner B's brand.
//
// Two other routes were considered and rejected, recorded so nobody re-opens
// them: giving each partner their own org (every fulfilment read binds
// org_id = staff.org_id, so Fundhub staff would stop seeing partner clients),
// and rewriting v_org_brand_effective (org-keyed, so one answer for every
// partner in the shared default org).
//
// THE WORDMARK WAITS FOR APPROVAL, the colours and type do not. partner_brand
// carries approval_status (draft / review / approved) and
// v_partner_brand_effective ignores it entirely — it returns the tokens whatever
// the state — so the gate is applied HERE, on one field. Colours and a font on a
// partner's own screens harm nobody and are undone by an edit. A wordmark is an
// image, and an image can carry somebody else's registered trademark; painting
// an unreviewed one into Fundhub-hosted chrome is the one part of this that is
// not the partner's own risk to take. Unapproved wordmark → the Fundhub default
// stays, which is exactly what a partner saw before this change.
//
// FAILS CLOSED TO THE ORG BRAND. No partner id on the session, no partner row,
// no partner_brand row, or a partner whose org does not match the session's:
// every one of those falls through to the org read. There is no half-painted
// state and no crash path.
//
// NO PREVIEW PARAMETER. The partner id is bound from the SESSION and nowhere
// else — no ?partner_id=. Staff who need to see a partner's tokens have
// /api/partner-brand, which already gates that read. A query parameter here
// would be a second, weaker way to reach the same rows.
//
// TWO LANES STILL — see docs/BRAND-THEMING-SPEC.md. Partner FUNNEL tokens are
// still written on /api/partner-brand; this endpoint never writes partner_brand
// and a partner still cannot PUT here.
//
// ENTRY GATE IS requirePrincipal FOR BOTH METHODS. shell.js calls GET on every
// signed-in app screen (closer, partner, client portal, …), so the read must
// admit every principal kind that can open /app/*. The write narrows further
// inside the PUT branch to owner/admin staff only — checked by role string,
// not requireRole(res, staff, SET), so scripts/journeys/extract.mjs reports the
// principal kinds that can REACH the route (the GET arm) rather than collapsing
// the whole file to the write set.
//
// The WRITE is scoped to the caller's own org_id only — there is no org_id
// query param, and a partner never reaches it.

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

/* readPartnerEffective — a partner principal's own brand, in the SAME SHAPE the
   org lane answers in, or null to mean "use the org row".

   WHY has_brand_row AND NOT JUST THE VIEW. v_partner_brand_effective LEFT JOINs
   partner_brand and COALESCEs ink/paper to Fundhub's hardcoded values, so a
   partner with no row at all still comes back looking like a full answer. That
   is the right behaviour for /api/partner-brand (a Brand Studio form needs
   something in every box) and the wrong one here: the fallback for the CRM is
   the ORG row, not a hardcoded pair of hex values. EXISTS is how the two cases
   are told apart, in the same round trip.

   ORG IS BOUND AS WELL AS PARTNER. The partner id comes from the session and the
   org id comes from the same session; requiring them to agree means an account
   pointing at a partner in another org reads nothing and falls back, rather than
   reaching across the tenancy line.

   NULL / EMPTY FIELDS ARE LEFT ALONE ON PURPOSE. A NULL face or an empty ramp
   reaches shell.js, which skips it, and the static fundhub-brand.css value
   stands. That is the documented fallback, not a half-painted screen. */
const PARTNER_BRAND_SQL = `
  SELECT e.org_id,
         e.slug,
         e.entity_name,
         e.wordmark_url,
         e.ink,
         e.paper,
         e.ramp,
         e.display_face,
         e.mono_face,
         e.approval_status,
         EXISTS (SELECT 1 FROM partner_brand b WHERE b.partner_id = e.partner_id)
           AS has_brand_row
    FROM v_partner_brand_effective e
   WHERE e.partner_id = $1 AND e.org_id = $2`;

async function readPartnerEffective(partnerId, orgId) {
  if (!partnerId || !orgId) return null;
  const { rows } = await db.query(PARTNER_BRAND_SQL, [partnerId, orgId]);
  const p = rows[0];
  if (!p || p.has_brand_row !== true) return null;
  return {
    org_id: p.org_id,
    // The PARTNER's slug. This row describes the partner's brand, so the
    // identifier on it names the partner. shell.js does not read it.
    slug: p.slug,
    entity_name: p.entity_name,
    // The one approval-gated field — see the header.
    wordmark_url: p.approval_status === "approved" ? p.wordmark_url : null,
    ink: p.ink,
    paper: p.paper,
    ramp: p.ramp,
    display_face: p.display_face,
    mono_face: p.mono_face
  };
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
      /* The one branch this whole file is about. A partner gets their own row;
         null from it means "no partner brand to paint", and the org read below
         is the fallback for every other principal AND for that case. */
      const brand =
        (principal.kind === "partner"
          ? await readPartnerEffective(principal.partnerId, orgId)
          : null)
        || await readEffective(orgId);
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

// POST /api/brand/review — move a white-label partner's brand through review.
//
//   { partner_id, action: "submit" }              draft   → review
//   { partner_id, action: "approve" }             review  → approved
//   { partner_id, action: "reject", note: "…" }   review  → draft
//
// THIS FILE IS THE ONLY WRITER OF partner_brand.approval_status. api/partner-brand.mjs
// lists approval_status / approved_at / approved_by in its FORBIDDEN array and
// 400s on the key, and that stays exactly as it is: a partner editing their own
// brand must not be able to hand themselves an approval. So the transition lives
// behind its own endpoint, with its own gate, and the edit endpoint keeps
// refusing the column.
//
// TWO DIFFERENT GATES, ON PURPOSE.
//   submit  — the OWNING partner (or an owner/admin acting for them). A partner
//             principal is pinned to their own partner_id by resolvePartnerId(),
//             which ignores a partner_id in the request, so there is no request
//             shape that submits somebody else's brand.
//   approve — owner/admin STAFF only. A partner principal is refused before any
//   reject    row is read. This is the whole point of having the endpoint.
//
// THE ROLE CHECK IS A SEPARATE CALL. requireAuth/authenticate read only { db, env }
// and silently drop a `roles` key — the bug src/http/auth-gate.test.mjs exists to
// catch. requireRole() is called after the principal resolves, never folded into it.
//
// APPROVED AND approved_at MOVE TOGETHER. 043_partner_brand.sql:73-75 has
// CHECK ((approval_status = 'approved') = (approved_at IS NOT NULL)), so the
// approve arm sets both in one statement and the reject arm clears both.
//
// NOTHING HERE TOUCHES DISCLOSURE COPY. The disclosure text is not a column on
// this table (043's header says why); this endpoint moves a status and records
// who moved it. It captures no consent and makes no claim about credit outcomes.
//
// PLAIN REFUSALS. Every non-200 carries a `message` a non-technical reader can
// act on, because public/app/brand-studio.html prints it beside the button.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { isUuid, requireRole } from "../../src/http/read-api.mjs";
import { resolvePartnerId } from "../../src/http/partner-read-api.mjs";
import { safeError } from "../../src/http/health.mjs";

/* Named here rather than inherited from ROLE_SETS, matching api/partner-brand.mjs:
   this decides whose brand goes live under a white-label disclosure, and widening
   it should cost somebody an edit to this line. */
const REVIEW_ROLES = new Set(["owner", "admin"]);

const ACTIONS = new Set(["submit", "approve", "reject"]);

// action → the status the row must already be in. An action taken from any other
// status is refused rather than applied, so a double-click cannot approve a draft
// that was never submitted.
const REQUIRED_FROM = { submit: "draft", approve: "review", reject: "review" };

const NOTE_MAX = 2000;

// What the partner is told when the row is not in the state the action needs.
function wrongStateMessage(action, current) {
  const now = current === "review" ? "already waiting for review"
            : current === "approved" ? "already approved"
            : "still a draft";
  if (action === "submit") return `Nothing was sent — this brand is ${now}.`;
  return `Nothing changed — this brand is ${now}.`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const principal = await requirePrincipal(req, res, ["partner", "staff"], { db });
  if (!principal) return;

  const body = req.body || {};
  const action = String(body.action || "").trim().toLowerCase();
  if (!ACTIONS.has(action)) {
    return res.status(400).json({
      ok: false, error: "unknown_action", allowed: [...ACTIONS],
      message: "That is not something this screen can do."
    });
  }

  /* Staff need owner/admin for every action, including submit — a setter or a
     closer has no business moving another company's brand. The role check is its
     own call, after the principal resolves. */
  if (principal.kind === "staff") {
    const staff = principal.staff || { role: principal.role };
    if (!requireRole(res, staff, REVIEW_ROLES)) return;
  }

  /* A PARTNER MAY NOT APPROVE OR REJECT, EVER. Checked before any row is read so
     the refusal cannot depend on whose brand was named. */
  if (principal.kind === "partner" && action !== "submit") {
    return res.status(403).json({
      ok: false, error: "forbidden",
      message: "Only Fundhub can approve a brand. You can send yours for review."
    });
  }

  /* resolvePartnerId pins a partner principal to their OWN id and ignores the
     partner_id they sent, so "submit somebody else's brand" has no request shape.
     A staff caller must name one. */
  const partnerId = resolvePartnerId(principal, { partner_id: body.partner_id });
  if (!partnerId) {
    return res.status(400).json({
      ok: false, error: "partner_id_required",
      message: "No partner was named, so there is nothing to send for review."
    });
  }
  if (!isUuid(partnerId)) {
    return res.status(400).json({
      ok: false, error: "invalid_partner_id",
      message: "That partner id is not a valid id."
    });
  }

  const rawNote = body.note == null ? "" : String(body.note).trim();
  if (action === "reject") {
    if (!rawNote) {
      return res.status(400).json({
        ok: false, error: "note_required",
        message: "Say why you are sending it back — the partner reads this."
      });
    }
    if (rawNote.length > NOTE_MAX) {
      return res.status(400).json({
        ok: false, error: "note_too_long",
        message: `Keep the reason to ${NOTE_MAX} characters or fewer.`
      });
    }
  }

  const staffId = principal.kind === "staff" ? (principal.staffId || null) : null;

  try {
    /* Read the row first so a refusal can say WHICH state it is in. partner_brand
       carries no RLS policy (it is not one of the nineteen tables 045 isolates),
       so the partner_id predicate here and in the UPDATE below is the only thing
       keeping one partner out of another's row. It is written explicitly in every
       statement for that reason. */
    const current = (await db.query(
      `SELECT approval_status FROM partner_brand WHERE partner_id = $1`, [partnerId]
    )).rows[0];

    if (!current) {
      return res.status(404).json({
        ok: false, error: "no_brand",
        message: "There is nothing to send yet — save the brand first."
      });
    }
    if (current.approval_status !== REQUIRED_FROM[action]) {
      return res.status(409).json({
        ok: false, error: "wrong_state",
        approval_status: current.approval_status,
        message: wrongStateMessage(action, current.approval_status)
      });
    }

    let sql, params;
    if (action === "submit") {
      /* review_note is cleared, not kept. A note is a reviewer's reason for
         sending the LAST version back; carrying it onto the new submission would
         show the reviewer a complaint about work the partner has already redone. */
      sql = `UPDATE partner_brand
                SET approval_status = 'review',
                    submitted_at = now(),
                    submitted_by = $2,
                    review_note = NULL,
                    updated_at = now()
              WHERE partner_id = $1 AND approval_status = 'draft'
              RETURNING approval_status, submitted_at`;
      params = [partnerId, staffId];
    } else if (action === "approve") {
      sql = `UPDATE partner_brand
                SET approval_status = 'approved',
                    approved_at = now(),
                    approved_by = $2,
                    review_note = NULL,
                    updated_at = now()
              WHERE partner_id = $1 AND approval_status = 'review'
              RETURNING approval_status, approved_at`;
      params = [partnerId, staffId];
    } else {
      // reject — back to draft, and the approval columns go with it so the
      // coupling CHECK in 043 stays true.
      sql = `UPDATE partner_brand
                SET approval_status = 'draft',
                    approved_at = NULL,
                    approved_by = NULL,
                    review_note = $2,
                    updated_at = now()
              WHERE partner_id = $1 AND approval_status = 'review'
              RETURNING approval_status, review_note`;
      params = [partnerId, rawNote];
    }

    const { rows } = await db.query(sql, params);
    if (!rows[0]) {
      // Somebody else moved the row between the read and the write.
      const now = (await db.query(
        `SELECT approval_status FROM partner_brand WHERE partner_id = $1`, [partnerId]
      )).rows[0];
      return res.status(409).json({
        ok: false, error: "wrong_state",
        approval_status: now ? now.approval_status : null,
        message: "Nothing changed — someone else changed this brand a moment ago. Reload and try again."
      });
    }

    return res.status(200).json({
      ok: true,
      action,
      partner_id: partnerId,
      approval_status: rows[0].approval_status,
      submitted_at: rows[0].submitted_at ?? null,
      approved_at: rows[0].approved_at ?? null,
      review_note: rows[0].review_note ?? null
    });
  } catch (err) {
    return res.status(500).json({
      ok: false, error: "write_failed",
      message: "Something went wrong. Nothing was changed. Try again in a moment.",
      detail: safeError(err)
    });
  }
}

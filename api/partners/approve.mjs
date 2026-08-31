// POST /api/partners/approve — the human step a white-label application waits for.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): consent capture. See "THE TEXT
// CONSENT IS THE APPLICANT'S" below.
//
// WHY THIS FILE EXISTS. api/public/partner-apply.mjs stopped making a stranger a
// live partner on submit: an application now writes one `partners` row at status
// 'invited' and a card on the R-08 rail, and every part of actually being a
// partner — the login, the brand row, the published page at /sites/{id}, the
// 'active' status and the welcome mail — moved into approvePartnerApplication().
//
// That function was written, tested, and reachable by nothing. Its own header
// said so: "NOT ROUTED YET… approval is a manual database step." So the
// end-to-end walk of 2026-08-27 was still right about its symptom even after the
// rewrite — a person applies and never hears from us again, because the only
// code that mails them could not be called. This route is the missing half.
//
// THE TEXT CONSENT IS THE APPLICANT'S, NOT THE APPROVER'S. src/messaging/gate.mjs
// lets SMS-PARTNER-WELCOME out with no client row behind it precisely because
// "the row existing is itself the consent record" — welcome.mjs only writes it
// when the applicant ticked the box. So this endpoint reads the phone number and
// the tick off the partners row the FORM wrote (they are kept in `notes` as
// `phone=` and `sms_consent=`), and takes neither from the request body. An
// employee cannot type a number into an approval and have it texted, and an
// application with no tick sends email only. If the note cannot be parsed, no
// text goes — the failure is silence, never an uninvited message.
//
// WHAT IT DOES NOT DO. It does not stamp agreement_signed_at. 042_partners.sql
// refuses every payout until that column is set AND status is 'active'; approval
// only supplies the second half, so signing stays a separate, deliberate act.
//
// THE FIRST PASSWORD comes back once, to the approving employee, and is never
// stored or re-shown. It is deliberately not in the welcome mail: db/seed/024
// tells the new partner to use "Forgot your password?" on the login page, which
// is a door that already works for partner logins.
//
// OWNER/ADMIN ONLY. Approving creates a login, publishes a page in somebody
// else's brand and opens a payout relationship. ROLE_SETS.OPS is the owner+admin
// set; requireAuth ignores a `roles` key (CLAUDE.md §12), so the gate is
// requireRole AFTER it.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requireRole, ROLE_SETS, isUuid } from "../../src/http/read-api.mjs";
import { safeError } from "../../src/http/health.mjs";
import { emit } from "../../src/events/bus.mjs";
import { approvePartnerApplication } from "../public/partner-apply.mjs";

function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body || "{}"); } catch { return null; }
  }
  return {};
}

/* applicantContact — what the person actually typed on the form, read back out
   of the note api/public/partner-apply.mjs writes:

     contact=<name>\nphone=<10 digits>\naudience=<free text>\nsms_consent=<bool>

   `audience` is FREE TEXT the applicant types and nothing strips newlines from
   it, so it can contain a line that looks exactly like one of these keys. That
   is a real hole, not a hypothetical one: a pasted "phone=<somebody else's
   number>" would otherwise decide who gets texted.

   Two defences. Every key is anchored to the START of a line, so a value cannot
   contribute unless it is on its own line. And the winning match is the one on
   the far side of `audience` from the injection: the writer emits phone BEFORE
   audience, so the FIRST phone= line is the genuine one, and it emits
   sms_consent AFTER audience, so the LAST sms_consent= line is the genuine one.
   An injected copy always loses to the real one.

   Anything unparsed comes back null/false, which is the quiet outcome. */
export function applicantContact(notes) {
  const text = String(notes == null ? "" : notes);
  const phones = [...text.matchAll(/^phone=([0-9+][0-9\-() .]{6,24})\s*$/gm)];
  const consents = [...text.matchAll(/^sms_consent=(true|false)\s*$/gm)];
  const consent = consents.length ? consents[consents.length - 1] : null;
  return {
    phone: phones.length ? phones[0][1].trim() : null,
    smsConsent: !!consent && consent[1] === "true"
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.OPS)) return;

  const body = readBody(req);
  if (!body) return res.status(400).json({ ok: false, error: "invalid_json" });

  const partnerId = String(body.partner_id || body.partnerId || "").trim();
  if (!isUuid(partnerId)) {
    return res.status(400).json({ ok: false, error: "partner_id_required" });
  }

  /* The company off the SESSION, never off the body. A body-supplied org would
     let an admin of one company approve another company's applicant. */
  const orgId = (staff && staff.org_id) || null;
  if (!orgId) {
    return res.status(400).json({
      ok: false,
      error: "org_required",
      message: "Your sign-in is not attached to a company, so there is nobody to approve."
    });
  }

  try {
    const row = (await db.query(
      `SELECT notes FROM partners WHERE id = $1::uuid AND org_id = $2::uuid LIMIT 1`,
      [partnerId, orgId]
    )).rows[0];
    if (!row) {
      return res.status(404).json({ ok: false, error: "partner_not_found" });
    }
    const contact = applicantContact(row.notes);

    const result = await approvePartnerApplication({
      partnerId,
      orgId,
      approvedBy: staff.id || null,
      phone: contact.phone,
      smsConsent: contact.smsConsent
    });

    if (!result || !result.ok) {
      return res.status((result && result.status) || 400).json({
        ok: false,
        error: (result && result.error) || "approve_failed"
      });
    }

    /* The bus write is best-effort and comes AFTER the partner is live. An event
       table that is down must not undo an approval that already committed. */
    let event = null;
    try {
      event = await emit(
        db,
        "partner.approved",
        {
          partnerId,
          status: result.status,
          loginCreated: !!result.password,
          loginBlocked: result.login_blocked || null,
          sitePath: result.site_path || null,
          smsConsent: contact.smsConsent,
          approvedBy: staff.id || null
        },
        { orgId, idempotencyKey: `partner.approved:${partnerId}` }
      );
    } catch {
      event = { ok: false, error: "emit_failed" };
    }

    return res.status(200).json({ ...result, event });
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}

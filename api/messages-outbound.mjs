// POST /api/messages-outbound — the outbound queue an operator can finally see and act on.
//
// NAMED "messages-outbound", not "messages": the staff-reply-inbox branch
// (merged first) already claims POST /api/messages for a staff member's
// direct reply to a client conversation (src/messaging/compose.mjs). Both
// branches independently wrote a handler at api/messages.mjs; the collision
// was caught at merge time and resolved by renaming this one, the same way
// colliding migration numbers were renumbered elsewhere in this merge —
// nobody's design changes, only the route path. See docs/MERGE-LOG.md
// section 3 for the full account.
//
//   { action: "status"   }                          what is waiting, and can it go
//   { action: "dispatch" }                          send what is due, now
//   { action: "settings", outbound_enabled, daily_send_cap, alert_email }
//   { action: "email_invoice", invoice_id }         send one invoice
//   { action: "email_invoice_backlog" }             send the ones never sent
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS ENDPOINT EXISTS AT ALL
//
// Twenty-six workflows call sendTemplated(), every one of them writes a queued
// `messages` row, and until now NOTHING DRAINED THAT QUEUE. src/messaging/
// dispatch.mjs said so in its own header: "dispatchDue() runs when something
// calls it, and today nothing does." So every client email this platform ever
// composed sat in a table — not blocked, not failed, just invisible.
//
// The owner's instruction: "holy shit, we gotta send out emails. Right? That's
// kind of like an obvious… it's not like the workflow is something that we turn
// on… it should be an option, the ability to set it up."
//
// So sending is a normal, visible part of the product now: a screen, a switch,
// a button, and a schedule — instead of an environment variable one person can
// set and nobody can see.
//
// ═══════════════════════════════════════════════════════════════════════════
// GATES
//
// `status` is ROLE_SETS.STAFF — knowing whether mail is going out is
// operational visibility, the same class as read/workflows.
//
// Everything else is OWNER/ADMIN. Draining the queue, flipping the switch and
// mailing an invoice backlog all put mail in front of real people in bulk, which
// is a narrower act than anything a closer does in a day.
//
// NOTHING HERE TRANSMITS DIRECTLY. It calls src/messaging/outbox.mjs, which
// calls the dispatcher, which resolves a provider from message_channel_routing.
// Outbound fetch lives in src/messaging/providers/* and nowhere else
// (CLAUDE.md §12). This file holds no URL and no credential.

import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { hasRole } from "../src/http/middleware/requireRole.mjs";
import { requireRole, ROLE_SETS, isUuid, CLIENT_DATA_ERRORS } from "../src/http/read-api.mjs";
import { safeError } from "../src/http/health.mjs";
import { outboxStatus, setSettings, drain } from "../src/messaging/outbox.mjs";
import {
  emailInvoice, emailOutstandingInvoices, unemailedInvoices
} from "../src/invoices/notify.mjs";

const OWNER_ADMIN_ACTIONS = new Set([
  "dispatch", "settings", "email_invoice", "email_invoice_backlog"
]);
const ALL_ACTIONS = [
  "status", "dispatch", "settings", "email_invoice", "email_invoice_backlog"
];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  /* requireAuth then requireRole, as two calls. requireAuth forwards opts to
     authenticate(), which reads only { db, env } — a `roles` key there gates
     nothing (CLAUDE.md §12, src/http/auth-gate.test.mjs). */
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const orgId = (staff && staff.org_id) || null;
  if (!orgId) {
    return res.status(400).json({
      ok: false, error: "org_required",
      message: "Your sign-in is not attached to a company, so there is nothing to show."
    });
  }

  const body = req.body || {};
  const action = String(body.action || "status").trim().toLowerCase();
  if (!ALL_ACTIONS.includes(action)) {
    return res.status(400).json({ ok: false, error: "unknown_action", allowed: ALL_ACTIONS });
  }
  if (OWNER_ADMIN_ACTIONS.has(action) && !hasRole(staff, ["admin"])) {
    return res.status(403).json({
      ok: false, error: "forbidden", required: ["owner", "admin"],
      message: "Only an owner or an admin can send mail or change how sending works."
    });
  }

  try {
    switch (action) {
      case "status": {
        const status = await outboxStatus(db, { orgId });
        const backlog = await unemailedInvoices(db, { orgId, limit: 500 });
        return res.status(200).json({
          ok: true, action, ...status,
          invoices_never_emailed: backlog.length,
          message: status.summary
        });
      }

      case "dispatch": {
        const out = await drain(db, { orgId, limit: Number(body.limit) || undefined });
        const status = await outboxStatus(db, { orgId });
        return res.status(200).json({
          ok: true, action, result: out, ...status,
          message: out.ran
            ? (out.sent
                ? `Sent ${out.sent} message${out.sent === 1 ? "" : "s"}.` +
                  (out.blocked ? ` ${out.blocked} was held by the compliance check.` : "")
                : "Nothing went out — see the details below.")
            : reasonText(out)
        });
      }

      case "settings": {
        const saved = await setSettings(db, {
          orgId, staffId: staff.id,
          outboundEnabled: body.outbound_enabled,
          dailySendCap: body.daily_send_cap,
          alertEmail: body.alert_email
        });
        return res.status(200).json({
          ok: true, action, settings: saved,
          message: saved.outbound_enabled
            ? "Sending is on. Anything waiting will go out on the next pass."
            : "Sending is paused. Nothing will go out until you turn it back on."
        });
      }

      /* ── invoices ──────────────────────────────────────────────────────────
         `invoices.status` has included 'sent' since 017 and nothing ever emailed
         one, so the client was never told. 119 separates the claim from the
         fact — `emailed_at` is what actually left. */
      case "email_invoice": {
        if (!isUuid(body.invoice_id)) return res.status(400).json({ ok: false, error: "invalid_invoice_id" });
        const out = await emailInvoice(db, { orgId, invoiceId: body.invoice_id });
        if (!out.ok) {
          return res.status(out.reason === "not_found" ? 404 : 409).json({
            ok: false, error: out.reason, message: invoiceReasonText(out.reason)
          });
        }
        return res.status(200).json({ ok: true, action, ...out, message: "Invoice emailed." });
      }

      case "email_invoice_backlog": {
        /* Bounded and deliberately NOT on a schedule. Mailing a backlog of
           historical invoices has real consequences for real people; it should
           be somebody pressing a button having seen the count. */
        const out = await emailOutstandingInvoices(db, {
          orgId, limit: Math.max(1, Math.min(Number(body.limit) || 50, 200))
        });
        return res.status(200).json({
          ok: true, action, result: out,
          message: out.emailed
            ? `Emailed ${out.emailed} invoice${out.emailed === 1 ? "" : "s"} that had never been sent.`
            : (out.considered
                ? "Nothing could be emailed — see the reasons below."
                : "Every invoice that was raised has already been emailed.")
        });
      }

      default:
        return res.status(400).json({ ok: false, error: "unknown_action", allowed: ALL_ACTIONS });
    }
  } catch (err) {
    if (err && CLIENT_DATA_ERRORS.has(err.code)) {
      return res.status(400).json({ ok: false, error: "bad_request_parameter" });
    }
    return res.status(500).json({ ok: false, error: "request_failed", message: "Something went wrong with that mail request. Try again in a moment.", detail: safeError(err) });
  }
}

/* Plain language for every way a drain can decline. A screen must never have to
   invent wording for these, and two screens must never word them differently. */
function reasonText(out) {
  if (out.reason === "paused") return "Sending is paused. Turn it on to send what is waiting.";
  if (out.reason === "daily_cap_reached") {
    return `Today's limit of ${out.cap} has been reached (${out.sentToday} sent). ` +
           "Nothing more will go out until tomorrow, or until you raise the limit.";
  }
  if (out.reason === "error") return "Something went wrong while sending. Nothing was lost — it is still waiting.";
  return "Nothing was sent.";
}

const invoiceReasonText = (reason) => ({
  not_found: "That invoice does not exist.",
  voided: "That invoice was voided, so it cannot be emailed.",
  no_email: "That client has no email address on file.",
  no_template: "The invoice email wording has not been set up yet.",
  template_not_approved: "The invoice email wording is waiting on approval.",
  already_emailed: "That invoice has already been emailed."
}[reason] || "That invoice could not be emailed.");

export { OWNER_ADMIN_ACTIONS, ALL_ACTIONS };

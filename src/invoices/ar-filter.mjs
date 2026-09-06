// src/invoices/ar-filter.mjs — what "unpaid" means when a screen asks for it.
//
// WHAT WAS WRONG (walk finding, 2026-09-06). The "AR + Collections — Oldest
// Unpaid First" table in public/app/ops-admin.html asked
// GET /api/read/invoices?status=open. There is no such status and there never
// can be: invoices_status_check (db/migrations/031_invoices.sql:133) permits
// exactly eight values and 'open' is not one of them. `v.status = 'open'`
// therefore matched no row, the panel painted "No unpaid invoices", and it
// would have painted that forever — however many bills went out — while a real
// $5,000 success-fee invoice sat in the table, sent and unpaid, with the client
// already emailed about it.
//
// 'open' IS NOT A STATUS, IT IS A QUESTION: "is money still owed on this?"
// 031 already answers it and deliberately does not store the answer —
// v_invoice_balance.open_balance is amount_due minus everything paid, forced to
// 0 for 'void' and 'written_off'. A stored "open" flag is a flag that drifts the
// first time a payment lands outside the one code path that maintains it, which
// is the reason that migration computes the balance instead.
//
// So the vocabulary is written down once, here, and the endpoint maps 'open' to
// that column rather than to a status that does not exist. An unrecognised
// status is now a 400 with the list in it, not a silently empty table: a screen
// asking a question the database cannot answer should hear so.

/* The eight stored values, in the order 031 lists them. This is the DUNNING
   state — where the invoice sits on the AR ladder — and it is deliberately NOT
   the settlement truth, which comes from the payments (settlement_state). */
export const INVOICE_STATUSES = Object.freeze([
  "draft",
  "sent",
  "reminded",
  "escalated",
  "paid",
  "partially_paid",
  "written_off",
  "void"
]);

/* The one named filter. Kept as a constant so the screen, the endpoint and the
   test all spell it the same way. */
export const OPEN_FILTER = "open";

/**
 * invoiceStatusFilter — turn a ?status= query value into something the SQL can
 * actually apply.
 *
 * Returns { kind, status, openOnly, valid, message }:
 *   kind "all"   — no filter asked for; every invoice in the org
 *   kind "open"  — money still owed, whatever rung of the ladder it is on
 *   kind "exact" — one of the eight stored statuses
 *
 * `valid:false` carries the message the caller should send back as a 400.
 */
export function invoiceStatusFilter(raw) {
  const asked = raw == null ? "" : String(raw).trim().toLowerCase();

  if (asked === "") {
    return { kind: "all", status: null, openOnly: false, valid: true, message: null };
  }

  if (asked === OPEN_FILTER) {
    return { kind: "open", status: null, openOnly: true, valid: true, message: null };
  }

  if (INVOICE_STATUSES.includes(asked)) {
    return { kind: "exact", status: asked, openOnly: false, valid: true, message: null };
  }

  return {
    kind: "invalid",
    status: null,
    openOnly: false,
    valid: false,
    message:
      `"${asked}" is not an invoice status. Use "open" for anything still owed, ` +
      `or one of: ${INVOICE_STATUSES.join(", ")}.`
  };
}

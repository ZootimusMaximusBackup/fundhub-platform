// src/payment-links/index.mjs — staff-initiated Commas checkout links.
//
// A payment_links row (117_payment_links.sql) is the ASK: a member of staff
// requested money from a named client for a named reason. It is distinct from
// `invoices` (money owed on the AR ladder) and from `transactions` (money
// actually received, written by src/handlers/client-lifecycle.mjs off
// payment.received). This module only ever moves a link through
// created -> sent -> paid, or -> expired / void. It never writes a
// transaction and never charges anyone — the link is a URL a client visits to
// pay Commas directly.
import crypto from "node:crypto";
import { buildCommasCheckoutUrl } from "../adapters/commas.mjs";

const PURPOSES = new Set(["deposit", "diagnostic", "repair", "custom"]);
const OPEN_STATUSES = ["created", "sent"];

export function generateLinkRef() {
  return `pl_${crypto.randomBytes(12).toString("hex")}`;
}

/** createPaymentLink — mints a checkout URL and records the ask.
 *  amountCents must be a positive integer; there is no "unknown amount" case
 *  here, unlike a subscription price — a payment link with no amount is not a
 *  link anyone can pay. `custom` purpose requires a description, because
 *  "custom" alone tells the client nothing about what they are paying for. */
export async function createPaymentLink(db, {
  orgId, clientId, purpose, description = null, amountCents,
  currency = "USD", createdByStaffId = null, checkoutBaseUrl
}) {
  if (!orgId) throw new TypeError("createPaymentLink: orgId is required");
  if (!clientId) throw new TypeError("createPaymentLink: clientId is required");
  if (!PURPOSES.has(purpose)) {
    throw new TypeError(`createPaymentLink: purpose must be one of ${[...PURPOSES].join(", ")}`);
  }
  if (purpose === "custom" && !String(description || "").trim()) {
    throw new TypeError("createPaymentLink: a custom link needs a description");
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new RangeError(`createPaymentLink: amountCents must be a positive integer, got ${amountCents}`);
  }

  const linkRef = generateLinkRef();
  const checkoutUrl = buildCommasCheckoutUrl({
    baseUrl: checkoutBaseUrl,
    linkRef,
    amountCents,
    description: description || purpose
  });

  const result = await db.query(
    `INSERT INTO payment_links
       (org_id, client_id, purpose, description, amount_cents, currency,
        link_ref, checkout_url, created_by_staff_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [orgId, clientId, purpose, description, amountCents, currency, linkRef, checkoutUrl, createdByStaffId]
  );
  return result.rows[0];
}

/** markSent — created -> sent. Idempotent: a link already sent (or paid) is
 *  untouched and the call returns null rather than clobbering a later state. */
export async function markSent(db, { id, orgId, at = new Date() }) {
  const result = await db.query(
    `UPDATE payment_links
        SET status = 'sent', sent_at = $3
      WHERE id = $1 AND org_id = $2 AND status = 'created'
     RETURNING *`,
    [id, orgId, at]
  );
  return result.rows[0] ?? null;
}

/** markExpired — created/sent -> expired. A staff action, not automatic: this
 *  repo has no scheduler that walks stale links, so a link only expires when
 *  someone says it has. */
export async function markExpired(db, { id, orgId, at = new Date() }) {
  const result = await db.query(
    `UPDATE payment_links
        SET status = 'expired', expired_at = $3
      WHERE id = $1 AND org_id = $2 AND status = ANY($4)
     RETURNING *`,
    [id, orgId, at, OPEN_STATUSES]
  );
  return result.rows[0] ?? null;
}

/** markPaid — created/sent -> paid, keyed by the link's OWN reference (the
 *  `ref` a checkout URL is assumed to echo back — see commas.mjs), not by org:
 *  the webhook that calls this has no session and no org context, only what
 *  Commas sent. `link_ref` is globally unique (117_payment_links.sql), so that
 *  is enough to find the one row.
 *
 *  paidAmountCents is recorded SEPARATELY from amount_cents (what was asked
 *  for) rather than overwriting it — a client paying a different amount than
 *  requested is a fact to keep, not to hide by summarising it. */
export async function markPaid(db, { linkRef, commasSessionId = null, paidAmountCents = null, paidAt = new Date() }) {
  if (!linkRef) throw new TypeError("markPaid: linkRef is required");
  const result = await db.query(
    `UPDATE payment_links
        SET status = 'paid', paid_at = $2, commas_session_id = $3, paid_amount_cents = $4
      WHERE link_ref = $1 AND status = ANY($5)
     RETURNING *`,
    [linkRef, paidAt, commasSessionId, paidAmountCents, OPEN_STATUSES]
  );
  return result.rows[0] ?? null;
}

export async function getPaymentLink(db, { id, orgId }) {
  const result = await db.query(
    `SELECT * FROM payment_links WHERE id = $1 AND org_id = $2`,
    [id, orgId]
  );
  return result.rows[0] ?? null;
}

export async function getByLinkRef(db, { linkRef }) {
  const result = await db.query(`SELECT * FROM payment_links WHERE link_ref = $1`, [linkRef]);
  return result.rows[0] ?? null;
}

export async function listPaymentLinksForClient(db, { orgId, clientId }) {
  const result = await db.query(
    `SELECT * FROM payment_links WHERE org_id = $1 AND client_id = $2 ORDER BY created_at DESC`,
    [orgId, clientId]
  );
  return result.rows;
}

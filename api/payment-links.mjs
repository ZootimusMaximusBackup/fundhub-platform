// /api/payment-links — the CRM's "create a payment link" action.
//
//   GET  ?client_id=<uuid>                                    → { ok, items }
//   POST { action: "create", client_id, purpose, description?, price | price_cents }
//   POST { action: "send",   id }
//   POST { action: "expire", id }
//
// ROLE_SETS.FINANCE — {owner, admin, sales_manager} — same gate as
// finance/subscriptions and finance/cards: a payment link is a live request
// for a client's money, same class of action as starting a plan or filing a
// card.
//
// THIS DOES NOT CALL COMMAS. There is no confirmed Commas API for minting a
// checkout session server-side (docs/PAYMENT-LINKS-SPEC.md), and this repo's
// hard rule is that new outbound `fetch` may only be added inside
// src/messaging/providers/* (CLAUDE.md §12) — a payment-session API call does
// not belong there. `checkout_url` is built by pure URL construction
// (src/adapters/commas.mjs buildCommasCheckoutUrl) against
// COMMAS_CHECKOUT_BASE_URL, an env var this file expects but does not invent
// a default for: unset, "create" answers 503 rather than minting a broken
// link nobody can pay.
//
// "send" queues an SMS via sendTemplated. If that template is not approved,
// nothing is queued and the link stays `created` — we do not mark it sent.
import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../src/http/read-api.mjs";
import {
  createPaymentLink, markSent, markExpired, getPaymentLink, listPaymentLinksForClient
} from "../src/payment-links/index.mjs";
import { priceToCents, assertPriceCents, formatPrice } from "../src/subscriptions/index.mjs";
import { sendTemplated } from "../src/workflows/messaging.mjs";
import { dbDown } from "../src/http/db-down.mjs";

const PAYMENT_LINK_ROLES = ROLE_SETS.FINANCE;
const SESSION_OWNED = ["org_id", "orgId"];
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(Object(o ?? {}), k);

/* readAmountCents — same two-spellings-not-both rule as
   api/finance/subscriptions.mjs readPriceCents, except an ABSENT or NULL
   amount is refused here rather than passed through: a subscription can be on
   an unknown price, a payment link cannot ask a client for an unknown amount. */
function readAmountCents(body) {
  const hasDollars = hasOwn(body, "price");
  const hasCents = hasOwn(body, "price_cents");
  if (hasDollars && hasCents) {
    throw new TypeError("create: send price (dollars) or price_cents (integer cents), not both — they can disagree");
  }
  const cents = hasCents ? assertPriceCents(body.price_cents, "create: price_cents")
              : hasDollars ? priceToCents(body.price)
              : undefined;
  if (cents === undefined || cents === null) {
    throw new TypeError("create: an amount is required — a payment link cannot ask for an unknown amount");
  }
  return cents;
}

function withDisplay(row) {
  if (!row) return null;
  return {
    ...row,
    amount_display: formatPrice(row.amount_cents),
    paid_amount_display: formatPrice(row.paid_amount_cents)
  };
}

async function ownsClient(orgId, clientId) {
  const r = await db.query(`SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`, [String(clientId).trim(), orgId]);
  return r.rows.length > 0;
}

export default async function handler(req, res) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, PAYMENT_LINK_ROLES)) return;

  const orgId = staff.org_id ?? null;
  if (!orgId) {
    return res.status(403).json({ ok: false, error: "org_required" });
  }

  try {
    if (req.method === "GET") {
      const q = req.query || {};
      if (!isUuid(q.client_id)) {
        return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
      }
      if (!(await ownsClient(orgId, q.client_id))) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }
      const items = await listPaymentLinksForClient(db, { orgId, clientId: String(q.client_id).trim() });
      return res.status(200).json({ ok: true, items: items.map(withDisplay) });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      for (const field of SESSION_OWNED) {
        if (hasOwn(body, field)) {
          return res.status(400).json({ ok: false, error: `${field}_not_accepted` });
        }
      }

      if (body.action === "create") {
        if (!isUuid(body.client_id)) {
          return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
        }
        if (!(await ownsClient(orgId, body.client_id))) {
          return res.status(403).json({ ok: false, error: "forbidden" });
        }
        const checkoutBaseUrl = process.env.COMMAS_CHECKOUT_BASE_URL;
        if (!checkoutBaseUrl) {
          return res.status(503).json({
            ok: false,
            error: "commas_not_configured",
            message: "COMMAS_CHECKOUT_BASE_URL is not set — no checkout link can be built"
          });
        }
        const amountCents = readAmountCents(body);
        const link = await createPaymentLink(db, {
          orgId,
          clientId: String(body.client_id).trim(),
          purpose: body.purpose,
          description: body.description ?? null,
          amountCents,
          currency: body.currency ?? "USD",
          createdByStaffId: staff.id,
          checkoutBaseUrl
        });
        return res.status(200).json({ ok: true, action: "create", link: withDisplay(link) });
      }

      if (body.action === "send" || body.action === "expire") {
        if (!isUuid(body.id)) {
          return res.status(400).json({ ok: false, error: "id must be a uuid" });
        }
        const link = await getPaymentLink(db, { id: body.id, orgId });
        if (!link) return res.status(404).json({ ok: false, error: "no such payment link" });

        if (body.action === "expire") {
          const updated = await markExpired(db, { id: body.id, orgId });
          if (!updated) {
            return res.status(409).json({ ok: false, error: "this link is already paid or expired — nothing changed" });
          }
          return res.status(200).json({ ok: true, action: "expire", link: withDisplay(updated) });
        }

        // action === "send". Resending after 'sent' is a legitimate "they said
        // they lost it" case and sendTemplated's own idempotency (one message
        // per link id) makes a second request harmless — but a link that is
        // already 'paid', 'expired' or 'void' asking a client for money again
        // is not a resend, it is a wrong message, so those are refused.
        if (link.status !== "created" && link.status !== "sent") {
          return res.status(409).json({
            ok: false,
            error: `this link is ${link.status} — sending it again would ask the client for money that is settled or dead`
          });
        }
        const queued = await sendTemplated(db, {
          orgId,
          clientId: link.client_id,
          channel: "sms",
          templateKey: "payment_link_notice",
          eventId: link.id,
          staffId: staff.id,
          context: {
            payment_link: {
              url: link.checkout_url,
              description: link.description || link.purpose,
              amount: formatPrice(link.amount_cents)
            }
          }
        });
        let updated = link;
        if (queued.sent === true) {
          updated = (await markSent(db, { id: body.id, orgId })) || link;
        }
        return res.status(200).json({
          ok: true,
          action: "send",
          link: withDisplay(updated),
          message_queued: queued.sent === true,
          message_reason: queued.sent ? null : queued.reason
        });
      }

      return res.status(400).json({ ok: false, error: "invalid_action" });
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    if (e instanceof TypeError || e instanceof RangeError) {
      return res.status(400).json({ ok: false, error: String(e.message).slice(0, 200) });
    }
    if (CLIENT_DATA_ERRORS.has(e && e.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    if (e && (e.code === "23505" || e.code === "23514" || e.code === "23503")) {
      return res.status(400).json({ ok: false, error: "the database refused that value" });
    }
    if (dbDown(res, e)) return;
    throw e;
  }
}

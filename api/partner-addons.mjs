// /api/partner-addons — a white-label partner buys, holds and cancels the three
// W6 add-ons.
//
//   GET  ?partner_id=<uuid>
//        → { ok, partner_id, catalog, current, history, orders }
//   POST { action: "buy",      partner_id, add_on, units? }   → { ok, link, ... }
//   POST { action: "cancel",   partner_id, add_on, at?, ends_at? }
//   POST { action: "activate", partner_id, payment_link_id }  → manual fallback
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): payment rails and fee timing. This
// endpoint asks a partner for money and puts them on a monthly cycle.
//
// "BUY" DOES NOT CHARGE ANYBODY. It mints a Commas checkout link — a URL a human
// clicks — and records the ask. The subscription appears when the payment does,
// through the webhook (src/handlers/partner-addons.mjs). Nothing here holds a
// card: 271's subscriptions_partner_card_chk forbids one, because there is no
// partner instrument table in this repository.
//
// "ACTIVATE" EXISTS BECAUSE THE WEBHOOK CAN GO MISSING. 119_payment_links.sql's
// own header records that the metadata round-trip is unverified against a live
// Commas sandbox, and that a webhook which does not echo our ref back leaves the
// row at 'sent' forever. That is an honest stuck state, and the fix for a stuck
// state is a human with the payment in front of them — not a guess. So activate
// refuses anything that is not already marked paid; it reconciles, it does not
// decide that money arrived.
//
// ORG COMES FROM THE SESSION, ALWAYS, and the partner must be in that org. The
// same two rules api/finance/subscriptions.mjs states at length: a body field
// that chose the org would file one company's money in another company's table,
// and an org-scoped write with an unchecked partner_id still writes a row about
// somebody this company has no relationship with.
import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { requireRole, isUuid, CLIENT_DATA_ERRORS } from "../src/http/read-api.mjs";
import { SubscriptionConflictError } from "../src/subscriptions/store.mjs";
import {
  buyAddOn, cancelAddOn, listAddOns, activateFromLink
} from "../src/subscriptions/partner-addons.mjs";
import { formatPrice } from "../src/subscriptions/index.mjs";
import { dbDown } from "../src/http/db-down.mjs";

/* WHO GATES THIS ROUTE.
   {owner, admin}. Narrower than ROLE_SETS.FINANCE, which also holds
   sales_manager — that seat sells to CLIENTS. The partner menu is the owner's
   own price list and buying off it starts a recurring charge against another
   business; a sales manager has no reason to reach it. Widening this is a
   decision with a sentence attached, not a convenience.

   WRITTEN OUT LONGHAND ON PURPOSE. scripts/journeys/extract.mjs resolves a bare
   identifier or a `new Set([...])` of quoted strings and nothing else. A gate it
   cannot read does not fail loudly — it extracts as "any signed in employee",
   publishing on the journey pages a non-coder reads the false claim that a
   setter can spend a partner's money. */
const PARTNER_ADDON_ROLES = new Set(["owner", "admin"]);

/* Fields the session owns. Present in a body ⇒ 400, never merged and never
   silently dropped — api/shifts.mjs:44 explains why refusing beats ignoring. */
const SESSION_OWNED = ["org_id", "orgId"];
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(Object(o ?? {}), k);

async function ownsPartner(orgId, partnerId) {
  const r = await db.query(
    `SELECT 1 FROM partners WHERE id = $1 AND org_id = $2`,
    [String(partnerId).trim(), orgId]
  );
  return r.rows.length > 0;
}

/* withPrice — the row as a screen needs to read it. price_display is the 2dp
   STRING money.fromCents() produces, computed here and never in the browser:
   19.90 as a JavaScript float is not 19.90. null price_cents stays null, and a
   screen renders that as an em dash — "we do not know what this costs" and
   "this costs nothing" are different facts about somebody's money. */
function withPrice(row) {
  if (!row) return null;
  return { ...row, price_display: formatPrice(row.price_cents) };
}

function withAmount(link) {
  if (!link) return null;
  return {
    ...link,
    amount_display: formatPrice(link.amount_cents),
    paid_amount_display: formatPrice(link.paid_amount_cents)
  };
}

/* readUnits — how many booked calls this Lead Flow purchase is for.
   ABSENT IS NOT ZERO. Omitting it means "I am not saying", which the store
   turns into a refusal naming the unit; sending 0 would be an ask for $0. */
function readUnits(body) {
  if (!hasOwn(body, "units")) return null;
  const raw = body.units;
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    throw new TypeError("units must be a whole number — half a booked call is not a thing that was delivered");
  }
  return n;
}

export default async function handler(req, res, deps = {}) {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl;

  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  /* A SECOND CALL, DELIBERATELY. requireAuth forwards opts to authenticate(),
     which reads only { db, env } — a `roles` key passed to it does nothing at
     all and has already shipped one hole (CLAUDE.md §12). The gate is this
     line. */
  if (!requireRole(res, staff, PARTNER_ADDON_ROLES)) return;

  const orgId = staff.org_id ?? null;
  if (!orgId) {
    // FAIL CLOSED. A session with no company cannot be scoped to one, and both
    // alternatives are worse: a default org files the row under the wrong
    // company, and no filter reads every company's rows.
    return res.status(403).json({ ok: false, error: "org_required" });
  }

  try {
    if (req.method === "GET") {
      const q = req.query || {};
      if (!isUuid(q.partner_id)) {
        return res.status(400).json({ ok: false, error: "partner_id must be a uuid" });
      }
      if (!(await ownsPartner(orgId, q.partner_id))) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }
      const partnerId = String(q.partner_id).trim();
      const view = await listAddOns(db, { orgId, partnerId });
      return res.status(200).json({
        ok: true,
        partner_id: partnerId,
        catalog: view.catalog,
        current: view.current.map(withPrice),
        history: view.history.map(withPrice),
        orders: view.orders.map(withAmount)
      });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      for (const field of SESSION_OWNED) {
        if (hasOwn(body, field)) {
          return res.status(400).json({ ok: false, error: `${field}_not_accepted` });
        }
      }
      if (!isUuid(body.partner_id)) {
        return res.status(400).json({ ok: false, error: "partner_id must be a uuid" });
      }
      if (!(await ownsPartner(orgId, body.partner_id))) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }
      const partnerId = String(body.partner_id).trim();

      switch (body.action) {
        case "buy": {
          /* Refuse only when there is NO way to mint a link at all. Gating on
             COMMAS_CHECKOUT_BASE_URL alone refused every request while the key
             that actually works sat set and unread — createPaymentLink prefers
             the checkout-session API and only falls back to a query-string URL.
             Same gate as api/payment-links.mjs and src/sales/closer-deck.mjs. */
          const checkoutBaseUrl = env.COMMAS_CHECKOUT_BASE_URL;
          if (!checkoutBaseUrl && !String(env.FANBASIS_CHECKOUT_API_KEY || "").trim()) {
            return res.status(503).json({
              ok: false,
              error: "commas_not_configured",
              message: "Neither FANBASIS_CHECKOUT_API_KEY nor COMMAS_CHECKOUT_BASE_URL is set — no checkout link can be built"
            });
          }
          const bought = await buyAddOn(db, {
            orgId,
            partnerId,
            addOn: body.add_on ?? body.addOn ?? null,
            units: readUnits(body),
            createdByStaffId: staff.id,
            createdByRole: staff.role,
            checkoutBaseUrl,
            env,
            fetchImpl
          });
          return res.status(200).json({
            ok: true,
            action: "buy",
            add_on: bought.addOn.productCode,
            monthly: bought.monthly,
            units: bought.units,
            amount_cents: bought.amountCents,
            amount_display: formatPrice(bought.amountCents),
            /* SAID IN WORDS, NOT IMPLIED BY A FIELD NAME. A link is a request.
               Nothing recurs until the money lands (CLAUDE.md §10). */
            note: bought.monthly
              ? "Nothing is charged yet. The add-on starts when this link is paid."
              : "Nothing is charged yet. This is a one-time charge, not a subscription.",
            link: withAmount(bought.link)
          });
        }

        case "cancel": {
          const cancelled = await cancelAddOn(db, {
            orgId,
            partnerId,
            addOn: body.add_on ?? body.addOn ?? null,
            at: body.at ?? null,
            endsAt: body.ends_at ?? null
          });
          if (!cancelled.subscription) {
            // Not an error and not a success-with-nothing: this partner is not
            // on that add-on, which the screen has to be able to say.
            return res.status(404).json({
              ok: false,
              error: `this partner has no ${cancelled.addOn.name} to cancel`
            });
          }
          return res.status(200).json({
            ok: true,
            action: "cancel",
            add_on: cancelled.addOn.productCode,
            subscription: withPrice(cancelled.subscription)
          });
        }

        case "activate": {
          if (!isUuid(body.payment_link_id)) {
            return res.status(400).json({ ok: false, error: "payment_link_id must be a uuid" });
          }
          const out = await activateFromLink(db, {
            orgId, linkId: String(body.payment_link_id).trim()
          });
          if (!out.activated) {
            /* EVERY REFUSAL IS NAMED. "not_paid" is a 409, because the caller's
               request is fine and the world is not ready; the rest are 400,
               because the link they named is not a partner add-on that can
               start anything. "already_active" is a 200 — the arrangement they
               asked for exists, which is the outcome they wanted. */
            if (out.reason === "already_active") {
              return res.status(200).json({
                ok: true,
                action: "activate",
                activated: false,
                reason: out.reason,
                subscription: withPrice(out.subscription)
              });
            }
            const status = out.reason === "not_paid" ? 409 : 400;
            return res.status(status).json({ ok: false, error: out.reason });
          }
          return res.status(200).json({
            ok: true,
            action: "activate",
            activated: true,
            add_on: out.addOn.productCode,
            subscription: withPrice(out.subscription)
          });
        }

        default:
          return res.status(400).json({ ok: false, error: "invalid_action" });
      }
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    // The store says what the status is, because it is the only thing that
    // knows which rule was broken. 409 means "somebody else got here first",
    // or here also "they already have this add-on".
    if (e instanceof SubscriptionConflictError) {
      return res.status(e.status).json({ ok: false, error: e.message });
    }
    if (e instanceof TypeError || e instanceof RangeError) {
      return res.status(400).json({ ok: false, error: String(e.message).slice(0, 200) });
    }
    /* createPaymentLink raises its own shaped errors when the checkout provider
       is unconfigured or refuses. Fixed statuses, not the provider's own:
       passing a Commas 401 through would tell the staff member they are signed
       out. Nothing is written on either path — both throw before the INSERT. */
    if (e && e.code === "commas_not_configured") {
      return res.status(503).json({ ok: false, error: e.code, message: String(e.message || e.code).slice(0, 200) });
    }
    if (e && e.code === "commas_checkout_failed") {
      return res.status(502).json({ ok: false, error: e.code, message: String(e.message || e.code).slice(0, 200) });
    }
    if (CLIENT_DATA_ERRORS.has(e && e.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    if (e && (e.code === "23505" || e.code === "23514" || e.code === "23503" || e.code === "23P01")) {
      return res.status(400).json({ ok: false, error: "the database refused that value" });
    }
    if (dbDown(res, e)) return;
    throw e;
  }
}

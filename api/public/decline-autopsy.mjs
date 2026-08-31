// GET/POST /api/public/decline-autopsy — the $27 Decline Autopsy: page data,
// and checkout.
//
// COMPLIANCE REVIEW REQUIRED — this offer touches consumer data belonging to
// somebody else's customers, it touches credit-pull type (by forbidding one),
// and it touches fee timing. Spec: docs/specs/W3-decline-autopsy.md §7.
//
// NO AUTH. A stranger from an ad, same class as api/public/survey-submit.mjs
// and api/public/optimize.mjs. The pattern is copied from optimize.mjs on
// purpose: that is the public-checkout path that already works.
//
// GET  — everything the sales page needs: price, row cap, the field list, the
//        attestation wording, and whether checkout is actually configured.
//        NO EARNINGS FIGURE OF ANY KIND. FundHub has zero measured paid closes,
//        so no public page carries a modelled number (spec §4.3).
// POST — mints a Commas checkout and writes the purchase record, returning the
//        autopsy_ref the upload page carries.
//
// ORDER OF OPERATIONS, AND IT MATTERS: PAY FIRST, UPLOAD SECOND. If we let a
// stranger upload first we would be holding other people's data from someone
// who never became a customer. api/public/decline-autopsy-upload.mjs refuses
// every upload whose autopsy has no paid_at.
//
// NO OUTBOUND SMS OR EMAIL FROM THIS HANDLER. Outbound transmission is
// permitted in src/messaging/providers/* and nowhere else.

import { db } from "../../src/db.mjs";
import { resolveDefaultOrg } from "../../src/auth/org.mjs";
import { safeError } from "../../src/http/health.mjs";
import { getOffer, COMMAS_DEFAULT_PRODUCT_TITLE } from "../../src/config/offers.mjs";
import { checkoutConfig, createCheckoutSession } from "../../src/payments/commas-api.mjs";
import { createAutopsy, newAutopsyRef, markPaid, getAutopsyByRef } from "../../src/autopsy/store.mjs";
import { AUTOPSY_PRODUCT_CODE } from "../../src/autopsy/report.mjs";
import {
  ACCEPTED_FIELDS,
  ATTESTATION_TEXT,
  ATTESTATION_VERSION,
  AUTOPSY_PRICE_CENTS,
  DECLINE_REASONS,
  FICO_BAND_KEYS,
  MAX_ROWS,
  REFUSED_HEADER_WORDS
} from "../../src/autopsy/fields.mjs";

/**
 * THE COMMAS CATALOG TITLE IS NOT INVENTED. api/public/optimize.mjs states the
 * rule in its own header: never POST /public-api/products/create, and never
 * invent a catalog title. The repo cannot tell us which titles exist in the live
 * Commas catalog, so this uses the EXISTING default rather than creating a new
 * one. Spec §7.1, open question Q1 — a human has to look at the catalog.
 */
export const AUTOPSY_KEEP_TITLE = COMMAS_DEFAULT_PRODUCT_TITLE;

/* One definition, not two. src/autopsy/report.mjs owns it because that is where
   the test proving it accrues no commission lives; it is re-exported here so a
   caller reading the checkout does not have to go looking. */
export { AUTOPSY_PRODUCT_CODE };

/**
 * The price. Reads src/config/offers.mjs first so that when the frozen
 * DECLINE_AUTOPSY entry lands there it becomes the single source with no code
 * change here. Until then it falls back to the constant beside the parser.
 *
 * KNOWN GAP: that OFFERS entry does not exist yet. src/config/offers.mjs is
 * owned by another workflow in this batch and was not editable from here.
 */
export function autopsyPriceCents() {
  const offer = getOffer("DECLINE_AUTOPSY");
  const fromOffers = offer?.priceCents;
  return Number.isInteger(fromOffers) && fromOffers > 0 ? fromOffers : AUTOPSY_PRICE_CENTS;
}

function readBody(req) {
  if (req?.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  const raw = typeof req?.body === "string" ? req.body : (typeof req?.rawBody === "string" ? req.rawBody : "");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

const cleanStr = (v, max = 200) => (v == null ? "" : String(v).trim().slice(0, max));
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/** What the sales page renders. Terms only — never an earnings figure. */
export function autopsyPageConfig(env = process.env) {
  return {
    ok: true,
    priceCents: autopsyPriceCents(),
    maxRows: MAX_ROWS,
    checkout: { ready: checkoutConfig(env).ok === true },
    fields: ACCEPTED_FIELDS.map((f) => ({ key: f.key, required: f.required })),
    ficoBands: FICO_BAND_KEYS,
    declineReasons: DECLINE_REASONS,
    refusedColumnWords: REFUSED_HEADER_WORDS,
    attestation: { version: ATTESTATION_VERSION, lines: ATTESTATION_TEXT },
    /* Said before he uploads, not after. Spec §5.2 A4 and §8.2. */
    promises: [
      "Take the names off before you upload. We refuse a file that still has them.",
      "We do not pull anyone's credit. Not now, not later, not on anybody on your list.",
      "We will not contact any of the people on your list.",
      "You can attach a turn-down letter as evidence, but a person still types that row's numbers — we do not read PDFs.",
      "Everything we send back is an estimate. None of it is a promise of a result."
    ]
  };
}

export function parseAutopsyCheckoutBody(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_json" };
  const email = cleanStr(body.email, 160).toLowerCase();
  if (!isEmail(email)) return { ok: false, error: "email_required" };
  const name = [cleanStr(body.first_name || body.firstName, 80), cleanStr(body.last_name || body.lastName, 80)]
    .filter(Boolean).join(" ").trim() || null;
  return { ok: true, email, name };
}

/**
 * runAutopsyCheckout — mint the link, and write the purchase record so the
 * success URL has something to carry.
 *
 * If neither Commas path is configured we answer 503. WE NEVER INVENT A LINK.
 */
export async function runAutopsyCheckout(parsed, deps = {}) {
  const dbh = deps.db || db;
  const env = deps.env || process.env;
  const orgId = deps.orgId || (await resolveDefaultOrg(dbh));
  const amountCents = autopsyPriceCents();
  if (!Number.isInteger(amountCents) || amountCents <= 0) return { ok: false, error: "offer_missing" };

  if ((deps.checkoutConfig || checkoutConfig)(env).ok !== true) {
    return { ok: false, error: "checkout_not_configured" };
  }

  const ref = deps.ref || newAutopsyRef();
  await createAutopsy(dbh, { orgId, buyerEmail: parsed.email, buyerName: parsed.name, ref });

  const mint = deps.createCheckoutSession || createCheckoutSession;
  const opts = {
    amountCents,
    productTitle: AUTOPSY_KEEP_TITLE,
    // link_ref is the parameter name withCheckoutIdentifiers puts on the success
    // URL. Our ref travels as `ref`, which is what the upload page reads.
    metadata: { source: "decline-autopsy", product_code: AUTOPSY_PRODUCT_CODE, link_ref: ref },
    env
  };
  if (deps.fetchImpl) opts.fetchImpl = deps.fetchImpl;

  const minted = await mint(opts);
  if (!minted?.ok || !minted.paymentLink) return { ok: false, error: "checkout_failed", ref };

  return { ok: true, checkoutUrl: String(minted.paymentLink), ref, priceCents: amountCents };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const method = String(req.method || "GET").toUpperCase();

  if (method === "GET") {
    return res.status(200).json(autopsyPageConfig(process.env));
  }
  if (method !== "POST") {
    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const body = readBody(req);

  /* Reconciliation on the way back from checkout. The buyer lands on the upload
     page carrying his ref; this stamps paid_at so the upload endpoint will take
     his rows. Idempotent — a second call does not move paid_at. */
  if (body && body.action === "confirm") {
    const ref = cleanStr(body.ref, 64);
    if (!ref) return res.status(400).json({ ok: false, error: "ref_required" });
    try {
      const orgId = await resolveDefaultOrg(db);
      const existing = await getAutopsyByRef(db, { orgId, ref });
      if (!existing) return res.status(404).json({ ok: false, error: "not_found" });
      const paid = await markPaid(db, { orgId, ref, paymentLinkRef: cleanStr(body.payment_link_ref, 120) || null });
      return res.status(200).json({ ok: true, ref, paid: Boolean(paid?.paid_at) });
    } catch (err) {
      return res.status(500).json({ ok: false, error: safeError(err) });
    }
  }

  const parsed = parseAutopsyCheckoutBody(body);
  if (!parsed.ok) return res.status(400).json({ ok: false, error: parsed.error });

  try {
    const result = await runAutopsyCheckout(parsed);
    if (!result.ok) {
      const status = result.error === "checkout_not_configured" ? 503
        : result.error === "offer_missing" ? 500
        : 502;
      return res.status(status).json(result);
    }
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}

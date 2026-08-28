// GET/POST /api/public/optimize — hidden referral page at /optimize.
//
// COMPLIANCE REVIEW REQUIRED — credit-repair referral door. Public words on
// the page stay vague ("Audit"). Commas sees a keep catalog title only.
//
// GET  — tells the page whether Smart Credit keys exist. No keys = no widget.
// POST — mints a Commas checkout on Consulting Services Assessment (keep).
//        Never POST /public-api/products/create. Never invent a catalog title.
//
// NO AUTH. Same class as survey-submit: a stranger on a referral page.
// NO outbound SMS/email from this handler.

import { getOffer } from "../../src/config/offers.mjs";
import {
  checkoutConfig,
  createCheckoutSession
} from "../../src/payments/commas-api.mjs";
import { normalizePhone } from "../../src/messaging/providers/bland-voice.mjs";
import { safeError } from "../../src/http/health.mjs";

export const BOOK_URL = "https://apply.fundhub.ai/funding-book-call";
export const AUDIT_KEEP_TITLE = "Consulting Services Assessment";

function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body || "{}");
    } catch {
      return null;
    }
  }
  if (typeof req.rawBody === "string") {
    try {
      return JSON.parse(req.rawBody || "{}");
    } catch {
      return null;
    }
  }
  return null;
}

function cleanStr(v, max = 200) {
  if (v == null) return "";
  return String(v).trim().slice(0, max);
}

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/** Widget config only when both a client key and a PID are set. Never invent. */
export function smartCreditFromEnv(env = process.env) {
  const clientKey = String(
    env.CONSUMER_DIRECT_CLIENT_KEY || env.SMART_CREDIT_CLIENT_KEY || ""
  ).trim();
  const pid = String(env.CONSUMER_DIRECT_PID || env.SMART_CREDIT_PID || "").trim();
  if (!clientKey || !pid) return null;
  const stage = String(env.CONSUMER_DIRECT_ENV || env.SMART_CREDIT_ENV || "")
    .trim()
    .toLowerCase() === "stage";
  return {
    clientKey,
    pid,
    productName: "smartcredit",
    memberUrl: stage
      ? "https://stage-sc.consumerdirect.app"
      : "https://www.smartcredit.com",
    scriptUrl: stage
      ? "https://stage-cdn.consumerdirect.io/cd-widgets/latest/cd-signup.js"
      : "https://cdn.consumerdirect.io/cd-widgets/latest/cd-signup.js"
  };
}

export function parseOptimizeCheckoutBody(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_json" };
  const firstName = cleanStr(body.first_name || body.firstName, 80);
  const lastName = cleanStr(body.last_name || body.lastName, 80);
  const email = cleanStr(body.email, 160).toLowerCase();
  const rawPhone = cleanStr(body.phone || body.mobile, 40);
  const phone = normalizePhone(rawPhone) || rawPhone;
  if (!isEmail(email)) return { ok: false, error: "email_required" };
  return { ok: true, firstName, lastName, email, phone };
}

export function optimizePageConfig(env = process.env) {
  return {
    ok: true,
    bookUrl: BOOK_URL,
    audit: { ready: checkoutConfig(env).ok === true },
    smartCredit: smartCreditFromEnv(env)
  };
}

export async function runOptimizeCheckout(parsed, deps = {}) {
  const offer = (deps.getOffer || getOffer)("SOFT_PULL");
  const amountCents = offer?.priceCents;
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { ok: false, error: "offer_missing" };
  }
  const mint = deps.createCheckoutSession || createCheckoutSession;
  const opts = {
    amountCents,
    productTitle: AUDIT_KEEP_TITLE,
    metadata: { source: "optimize-referral" },
    env: deps.env || process.env
  };
  if (deps.fetchImpl) opts.fetchImpl = deps.fetchImpl;
  const minted = await mint(opts);
  if (!minted?.ok || !minted.paymentLink) {
    return { ok: false, error: "checkout_failed" };
  }
  return { ok: true, checkoutUrl: String(minted.paymentLink) };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const method = String(req.method || "GET").toUpperCase();
  if (method === "GET") {
    return res.status(200).json(optimizePageConfig(process.env));
  }
  if (method !== "POST") {
    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const parsed = parseOptimizeCheckoutBody(readBody(req));
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }
  try {
    const result = await runOptimizeCheckout(parsed);
    if (!result.ok) {
      const status = result.error === "offer_missing" ? 500 : 502;
      return res.status(status).json(result);
    }
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}

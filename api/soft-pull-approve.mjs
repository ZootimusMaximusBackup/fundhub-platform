// /api/soft-pull-approve — client-facing soft-pull approval (signed link).
//
//   GET  ?org=&client=&exp=&sig=  → disclosure + pricing + contact
//   POST { …identity, businesses[] } → consent + identity + businesses + checkout
//
// COMPLIANCE REVIEW REQUIRED — consent capture, fee timing, credit-pull identity (SSN).
// The consent TEXT is never taken from the body — only the version key, then
// the server copies its own words (same rule as api/consent/capture.mjs).
//
// Flow (owner 2026-08-25): form collects optional businesses first (safety
// ceiling 20); total = $32 + $10×n; checkout is minted/adjusted to that total
// before pay. EIN and incorporation date (month/year) are required on each
// added business; extra owner is optional. Age months are stored on the row.
// Live CRS / Experian Business in this repo does not return that date.

import { db } from "../src/db.mjs";
import { isUuid } from "../src/http/read-api.mjs";
import { dbDown } from "../src/http/db-down.mjs";
import { verifySoftPullApproveToken } from "../src/consent/approve-token.mjs";
import {
  CURRENT_SOFT_PULL_VERSION,
  SOFT_PULL_DISCLOSURES
} from "../src/consent/disclosures.mjs";
import {
  captureConsent,
  consentStatus,
  ConsentError
} from "../src/consent/index.mjs";
import { storeIdentity, PiiError } from "../src/pii/index.mjs";
import { hashPassword } from "../src/auth/hash.mjs";
import { newToken } from "../src/auth/session.mjs";
import { getOffer, formatCents } from "../src/config/offers.mjs";
import {
  softPullTotalCents,
  softPullPricingPublic,
  SOFT_PULL_MAX_BUSINESSES
} from "../src/finance/soft-pull-pricing.mjs";
import {
  createPaymentLink,
  markExpired,
  markSent
} from "../src/payment-links/index.mjs";

const KIND = "soft_pull_consent";
const BIZ_SOURCE = "soft_pull_approve";
const OPEN = ["created", "sent"];

function clientIp(req) {
  const xf = req.headers?.["x-forwarded-for"];
  if (xf) return String(xf).split(",")[0].trim();
  return req.headers?.["x-real-ip"] || null;
}

async function provisionClientAccount(database, { orgId, clientId, email, name }) {
  const existing = await database.query(
    `SELECT id FROM accounts
      WHERE client_id = $1 AND kind = 'client'
      ORDER BY created_at LIMIT 1`,
    [clientId]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  if (!email) {
    throw new ConsentError(
      "This contact has no email on file — we cannot attribute soft-pull consent.",
      { status: 409, code: "no_email_for_account" }
    );
  }

  await database.query(
    `INSERT INTO accounts
       (org_id, kind, email, name, password_hash, status, client_id, activated_at)
     VALUES ($1,'client',$2,$3,$4,'active',$5, now())
     ON CONFLICT DO NOTHING`,
    [orgId, email, name || null, await hashPassword(newToken()), clientId]
  );

  const again = await database.query(
    `SELECT id FROM accounts
      WHERE client_id = $1 AND kind = 'client'
      ORDER BY created_at LIMIT 1`,
    [clientId]
  );
  if (!again.rows[0]) {
    throw new ConsentError(
      "Could not open a portal account to attribute this consent.",
      { status: 500, code: "account_provision_failed" }
    );
  }
  return again.rows[0].id;
}

function tokenFrom(req) {
  const q = req.query || {};
  const body = req.body || {};
  return {
    orgId: q.org || body.org || null,
    clientId: q.client || body.client || null,
    exp: q.exp || body.exp || null,
    sig: q.sig || body.sig || null
  };
}

/** Store EIN as XX-XXXXXXX. Accepts 9 digits or XX-XXXXXXX. */
export function normalizeSoftPullEin(raw) {
  const digits = String(raw == null ? "" : raw).replace(/\D/g, "");
  if (digits.length !== 9) return null;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

/** YYYY-MM or YYYY-MM-DD. No invented day. Invalid or empty → null. */
export function parseIncorporatedDate(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (/^\d{4}-\d{2}$/.test(s)) {
    const y = Number(s.slice(0, 4));
    const m = Number(s.slice(5, 7));
    if (y < 1800 || y > 2100 || m < 1 || m > 12) return null;
    return s;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const y = Number(s.slice(0, 4));
    const m = Number(s.slice(5, 7));
    const d = Number(s.slice(8, 10));
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (
      dt.getUTCFullYear() !== y
      || dt.getUTCMonth() + 1 !== m
      || dt.getUTCDate() !== d
      || y < 1800
      || y > 2100
    ) {
      return null;
    }
    return s;
  }
  return null;
}

/** Months from the stored date to `now`. Future or bad date → null. No default age. */
export function ageMonthsFromIncorporated(raw, now = new Date()) {
  const parsed = parseIncorporatedDate(raw);
  if (!parsed) return null;
  const y = Number(parsed.slice(0, 4));
  const m = Number(parsed.slice(5, 7));
  const day = parsed.length >= 10 ? Number(parsed.slice(8, 10)) : 1;
  const months =
    (now.getUTCFullYear() - y) * 12
    + (now.getUTCMonth() + 1 - m)
    - (now.getUTCDate() < day ? 1 : 0);
  if (!Number.isFinite(months) || months < 0) return null;
  return months;
}

/** Parse 0–20 businesses: name + street + city + state + ZIP + EIN + incorporated date; extra owner optional. */
export function parseSoftPullBusinesses(raw) {
  if (raw == null || raw === "") return [];
  if (!Array.isArray(raw)) {
    const err = new ConsentError("Businesses must be a list.", {
      status: 400,
      code: "businesses_invalid"
    });
    throw err;
  }
  if (raw.length > SOFT_PULL_MAX_BUSINESSES) {
    throw new ConsentError("That's too many businesses for this form.", {
      status: 400,
      code: "businesses_max"
    });
  }
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i] || {};
    const name = String(row.name || "").trim();
    const line1 = String(row.address_line1 || "").trim();
    const city = String(row.city || "").trim();
    const state = String(row.state || "").trim().toUpperCase();
    const postal = String(row.postal_code || "").trim();
    const extraOwner = String(row.extra_owner_name || "").trim();
    const ein = normalizeSoftPullEin(row.ein);
    const incorporated = parseIncorporatedDate(row.incorporated_date);
    if (!name && !line1 && !city && !state && !postal && !row.ein && !extraOwner && !row.incorporated_date) continue;
    if (!name || name.length < 2) {
      throw new ConsentError(`Business ${i + 1}: enter the business name.`, {
        status: 400,
        code: "business_name_required"
      });
    }
    if (!line1 || !city || !/^[A-Z]{2}$/.test(state) || !postal) {
      throw new ConsentError(
        `Business ${i + 1}: enter street, city, state, and ZIP.`,
        { status: 400, code: "business_address_required" }
      );
    }
    if (!ein) {
      throw new ConsentError(
        `Business ${i + 1}: enter the 9-digit EIN.`,
        { status: 400, code: "business_ein_required" }
      );
    }
    if (!incorporated) {
      throw new ConsentError(
        `Business ${i + 1}: enter when this business was incorporated (month and year).`,
        { status: 400, code: "business_incorporated_required" }
      );
    }
    const ageMonths = ageMonthsFromIncorporated(incorporated);
    if (ageMonths == null) {
      throw new ConsentError(
        `Business ${i + 1}: the incorporation date cannot be in the future.`,
        { status: 400, code: "business_incorporated_invalid" }
      );
    }
    out.push({
      name,
      address_line1: line1,
      city,
      state,
      postal_code: postal,
      ein,
      extra_owner_name: extraOwner || null,
      incorporated_date: incorporated,
      age_months: ageMonths
    });
  }
  return out;
}

export async function replaceSoftPullBusinesses(database, { orgId, clientId, businesses }) {
  await database.query(
    `DELETE FROM businesses
      WHERE org_id = $1 AND client_id = $2
        AND COALESCE(entity_data->>'source', '') = $3`,
    [orgId, clientId, BIZ_SOURCE]
  );
  for (const b of businesses) {
    await database.query(
      `INSERT INTO businesses (org_id, client_id, name, age_months, entity_data)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        orgId,
        clientId,
        b.name,
        b.age_months,
        JSON.stringify({
          source: BIZ_SOURCE,
          address_line1: b.address_line1,
          city: b.city,
          state: b.state,
          postal_code: b.postal_code,
          ein: b.ein,
          extra_owner_name: b.extra_owner_name || null,
          incorporated_date: b.incorporated_date || null
        })
      ]
    );
  }
}

/**
 * Reuse an open diagnostic link at the exact total, or expire wrong-amount
 * open diagnostic links and mint a new one.
 */
export async function ensureSoftPullCheckout(database, {
  orgId, clientId, amountCents, description, env, checkoutBaseUrl, fetchImpl
}) {
  const existing = await database.query(
    `SELECT * FROM payment_links
      WHERE org_id = $1 AND client_id = $2 AND purpose = 'diagnostic'
        AND status = ANY($3) AND amount_cents = $4
      ORDER BY created_at DESC
      LIMIT 1`,
    [orgId, clientId, OPEN, amountCents]
  );
  if (existing.rows[0]) {
    const row = existing.rows[0];
    if (row.status === "created") {
      const sent = await markSent(database, { id: row.id, orgId });
      return sent || row;
    }
    return row;
  }

  const wrong = await database.query(
    `SELECT id FROM payment_links
      WHERE org_id = $1 AND client_id = $2 AND purpose = 'diagnostic'
        AND status = ANY($3) AND amount_cents <> $4`,
    [orgId, clientId, OPEN, amountCents]
  );
  for (const row of wrong.rows) {
    await markExpired(database, { id: row.id, orgId });
  }

  const offer = getOffer("SOFT_PULL");
  const link = await createPaymentLink(database, {
    orgId,
    clientId,
    purpose: "diagnostic",
    description: description || offer?.name || "UnderwriteIQ soft-pull assessment",
    commasProductTitle: offer?.commasProductTitle || "Consulting Services Assessment",
    amountCents,
    productCode: offer?.productCode || "diagnostic",
    checkoutBaseUrl,
    env,
    fetchImpl
  });
  const sent = await markSent(database, { id: link.id, orgId });
  return sent || link;
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;

  try {
    const raw = tokenFrom(req);
    if (!isUuid(raw.orgId) || !isUuid(raw.clientId)) {
      return res.status(400).json({ ok: false, error: "bad_token", message: "This link is missing required fields." });
    }

    const verified = verifySoftPullApproveToken({
      orgId: String(raw.orgId).trim(),
      clientId: String(raw.clientId).trim(),
      exp: raw.exp,
      sig: raw.sig,
      secret: deps.secret,
      now: deps.now
    });
    if (!verified) {
      return res.status(401).json({
        ok: false,
        error: "invalid_or_expired",
        message: "This approval link is invalid or has expired. Ask your advisor to send a new one."
      });
    }

    const { orgId, clientId } = verified;

    const clientRes = await database.query(
      `SELECT id, first_name, last_name, email
         FROM clients WHERE id = $1 AND org_id = $2`,
      [clientId, orgId]
    );
    const client = clientRes.rows[0];
    if (!client) {
      return res.status(404).json({ ok: false, error: "not_found", message: "This contact was not found." });
    }

    const disclosure = SOFT_PULL_DISCLOSURES[CURRENT_SOFT_PULL_VERSION];
    const status = await consentStatus(database, { orgId, clientId, kind: KIND });
    const pricing = softPullPricingPublic();

    if (req.method === "GET") {
      return res.status(200).json({
        ok: true,
        kind: KIND,
        version: CURRENT_SOFT_PULL_VERSION,
        disclosure: {
          version: disclosure.version,
          text: disclosure.text,
          bullets: disclosure.bullets || null
        },
        consent: { valid: !!status.valid, reason: status.reason || null },
        pricing,
        contact: {
          first_name: client.first_name || null,
          last_name: client.last_name || null
        }
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ ok: false, error: "method_not_allowed" });
    }

    const body = req.body || {};
    const grantedName = String(body.granted_name || "").trim();
    if (!grantedName || grantedName.length < 2) {
      return res.status(400).json({
        ok: false,
        error: "name_required",
        message: "Type your full legal name to approve the soft pull."
      });
    }

    const ssn = String(body.ssn || "").replace(/\D/g, "");
    if (ssn.length !== 9) {
      return res.status(400).json({
        ok: false,
        error: "ssn_required",
        message: "Enter a valid 9-digit Social Security number."
      });
    }

    const dob = String(body.dob || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      return res.status(400).json({
        ok: false,
        error: "dob_required",
        message: "Enter your date of birth as YYYY-MM-DD."
      });
    }

    const line1 = String(body.address_line1 || "").trim();
    const city = String(body.city || "").trim();
    const state = String(body.state || "").trim().toUpperCase();
    const postal = String(body.postal_code || "").trim();
    if (!line1 || !city || !/^[A-Z]{2}$/.test(state) || !postal) {
      return res.status(400).json({
        ok: false,
        error: "address_required",
        message: "Enter your current street address, city, state, and ZIP."
      });
    }

    let businesses;
    try {
      businesses = parseSoftPullBusinesses(body.businesses);
    } catch (e) {
      if (e instanceof ConsentError) {
        return res.status(e.status || 400).json({
          ok: false,
          error: e.code || "bad_request",
          message: e.message
        });
      }
      throw e;
    }

    const amountCents = softPullTotalCents(businesses.length);
    const amountDisplay = formatCents(amountCents) || `$${(amountCents / 100).toFixed(0)}`;
    const offer = getOffer("SOFT_PULL");
    const n = businesses.length;
    const description = n > 0
      ? `${offer?.name || "UnderwriteIQ soft-pull assessment"} (+${n} business${n === 1 ? "" : "es"})`
      : (offer?.name || "UnderwriteIQ soft-pull assessment");

    const name = [client.first_name, client.last_name].filter(Boolean).join(" ") || grantedName;
    const accountId = await provisionClientAccount(database, {
      orgId,
      clientId,
      email: client.email,
      name
    });

    await storeIdentity(database, {
      orgId,
      clientId,
      ssn,
      dob,
      addresses: [{
        addressLine1: line1,
        city,
        state,
        postalCode: postal
      }],
      env
    });

    await replaceSoftPullBusinesses(database, { orgId, clientId, businesses });

    const consent = await captureConsent(database, {
      orgId,
      clientId,
      kind: KIND,
      consentText: disclosure.text,
      consentVersion: CURRENT_SOFT_PULL_VERSION,
      captureMethod: "typed",
      grantedName,
      grantedBy: { kind: "client", id: accountId },
      capturedIp: clientIp(req),
      capturedUserAgent: req.headers?.["user-agent"] || null
    });

    let checkout = null;
    let checkoutError = null;
    try {
      const link = await ensureSoftPullCheckout(database, {
        orgId,
        clientId,
        amountCents,
        description,
        env,
        checkoutBaseUrl: deps.checkoutBaseUrl,
        fetchImpl: deps.fetchImpl
      });
      checkout = {
        id: link.id,
        checkout_url: link.checkout_url,
        amount_cents: Number(link.amount_cents),
        amount_display: formatCents(link.amount_cents) || amountDisplay
      };
    } catch (err) {
      checkoutError = String(err && err.message ? err.message : err).slice(0, 160);
    }

    return res.status(201).json({
      ok: true,
      consent: { id: consent.id, valid: true, version: CURRENT_SOFT_PULL_VERSION },
      businesses: { count: n },
      pricing: { ...pricing, total_cents: amountCents, total_display: amountDisplay },
      checkout,
      checkout_error: checkoutError,
      next: checkout?.checkout_url
        ? `Pay ${amountDisplay} next — use the Pay button below.`
        : `Consent saved. Ask your advisor for the ${amountDisplay} pay link.`
    });
  } catch (err) {
    if (err instanceof ConsentError || err instanceof PiiError) {
      return res.status(err.status || 400).json({
        ok: false,
        error: err.code || "bad_request",
        message: err.message
      });
    }
    return dbDown(res, err);
  }
}

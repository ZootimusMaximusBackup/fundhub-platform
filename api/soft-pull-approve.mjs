// /api/soft-pull-approve — client-facing soft-pull approval (signed link).
//
//   GET  ?org=&client=&exp=&sig=  → disclosure + client first name + whether consent already valid
//   POST { org, client, exp, sig, granted_name, ssn, dob, address_line1, city, state, postal_code }
//        → capture soft_pull_consent + store identity; no session required
//
// COMPLIANCE REVIEW REQUIRED — consent capture, credit-pull identity (SSN).
// The consent TEXT is never taken from the body — only the version key, then
// the server copies its own words (same rule as api/consent/capture.mjs).

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

const KIND = "soft_pull_consent";

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

    return res.status(201).json({
      ok: true,
      consent: { id: consent.id, valid: true, version: CURRENT_SOFT_PULL_VERSION },
      next: "Pay the $32 assessment next — your advisor sends that link separately."
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

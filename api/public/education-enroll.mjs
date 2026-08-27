// POST /api/public/education-enroll — the /education/enroll/ form, made real.
//
// WHAT THIS REPLACES. The enrollment page used to save nothing at all. Its
// script held `var WEBHOOK = ''` and only posted when that string began with
// "http"; a bare setTimeout then hid the form and showed "You're enrolled in
// the queue". No row, no lead, no email. This handler is where that form now
// actually lands.
//
// Shape, body parsing and error handling copied from api/public/survey-submit.mjs,
// which is the house pattern for a public capture endpoint.
//
// NO AUTH. Same class as survey-submit: a stranger on a marketing page has no
// session. It is write-only — it never reads anyone else's enrollment back.
//
// NO EMAIL AND NO OUTBOUND FETCH. Outbound transmission is permitted in
// src/messaging/providers/* and nowhere else (CLAUDE.md §12). A person is
// contacted by a human working the row this writes.
//
// NO EVENT IS EMITTED, deliberately. src/events/canonical.mjs has no name for
// an education enrollment. The nearest fit, entry.captured, is the funding
// pipeline's front door: it triggers s-01 new-lead intake, s-02 incomplete
// survey nudge, n-01 cold nurture and at-01 first-touch capture, so emitting it
// here would chase an education buyer for a funding survey they never started.
// A canonical name is not invented and allowNonCanonical is not passed.

import { db } from "../../src/db.mjs";
import { defaultOrgId } from "../../src/events/bus.mjs";
import { resolveClient } from "../../src/handlers/client-lifecycle.mjs";
import { safeError } from "../../src/http/health.mjs";
import { createEnrollment, isProgram, EnrollmentError } from "../../src/education/enrollments.mjs";
import { normalizePhone } from "../../src/messaging/providers/bland-voice.mjs";

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

/** Pure validation. Exported for unit tests. */
export function parseEducationEnrollBody(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_json" };

  const program = cleanStr(body.program, 60);
  const name = cleanStr(body.full_name || body.name, 120);
  const email = cleanStr(body.email, 160).toLowerCase();
  const rawPhone = cleanStr(body.phone || body.mobile, 40);
  const phone = normalizePhone(rawPhone) || rawPhone;
  const pageUrl = cleanStr(body.page_url, 500);

  if (!isProgram(program)) return { ok: false, error: "unknown_program" };
  if (!name) return { ok: false, error: "name_required" };
  if (!isEmail(email)) return { ok: false, error: "email_required" };

  return {
    ok: true,
    program,
    name,
    email,
    phone,
    page_url: pageUrl,
    sms_consent: !!body.sms_consent
  };
}

/** Find-or-create the person behind the request. Never throws: a request that
 *  cannot resolve a client must still be STORED rather than 500 — losing the
 *  row is the exact failure this endpoint exists to end. */
async function resolveEnrollClient(database, parsed, deps = {}) {
  const resolve = deps.resolveClient || resolveClient;
  const orgOf = deps.defaultOrgId || defaultOrgId;
  try {
    const orgId = deps.orgId || (await orgOf(database));
    if (!orgId) return null;
    return await resolve(database, {
      orgId,
      payload: {
        email: parsed.email,
        name: parsed.name,
        phone: parsed.phone,
        source: "website:education-enroll"
      }
    });
  } catch {
    return null;
  }
}

/** Resolve the client, then write the row. `deps` injectable for tests. */
export async function runEducationEnroll(parsed, deps = {}) {
  const database = deps.db || db;
  const orgOf = deps.defaultOrgId || defaultOrgId;

  const orgId = deps.orgId || (await orgOf(database));
  if (!orgId) throw new EnrollmentError("org_required");

  const clientId = await resolveEnrollClient(database, parsed, { ...deps, orgId });

  const row = await createEnrollment(database, {
    orgId,
    clientId,
    program: parsed.program,
    fullName: parsed.name,
    email: parsed.email,
    phone: parsed.phone,
    smsConsent: parsed.sms_consent,
    pageUrl: parsed.page_url
  });

  // The id is returned so a support person can be pointed at one row. Nothing
  // about it is a credential and it grants access to nothing.
  return { ok: true, id: row.id, status: row.status, clientId };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const parsed = parseEducationEnrollBody(readBody(req));
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  try {
    const result = await runEducationEnroll(parsed);
    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof EnrollmentError) {
      return res.status(400).json({ ok: false, error: err.code });
    }
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}

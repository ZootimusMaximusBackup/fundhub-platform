// POST /api/public/survey-submit — homepage (and later) multi-step survey capture.
// Emits entry.captured + survey.submitted, then returns classifySurvey redirect.

import { db } from "../../src/db.mjs";
import { emit } from "../../src/events/bus.mjs";
import { ensureRegistered } from "../../src/register-all.mjs";
import { classifySurvey } from "../../src/config/survey-qualification.mjs";
import { SURVEY_REDIRECTS } from "../../src/config/homepage-survey-steps.mjs";
import { safeError } from "../../src/http/health.mjs";

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

/** Pure validation + answer filter. Exported for unit tests. */
export function parseSurveySubmitBody(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_json" };

  const name = cleanStr(body.name || body.full_name, 120);
  const email = cleanStr(body.email, 160).toLowerCase();
  const phone = cleanStr(body.phone || body.mobile, 40);
  const business = cleanStr(body.business || body.business_name, 160);
  const source = cleanStr(body.source, 80) || "website:home";
  const answersIn = body.answers && typeof body.answers === "object" ? body.answers : {};

  if (!name || !isEmail(email) || !phone) {
    return { ok: false, error: "name_email_phone_required" };
  }

  const answers = {};
  for (const [k, v] of Object.entries(answersIn)) {
    if (!k.startsWith("cf_svy_")) continue;
    if (v == null || v === "") continue;
    answers[k] = v;
  }

  return {
    ok: true,
    name,
    email,
    phone,
    business,
    source,
    sms_consent: !!body.sms_consent,
    answers,
  };
}

/** Emit + classify. `deps.emit` injectable for tests. */
export async function runSurveySubmit(parsed, deps = {}) {
  const emitFn = deps.emit || emit;
  const database = deps.db || db;
  const ensure = deps.ensureRegistered || ensureRegistered;

  ensure();
  const idemBase = `website-survey:${parsed.email}:${Date.now()}`;
  const entryPayload = {
    email: parsed.email,
    name: parsed.name,
    phone: parsed.phone,
    business: parsed.business,
    source: parsed.source,
    sms_consent: parsed.sms_consent,
  };
  const entry = await emitFn(database, "entry.captured", entryPayload, {
    idempotencyKey: `${idemBase}:entry`,
  });
  const survey = await emitFn(
    database,
    "survey.submitted",
    {
      email: parsed.email,
      name: parsed.name,
      phone: parsed.phone,
      business: parsed.business,
      source: parsed.source,
      answers: parsed.answers,
    },
    { idempotencyKey: `${idemBase}:survey` }
  );

  const qualification = classifySurvey(parsed.answers);
  const redirect = SURVEY_REDIRECTS[qualification] || SURVEY_REDIRECTS.MANUAL_REVIEW;

  return {
    ok: true,
    qualification,
    redirect,
    deduped: !!(entry.deduped || survey.deduped),
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const parsed = parseSurveySubmitBody(readBody(req));
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  try {
    const result = await runSurveySubmit(parsed);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}

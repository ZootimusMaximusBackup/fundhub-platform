#!/usr/bin/env node
/** Fill prove-client survey, then fire every Present-deck send against live fundhub.ai. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const CLIENT_ID = "9af65808-a619-4e65-ae91-239766a006b7";
const EMAIL = "stanbridgejchris@gmail.com";
const PHONE = "+16616180865";
const BASE = "https://fundhub.ai";

const SURVEY = {
  cf_svy_funding_target_amount: "$50k - $100k",
  cf_svy_planned_use: "Equipment or buildout",
  cf_svy_money_change_now: [
    "Peace of mind (stop stressing about cash)",
    "Grow faster (more customers / more reach)"
  ],
  cf_svy_self_reported_fico: "500-579",
  cf_svy_self_reported_fico_label: "500-579",
  cf_svy_has_business: "Yes, 1-2 years",
  cf_svy_business_revenue: "$100k - $249k",
  cf_svy_revenue_verifiable: "Yes, bank statements",
  cf_svy_available_capital: "$1k - $5k",
  business_name: "ProveFunding"
};

function loadEnv() {
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] == null) process.env[k] = v;
  }
}

function redactUrl(u) {
  if (!u) return null;
  try {
    const x = new URL(u);
    return x.origin + x.pathname.replace(/[A-Za-z0-9_-]{8,}/g, "…");
  } catch {
    return "(url)";
  }
}

async function fillSurvey(db) {
  const { mergeCustomFields } = await import("../src/workflows/custom-fields.mjs");
  const { upsertSurveyCarbonCopy } = await import("../src/handlers/client-custom-fields.mjs");

  await db.query(
    `UPDATE clients
        SET email = $2, phone = $3,
            custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $4::jsonb
      WHERE id = $1 AND org_id = $5`,
    [CLIENT_ID, EMAIL, PHONE, JSON.stringify(SURVEY), ORG]
  );
  await mergeCustomFields(db, CLIENT_ID, SURVEY);
  const written = await upsertSurveyCarbonCopy(db, { clientId: CLIENT_ID, orgId: ORG, answers: SURVEY });

  try {
    const biz = await db.query(
      `SELECT id FROM businesses WHERE client_id = $1 AND org_id = $2 LIMIT 1`,
      [CLIENT_ID, ORG]
    );
    if (biz.rows[0]) {
      await db.query(`UPDATE businesses SET name = $2 WHERE id = $1`, [biz.rows[0].id, "ProveFunding"]);
    }
  } catch {
    /* businesses has extra required keys — survey business_name on the client is enough */
  }

  const row = (await db.query(
    `SELECT email, phone, custom_fields->>'cf_svy_planned_use' AS use,
            custom_fields->>'cf_svy_funding_target_amount' AS target
       FROM clients WHERE id = $1`,
    [CLIENT_ID]
  )).rows[0];
  const typed = (await db.query(
    `SELECT cf_svy_has_business, cf_svy_available_capital FROM client_custom_fields WHERE client_id = $1`,
    [CLIENT_ID]
  )).rows[0];
  return { written: written.written, email: row.email, phone: row.phone, use: row.use, target: row.target, typed };
}

async function login() {
  const password = process.env.STAFF_E2E_PASSWORD || process.env.STAFF_INITIAL_PASSWORD;
  if (!password) throw new Error("STAFF_E2E_PASSWORD missing");
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ email: "chris@fundhub.ai", password })
  });
  const json = await r.json().catch(() => ({}));
  const token = json.token || json.session?.token || json.data?.token;
  if (!r.ok || !token) {
    return { ok: false, status: r.status, error: json.error || json.message || "login_failed" };
  }
  return { ok: true, token };
}

async function deck(token, body) {
  const r = await fetch(`${BASE}/api/closer-deck`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ client_id: CLIENT_ID, ...body })
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok && json.ok === true, json };
}

async function headOk(url) {
  if (!url) return { ok: false, status: 0 };
  try {
    const r = await fetch(url, { method: "GET", redirect: "manual" });
    return { ok: r.status >= 200 && r.status < 400, status: r.status };
  } catch (e) {
    return { ok: false, status: 0, error: String(e.message || e).slice(0, 80) };
  }
}

async function main() {
  loadEnv();
  const skipFill = process.argv.includes("--sends-only");
  process.env.ADAPTERS_DRY_RUN = process.env.ADAPTERS_DRY_RUN || "0";
  process.env.MESSAGING_DRY_RUN = process.env.MESSAGING_DRY_RUN || "0";

  const { db, pool } = await import("../src/db.mjs");
  const report = { survey: skipFill ? { skipped: true } : null, login: null, actions: [] };

  try {
    if (!skipFill) report.survey = await fillSurvey(db);
    const auth = await login();
    report.login = { ok: auth.ok, status: auth.status || 200, error: auth.error || null };
    if (!auth.ok) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    const actions = [
      { name: "send_soft_pull", body: { action: "send_soft_pull" } },
      { name: "send_ebook_$1", body: { action: "send_ebook", amount_cents: 100, description: "Prove e-book $1" } },
      { name: "send_pay_link_repair_trial", body: { action: "send_pay_link", offer_key: "REPAIR_TRIAL" } },
      { name: "generate_letters_repair", body: { action: "generate_letters", offer_key: "REPAIR_DFY", tier: "REPAIR_ONLY", force_repair: true } },
      { name: "log_disposition", body: { action: "log_disposition", offer_key: "REPAIR_TRIAL", route: "DESCENT", temperature: 8, beliefs_count: 2, cost_of_inaction: "$32" } }
    ];

    for (const a of actions) {
      const out = await deck(auth.token, a.body);
      const link = out.json.link || {};
      const email = out.json.email || {};
      const checkout = link.checkout_url || null;
      const href = await headOk(checkout);
      const approve = out.json.approve_url || null;
      const approveHead = await headOk(approve);
      report.actions.push({
        name: a.name,
        http: out.status,
        ok: out.ok,
        error: out.json.error || null,
        message: out.json.message || null,
        email_outcome: email.outcome || email.sent || email.status || null,
        email_detail: email.detail ? String(email.detail).slice(0, 80) : null,
        checkout_ok: href.ok,
        checkout_status: href.status,
        approve_ok: approve ? approveHead.ok : null,
        approve_status: approve ? approveHead.status : null,
        checkout: redactUrl(checkout),
        approve: redactUrl(approve),
        letterCount: out.json.letterCount ?? null,
        delivered: out.json.delivered ?? null
      });
    }

    const msgs = (await db.query(
      `SELECT channel, status, provider, subject, last_error, created_at
         FROM messages
        WHERE client_id = $1 AND created_at > now() - interval '20 minutes'
        ORDER BY created_at DESC LIMIT 12`,
      [CLIENT_ID]
    )).rows.map((m) => ({
      channel: m.channel,
      status: m.status,
      provider: m.provider,
      subject: m.subject,
      last_error: m.last_error ? String(m.last_error).slice(0, 80) : null,
      created_at: m.created_at
    }));
    report.recent_messages = msgs;
    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    report.crash = String(err && err.message ? err.message : err).slice(0, 200);
    console.log(JSON.stringify(report, null, 2));
    throw err;
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e.message || e).slice(0, 200) }));
  process.exit(1);
});

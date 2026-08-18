/**
 * G3 read-only DB snapshot. Evidence only. Never prints secrets or PII values.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-gaps-2026-08-18-evidence/g3");
const TEST_CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadDotEnv();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
fs.mkdirSync(OUT, { recursive: true });

const inboxSet = !!String(process.env.FUNDHUB_TEST_INBOX || "").trim();
const phoneSet = !!String(process.env.FUNDHUB_TEST_PHONE || "").trim();
const inbox = String(process.env.FUNDHUB_TEST_INBOX || "").trim();
const phone = String(process.env.FUNDHUB_TEST_PHONE || "").trim();

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

async function q(label, sql, params = []) {
  try {
    const r = await c.query(sql, params);
    return { ok: true, n: r.rows.length, rows: r.rows };
  } catch (err) {
    return { ok: false, error: String(err.message || err).slice(0, 220) };
  }
}

const out = {
  at: new Date().toISOString(),
  test_client: TEST_CLIENT,
  opened_forbidden: false,
  env_names: {
    FUNDHUB_TEST_INBOX: inboxSet,
    FUNDHUB_TEST_PHONE: phoneSet,
    FANBASIS_CHECKOUT_API_KEY: !!String(process.env.FANBASIS_CHECKOUT_API_KEY || "").trim(),
    COMMAS_CHECKOUT_BASE_URL: !!String(process.env.COMMAS_CHECKOUT_BASE_URL || "").trim(),
    STRIPE_keys: Object.keys(process.env).filter((k) => /^STRIPE_/.test(k)).length
  }
};

out.client = await q(
  "client",
  `SELECT id, is_demo,
          CASE WHEN email IS NULL OR email = '' THEN false ELSE true END AS has_email,
          CASE WHEN email IS NULL OR email = '' THEN NULL ELSE split_part(email, '@', 2) END AS email_domain,
          CASE WHEN phone IS NULL OR phone = '' THEN false ELSE true END AS has_phone,
          CASE WHEN phone IS NULL OR phone = '' THEN 0 ELSE length(regexp_replace(phone, '\\D', '', 'g')) END AS phone_digits
     FROM clients WHERE id = $1`,
  [TEST_CLIENT]
);

if (out.client.rows?.[0]) {
  const row = (await c.query(`SELECT email, phone FROM clients WHERE id = $1`, [TEST_CLIENT])).rows[0];
  out.client_dest_match = {
    email_equals_FUNDHUB_TEST_INBOX: !!(inbox && row.email && String(row.email).toLowerCase() === inbox.toLowerCase()),
    phone_equals_FUNDHUB_TEST_PHONE: !!(phone && row.phone && String(row.phone).replace(/\D/g, "") === phone.replace(/\D/g, ""))
  };
}

out.account = await q(
  "account",
  `SELECT id, kind, status, client_id = $1 AS owns_test
     FROM accounts WHERE client_id = $1 AND kind = 'client'`,
  [TEST_CLIENT]
);

out.cards = await q(
  "cards",
  `SELECT id, client_id, stage, board, is_demo, total_funding_estimate
     FROM cards WHERE client_id = $1`,
  [TEST_CLIENT]
);

out.live_board_cards = await q(
  "live_board",
  `SELECT count(*)::int AS n,
          count(*) FILTER (WHERE is_demo IS TRUE)::int AS demo,
          count(*) FILTER (WHERE client_id = $1)::int AS test_client
     FROM cards WHERE board = 'sales' OR board IS NULL`,
  [TEST_CLIENT]
);

out.inquiry_cases = await q(
  "inquiry_cases",
  `SELECT id, case_status, call_fired_at IS NOT NULL AS call_fired,
          first_delivery_at IS NOT NULL AS delivered,
          request_source, created_at
     FROM inquiry_removal_cases WHERE client_id = $1 ORDER BY created_at DESC`,
  [TEST_CLIENT]
);

out.events_inquiry_removed = await q(
  "events_inquiry_removed",
  `SELECT count(*)::int AS n, max(created_at) AS last
     FROM events WHERE name = 'inquiry.removed'`
);

out.events_inquiry_removed_test = await q(
  "events_inquiry_removed_test",
  `SELECT count(*)::int AS n
     FROM events WHERE name = 'inquiry.removed' AND client_id = $1`,
  [TEST_CLIENT]
);

out.events_diagnostic_paid = await q(
  "events_diagnostic_paid",
  `SELECT count(*)::int AS n,
          count(*) FILTER (WHERE client_id IS NULL)::int AS no_client,
          count(*) FILTER (WHERE client_id = $1)::int AS test_client
     FROM events WHERE name IN ('diagnostic.paid', 'payment.received')`,
  [TEST_CLIENT]
);

out.payment_links = await q(
  "payment_links",
  `SELECT id, purpose, status, amount_cents, checkout_url IS NOT NULL AS has_url, created_at
     FROM payment_links WHERE client_id = $1 ORDER BY created_at DESC LIMIT 10`,
  [TEST_CLIENT]
);

out.consents = await q(
  "consents",
  `SELECT id, kind, valid, revoked_at IS NOT NULL AS revoked, capture_method, created_at
     FROM client_consents WHERE client_id = $1 ORDER BY created_at DESC`,
  [TEST_CLIENT]
);

out.contracts = await q(
  "contracts",
  `SELECT id, template_key, status, signed_at IS NOT NULL AS signed
     FROM contracts WHERE client_id = $1 ORDER BY created_at DESC`,
  [TEST_CLIENT]
);

out.documents = await q(
  "documents",
  `SELECT id, kind, status, delivery_status
     FROM documents WHERE client_id = $1 ORDER BY created_at DESC LIMIT 20`,
  [TEST_CLIENT]
);

out.entitlements = await q(
  "entitlements",
  `SELECT code, active FROM entitlements WHERE client_id = $1`,
  [TEST_CLIENT]
);

out.soft_pulls = await q(
  "soft_pulls",
  `SELECT id, status, created_at
     FROM soft_pull_requests WHERE client_id = $1 ORDER BY created_at DESC LIMIT 10`,
  [TEST_CLIENT]
);

out.crs = await q(
  "crs",
  `SELECT id, created_at
     FROM crs_results WHERE client_id = $1 ORDER BY created_at DESC LIMIT 5`,
  [TEST_CLIENT]
);

out.messages_test = await q(
  "messages_test",
  `SELECT id, channel, status, to_address IS NOT NULL AS has_to, created_at
     FROM messages WHERE client_id = $1 ORDER BY created_at DESC LIMIT 15`,
  [TEST_CLIENT]
);

out.tasks_c03 = await q(
  "tasks_c03",
  `SELECT id, title, source_workflow, created_at
     FROM tasks WHERE client_id = $1 AND (source_workflow = 'c-03-inquiry-removed-resume-or-hold' OR title ILIKE '%next funding%')
     ORDER BY created_at DESC LIMIT 10`,
  [TEST_CLIENT]
);

out.forbidden_touched = await q(
  "forbidden",
  `SELECT 1 FROM clients WHERE id = $1`,
  [FORBIDDEN]
);

await c.end();

fs.writeFileSync(path.join(OUT, "db.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  wrote: "g3/db.json",
  cards: out.cards.n,
  inquiry_removed: out.events_inquiry_removed.rows?.[0] || null,
  consents: (out.consents.rows || []).map((r) => r.kind),
  dest_match: out.client_dest_match || null,
  inbox_set: inboxSet,
  phone_set: phoneSet
}, null, 2));

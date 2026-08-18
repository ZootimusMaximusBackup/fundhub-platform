/**
 * W6 read-only DB probe. Evidence only. Prints no secrets, tokens, or full phones.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-crm-whole-2026-08-18-evidence/w6");
const TEST_CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";
const DEMO_PARTNER = "94796e0e-d012-4987-8721-676093aaed79";

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

function last4(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (!d) return null;
  return { last4: d.slice(-4), len: d.length };
}

function maskEmail(email) {
  const s = String(email || "");
  if (!s.includes("@")) return s ? "set" : null;
  const [local, domain] = s.split("@");
  return { domain, local_len: local.length, is_test: /^(client@fundhub\.ai|e2e\+|.*@fundhub\.ai$)/i.test(s) };
}

async function q(c, sql, params = []) {
  try {
    const r = await c.query(sql, params);
    return { ok: true, rows: r.rows, n: r.rowCount };
  } catch (err) {
    return { ok: false, error: String(err.message || err).slice(0, 240) };
  }
}

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
await c.connect();

const out = {
  at: new Date().toISOString(),
  destinations: {
    env_test_inbox: false,
    env_test_phone: false,
    note: "No TEST_INBOX / TEST_PHONE (or similar) in local .env. TWILIO_SEND_FROM is a send-from number, not a destination."
  },
  forbidden_touched: false
};

const tables = await q(c, `
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_type='BASE TABLE'
  ORDER BY 1
`);
out.tables = tables.ok ? tables.rows.map((r) => r.table_name) : { error: tables.error };

async function ifTable(name, fn) {
  if (!out.tables.includes?.(name) && !(Array.isArray(out.tables) && out.tables.includes(name))) {
    return { missing_table: name };
  }
  return fn();
}

const T = Array.isArray(out.tables) ? new Set(out.tables) : new Set();

// --- test client (no PII names) ---
out.test_client = await q(c, `
  SELECT id, email, phone IS NOT NULL AS has_phone,
         length(regexp_replace(coalesce(phone,''),'\\D','','g')) AS phone_digits,
         right(regexp_replace(coalesce(phone,''),'\\D','','g'),4) AS phone_last4,
         ghl_contact_id IS NOT NULL AS has_ghl,
         stage, pipeline_key, archived_at IS NOT NULL AS archived
  FROM clients WHERE id=$1
`, [TEST_CLIENT]);
if (out.test_client.ok) {
  for (const r of out.test_client.rows) r.email = maskEmail(r.email);
}

out.forbidden_guard = await q(c, `SELECT id FROM clients WHERE id=$1`, [FORBIDDEN]);

// --- messages / dispatcher ---
out.messages_by_status = T.has("messages")
  ? await q(c, `SELECT status, channel, count(*)::int AS n FROM messages GROUP BY 1,2 ORDER BY 3 DESC`)
  : { missing_table: "messages" };

out.messages_queued_sample = T.has("messages")
  ? await q(c, `
      SELECT id, status, channel, template_key, provider,
             to_address IS NOT NULL AS has_to,
             created_at, sent_at
      FROM messages
      WHERE status IN ('queued','held','failed','sending')
      ORDER BY created_at DESC NULLS LAST
      LIMIT 25
    `)
  : { missing_table: "messages" };

out.messaging_settings = T.has("messaging_settings")
  ? await q(c, `SELECT outbound_enabled, daily_cap, updated_at FROM messaging_settings`)
  : { missing_table: "messaging_settings" };

out.channel_routing = T.has("message_channel_routing")
  ? await q(c, `SELECT channel, provider, enabled FROM message_channel_routing ORDER BY 1`)
  : { missing_table: "message_channel_routing" };

// templates
out.templates = T.has("message_templates")
  ? await q(c, `
      SELECT template_key, channel, subject,
             (body ILIKE '%lorem ipsum%' OR coalesce(subject,'') ILIKE '%lorem ipsum%') AS lorem,
             length(coalesce(body,'')) AS body_len,
             compliance_passed, approved_at IS NOT NULL AS approved
      FROM message_templates
      ORDER BY template_key
    `)
  : { missing_table: "message_templates" };

if (out.templates.ok) {
  out.template_count = out.templates.n;
  out.templates_lorem = out.templates.rows.filter((r) => r.lorem).map((r) => r.template_key);
  const cats = {};
  for (const r of out.templates.rows) {
    const m = String(r.template_key || "").match(/^(SMS|EMAIL)-([A-Z0-9]+)/);
    const cat = m ? `${m[1]}-${m[2]}` : "other";
    cats[cat] = (cats[cat] || 0) + 1;
  }
  out.template_categories = cats;
}

// --- contracts ---
out.test_contracts = T.has("contracts")
  ? await q(c, `
      SELECT id, status, template_key, sent_at, signed_at, voided_at
      FROM contracts WHERE client_id=$1
      ORDER BY created_at DESC NULLS LAST
      LIMIT 20
    `, [TEST_CLIENT])
  : { missing_table: "contracts" };

// --- inquiry ---
out.test_inquiry_cases = T.has("inquiry_removal_cases")
  ? await q(c, `
      SELECT id, case_status, call_fired_at, call_due_at, selected_bureaus_raw, created_at
      FROM inquiry_removal_cases WHERE client_id=$1
      ORDER BY created_at DESC NULLS LAST
      LIMIT 20
    `, [TEST_CLIENT])
  : { missing_table: "inquiry_removal_cases" };

// --- pipeline reconcile ---
out.pipeline_cards = T.has("clients")
  ? await q(c, `
      SELECT coalesce(pipeline_key,'?') AS pipeline_key,
             coalesce(stage,'?') AS stage,
             count(*)::int AS n,
             count(*) FILTER (WHERE archived_at IS NULL)::int AS live
      FROM clients
      GROUP BY 1,2
      ORDER BY 1,2
    `)
  : { missing_table: "clients" };

out.pipeline_est = T.has("clients")
  ? await q(c, `
      SELECT column_name FROM information_schema.columns
      WHERE table_name='clients' AND column_name ~* 'est|amount|funded|draw'
    `)
  : null;

// --- products ---
out.products = T.has("products")
  ? await q(c, `
      SELECT id, name, pricing_model, price_cents, default_success_fee_percent, active
      FROM products ORDER BY sort_order NULLS LAST, name
    `)
  : { missing_table: "products" };

// --- staff / closers ---
out.staff_counts = T.has("staff")
  ? await q(c, `
      SELECT role, status, count(*)::int AS n
      FROM staff GROUP BY 1,2 ORDER BY 1,2
    `)
  : { missing_table: "staff" };

out.closer_active = T.has("staff")
  ? await q(c, `
      SELECT id, role, status,
             (lower(coalesce(name,'')) LIKE 'test%' OR lower(coalesce(email,'')) LIKE 'test%') AS looks_test
      FROM staff WHERE role ILIKE '%closer%'
    `)
  : { missing_table: "staff" };
if (out.closer_active.ok) {
  for (const r of out.closer_active.rows) {
    delete r.name;
    delete r.email;
  }
}

// --- agents ---
out.agents = T.has("agents")
  ? await q(c, `
      SELECT code, name, mode, channel,
             (prompt IS NULL OR length(trim(prompt))=0) AS empty_prompt,
             owner_label
      FROM agents ORDER BY code
    `)
  : T.has("ai_agents")
    ? await q(c, `
        SELECT code, name, mode, channel,
               (prompt IS NULL OR length(trim(prompt))=0) AS empty_prompt
        FROM ai_agents ORDER BY code
      `)
    : { missing_table: "agents" };

// --- hiring ---
out.hiring_candidates = T.has("hiring_candidates")
  ? await q(c, `SELECT count(*)::int AS n, count(*) FILTER (WHERE status='open')::int AS open FROM hiring_candidates`)
  : T.has("candidates")
    ? await q(c, `SELECT count(*)::int AS n FROM candidates`)
    : { missing_table: "hiring_candidates" };

out.hiring_applications = T.has("hiring_applications")
  ? await q(c, `SELECT status, count(*)::int AS n FROM hiring_applications GROUP BY 1`)
  : { missing_table: "hiring_applications" };

// --- lenders ---
out.lenders = T.has("lenders")
  ? await q(c, `SELECT count(*)::int AS n, count(*) FILTER (WHERE active)::int AS active FROM lenders`)
  : { missing_table: "lenders" };

// --- payments ---
out.payment_links = T.has("payment_links")
  ? await q(c, `
      SELECT id, client_id, purpose, status, amount_cents, checkout_url IS NOT NULL AS has_url, created_at
      FROM payment_links
      WHERE client_id=$1 OR client_id IS NULL
      ORDER BY created_at DESC NULLS LAST
      LIMIT 15
    `, [TEST_CLIENT])
  : { missing_table: "payment_links" };

out.sales_test = T.has("sales")
  ? await q(c, `
      SELECT id, product_id, status, agreed_price, agreed_success_fee_percent, sold_at
      FROM sales WHERE client_id=$1
      ORDER BY sold_at DESC NULLS LAST LIMIT 10
    `, [TEST_CLIENT])
  : { missing_table: "sales" };

out.invoices_test = T.has("invoices")
  ? await q(c, `
      SELECT id, status, amount_cents, balance_due, provider, created_at
      FROM invoices WHERE client_id=$1
      ORDER BY created_at DESC NULLS LAST LIMIT 10
    `, [TEST_CLIENT])
  : { missing_table: "invoices" };

out.commas_inbox = T.has("commas_inbox")
  ? await q(c, `SELECT count(*)::int AS n, max(created_at) AS last_at FROM commas_inbox`)
  : { missing_table: "commas_inbox" };

// --- inbound webhook-ish tables ---
const inboundNames = [
  "webhook_events", "webhook_deliveries", "inbound_webhooks",
  "bland_calls", "bland_webhooks", "call_logs", "voice_calls",
  "postgrid_events", "letter_mailings", "mail_letters",
  "plaid_items", "bank_accounts",
  "ghl_contacts", "ghl_webhooks",
  "clickfunnels_events", "calcom_bookings", "appointments"
];
out.inbound = {};
for (const name of inboundNames) {
  if (!T.has(name)) {
    out.inbound[name] = { missing_table: true };
    continue;
  }
  out.inbound[name] = await q(c, `SELECT count(*)::int AS n, max(created_at) AS last_at FROM ${name}`);
}

// events table if present
if (T.has("events")) {
  out.events_by_type = await q(c, `
    SELECT type, count(*)::int AS n, max(created_at) AS last_at
    FROM events
    WHERE type ILIKE '%webhook%' OR type ILIKE '%bland%' OR type ILIKE '%postgrid%'
       OR type ILIKE '%plaid%' OR type ILIKE '%ghl%' OR type ILIKE '%payment%'
       OR type ILIKE '%commas%' OR type ILIKE '%clickfunnel%'
    GROUP BY 1 ORDER BY 2 DESC
    LIMIT 40
  `);
}

if (T.has("failed_events")) {
  out.failed_events = await q(c, `
    SELECT source, count(*)::int AS n, max(created_at) AS last_at
    FROM failed_events GROUP BY 1 ORDER BY 2 DESC LIMIT 20
  `);
}

// proxy
out.proxy_sessions = T.has("proxy_sessions")
  ? await q(c, `SELECT count(*)::int AS n, max(created_at) AS last_at FROM proxy_sessions`)
  : { missing_table: "proxy_sessions" };

// client account
out.test_account = T.has("accounts")
  ? await q(c, `
      SELECT id, kind, status, client_id, email
      FROM accounts
      WHERE client_id=$1 OR lower(email)='client@fundhub.ai'
    `, [TEST_CLIENT])
  : { missing_table: "accounts" };
if (out.test_account.ok) {
  for (const r of out.test_account.rows) r.email = maskEmail(r.email);
}

// demo agents / e2e clients
out.e2e_clients = T.has("clients")
  ? await q(c, `
      SELECT id, email, phone IS NOT NULL AS has_phone,
             right(regexp_replace(coalesce(phone,''),'\\D','','g'),4) AS phone_last4,
             archived_at IS NOT NULL AS archived, stage
      FROM clients
      WHERE email ILIKE 'e2e+%' OR email ILIKE 'e2e+aff-%' OR email ILIKE 'e2e+wl-%'
      ORDER BY created_at DESC NULLS LAST
      LIMIT 20
    `)
  : { missing_table: "clients" };
if (out.e2e_clients.ok) {
  for (const r of out.e2e_clients.rows) r.email = maskEmail(r.email);
}

// inngest / tasks
out.dispatch_tasks = T.has("tasks")
  ? await q(c, `
      SELECT source_workflow, status, count(*)::int AS n, max(created_at) AS last_at
      FROM tasks
      WHERE source_workflow ILIKE '%dispatch%' OR source_workflow ILIKE '%message%'
      GROUP BY 1,2
    `)
  : { missing_table: "tasks" };

await c.end();

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "db.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  wrote: "w6/db.json",
  template_count: out.template_count || null,
  lorem: (out.templates_lorem || []).length,
  messages_status_n: out.messages_by_status.n || null,
  products: out.products.n || null,
  lenders: out.lenders,
  hiring: out.hiring_candidates,
  test_contracts: out.test_contracts.n || null,
  test_cases: out.test_inquiry_cases.n || null,
  agents: out.agents.n || null,
  payment_links: out.payment_links.n || null,
  env_destinations: out.destinations
}, null, 2));

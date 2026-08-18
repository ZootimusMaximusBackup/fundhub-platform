/**
 * W6 follow-up counts with real column names. No secrets / full phones / names.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-crm-whole-2026-08-18-evidence/w6");
const TEST_CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";

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

function maskEmail(email) {
  const s = String(email || "");
  if (!s.includes("@")) return s ? "set" : null;
  const [local, domain] = s.split("@");
  return { domain, local_len: local.length };
}

async function q(c, sql, params = []) {
  try {
    const r = await c.query(sql, params);
    return { ok: true, rows: r.rows, n: r.rowCount };
  } catch (err) {
    return { ok: false, error: String(err.message || err).slice(0, 280) };
  }
}

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
await c.connect();
const out = { at: new Date().toISOString() };

out.test_client = await q(c, `
  SELECT id, email, phone IS NOT NULL AND length(regexp_replace(coalesce(phone,''),'\\D','','g'))>0 AS has_phone,
         length(regexp_replace(coalesce(phone,''),'\\D','','g')) AS phone_digits,
         right(regexp_replace(coalesce(phone,''),'\\D','','g'),4) AS phone_last4,
         ghl_contact_id IS NOT NULL AS has_ghl,
         is_demo, funded, funded_amount, pipeline_ids
  FROM clients WHERE id=$1
`, [TEST_CLIENT]);
if (out.test_client.ok) for (const r of out.test_client.rows) r.email = maskEmail(r.email);

out.client_cards_cols = await q(c, `
  SELECT column_name FROM information_schema.columns
  WHERE table_name='client_cards' ORDER BY ordinal_position
`);

out.pipeline_card_count = await q(c, `
  SELECT count(*)::int AS cards FROM client_cards
`);

out.pipeline_by_stage = await q(c, `
  SELECT p.key AS pipeline_key, s.key AS stage_key, s.name AS stage_name, count(cc.id)::int AS n
  FROM pipeline_stages s
  JOIN pipelines p ON p.id = s.pipeline_id
  LEFT JOIN client_cards cc ON cc.stage_id = s.id
  GROUP BY 1,2,3
  ORDER BY 1,2
`);

out.clients_live = await q(c, `SELECT count(*)::int AS n, count(*) FILTER (WHERE is_demo)::int AS demo FROM clients`);

out.messages_all = await q(c, `
  SELECT status, channel, count(*)::int AS n
  FROM messages GROUP BY 1,2 ORDER BY 3 DESC
`);
out.messages_queued = await q(c, `
  SELECT id, status, channel, template_key, provider, created_at, scheduled_at
  FROM messages
  WHERE status IN ('queued','held','pending','scheduled')
  ORDER BY created_at DESC LIMIT 20
`);
out.messaging_settings = await q(c, `
  SELECT outbound_enabled, daily_send_cap, updated_at FROM messaging_settings
`);

out.products = await q(c, `
  SELECT code, name, price_is_variable, default_price, default_success_fee_percent, active
  FROM products ORDER BY sort_order NULLS LAST, name
`);

out.agents = await q(c, `
  SELECT code, name, status, channel, agent_class,
         (prompt IS NULL OR length(trim(prompt))=0) AS empty_prompt,
         coalesce(jsonb_array_length(trigger_events),0) AS trigger_n,
         owner_label, is_demo IS NOT NULL AS has_demo_col
  FROM agents ORDER BY code
`);
// is_demo may not exist on agents
if (!out.agents.ok) {
  out.agents = await q(c, `
    SELECT code, name, status, channel, agent_class,
           (prompt IS NULL OR length(trim(prompt))=0) AS empty_prompt,
           coalesce(jsonb_array_length(trigger_events),0) AS trigger_n,
           owner_label
    FROM agents ORDER BY code
  `);
}

out.staff = await q(c, `
  SELECT role, status, active, is_demo, count(*)::int AS n
  FROM staff GROUP BY 1,2,3,4 ORDER BY 1,2
`);
out.closers = await q(c, `
  SELECT role, status, active, is_demo,
         (lower(coalesce(name,'')) LIKE 'test%') AS name_starts_test
  FROM staff WHERE lower(role) LIKE '%closer%'
`);

out.payment_links = await q(c, `
  SELECT id, purpose, status, amount_cents, provider,
         checkout_url IS NOT NULL AS has_url, client_id=$1 AS is_test_client, created_at
  FROM payment_links
  ORDER BY created_at DESC LIMIT 15
`, [TEST_CLIENT]);

out.test_contracts = await q(c, `
  SELECT id, status, template_key, title, sent_at, signed_at, voided_at, is_demo
  FROM contracts WHERE client_id=$1
  ORDER BY created_at DESC
`, [TEST_CLIENT]);

out.test_inquiry = await q(c, `
  SELECT id, case_status, call_fired_at, call_due_at, selected_bureaus_raw, ai_call_status, request_source, is_demo
  FROM inquiry_removal_cases WHERE client_id=$1
  ORDER BY created_at DESC
`, [TEST_CLIENT]);

out.candidates = await q(c, `
  SELECT id, is_demo, source, email ILIKE '%e2e%' OR email ILIKE '%demo%' OR email ILIKE '%test%' AS looks_test
  FROM candidates
`);
out.candidate_apps = await q(c, `
  SELECT status, count(*)::int AS n FROM candidate_applications GROUP BY 1
`);

out.webhooks = await q(c, `
  SELECT provider, count(*)::int AS n, max(created_at) AS last_at
  FROM webhook_captures GROUP BY 1 ORDER BY 2 DESC
`);

out.plaid = await q(c, `SELECT count(*)::int AS n, count(*) FILTER (WHERE plaid_item_id IS NOT NULL)::int AS linked FROM plaid_items`);
out.bank_accounts = await q(c, `SELECT count(*)::int AS n FROM bank_accounts`);
out.proxy = await q(c, `SELECT count(*)::int AS n, max(created_at) AS last_at FROM proxy_sessions`);
out.outbound_calls = await q(c, `SELECT kind, status, count(*)::int AS n FROM outbound_calls GROUP BY 1,2`);

out.events_inboundish = await q(c, `
  SELECT name, count(*)::int AS n, max(created_at) AS last_at
  FROM events
  WHERE name ILIKE '%webhook%' OR name ILIKE '%bland%' OR name ILIKE '%postgrid%'
     OR name ILIKE '%plaid%' OR name ILIKE '%ghl%' OR name ILIKE '%payment%'
     OR name ILIKE '%commas%' OR name ILIKE '%clickfunnel%' OR name ILIKE '%mail%'
  GROUP BY 1 ORDER BY 2 DESC LIMIT 40
`);

out.failed_events = await q(c, `
  SELECT event_name, status, count(*)::int AS n, max(last_seen_at) AS last_at
  FROM failed_events GROUP BY 1,2 ORDER BY 3 DESC LIMIT 20
`);

out.test_account = await q(c, `
  SELECT id, kind, status, client_id, email
  FROM accounts WHERE client_id=$1 OR lower(email)='client@fundhub.ai'
`, [TEST_CLIENT]);
if (out.test_account.ok) for (const r of out.test_account.rows) r.email = maskEmail(r.email);

out.test_sales = await q(c, `
  SELECT id, status, agreed_price, agreed_success_fee_percent, sold_at, is_demo
  FROM sales WHERE client_id=$1 ORDER BY created_at DESC LIMIT 10
`, [TEST_CLIENT]);
out.test_invoices = await q(c, `
  SELECT id, invoice_type, status, amount_due, provider, emailed_at IS NOT NULL AS emailed
  FROM invoices WHERE client_id=$1 ORDER BY created_at DESC LIMIT 10
`, [TEST_CLIENT]);

out.commas_inbox = await q(c, `SELECT count(*)::int AS n, max(created_at) AS last_at FROM commas_inbox`);

out.e2e_clients = await q(c, `
  SELECT id, email, phone IS NOT NULL AND length(regexp_replace(coalesce(phone,''),'\\D','','g'))>0 AS has_phone,
         right(regexp_replace(coalesce(phone,''),'\\D','','g'),4) AS phone_last4, is_demo
  FROM clients
  WHERE email ILIKE 'e2e+%' OR is_demo = true
  ORDER BY created_at DESC NULLS LAST
  LIMIT 25
`);
if (out.e2e_clients.ok) for (const r of out.e2e_clients.rows) r.email = maskEmail(r.email);

out.templates_lorem = await q(c, `
  SELECT template_key, channel, subject
  FROM message_templates
  WHERE body ILIKE '%lorem ipsum%' OR coalesce(subject,'') ILIKE '%lorem ipsum%'
  ORDER BY template_key
`);
out.template_cats = await q(c, `
  SELECT
    CASE
      WHEN template_key ~ '^[A-Z]+-[A-Z0-9]+' THEN substring(template_key from '^([A-Z]+-[A-Z0-9]+)')
      ELSE 'other'
    END AS cat,
    channel,
    count(*)::int AS n,
    count(*) FILTER (WHERE body ILIKE '%lorem ipsum%' OR coalesce(subject,'') ILIKE '%lorem ipsum%')::int AS lorem
  FROM message_templates
  GROUP BY 1,2
  ORDER BY 1
`);

await c.end();
fs.writeFileSync(path.join(OUT, "db2.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  wrote: "w6/db2.json",
  test_client: out.test_client,
  products: out.products.ok ? out.products.rows.map(r => ({ code: r.code, variable: r.price_is_variable })) : out.products.error,
  agents_n: out.agents.n,
  staff: out.staff.ok ? out.staff.rows : out.staff.error,
  closers: out.closers.ok ? out.closers.rows : out.closers.error,
  pipeline: out.pipeline_by_stage.ok ? out.pipeline_by_stage.rows : out.pipeline_by_stage.error,
  cards: out.pipeline_card_count,
  queued: out.messages_queued,
  settings: out.messaging_settings,
  webhooks: out.webhooks,
  plaid: out.plaid,
  proxy: out.proxy,
  payment_links_n: out.payment_links.n,
  contracts: out.test_contracts,
  inquiry: out.test_inquiry,
  candidates: out.candidates,
  lorem_n: out.templates_lorem.n,
  account: out.test_account
}, null, 2));

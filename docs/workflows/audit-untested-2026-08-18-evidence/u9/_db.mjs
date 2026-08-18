/**
 * U9 read-only DB probe. Evidence only. No secret values printed.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u9");
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

const emails = [];
for (const f of ["email.txt", "email-b.txt", "email-c.txt", "email-d.txt", "email-e.txt"]) {
  const p = path.join(OUT, f);
  if (fs.existsSync(p)) emails.push(fs.readFileSync(p, "utf8").trim());
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

async function q(sql, params = []) {
  try {
    const r = await c.query(sql, params);
    return { ok: true, n: r.rows.length, rows: r.rows };
  } catch (err) {
    return { ok: false, error: String(err.message || err).slice(0, 220) };
  }
}

const tables = await q(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_type='BASE TABLE'
  ORDER BY 1
`);
const T = new Set((tables.rows || []).map((r) => r.table_name));

const out = {
  at: new Date().toISOString(),
  emails_used_count: emails.length,
  emails_are_e2e_aff: emails.every((e) => /^e2e\+aff-/i.test(e)),
  table_names_checked: ["clients", "events", "cards", "webhook_events", "inbound_webhooks", "clickfunnels_events"]
};

out.forbidden_touched = await q(`SELECT 1 FROM clients WHERE id = $1`, [FORBIDDEN]);

out.clients_by_email = T.has("clients")
  ? await q(
      `SELECT id, created_at, channel_source,
              split_part(email, '@', 2) AS email_domain,
              left(split_part(email, '@', 1), 12) AS email_local_prefix,
              (custom_fields IS NOT NULL AND custom_fields <> '{}'::jsonb) AS has_custom_fields
         FROM clients
        WHERE lower(email) = ANY($1::text[])
        ORDER BY created_at DESC`,
      [emails.map((e) => e.toLowerCase())]
    )
  : { missing_table: "clients" };

out.recent_e2e_aff_clients = T.has("clients")
  ? await q(
      `SELECT id, created_at, channel_source,
              left(split_part(email, '@', 1), 16) AS email_local_prefix,
              split_part(email, '@', 2) AS email_domain
         FROM clients
        WHERE email ILIKE 'e2e+aff-u9%'
        ORDER BY created_at DESC
        LIMIT 20`
    )
  : { missing_table: "clients" };

out.events_for_those_clients = T.has("events") && out.clients_by_email.ok
  ? await q(
      `SELECT e.id, e.name, e.created_at, e.client_id
         FROM events e
        WHERE e.client_id = ANY($1::uuid[])
        ORDER BY e.created_at DESC
        LIMIT 40`,
      [(out.clients_by_email.rows || []).map((r) => r.id)]
    )
  : { skipped: true };

if (T.has("events")) {
  out.recent_entry_captured = await q(
    `SELECT id, name, created_at, client_id,
            (payload ? 'email') AS has_email_key,
            (coalesce(payload->>'email','') ILIKE 'e2e+aff-%' OR coalesce(payload->>'email','') ILIKE 'e2e+wl-%') AS is_e2e
       FROM events
      WHERE name IN ('entry.captured', 'survey.submitted')
        AND created_at > now() - interval '2 hours'
      ORDER BY created_at DESC
      LIMIT 30`
  );
}

for (const name of ["webhook_events", "inbound_webhooks", "clickfunnels_events", "webhook_deliveries"]) {
  if (!T.has(name)) {
    out[name] = { missing_table: name };
    continue;
  }
  const cols = await q(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
    [name]
  );
  out[name + "_cols"] = (cols.rows || []).map((r) => r.column_name);
  out[name + "_count"] = await q(`SELECT count(*)::int AS n FROM ${name}`);
}

out.survey_submitted_2h = T.has("events")
  ? await q(
      `SELECT count(*)::int AS n
         FROM events
        WHERE name = 'survey.submitted'
          AND created_at > now() - interval '2 hours'`
    )
  : { missing_table: "events" };

out.tables_present = {
  clients: T.has("clients"),
  events: T.has("events"),
  webhook_events: T.has("webhook_events"),
  inbound_webhooks: T.has("inbound_webhooks"),
  clickfunnels_events: T.has("clickfunnels_events")
};

fs.writeFileSync(path.join(OUT, "db.json"), JSON.stringify(out, null, 2));
await c.end();
console.log(JSON.stringify({
  emails: emails.length,
  clients: out.clients_by_email.n ?? out.clients_by_email.error,
  recent_u9: out.recent_e2e_aff_clients.n ?? out.recent_e2e_aff_clients.error,
  entry: out.recent_entry_captured?.n,
  tables: out.tables_present
}));

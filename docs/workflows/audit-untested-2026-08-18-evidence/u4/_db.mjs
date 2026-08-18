/**
 * U4 read-only DB snapshot. Evidence only. Never prints secrets or PII values.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u4");
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

const out = {
  at: new Date().toISOString(),
  test_client: TEST_CLIENT,
  opened_forbidden: false,
  env_names: {
    COMMAS_CHECKOUT_BASE_URL: !!String(process.env.COMMAS_CHECKOUT_BASE_URL || "").trim(),
    FANBASIS_CHECKOUT_API_KEY: !!String(process.env.FANBASIS_CHECKOUT_API_KEY || "").trim(),
    COMMAS_API_KEY: !!String(process.env.COMMAS_API_KEY || "").trim(),
    STRIPE_keys: Object.keys(process.env).filter((k) => /^STRIPE_/.test(k)).length
  }
};

out.client = await q(
  `SELECT id, is_demo,
          CASE WHEN email IS NULL OR email = '' THEN false ELSE true END AS has_email,
          CASE WHEN email IS NULL OR email = '' THEN NULL ELSE split_part(email, '@', 2) END AS email_domain
     FROM clients WHERE id = $1`,
  [TEST_CLIENT]
);

out.payment_links = await q(
  `SELECT id, purpose, status, amount_cents, checkout_url IS NOT NULL AS has_url, created_at
     FROM payment_links WHERE client_id = $1 ORDER BY created_at DESC LIMIT 10`,
  [TEST_CLIENT]
);

out.payment_links_all = await q(
  `SELECT count(*)::int AS n,
          count(*) FILTER (WHERE client_id = $1)::int AS test_client
     FROM payment_links`,
  [TEST_CLIENT]
);

out.events_paid = await q(
  `SELECT name, count(*)::int AS n,
          count(*) FILTER (WHERE client_id = $1)::int AS test_client,
          max(created_at) AS last
     FROM events
     WHERE name IN ('diagnostic.paid', 'payment.received', 'deposit.paid')
     GROUP BY name
     ORDER BY name`,
  [TEST_CLIENT]
);

out.invoices_test = await q(
  `SELECT id, status, currency
     FROM invoices WHERE client_id = $1 ORDER BY created_at DESC LIMIT 10`,
  [TEST_CLIENT]
);

out.forbidden_touched = await q(`SELECT 1 FROM clients WHERE id = $1`, [FORBIDDEN]);

await c.end();
fs.writeFileSync(path.join(OUT, "db.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  wrote: "u4/db.json",
  payment_links_test: out.payment_links.n,
  payment_links_all: out.payment_links_all.rows?.[0] || null,
  events_paid: out.events_paid.rows || [],
  invoices_test: out.invoices_test.n
}, null, 2));

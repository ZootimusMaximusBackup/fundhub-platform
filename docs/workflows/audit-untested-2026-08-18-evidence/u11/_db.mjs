/**
 * U11 read-only DB count. Evidence only. Never prints secrets or PII.
 * Never SELECTs the forbidden live credit file.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u11");
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
    DATABASE_URL: !!String(process.env.DATABASE_URL || "").trim(),
    STAFF_E2E_PASSWORD: !!String(process.env.STAFF_E2E_PASSWORD || "").trim()
  }
};

out.cards_columns = await q(
  `SELECT column_name
     FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cards'
    ORDER BY ordinal_position`
);

out.test_client = await q(
  `SELECT id, is_demo,
          CASE WHEN email IS NULL OR email = '' THEN false ELSE true END AS has_email,
          CASE WHEN email IS NULL OR email = '' THEN NULL ELSE split_part(email, '@', 2) END AS email_domain
     FROM clients WHERE id = $1`,
  [TEST_CLIENT]
);

out.test_cards = await q(
  `SELECT c.id, c.client_id, c.is_demo, ps.key AS stage, p.name AS pipeline, c.created_at
     FROM cards c
     JOIN pipeline_stages ps ON ps.id = c.stage_id
     JOIN pipelines p ON p.id = c.pipeline_id
    WHERE c.client_id = $1`,
  [TEST_CLIENT]
);

out.card_counts = await q(
  `SELECT count(*)::int AS all_cards,
          count(*) FILTER (WHERE is_demo IS TRUE)::int AS demo,
          count(*) FILTER (WHERE is_demo IS NOT TRUE)::int AS not_demo,
          count(*) FILTER (WHERE client_id = $1)::int AS test_client
     FROM cards`,
  [TEST_CLIENT]
);

out.simulate_for_this_id = await q(
  `SELECT id, is_demo,
          (tags IS NOT NULL AND 'simulated' = ANY(tags)) AS tagged_simulated
     FROM clients WHERE id = $1`,
  [TEST_CLIENT]
);

await c.end();

fs.writeFileSync(path.join(OUT, "db.json"), JSON.stringify(out, null, 2));
const counts = out.card_counts.rows?.[0] || null;
console.log(JSON.stringify({
  wrote: "u11/db.json",
  test_cards: out.test_cards.n,
  card_counts: counts,
  test_is_demo: out.test_client.rows?.[0]?.is_demo ?? null,
  tagged_simulated: out.simulate_for_this_id.rows?.[0]?.tagged_simulated ?? null,
  opened_forbidden: false
}, null, 2));

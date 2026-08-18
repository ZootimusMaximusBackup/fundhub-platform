/**
 * U5 read-only DB snapshot. Evidence only. Never prints secrets or PII.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u5");
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
  opened_forbidden: false
};

out.consents = await q(
  `SELECT id, kind, capture_method, granted_at,
          revoked_at IS NOT NULL AS revoked,
          expires_at,
          (revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())) AS usable
     FROM client_consents WHERE client_id = $1 ORDER BY created_at DESC`,
  [TEST_CLIENT]
);

out.soft_pull_consent = await q(
  `SELECT id, kind, capture_method, granted_at,
          revoked_at IS NOT NULL AS revoked,
          (revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())) AS usable
     FROM client_consents
     WHERE client_id = $1 AND kind = 'soft_pull_consent'
     ORDER BY created_at DESC`,
  [TEST_CLIENT]
);

out.contracts_soft = await q(
  `SELECT id, template_key, status, signed_at IS NOT NULL AS signed
     FROM contracts
     WHERE client_id = $1 AND (template_key ILIKE '%soft%' OR template_key ILIKE '%pull%' OR template_key ILIKE '%consent%')
     ORDER BY created_at DESC`,
  [TEST_CLIENT]
);

out.soft_pulls = await q(
  `SELECT id, status, created_at
     FROM soft_pull_requests WHERE client_id = $1 ORDER BY created_at DESC LIMIT 10`,
  [TEST_CLIENT]
);

out.crs = await q(
  `SELECT id, created_at
     FROM crs_results WHERE client_id = $1 ORDER BY created_at DESC LIMIT 5`,
  [TEST_CLIENT]
);

out.scores_present = await q(
  `SELECT id FROM crs_results WHERE client_id = $1 LIMIT 1`,
  [TEST_CLIENT]
);

out.forbidden_opened = false;
out.forbidden_exists = await q(`SELECT 1 FROM clients WHERE id = $1`, [FORBIDDEN]);

await c.end();
const tag = process.argv[1] && process.argv.includes("--after") ? "db-after.json" : "db.json";
fs.writeFileSync(path.join(OUT, tag), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  wrote: `u5/${tag}`,
  consents: (out.consents.rows || []).map((r) => ({ kind: r.kind, valid: r.valid })),
  soft_pull_consent_n: out.soft_pull_consent.n,
  soft_pulls: out.soft_pulls.n,
  crs: out.crs.n,
  scores: out.scores_present.rows?.[0] || out.scores_present
}, null, 2));

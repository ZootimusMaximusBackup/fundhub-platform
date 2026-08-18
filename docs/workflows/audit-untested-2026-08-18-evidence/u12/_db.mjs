/**
 * U12 read-only candidate count. Evidence only.
 * Never prints secrets, real names, or real emails.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u12");

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
  opened_forbidden: false,
  env_names: {
    DATABASE_URL: !!String(process.env.DATABASE_URL || "").trim(),
    STAFF_E2E_PASSWORD: !!String(process.env.STAFF_E2E_PASSWORD || "").trim()
  }
};

out.candidate_columns = await q(
  `SELECT column_name
     FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'candidates'
    ORDER BY ordinal_position`
);

out.counts = await q(
  `SELECT count(*)::int AS all_candidates,
          count(*) FILTER (WHERE is_demo IS TRUE)::int AS is_demo,
          count(*) FILTER (WHERE source_detail = 'platform_demo')::int AS platform_demo,
          count(*) FILTER (WHERE full_name ~* '^(DEMO[\\s—-]|.*\\b(test|demo|e2e)\\b)')::int AS name_looks_demo,
          count(*) FILTER (WHERE email ~* '(^e2e\\+|(test|demo|e2e)@|@demo\\.|@example\\.|@fundhub\\.local)')::int AS email_looks_demo
     FROM candidates`
);

out.demo_rows = await q(
  `SELECT id, is_demo,
          (source_detail = 'platform_demo') AS platform_demo,
          (full_name ~* '^(DEMO[\\s—-]|.*\\b(test|demo|e2e)\\b)') AS name_looks_demo,
          split_part(email, '@', 2) AS email_domain,
          left(full_name, 8) AS name_prefix,
          source,
          source_detail
     FROM candidates
    WHERE is_demo IS TRUE
       OR source_detail = 'platform_demo'
       OR full_name ~* '^(DEMO[\\s—-]|.*\\b(test|demo|e2e)\\b)'
       OR email ~* '(^e2e\\+|(test|demo|e2e)@|@demo\\.|@example\\.|@fundhub\\.local)'
    ORDER BY created_at DESC
    LIMIT 20`
);

out.applications_on_demo = await q(
  `SELECT a.id, a.status, s.key AS stage
     FROM candidate_applications a
     JOIN candidates c ON c.id = a.candidate_id
     JOIN pipeline_stages s ON s.id = a.stage_id
    WHERE c.is_demo IS TRUE
       OR c.source_detail = 'platform_demo'
       OR c.full_name ~* '^(DEMO[\\s—-]|.*\\b(test|demo|e2e)\\b)'
       OR c.email ~* '(^e2e\\+|(test|demo|e2e)@|@demo\\.|@example\\.|@fundhub\\.local)'
    ORDER BY a.applied_at DESC
    LIMIT 20`
);

out.decision_counts = await q(
  `SELECT count(*)::int AS n,
          count(*) FILTER (WHERE decision = 'reject')::int AS rejects,
          count(*) FILTER (WHERE decision IN ('offer','offer_accepted','hired'))::int AS hire_ish
     FROM hiring_decisions`
);

await c.end();

fs.writeFileSync(path.join(OUT, "db.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  wrote: "u12/db.json",
  counts: out.counts.rows?.[0] || out.counts,
  demo_rows: out.demo_rows.n,
  demo_apps: out.applications_on_demo.n,
  decisions: out.decision_counts.rows?.[0] || null
}, null, 2));

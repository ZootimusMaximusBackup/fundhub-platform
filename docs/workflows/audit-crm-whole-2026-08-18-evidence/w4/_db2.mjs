import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-crm-whole-2026-08-18-evidence/w4");
const DEMO = "94796e0e-d012-4987-8721-676093aaed79";
const TEST_CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const PORTAL_EMAIL = "client@fundhub.ai";

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
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, params = []) => {
  try { return (await c.query(sql, params)).rows; }
  catch (e) { return { error: e.message }; }
};
const out = {
  social_posts: await q(`SELECT id::text, status, left(coalesce(caption,''),80) AS caption, created_at FROM social_posts WHERE partner_id=$1 AND created_at>now()-interval '6 hours' ORDER BY created_at DESC LIMIT 10`, [DEMO]),
  social_channels: await q(`SELECT id::text, channel, connection_state FROM social_channels WHERE partner_id=$1 LIMIT 12`, [DEMO]),
  generation_jobs: await q(`SELECT id::text, status, left(coalesce(error,''),120) AS error, created_at FROM generation_jobs WHERE partner_id=$1 AND created_at>now()-interval '6 hours' ORDER BY created_at DESC LIMIT 10`, [DEMO]),
  partner_pages: await q(`SELECT id::text, slug, status, created_at FROM partner_pages WHERE partner_id=$1 ORDER BY created_at DESC LIMIT 10`, [DEMO]),
  suite: await q(`SELECT partner_id::text, marketing_suite_enabled, updated_at FROM partner_module_settings WHERE partner_id=$1`, [DEMO]),
  brain_files: await q(`SELECT id::text, name, approval_status, created_at FROM brain_files WHERE created_at>now()-interval '6 hours' ORDER BY created_at DESC LIMIT 10`),
  brain_threads: await q(`SELECT id::text, created_at FROM brain_threads WHERE created_at>now()-interval '6 hours' ORDER BY created_at DESC LIMIT 8`),
  magic_links_15m: await q(`SELECT outcome, created_at FROM account_magic_links WHERE lower(email)=lower($1) AND created_at>now()-interval '15 minutes' ORDER BY created_at DESC`, [PORTAL_EMAIL]),
  messages: await q(`SELECT id::text, status, channel, template_key, created_at FROM messages WHERE client_id=$1 AND created_at>now()-interval '6 hours' ORDER BY created_at DESC LIMIT 10`, [TEST_CLIENT])
};
await c.end();
fs.writeFileSync(path.join(OUT, "db.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));

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
  social_posts: await q(`SELECT id::text, state, left(coalesce(caption,''),80) AS caption, created_at FROM social_posts WHERE partner_id=$1 AND created_at>now()-interval '6 hours' ORDER BY created_at DESC LIMIT 10`, [DEMO]),
  social_channels: await q(`SELECT id::text, channel, status FROM social_channels WHERE partner_id=$1 LIMIT 12`, [DEMO]),
  generation_jobs: await q(`SELECT id::text, status, kind, error, created_at FROM generation_jobs WHERE partner_id=$1 AND created_at>now()-interval '6 hours' ORDER BY created_at DESC LIMIT 10`, [DEMO]),
  partner_pages: await q(`SELECT id::text, slug, status, created_at FROM partner_pages WHERE partner_id=$1 ORDER BY created_at DESC LIMIT 10`, [DEMO]),
  partner_marketing: await q(`SELECT partner_id::text, enabled, updated_at FROM partner_marketing WHERE partner_id=$1`, [DEMO]),
  brain_files: await q(`SELECT id::text, title, approval_status, created_at FROM brain_files WHERE created_at>now()-interval '6 hours' ORDER BY created_at DESC LIMIT 10`),
  brain_threads: await q(`SELECT id::text, created_at FROM brain_threads WHERE created_at>now()-interval '6 hours' ORDER BY created_at DESC LIMIT 8`),
  magic_links_15m: await q(`SELECT outcome, created_at FROM account_magic_links WHERE lower(email)=lower($1) AND created_at>now()-interval '15 minutes' ORDER BY created_at DESC`, [PORTAL_EMAIL]),
  messages: await q(`SELECT id::text, status, channel, template_key, created_at FROM messages WHERE client_id=$1 AND created_at>now()-interval '6 hours' ORDER BY created_at DESC LIMIT 10`, [TEST_CLIENT])
};
await c.end();
fs.writeFileSync(path.join(OUT, "db.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  social: Array.isArray(out.social_posts) ? out.social_posts.length : out.social_posts,
  jobs: Array.isArray(out.generation_jobs) ? out.generation_jobs.length : out.generation_jobs,
  pages: Array.isArray(out.partner_pages) ? out.partner_pages.length : out.partner_pages,
  marketing: out.partner_marketing,
  brain: Array.isArray(out.brain_files) ? out.brain_files.length : out.brain_files,
  links: Array.isArray(out.magic_links_15m) ? out.magic_links_15m.length : out.magic_links_15m
}, null, 2));

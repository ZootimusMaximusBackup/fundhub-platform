import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
function loadEnv() {
  const raw = readFileSync(resolve(ROOT, ".env"), "utf8");
  for (const line of raw.split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!m) continue;
    if (process.env[m[1]] != null && process.env[m[1]] !== "") continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}
loadEnv();
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const r = await db.query(`
  SELECT
    count(*)::int AS email_templates,
    count(*) FILTER (WHERE body ~* '<a[^>]+href[^>]*>[^<]*unsubscribe') ::int AS anchor_unsub,
    count(*) FILTER (WHERE body ~* 'href=["''][^"'']*unsub') ::int AS href_contains_unsub,
    count(*) FILTER (WHERE body ~* 'mailto:.*unsub') ::int AS mailto_unsub
  FROM message_templates
  WHERE channel = 'email'
`);
writeFileSync(resolve(HERE, "06-href.json"), JSON.stringify(r.rows[0], null, 2) + "\n");
await db.end();
console.log("wrote 06-href.json");

// Sanitized plus-tag client probe. No raw emails, phones, or names.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const LIVE = "9af65808-a619-4e65-ae91-239766a006b7";

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
const inbox = String(process.env.FUNDHUB_TEST_INBOX || "").trim().toLowerCase();
const at = inbox.lastIndexOf("@");
const inboxLocal = at >= 0 ? inbox.slice(0, at) : "";
const inboxHost = at >= 0 ? inbox.slice(at + 1) : "";

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const r = await db.query(`
  SELECT
    id = $1::uuid AS is_live_file,
    COALESCE(is_demo, false) AS is_demo,
    split_part(lower(coalesce(email, '')), '@', 2) AS email_domain,
    lower(split_part(coalesce(email, ''), '@', 1)) LIKE $2 AS local_is_inbox_plus_tag,
    lower(email) LIKE 'e2e+%' AS email_is_e2e,
    lower(coalesce(first_name, '')) ~ '(test|demo|e2e|sim)'
      OR lower(coalesce(last_name, '')) ~ '(test|demo|e2e|sim)'
      AS name_looks_test,
    created_at::date::text AS created_date
  FROM clients
  WHERE position('+' in coalesce(email, '')) > 0
  ORDER BY created_at
`, [LIVE, inboxLocal + "+%@gmail.com"]);

writeFileSync(resolve(HERE, "11-plus-clients-safe.json"), JSON.stringify({
  inbox_host_is_gmail: inboxHost === "gmail.com",
  count: r.rows.length,
  rows: r.rows
}, null, 2) + "\n");

await db.end();
console.log("wrote 11-plus-clients-safe.json");

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const LIVE = "9af65808-a619-4e65-ae91-239766a006b7";
const TEST = "8556bedc-46e1-4d85-b0cd-a24adfee1521";

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
const digits = String(process.env.FUNDHUB_TEST_PHONE || "").replace(/\D/g, "");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const r = await db.query(`
  SELECT id, status, provider, direction,
         client_id = $1::uuid AS is_live_file,
         client_id = $2::uuid AS is_test_file,
         last_error IS NOT NULL AS has_error,
         created_at::date::text AS created_date
    FROM messages
   WHERE channel = 'sms'
     AND regexp_replace(coalesce(to_address, ''), '\\D', '', 'g') = $3
   ORDER BY created_at
`, [LIVE, TEST, digits]);
writeFileSync(resolve(HERE, "07-rows-to-test-phone.json"), JSON.stringify({
  count: r.rows.length,
  rows: r.rows
}, null, 2) + "\n");
await db.end();
console.log("wrote 07-rows-to-test-phone.json");

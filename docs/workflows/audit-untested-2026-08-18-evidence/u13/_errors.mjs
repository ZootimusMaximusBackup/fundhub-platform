import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const TEST = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
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
function normPhone(v) {
  return String(v || "").replace(/\D/g, "");
}
loadEnv();
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const testPhone = normPhone(process.env.FUNDHUB_TEST_PHONE);
const failed = await db.query(`
  SELECT id, status,
         left(coalesce(last_error, ''), 80) AS error_prefix,
         blocked_reason
    FROM messages
   WHERE client_id = $1 AND channel = 'sms'
   ORDER BY created_at DESC
`, [TEST]);
const toTestPhone = await db.query(`
  SELECT count(*)::int AS n
    FROM messages
   WHERE channel = 'sms'
     AND regexp_replace(coalesce(to_address, ''), '\\D', '', 'g') = $1
`, [testPhone]);
const liveSms = await db.query(`
  SELECT count(*)::int AS n
    FROM messages
   WHERE client_id = $1 AND channel = 'sms'
`, [LIVE]);
writeFileSync(resolve(HERE, "06-test-sms-errors.json"), JSON.stringify({
  test_client_sms: failed.rows,
  sms_rows_to_fundhub_test_phone: toTestPhone.rows[0].n,
  live_file_sms_rows: liveSms.rows[0].n
}, null, 2) + "\n");
await db.end();
console.log("wrote 06-test-sms-errors.json");

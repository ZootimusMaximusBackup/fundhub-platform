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
const names = await db.query(`
  SELECT name, count(*)::int AS n
    FROM events
   GROUP BY name
   ORDER BY n DESC
`);
const inbound = await db.query(`
  SELECT count(*)::int AS n FROM messages WHERE direction = 'inbound'
`);
const inboundEmail = await db.query(`
  SELECT count(*)::int AS n FROM messages WHERE direction = 'inbound' AND channel = 'email'
`);
writeFileSync(resolve(HERE, "12-event-names.json"), JSON.stringify({
  all_event_names: names.rows,
  inbound_messages_total: inbound.rows[0].n,
  inbound_email_messages: inboundEmail.rows[0].n,
  message_inbound_count: (names.rows.find((r) => r.name === "message.inbound") || { n: 0 }).n,
  mail_response_count: (names.rows.find((r) => r.name === "mail.response") || { n: 0 }).n
}, null, 2) + "\n");
await db.end();
console.log("wrote 12-event-names.json");

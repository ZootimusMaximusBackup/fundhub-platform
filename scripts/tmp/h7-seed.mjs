import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const { db } = await import("../../src/db.mjs");
const key = "seed/022_partner_welcome.sql";
const done = (await db.query(`SELECT 1 FROM schema_migrations WHERE key=$1`, [key])).rows[0];
if (done) { console.log("already applied"); process.exit(0); }
const sql = readFileSync("/tmp/wt-hole7/db/seed/022_partner_welcome.sql", "utf8");
await db.query(sql);
await db.query(`INSERT INTO schema_migrations (key) VALUES ($1)`, [key]);
console.log("applied", JSON.stringify((await db.query(`SELECT template_key,channel,compliance_passed FROM message_templates WHERE template_key LIKE '%PARTNER-WELCOME%'`)).rows));
process.exit(0);

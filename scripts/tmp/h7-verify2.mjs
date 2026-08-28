import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const { db } = await import("../../src/db.mjs");
console.log("to partner email:", (await db.query(`SELECT count(*) c FROM messages WHERE to_address ILIKE '%wl-e2e27-wlchat%'`)).rows[0].c);
console.log("partner-ish templates ever:", JSON.stringify((await db.query(`SELECT DISTINCT template_key FROM messages WHERE template_key ILIKE '%PARTNER%' OR template_key ILIKE '%WL%' OR template_key ILIKE '%AFFIL%'`)).rows));
process.exit(0);

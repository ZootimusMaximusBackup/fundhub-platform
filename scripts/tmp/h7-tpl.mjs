import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const { db } = await import("../../src/db.mjs");
console.log(JSON.stringify((await db.query(`SELECT template_key,channel,compliance_passed FROM message_templates WHERE template_key LIKE '%PARTNER-WELCOME%'`)).rows));
process.exit(0);

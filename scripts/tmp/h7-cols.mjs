import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const { db } = await import("../../src/db.mjs");
const c = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='messages' ORDER BY ordinal_position`)).rows.map(r=>r.column_name);
console.log(c.join(", "));
process.exit(0);

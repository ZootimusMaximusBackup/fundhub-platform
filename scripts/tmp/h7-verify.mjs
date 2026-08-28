import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const { db } = await import("../../src/db.mjs");
const m = (await db.query(`SELECT id,template_key,channel,status,to_address,created_at FROM messages WHERE to_address ILIKE '%wl-e2e27-wlchat%' OR to_address='+16616054248' AND created_at > '2026-08-27T07:00:00Z' ORDER BY created_at DESC LIMIT 20`)).rows;
console.log("messages matching partner:", m.length, JSON.stringify(m,null,1));
const acc = (await db.query(`SELECT id,email,kind,created_at FROM accounts WHERE partner_id='ed962d4b-e373-444d-8e47-8a156446d5be'`)).rows;
console.log("accounts:", JSON.stringify(acc,null,1));
process.exit(0);

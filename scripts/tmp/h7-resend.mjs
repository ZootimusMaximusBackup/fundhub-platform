import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const { db } = await import("../../src/db.mjs");
const { drain } = await import("/tmp/wt-hole7/src/messaging/outbox.mjs");
const org = (await db.query(`SELECT org_id FROM partners WHERE id='ed962d4b-e373-444d-8e47-8a156446d5be'`)).rows[0].org_id;
await db.query(`UPDATE messages SET status='queued', blocked_reason=NULL, blocked_at=NULL WHERE provider_ref='partner:ed962d4b-e373-444d-8e47-8a156446d5be:welcome:email' AND status='blocked'`);
console.log("drain:", JSON.stringify(await drain(db, { orgId: org }), null, 1));
console.log("rows:", JSON.stringify((await db.query(`SELECT template_key,channel,status,to_address,provider,provider_message_id,last_error FROM messages WHERE provider_ref LIKE 'partner:ed962d4b%' ORDER BY channel`)).rows, null, 1));
process.exit(0);

import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const { db } = await import("../../src/db.mjs");
const p = (await db.query(`SELECT id,org_id,name,brand_name,contact_email,notes FROM partners WHERE id='ed962d4b-e373-444d-8e47-8a156446d5be'`)).rows[0];
console.log("notes:", JSON.stringify(p.notes));
const note = String(p.notes||"");
const phone = (note.match(/phone=(\d*)/)||[])[1] || "";
const consent = /sms_consent=true/.test(note);
const acct = (await db.query(`SELECT name FROM accounts WHERE partner_id=$1 LIMIT 1`,[p.id])).rows[0];
const { queuePartnerWelcome } = await import("/tmp/wt-hole7/src/partners/welcome.mjs");
const res = await queuePartnerWelcome(db, {
  orgId: p.org_id, partnerId: p.id, email: p.contact_email,
  phone, name: acct?.name || p.name, brand: p.brand_name, kind: "partner",
  loginUrl: "https://fundhub.ai/login.html",
  siteUrl: `https://fundhub.ai/sites/${p.id}/apply`,
  smsConsent: consent
});
console.log("consent:", consent, "phone:", phone);
console.log("result:", JSON.stringify(res, null, 1));
console.log("messages now:", JSON.stringify((await db.query(`SELECT id,template_key,channel,status,to_address,subject,last_error FROM messages WHERE provider_ref LIKE 'partner:ed962d4b%' ORDER BY created_at`)).rows, null, 1));
process.exit(0);

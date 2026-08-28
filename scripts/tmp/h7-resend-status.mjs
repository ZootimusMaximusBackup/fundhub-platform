import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const key = process.env.RESEND_API_KEY;
if (!key) { console.log("no RESEND_API_KEY in env"); process.exit(0); }
const r = await fetch("https://api.resend.com/emails/509a0052-f237-4469-91f1-392557689743", { headers: { authorization: `Bearer ${key}` } });
console.log(r.status, await r.text());
process.exit(0);

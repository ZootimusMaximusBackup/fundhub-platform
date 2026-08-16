#!/usr/bin/env node
/** Fire a +test bus+Inngest event via live tmp-cf-seam-watch. Usage:
 *  DASHBOARD_SECRET=... node scripts/gauntlet-emit.mjs <eventName> '<jsonPayload>'
 */
const name = process.argv[2];
const payload = process.argv[3] ? JSON.parse(process.argv[3]) : null;
const email = process.env.GAUNTLET_EMAIL || payload?.email;
const clientId = process.env.GAUNTLET_CLIENT || payload?.clientId;
if (!name || !email) {
  console.error("usage: GAUNTLET_EMAIL=... node scripts/gauntlet-emit.mjs <event> '{...}'");
  process.exit(1);
}
const res = await fetch("https://fundhub.ai/.netlify/functions/tmp-cf-seam-watch", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-cf-seam-token": process.env.DASHBOARD_SECRET
  },
  body: JSON.stringify({
    action: "emit_inngest_probe",
    name,
    email,
    client_id: clientId,
    payload: payload || { email, source: "gauntlet" }
  })
});
const j = await res.json();
console.log(JSON.stringify({ http: res.status, ...j }, null, 2));
if (!j.ok) process.exit(1);

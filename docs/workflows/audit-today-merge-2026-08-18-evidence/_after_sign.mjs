/**
 * After TEST Credit Repair Agreement sign: unlock map + Inngest.
 * Do not open the live file.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-today-merge-2026-08-18-evidence");
const BASE = "https://fundhub.ai";
const TEST = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const LIVE = "9af65808-a619-4e65-ae91-239766a006b7";

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadDotEnv();

const login = await fetch(BASE + "/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "chris@fundhub.ai", password: process.env.STAFF_E2E_PASSWORD })
});
const loginJson = await login.json().catch(() => ({}));
const token = loginJson.token || null;
if (!token) throw new Error("login failed");
const headers = { authorization: "Bearer " + token, accept: "application/json" };

async function get(p) {
  const r = await fetch(BASE + p, { headers });
  const j = await r.json().catch(() => ({}));
  return {
    path: p,
    status: r.status,
    ok: j.ok ?? null,
    keys: Object.keys(j).slice(0, 20),
    count: j.count ?? j.items?.length ?? null,
    error: j.error || j.message || null,
    n6: j.unlocked_count ?? j.entitlements_unlocked ?? j.unlocked ?? null,
    locked: j.locked ?? null
  };
}

const out = {
  at: new Date().toISOString(),
  opened_live: false,
  test: TEST,
  live_blocked: LIVE,
  login: { status: login.status, has_token: true },
  portal_summary: await get("/api/read/portal-summary?client_id=" + TEST),
  portal_contracts: await get("/api/read/portal-contracts?client_id=" + TEST),
  entitlements: await get("/api/read/entitlements?client_id=" + TEST),
  inngest: {
    contract_signed_listeners: 0,
    note: "no src/workflows file listens for contract.signed"
  }
};

fs.writeFileSync(path.join(OUT, "after-sign.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  portal_summary: out.portal_summary,
  portal_contracts: out.portal_contracts,
  entitlements: out.entitlements
}, null, 2));

// W-CRS paint fetch — live API numbers for this client. No secrets written.
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-engine-2026-08-18-evidence/w-crs");
const BASE = "https://fundhub.ai";
const CLIENT_ID = "41a3199f-1835-4ac8-91c0-d4f37bd92037";

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

const PASSWORD = process.env.STAFF_E2E_PASSWORD || process.env.STAFF_INITIAL_PASSWORD || "";
if (!PASSWORD) throw new Error("STAFF_E2E_PASSWORD missing");

async function main() {
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "chris@fundhub.ai", password: PASSWORD })
  });
  const loginJson = await loginRes.json().catch(() => ({}));
  const token = loginJson.token || null;
  fs.writeFileSync(path.join(OUT, "dumps/07-login-status.json"), JSON.stringify({
    status: loginRes.status,
    ok: loginJson.ok === true,
    has_token: Boolean(token),
    staff_role: loginJson.staff?.role || null
  }, null, 2));
  if (!token) throw new Error("login failed");

  const headers = {
    accept: "application/json",
    authorization: `Bearer ${token}`,
    cookie: `fundhub_session=${token}`
  };

  const clientRes = await fetch(`${BASE}/api/dashboard/client?id=${CLIENT_ID}`, { headers });
  const clientJson = await clientRes.json().catch(() => ({}));
  const c = clientJson.client || clientJson.data?.client || null;
  const data = clientJson.data || clientJson;
  const paint = {
    status: clientRes.status,
    ok: clientJson.ok !== false,
    client_id: c?.id || data?.client?.id || null,
    email: c?.email || data?.client?.email || null,
    outcome_tier: c?.outcome_tier || data?.client?.outcome_tier || null,
    custom_fields: {
      total_funding_estimate: (c?.custom_fields || data?.client?.custom_fields || {}).total_funding_estimate ?? null,
      analyzer_prequal_amount: (c?.custom_fields || data?.client?.custom_fields || {}).analyzer_prequal_amount ?? null
    },
    tri_merge: data.tri_merge || clientJson.tri_merge || null,
    utilisation: data.utilisation || data.utilization || clientJson.utilisation || null,
    tier_reasoning: data.tier_reasoning || clientJson.tier_reasoning || null,
    crs_results_count: (data.crs_results || clientJson.crs_results || []).length,
    top_keys: Object.keys(clientJson).sort()
  };
  fs.writeFileSync(path.join(OUT, "dumps/07-ccp-api.json"), JSON.stringify(paint, null, 2));

  const tlRes = await fetch(`${BASE}/api/read/tradelines?client_id=${CLIENT_ID}`, { headers });
  const tlJson = await tlRes.json().catch(() => ({}));
  const funding = tlJson.funding || tlJson.data?.funding || null;
  fs.writeFileSync(path.join(OUT, "dumps/07-closer-tradelines-api.json"), JSON.stringify({
    status: tlRes.status,
    ok: tlJson.ok !== false,
    top_keys: Object.keys(tlJson).sort(),
    tradeline_count: (tlJson.tradelines || tlJson.data?.tradelines || []).length,
    funding_keys: funding ? Object.keys(funding).sort() : null,
    totalAvailableCredit: funding?.totalAvailableCredit ?? null,
    allocation: funding?.allocation ?? null,
    guardrail: funding?.guardrail ?? null
  }, null, 2));

  console.log(JSON.stringify({
    login: loginRes.status,
    client_api: clientRes.status,
    tri_merge: paint.tri_merge,
    utilisation: paint.utilisation,
    estimate: paint.custom_fields,
    tradelines: tlRes.status,
    totalAvailableCredit: funding?.totalAvailableCredit ?? null
  }));
}

main().catch((err) => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});

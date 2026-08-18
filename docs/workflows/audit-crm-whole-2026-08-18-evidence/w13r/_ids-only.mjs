/**
 * W13R: Bland stored-id fields only. No PII, no prompt text.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-crm-whole-2026-08-18-evidence/w13r");

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadDotEnv();

async function blandGet(pathname) {
  const resp = await fetch(`https://api.bland.ai/v1${pathname}`, {
    method: "GET",
    headers: { authorization: process.env.BLAND_API_KEY }
  });
  return { status: resp.status, json: await resp.json().catch(() => null) };
}

const list = await blandGet("/calls?limit=20");
const calls = (list.json && list.json.calls) || [];
const idRows = calls.map((c) => ({
  call_id: c.call_id,
  created_at: c.created_at,
  pathway_id: c.pathway_id || null,
  agent_version_id: c.agent_version_id || null,
  agent_experiment_id: c.agent_experiment_id || null,
  persona_id: c.persona_id || null,
  contact_id: c.contact_id || null
}));

const uniqueVersions = [...new Set(idRows.map((r) => r.agent_version_id).filter(Boolean))];
const versionLooks = [];
for (const id of uniqueVersions.slice(0, 5)) {
  const tries = [`/agents/${id}`, `/agent/${id}`, `/v2/agents/${id}`];
  for (const t of tries) {
    const r = await blandGet(t.startsWith("/v2") ? t.replace("/v2", "") : t);
    versionLooks.push({
      id,
      path: t,
      status: r.status,
      top_keys: r.json && typeof r.json === "object" ? Object.keys(r.json).slice(0, 15) : [],
      name: r.json && (r.json.name || (r.json.agent && r.json.agent.name)) || null,
      prompt_chars: r.json && r.json.prompt ? String(r.json.prompt).length : 0
    });
  }
}

const extra = [];
for (const ep of ["/agent", "/conversational-pathways", "/personas"]) {
  const r = await blandGet(ep);
  extra.push({
    path: ep,
    status: r.status,
    top_keys: r.json && typeof r.json === "object" ? Object.keys(r.json).slice(0, 12) : [],
    bytes_hint: r.json ? JSON.stringify(r.json).length : 0
  });
}

const out = { at: new Date().toISOString(), idRows, uniqueVersions, versionLooks, extra };
fs.writeFileSync(path.join(OUT, "bland-stored-ids.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  calls: idRows.length,
  with_pathway: idRows.filter((r) => r.pathway_id).length,
  with_agent_version: idRows.filter((r) => r.agent_version_id).length,
  uniqueVersions,
  versionLooks: versionLooks.map((v) => ({ path: v.path, status: v.status, name: v.name, prompt_chars: v.prompt_chars })),
  extra
}, null, 2));

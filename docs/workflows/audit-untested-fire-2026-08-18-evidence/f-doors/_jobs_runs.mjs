/**
 * F-DOORS jobs follow-up: reach Inngest run API with local key names.
 * Await one contract.signed send so we have an Inngest event id.
 * Do not write Netlify INNGEST_EVENT_KEY. Never print secrets.
 */
import fs from "node:fs";
import path from "node:path";
import { inngest } from "../../../../src/workflows/client.mjs";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-fire-2026-08-18-evidence/f-doors");
const TEST = "8556bedc-46e1-4d85-b0cd-a24adfee1521";

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

function present(name) {
  return Boolean(String(process.env[name] || "").trim());
}

async function inngestApi(pathname) {
  const r = await fetch("https://api.inngest.com" + pathname, {
    headers: {
      authorization: "Bearer " + (process.env.INNGEST_SIGNING_KEY || ""),
      accept: "application/json"
    }
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return {
    path: pathname,
    status: r.status,
    keys: json ? Object.keys(json) : [],
    data_n: json && Array.isArray(json.data) ? json.data.length : null,
    error: json && (json.error || json.message) || null,
    sample: json && Array.isArray(json.data)
      ? json.data.slice(0, 5).map((row) => ({
        id: row.id || row.run_id || null,
        status: row.status || null,
        function_id: row.function_id || row.function?.id || null,
        name: row.name || row.event_name || row.function_name || null
      }))
      : null,
    raw_clip: json ? null : String(text || "").slice(0, 160)
  };
}

const out = {
  at: new Date().toISOString(),
  env_names: {
    INNGEST_EVENT_KEY: present("INNGEST_EVENT_KEY"),
    INNGEST_SIGNING_KEY: present("INNGEST_SIGNING_KEY")
  },
  netlify_inngest_key_written: false,
  bland_call: null,
  send: null,
  probes: {}
};

if (present("BLAND_API_KEY")) {
  const r = await fetch("https://api.bland.ai/v1/calls/70a094ce-77f5-4cca-a9f2-5d75d899cdff", {
    headers: { authorization: process.env.BLAND_API_KEY }
  });
  const j = await r.json().catch(() => ({}));
  out.bland_call = {
    status: r.status,
    call_id: j.call_id || j.c_id || null,
    queue_status: j.queue_status || j.status || null,
    completed: j.completed ?? null,
    to_last4: typeof j.to === "string" ? j.to.slice(-4) : null,
    error_message: j.error_message || null
  };
}

out.probes.v1_runs = await inngestApi("/v1/runs?limit=5");
out.probes.v1_events = await inngestApi("/v1/events?limit=10");
out.probes.v2_runs = await inngestApi("/v2/runs?limit=5");
out.probes.v1_apps = await inngestApi("/v1/apps");

let sendIds = [];
try {
  const sent = await inngest.send({
    name: "contract.signed",
    data: { e2e: true, source: "audit-fire", clientId: TEST }
  });
  sendIds = (sent && sent.ids) || (Array.isArray(sent) ? sent : []);
  out.send = { ok: true, ids_n: sendIds.length, id0: sendIds[0] || null };
} catch (err) {
  out.send = { ok: false, error: String(err.message || err).slice(0, 220) };
}

await new Promise((r) => setTimeout(r, 5000));

if (sendIds[0]) {
  out.probes.event_runs = await inngestApi(`/v1/events/${sendIds[0]}/runs`);
  out.probes.event_get = await inngestApi(`/v1/events/${sendIds[0]}`);
}

const finishedId = out.probes.v1_events && out.probes.v1_events.sample
  && out.probes.v1_events.sample[0] && out.probes.v1_events.sample[0].id;
if (finishedId) {
  out.probes.finished_event_runs = await inngestApi(`/v1/events/${finishedId}/runs`);
}

fs.writeFileSync(path.join(OUT, "jobs-runs.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  bland_call: out.bland_call,
  send: out.send,
  probes: Object.fromEntries(Object.entries(out.probes).map(([k, v]) => [k, {
    status: v.status,
    data_n: v.data_n,
    error: v.error,
    sample_names: (v.sample || []).map((s) => s.name || s.status)
  }]))
}, null, 2));

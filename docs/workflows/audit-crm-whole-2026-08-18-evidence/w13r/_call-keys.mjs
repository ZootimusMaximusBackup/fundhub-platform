/**
 * W13R: keys-only look at Bland call GET bodies. No phones, no transcripts, no full task.
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
    headers: { authorization: process.env.BLAND_API_KEY, "Content-Type": "application/json" }
  });
  const json = await resp.json().catch(() => null);
  return { ok: resp.ok, status: resp.status, json };
}

function hintFromText(s) {
  if (!s) return null;
  const t = String(s);
  if (/josh/i.test(t) && /fundhub/i.test(t)) return "mentions_josh_fundhub";
  if (/experian/i.test(t)) return "mentions_experian";
  if (/equifax/i.test(t)) return "mentions_equifax";
  if (/transunion/i.test(t)) return "mentions_transunion";
  if (/roleplay|test call/i.test(t)) return "mentions_roleplay_or_test";
  return "other";
}

const ids = [
  "5265c6e8-d68e-4427-996e-52936ffa28cc",
  "b86a85ac-6bc0-4778-bed2-07757b336690",
  "823ec038-e86e-461a-b265-13009959eb8f",
  "9c6db403-8153-43c7-91ff-7382f57ab192",
  "326e71c0-86f3-4c76-ba8e-de0627a9c30d"
];

const rows = [];
for (const id of ids) {
  const r = await blandGet(`/calls/${id}`);
  const c = r.json || {};
  const req = c.request_data && typeof c.request_data === "object" ? c.request_data : {};
  rows.push({
    call_id: id,
    http: r.status,
    top_keys: Object.keys(c).sort(),
    request_data_keys: Object.keys(req).sort(),
    has_task_top: Object.prototype.hasOwnProperty.call(c, "task"),
    has_task_req: Object.prototype.hasOwnProperty.call(req, "task"),
    has_prompt_top: Object.prototype.hasOwnProperty.call(c, "prompt"),
    has_prompt_req: Object.prototype.hasOwnProperty.call(req, "prompt"),
    has_pathway_id: !!c.pathway_id,
    pathway_id: c.pathway_id || null,
    metadata_keys: c.metadata && typeof c.metadata === "object" ? Object.keys(c.metadata).sort() : [],
    summary_chars: c.summary ? String(c.summary).length : 0,
    summary_hint: hintFromText(c.summary),
    transcript_chars: c.concatenated_transcript ? String(c.concatenated_transcript).length : 0,
    transcript_hint: hintFromText(c.concatenated_transcript)
  });
}

fs.writeFileSync(path.join(OUT, "bland-call-keys.json"), JSON.stringify({ at: new Date().toISOString(), rows }, null, 2));
console.log(JSON.stringify(rows, null, 2));

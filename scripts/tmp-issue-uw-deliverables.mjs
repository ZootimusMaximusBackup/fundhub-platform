#!/usr/bin/env node
// One-shot: issue UWIQ pack + repair letters on existing sim files. No card charge.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const EVIDENCE = join(ROOT, "docs/workflows/four-plus-pulse-2026-08-25-evidence/deliverables");
const FUND = "614927f7-95a9-4623-86e8-cd85420d9716";
const REPAIR = "5ce80871-0b70-4d2d-89e0-efdd62aa2e2f";
const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const STAFF_ID = "52bc675a-db0f-4e24-9b53-80f7fd077f72";
const BASE = "https://fundhub.ai";

function loadEnv() {
  for (const line of readFileSync(join(ROOT, ".env"), "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadEnv();

function redact(s) {
  return String(s || "").replace(/\b\d{3}-\d{2}-\d{4}\b/g, "XXX-XX-XXXX");
}
function safeName(name) {
  return String(name || "file.pdf").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 90);
}
function hasSsn(s) {
  return /\b\d{3}-\d{2}-\d{4}\b/.test(String(s || ""));
}
function wrap(text, width) {
  const words = String(text || "").replace(/\r/g, "").split(/\n/);
  const out = [];
  for (const para of words) {
    if (!para) { out.push(""); continue; }
    let line = "";
    for (const w of para.split(/\s+/)) {
      if ((line + " " + w).trim().length > width) {
        if (line) out.push(line);
        line = w;
      } else line = (line ? line + " " : "") + w;
    }
    if (line) out.push(line);
  }
  return out;
}
function subtypeFromFile(file) {
  const t = String(file.type || "").toLowerCase();
  const fn = String(file.filename || "").toLowerCase();
  if (t === "credit_analysis" || fn.includes("credit-analysis")) return "credit_analysis_report";
  if (t === "roadmap" || fn.includes("roadmap") || fn.includes("optimization")) return "credit_optimization_roadmap";
  if (t === "funding_snapshot" || fn.includes("funding-snapshot") || fn.includes("capital-readiness")) return "funding_snapshot";
  if (t === "lender_match" || fn.includes("lender")) return "bank_lender_match_list";
  if (t === "dispute" || /_round\d/.test(fn) || fn.includes("metro")) return "metro2_dispute_letter_pack";
  if (t === "personal_info" || fn.includes("personal_info")) return "funding_personal_info";
  if (t === "inquiry_removal" || fn.includes("inquiry_")) return "funding_inquiry_removal";
  return null;
}
function sanitizePersonal(personal) {
  return { ...personal, ssn: null };
}
function stripEngineSsn(engine) {
  if (!engine || typeof engine !== "object") return engine;
  const copy = JSON.parse(JSON.stringify(engine));
  if (copy.normalized?.identity) {
    copy.normalized.identity.ssns = [];
    if (copy.normalized.identity.bySource) {
      for (const k of Object.keys(copy.normalized.identity.bySource)) {
        if (copy.normalized.identity.bySource[k]) copy.normalized.identity.bySource[k].ssns = [];
      }
    }
  }
  return copy;
}

async function textPdf(title, body) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = wrap(redact(body), 92);
  let page = doc.addPage();
  let y = page.getHeight() - 48;
  page.drawText(String(title).slice(0, 80), { x: 48, y, size: 13, font });
  y -= 22;
  for (const line of lines) {
    if (y < 48) {
      page = doc.addPage();
      y = page.getHeight() - 48;
    }
    page.drawText(line.slice(0, 120), { x: 48, y, size: 9, font });
    y -= 11;
  }
  return Buffer.from(await doc.save());
}

async function staffLogin() {
  const password = process.env.STAFF_E2E_PASSWORD || process.env.STAFF_INITIAL_PASSWORD || "";
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "chris@fundhub.ai", password })
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, token: body.token || null, ok: !!(res.ok && body.token) };
}

async function apiGet(token, path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" }
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function apiPost(token, path, data) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(data)
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function uploadPdf(token, clientId, filename, buf) {
  const form = new FormData();
  form.append("client_id", clientId);
  form.append("kind", "client_upload");
  form.append("subtype", "other");
  form.append("file", new Blob([buf], { type: "application/pdf" }), filename);
  const res = await fetch(`${BASE}/api/documents-upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    body: form
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function blandCall(id) {
  const key = process.env.BLAND_API_KEY || "";
  if (!key) return { id, error: "no_bland_key" };
  const res = await fetch(`https://api.bland.ai/v1/calls/${id}`, {
    headers: { authorization: key, accept: "application/json" }
  });
  const json = await res.json().catch(() => ({}));
  const duration = Number(json.corrected_duration ?? json.queue_status?.duration ?? json.call_length ?? json.duration ?? 0);
  const answered = !!(json.answered_by || json.concatenated_transcript || (duration > 8 && json.status === "completed"));
  return {
    id,
    http: res.status,
    status: json.status || json.error || null,
    to: json.to || json.inbound_number || null,
    answered,
    duration_sec: Number.isFinite(duration) ? duration : null,
    completed: json.status === "completed",
    answered_by: json.answered_by || null,
    disposition: json.disposition_tag || json.queue_status?.status || null
  };
}

async function gmailHits(client, queries) {
  const out = [];
  for (const q of queries) {
    const listed = await client.listMessages({ maxResults: 20, q });
    const rows = [];
    for (const row of (listed.messages || []).slice(0, 12)) {
      const msg = await client.getMessage(row.id);
      rows.push({
        subject: client.headerValue(msg, "Subject"),
        date: client.headerValue(msg, "Date"),
        to: client.headerValue(msg, "To")
      });
    }
    out.push({ q, count: listed.resultSizeEstimate ?? rows.length, rows });
  }
  return out;
}

const proof = {
  started_at: new Date().toISOString(),
  charged_card: false,
  live_crs: false,
  postgrid: false,
  clickfunnels: false,
  assumed_paid: [],
  fund_files: [],
  repair_letters: [],
  uploads: [],
  emails: [],
  bland: [],
  said: null,
  notes: []
};

mkdirSync(EVIDENCE, { recursive: true });

const { db } = await import(join(ROOT, "src/db.mjs"));
const { grant } = await import(join(ROOT, "src/entitlements/entitlements.mjs"));
const { mergeCustomFields } = await import(join(ROOT, "src/workflows/custom-fields.mjs"));
const { buildLetterPack, personalFromClient } = await import(join(ROOT, "src/underwrite/letter-pack.mjs"));
const { runTierEngineFromCrsResult } = await import(join(ROOT, "src/finance/crs-tier.mjs"));
const { gmailConfigFromEnv, createGmailClientFromConfig } = await import(join(ROOT, "src/gmail/index.mjs"));

const UWIQ_CODES = [
  "credit-analysis-report",
  "metro2-letter-pack",
  "credit-optimization-roadmap",
  "funding-snapshot",
  "bank-lender-match-list"
];

for (const code of UWIQ_CODES) {
  const g = await grant(db, {
    orgId: ORG,
    clientId: FUND,
    code,
    grantedBy: STAFF_ID,
    reason: "sim assume paid UWIQ pack 2026-08-25 — owner law, no card charge"
  });
  proof.assumed_paid.push({ client: "Sim Fund Horse", code, ...g });
}

await mergeCustomFields(db, FUND, {
  uw_deliverables_assumed_paid: true,
  uw_deliverables_assumed_paid_at: new Date().toISOString(),
  uw_deliverables_assumed_paid_reason: "owner law 2026-08-25 sims issue as paid"
});
proof.notes.push("Set uw_deliverables_assumed_paid on Sim Fund Horse only. No card charge.");

async function generatePack(clientId, packName, prefix) {
  const client = await db.query(
    `SELECT first_name, last_name, custom_fields FROM clients WHERE id = $1`,
    [clientId]
  );
  const personal = sanitizePersonal(personalFromClient(client.rows[0]));
  const crs = await db.query(
    `SELECT result FROM crs_results WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [clientId]
  );
  if (!crs.rows[0]?.result) {
    return { files: [], reason: "no_crs_result", deliverableCount: 0, deliverableSkip: "no_crs" };
  }
  let engine = null;
  let engineSkip = null;
  try {
    engine = stripEngineSsn(runTierEngineFromCrsResult(crs.rows[0].result, {
      submittedName: personal.name,
      submittedAddress: personal.address
    }));
  } catch (err) {
    engineSkip = String(err && err.message || err).slice(0, 240);
  }
  const pack = await buildLetterPack({ crsResult: engine, personal, pack: packName });
  const saved = [];
  for (const file of pack.files || []) {
    const buf = file.content || file.buffer;
    if (!buf) continue;
    const filename = `${prefix}-${safeName(file.filename || file.type || "file.pdf")}`;
    const path = join(EVIDENCE, filename);
    writeFileSync(path, Buffer.from(buf));
    saved.push({
      filename,
      type: file.type || null,
      bureau: file.bureau || null,
      bytes: Buffer.from(buf).length,
      path: `docs/workflows/four-plus-pulse-2026-08-25-evidence/deliverables/${filename}`,
      subtype: subtypeFromFile(file)
    });
  }
  return {
    ...pack,
    files: saved,
    engineSkip,
    rawCount: (pack.files || []).length
  };
}

proof.notes.push("Generating Fund Horse funding pack (UnderwriteIQ PDFs)...");
const fundPack = await generatePack(FUND, "funding", "fund");
proof.fund_files = fundPack.files;
proof.fund_pack_meta = {
  reason: fundPack.reason || null,
  deliverableCount: fundPack.deliverableCount || 0,
  deliverableSkip: fundPack.deliverableSkip || null,
  summarySkip: fundPack.summarySkip || null,
  engineSkip: fundPack.engineSkip || null
};

proof.notes.push("Generating Repair Horse letter pack...");
const repairPack = await generatePack(REPAIR, "repair", "repair-pack");
proof.repair_pack_files = repairPack.files;
proof.repair_pack_meta = {
  reason: repairPack.reason || null,
  deliverableCount: repairPack.deliverableCount || 0,
  deliverableSkip: repairPack.deliverableSkip || null,
  engineSkip: repairPack.engineSkip || null
};

const letters = await db.query(
  `SELECT id, bureau, round, status, target, body_text, created_at
     FROM dispute_letters
    WHERE client_id = $1
    ORDER BY bureau, round`,
  [REPAIR]
);
const BUREAU_NAME = { EQ: "Equifax", EX: "Experian", TU: "TransUnion" };
for (const row of letters.rows) {
  const bureau = BUREAU_NAME[row.bureau] || row.bureau;
  const base = `repair-${row.bureau}-${row.round}-${row.target}`;
  const txt = redact(row.body_text || "");
  writeFileSync(join(EVIDENCE, `${base}.txt`), txt);
  const pdf = await textPdf(`${bureau} ${row.round} ${row.target} letter`, txt);
  writeFileSync(join(EVIDENCE, `${base}.pdf`), pdf);
  proof.repair_letters.push({
    letter_id: row.id,
    bureau,
    bureau_code: row.bureau,
    round: row.round,
    target: row.target,
    status: row.status,
    created_at: row.created_at,
    staff_url: `https://fundhub.ai/app/inquiry-remover.html`,
    control_panel: `https://fundhub.ai/app/client-control-panel.html?id=${REPAIR}`,
    evidence_pdf: `docs/workflows/four-plus-pulse-2026-08-25-evidence/deliverables/${base}.pdf`,
    evidence_txt: `docs/workflows/four-plus-pulse-2026-08-25-evidence/deliverables/${base}.txt`,
    had_ssn: hasSsn(row.body_text || "")
  });
}

const login = await staffLogin();
proof.staff_login = { ok: login.ok, status: login.status };
if (login.ok) {
  const stage = await apiPost(login.token, "/api/repair/generate", { client_id: REPAIR, round: "R1" });
  proof.repair_stage = {
    status: stage.status,
    ok: stage.json.ok === true,
    already_generated: stage.json.already_generated === true,
    letters: (stage.json.letters || []).map((l) => ({
      bureau: l.bureau,
      letterId: l.letterId || l.letter_id || null,
      target: l.target || "bureau"
    })),
    reason: stage.json.reason || null
  };

  const ctx = await apiGet(login.token, `/api/read/agent-context?client_id=${FUND}`);
  const packText = JSON.stringify(ctx.json || {});
  const saidIdx = packText.indexOf("said:");
  proof.said = {
    http: ctx.status,
    has_said: saidIdx >= 0,
    has_fake_meet: packText.includes("FAKE MEET SIM"),
    snippet: saidIdx >= 0 ? redact(packText.slice(Math.max(0, saidIdx - 20), saidIdx + 80)) : null
  };

  const toUpload = [
    ...fundPack.files.filter((f) => ["credit_analysis_report", "credit_optimization_roadmap", "funding_snapshot", "bank_lender_match_list"].includes(f.subtype)),
    ...proof.repair_letters.map((l) => ({
      filename: l.evidence_pdf.split("/").pop(),
      path: l.evidence_pdf,
      clientId: REPAIR
    }))
  ];
  for (const f of fundPack.files.filter((x) => ["credit_analysis_report", "credit_optimization_roadmap", "funding_snapshot", "bank_lender_match_list"].includes(x.subtype))) {
    const buf = readFileSync(join(ROOT, f.path));
    const up = await uploadPdf(login.token, FUND, f.filename, buf);
    const doc = (up.json.documents || [])[0] || {};
    proof.uploads.push({
      who: "Sim Fund Horse",
      filename: f.filename,
      http: up.status,
      document_id: doc.id || null,
      download: doc.download?.url || doc.download_url || null,
      title: doc.title || null
    });
  }
  for (const l of proof.repair_letters) {
    const buf = readFileSync(join(ROOT, l.evidence_pdf));
    const up = await uploadPdf(login.token, REPAIR, l.evidence_pdf.split("/").pop(), buf);
    const doc = (up.json.documents || [])[0] || {};
    proof.uploads.push({
      who: "Sim Repair Horse",
      filename: l.evidence_pdf.split("/").pop(),
      http: up.status,
      document_id: doc.id || null,
      download: doc.download?.url || doc.download_url || null,
      title: doc.title || null
    });
  }
} else {
  proof.notes.push("Staff login failed — evidence PDFs still written. No live upload.");
}

const gcfg = gmailConfigFromEnv(process.env);
if (gcfg.ready) {
  try {
    const gclient = createGmailClientFromConfig(gcfg);
    proof.emails = await gmailHits(gclient, [
      "to:stanbridgejchris+sim-fund-20260825h@gmail.com",
      "to:stanbridgejchris+sim-repair-20260825h@gmail.com",
      "subject:(UnderwriteIQ OR deliverable OR letter OR correction) newer_than:3d"
    ]);
  } catch (err) {
    proof.emails = [{ error: String(err && err.message || err).slice(0, 180) }];
  }
} else {
  proof.emails = [{ error: "gmail_not_configured", missing: gcfg.missing || [] }];
}

const callIds = [
  { id: "32c76f04-9d7c-4f5f-b9aa-fa7ce02c54bd", who: "Sim Fund Horse" },
  { id: "41f21347-8b40-495d-8e28-3f668cdc6f8c", who: "Sim Fund Horse" },
  { id: "921ec162-ef27-4d0e-a7da-d7755f041b34", who: "Sim Fund Horse" },
  { id: "e0d29f8f-5af5-4d96-9c55-14945a7d52ba", who: "Sim Repair Horse" }
];
for (const c of callIds) {
  const row = await blandCall(c.id);
  proof.bland.push({ who: c.who, ...row });
}

proof.staff_urls = {
  fund_control: `https://fundhub.ai/app/client-control-panel.html?id=${FUND}`,
  fund_finance: `https://fundhub.ai/app/finance-os.html?client_id=${FUND}`,
  fund_docs: `https://fundhub.ai/app/documents.html?client_id=${FUND}`,
  fund_underwrite: `https://fundhub.ai/app/finance-os.html?client_id=${FUND}`,
  repair_control: `https://fundhub.ai/app/client-control-panel.html?id=${REPAIR}`,
  repair_specialist: "https://fundhub.ai/app/inquiry-remover.html",
  repair_docs: `https://fundhub.ai/app/documents.html?client_id=${REPAIR}`
};

proof.finished_at = new Date().toISOString();
writeFileSync(join(EVIDENCE, "PROOF.json"), JSON.stringify(proof, null, 2));
console.log(JSON.stringify({
  ok: true,
  fund_pdfs: proof.fund_files.length,
  repair_letters: proof.repair_letters.length,
  repair_pack_pdfs: (proof.repair_pack_files || []).length,
  uploads: proof.uploads.length,
  emails_queries: proof.emails.length,
  bland: proof.bland.length,
  said: proof.said,
  fund_meta: proof.fund_pack_meta,
  assumed_paid: proof.assumed_paid.map((r) => `${r.code}:${r.granted || r.reason}`)
}, null, 2));

await db.end?.();
process.exit(0);

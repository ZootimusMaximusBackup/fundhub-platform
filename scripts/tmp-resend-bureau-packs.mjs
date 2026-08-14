#!/usr/bin/env node
/**
 * One-shot: resend funding packs with bureau Metro 2 letters attached.
 * Uses Supabase REST when local DATABASE_URL is masked. Reuses last good
 * analysis PDFs (no Claude). Does not drain outbox. Does not --prod.
 */
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import "./load-env.mjs";
import { send as sendResend } from "../src/messaging/providers/resend.mjs";
import {
  buildLetterPack,
  personalFromClient
} from "../src/underwrite/letter-pack.mjs";
import { runTierEngineFromCrsResult } from "../src/finance/crs-tier.mjs";
import { hasFundingAnalysisPdfs } from "../src/underwrite/letter-pack-filter.mjs";

export const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
export const RESEND_TEST_INBOX = "stanbridgejchris@gmail.com";

const PEOPLE = [
  {
    email: "stanbridgejchris+full@gmail.com",
    clientId: "d56838a7-3d62-4dfd-8ed0-ead5dd76cbab",
    messageId: "e9f1db77-c6f6-4ea1-8d3a-028f5809320f",
    crsId: "8b11d0ee-7698-4be3-a721-4e76f2c117a2"
  },
  {
    email: "stanbridgejchris+fpr@gmail.com",
    clientId: "54bdc228-d4ca-4192-8811-6cecbaf62ede",
    messageId: "24cb56bc-5af2-489b-96da-bbe54a04bda1",
    crsId: "00aa25a0-0cb2-4c1a-acaf-1b39204ba549"
  },
  {
    email: "stanbridgejchris+prem@gmail.com",
    clientId: "dad186ff-9dce-4f59-966c-6e3db2ed503d",
    messageId: "fbca752b-316b-4577-b832-2e5e6726a43d",
    crsId: "1b3af2df-d866-4ae9-9798-d387990dbbcc"
  }
];

const KEEP_FROM_LAST = [
  "Credit-Analysis-Report.pdf",
  "Credit-Optimization-Roadmap.pdf",
  "Funding-Snapshot.pdf",
  "Bank-Lender-Match-List.pdf",
  "Capital-Readiness-Summary.pdf"
];

function restConfig() {
  const url = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return {
    url,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    }
  };
}

async function restGet(cfg, path) {
  const res = await fetch(`${cfg.url}/rest/v1/${path}`, { headers: cfg.headers });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) {
    throw new Error(`rest GET ${res.status} ${String(text).slice(0, 180)}`);
  }
  return json;
}

async function restPost(cfg, table, row) {
  const res = await fetch(`${cfg.url}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...cfg.headers, Prefer: "return=representation" },
    body: JSON.stringify(row)
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) {
    throw new Error(`rest POST ${table} ${res.status} ${String(text).slice(0, 240)}`);
  }
  return Array.isArray(json) ? json[0] : json;
}

async function restPatch(cfg, table, filter, row) {
  const res = await fetch(`${cfg.url}/rest/v1/${table}?${filter}`, {
    method: "PATCH",
    headers: { ...cfg.headers, Prefer: "return=representation" },
    body: JSON.stringify(row)
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`rest PATCH ${table} ${res.status} ${String(text).slice(0, 180)}`);
  }
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

function asPdfFile(att) {
  const filename = att?.filename || att?.name;
  const raw = att?.contentBase64 || att?.content;
  if (!filename || !raw) return null;
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), "base64");
  if (buf.subarray(0, 4).toString() !== "%PDF") return null;
  return {
    filename,
    contentType: "application/pdf",
    content: buf,
    contentBase64: buf.toString("base64")
  };
}

function letterish(filename) {
  return /inquiry_|personal_info_|round/i.test(filename || "");
}

async function threadConversation(cfg, { orgId, clientId }) {
  const existing = await restGet(
    cfg,
    `conversations?client_id=eq.${clientId}&channel=eq.email&select=id&limit=1`
  );
  const now = new Date().toISOString();
  if (existing?.[0]?.id) {
    await restPatch(cfg, "conversations", `id=eq.${existing[0].id}`, {
      last_pulse_at: now
    }).catch(() => null);
    return existing[0].id;
  }
  const created = await restPost(cfg, "conversations", {
    org_id: orgId,
    client_id: clientId,
    channel: "email",
    last_pulse_at: now
  }).catch(() => null);
  return created?.id || null;
}

export async function resendBureauPacks() {
  process.env.MESSAGING_DRY_RUN = "0";
  process.env.CRS_ALLOW_LIVE = "0";
  delete process.env.INNGEST_EVENT_KEY;
  const cfg = restConfig();
  if (!cfg) return { ok: false, error: "SUPABASE_SECRET_KEY missing" };

  const people = [];
  for (const row of PEOPLE) {
    const [msgRows, crsRows, clientRows] = await Promise.all([
      restGet(cfg, `messages?id=eq.${row.messageId}&select=attachments,rendered_body,subject`),
      restGet(cfg, `crs_results?id=eq.${row.crsId}&select=result`),
      restGet(cfg, `clients?id=eq.${row.clientId}&select=id,first_name,last_name,custom_fields,outcome_tier`)
    ]);
    const saved = Array.isArray(msgRows?.[0]?.attachments) ? msgRows[0].attachments : [];
    const analysis = [];
    for (const name of KEEP_FROM_LAST) {
      const hit = saved.find((a) => a && a.filename === name);
      const file = hit ? asPdfFile(hit) : null;
      if (file) analysis.push(file);
    }
    const client = clientRows?.[0];
    const crsResult = crsRows?.[0]?.result;
    if (!client || !crsResult) {
      people.push({ email: row.email, dispatch: "skipped", detail: "missing_client_or_crs" });
      continue;
    }
    const personal = personalFromClient(client);
    const engine = runTierEngineFromCrsResult(crsResult, {
      submittedName: personal.name,
      submittedAddress: personal.address
    });
    const pack = await buildLetterPack({
      crsResult: engine,
      personal,
      pack: "funding",
      generateDeliverablesFn: async () => ({ documents: {} })
    });
    const letters = (pack.files || [])
      .filter((f) => letterish(f.filename))
      .map((f) => asPdfFile(f))
      .filter(Boolean);
    const bureau = letters.filter((f) => /round/i.test(f.filename)).map((f) => f.filename);
    const files = [...analysis, ...letters];
    if (!hasFundingAnalysisPdfs(files) || bureau.length === 0) {
      people.push({
        email: row.email,
        dispatch: "skipped",
        detail: !hasFundingAnalysisPdfs(files) ? "missing_analysis" : "no_bureau_letters",
        files: files.map((f) => f.filename),
        bureau
      });
      continue;
    }
    const body = String(msgRows?.[0]?.rendered_body || "").trim()
      || "Your Underwrite IQ analysis pack is ready. The attached PDFs are your funding analysis and bureau letters.";
    const sent = await sendResend({
      to: RESEND_TEST_INBOX,
      subject: "Your Underwrite IQ analysis pack is ready",
      body,
      attachments: files,
      providerRef: `prove:bureau:${row.clientId}:${randomUUID()}`
    });
    if (sent.status !== "sent") {
      people.push({
        email: row.email,
        dispatch: sent.status || "failed",
        detail: sent.error || null,
        bureau,
        files: files.map((f) => f.filename)
      });
      continue;
    }
    const conversationId = await threadConversation(cfg, { orgId: ORG, clientId: row.clientId });
    const stored = files.map((f) => ({
      filename: f.filename,
      contentType: "application/pdf",
      contentBase64: f.contentBase64
    }));
    const inserted = await restPost(cfg, "messages", {
      org_id: ORG,
      client_id: row.clientId,
      conversation_id: conversationId,
      direction: "outbound",
      channel: "email",
      template_key: "EMAIL-U02-ANALYZER-FUNDING-DELIVERY",
      rendered_body: body,
      provider: "resend",
      provider_ref: `prove:bureau:${row.clientId}:${randomUUID()}`,
      status: "sent",
      compliance_check_passed: true,
      to_address: RESEND_TEST_INBOX,
      subject: "Your Underwrite IQ analysis pack is ready",
      attachments: stored,
      attempts: 1,
      last_attempt_at: new Date().toISOString(),
      provider_message_id: sent.providerMessageId || sent.id || null,
      is_demo: false
    });
    people.push({
      email: row.email,
      dispatch: "sent",
      files: files.map((f) => f.filename),
      bureau,
      messageId: inserted?.id || null,
      resendId: Boolean(sent.providerMessageId || sent.id)
    });
  }
  return {
    ok: people.length === 3 && people.every((p) => p.dispatch === "sent"),
    people
  };
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  resendBureauPacks()
    .then((out) => {
      console.log(JSON.stringify(out, null, 2));
      if (!out.ok) process.exitCode = 2;
    })
    .catch((err) => {
      console.error(JSON.stringify({
        ok: false,
        error: String(err && err.message || err).slice(0, 500)
      }));
      process.exitCode = 1;
    });
}

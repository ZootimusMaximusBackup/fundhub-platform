#!/usr/bin/env node
/**
 * One-shot prove: workflow EMAIL-* + remaining passed templates via Resend.
 * Body only. No pack PDFs. Does not drain the paused outbox.
 * Does not flip message_templates.compliance_passed.
 * Temporary — delete after the prove.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { db, close } from "../src/db.mjs";
import { renderTemplate } from "../src/lib/render-template.mjs";
import { isDraftTemplateRow } from "../src/messaging/draft-guard.mjs";
import { dispatchMessage } from "../src/messaging/dispatch.mjs";

export const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
export const RESEND_TEST_INBOX = "stanbridgejchris@gmail.com";
export const SAMPLE_CLIENT_EMAIL = "stanbridgejchris+full@gmail.com";

/** Already proved with giant PDF packs — do not resend. */
export const SKIP_PACKS = Object.freeze([
  "EMAIL-U02-ANALYZER-FUNDING-DELIVERY",
  "EMAIL-DS02-DIY-LETTERS-READY"
]);

/** Owner law: must stay false / unsent. */
export const SKIP_REPAIR_DELIVERY = "EMAIL-U02-ANALYZER-REPAIR-DELIVERY";

export const PASSED_BODY_ONLY = Object.freeze([
  "CONTRACT-REMIND-EMAIL",
  "CONTRACT-SEND-EMAIL",
  "EMAIL-PORTAL-MAGIC-LINK",
  "INVOICE-SENT-EMAIL"
]);

export const WORKFLOW_IF_NOT_DRAFT = Object.freeze([
  "EMAIL-F02-ID-PORTAL-NEEDED",
  "EMAIL-F02-ID-PORTAL-NEEDED-FOLLOWUP",
  "EMAIL-F03-ROUND-SUBMITTED",
  "EMAIL-F04-ROUND-APPROVALS",
  "EMAIL-F06-MISSING-DOCS",
  "EMAIL-F07-FUNDING-LOCKED",
  "EMAIL-F10-INBOX-SETUP",
  "EMAIL-N01-COLD-NURTURE",
  "EMAIL-N02-WARM-NURTURE",
  "EMAIL-N03-HOT-NURTURE",
  "EMAIL-N04-POST-FUNDING",
  "EMAIL-N06-RENEWAL",
  "EMAIL-S02-FINISH-APPLICATION",
  "EMAIL-DPC05-NO-PROGRESS-72H",
  "EMAIL-AX07-FUNDING-PAUSED",
  "EMAIL-C06-DECLINE",
  "EMAIL-DS01-REPAIR-REFERRAL"
]);

export const PROVE_KEYS = Object.freeze([...PASSED_BODY_ONLY, ...WORKFLOW_IF_NOT_DRAFT]);

const GHL_LEFTOVER = /^(FR|BS-FUND|LT-|AF)/i;

export function isGhlLeftoverKey(key) {
  return GHL_LEFTOVER.test(String(key || ""));
}

export function fenceProcessEnv() {
  delete process.env.INNGEST_EVENT_KEY;
  delete process.env.GHL_API_KEY;
  delete process.env.GHL_RELAY_API_KEY;
  process.env.CRS_ALLOW_LIVE = "0";
  process.env.ADAPTERS_DRY_RUN = "0";
  process.env.MESSAGING_DRY_RUN = "0";
}

function sendEnv() {
  return { ...process.env, MESSAGING_DRY_RUN: "0", CRS_ALLOW_LIVE: "0" };
}

function resolveDeps(opts = {}) {
  return {
    db: opts.db || db,
    dispatchMessage: opts.dispatchMessage || dispatchMessage
  };
}

/**
 * Rewrite messages.to_address only. Never touch clients.email.
 * Resend onboarding delivers only to the account inbox, not plus-aliases.
 */
export async function rewriteOutboundToGmail(database, messageId) {
  if (!messageId) return { rewritten: false, detail: "no_message_id" };
  const result = await database.query(
    `UPDATE messages SET to_address = $2 WHERE id = $1 AND direction = 'outbound' RETURNING id, to_address`,
    [messageId, RESEND_TEST_INBOX]
  );
  const row = result.rows?.[0];
  if (!row || String(row.to_address).toLowerCase() !== RESEND_TEST_INBOX) {
    return { rewritten: false, detail: "rewrite_failed" };
  }
  return { rewritten: true, to_address: row.to_address };
}

export function wrapFetch(fetchImpl, statuses) {
  const inner = fetchImpl || globalThis.fetch;
  return async (input, init) => {
    const res = await inner(input, init);
    statuses.push(res.status);
    return res;
  };
}

export function skipReason(key, tpl) {
  if (key === SKIP_REPAIR_DELIVERY) return "skip_repair_delivery";
  if (SKIP_PACKS.includes(key)) return "skip_pack_already_sent";
  if (isGhlLeftoverKey(key)) return "skip_ghl_leftover";
  if (!tpl) return "missing";
  if (String(tpl.channel || "") !== "email") return "skip_not_email";
  if (isDraftTemplateRow(tpl)) return "draft";
  return null;
}

async function loadTemplate(database, key) {
  const { rows } = await database.query(
    `SELECT template_key, channel, subject, body, compliance_passed
       FROM message_templates
      WHERE org_id = $1 AND template_key = $2
      LIMIT 1`,
    [ORG, key]
  );
  return rows[0] || null;
}

async function loadSampleClient(database) {
  const { rows } = await database.query(
    `SELECT id, email, first_name, last_name, custom_fields
       FROM clients
      WHERE org_id = $1 AND lower(email) = lower($2)
      LIMIT 1`,
    [ORG, SAMPLE_CLIENT_EMAIL]
  );
  return rows[0] || null;
}

function mergeContext(client) {
  const fullName = [client.first_name, client.last_name].filter(Boolean).join(" ") || null;
  return {
    contact: {
      ...(client.custom_fields || {}),
      first_name: client.first_name ?? null,
      last_name: client.last_name ?? null,
      name: fullName,
      full_name: fullName,
      email: client.email ?? null
    }
  };
}

export function proveSubject(rendered) {
  const line = String(rendered || "").trim();
  return line ? `[PROVE] ${line}` : "[PROVE]";
}

export async function queueProveRow(database, { client, tpl, key }) {
  const ctx = mergeContext(client);
  const body = renderTemplate(tpl.body || "", ctx);
  const subject = proveSubject(tpl.subject ? renderTemplate(tpl.subject, ctx) : "");
  const providerRef = `prove-p1:${key}:${randomUUID()}`;
  const ins = await database.query(
    `INSERT INTO messages (
       org_id, client_id, direction, channel, template_key, rendered_body,
       provider, provider_ref, status, compliance_check_passed, to_address, subject, attachments
     ) VALUES ($1,$2,'outbound','email',$3,$4,'internal',$5,'queued',true,$6,$7,'[]'::jsonb)
     RETURNING id`,
    [ORG, client.id, key, body, providerRef, client.email, subject]
  );
  return ins.rows[0]?.id || null;
}

export async function dispatchQueued(messageId, deps = {}, extra = {}) {
  if (!messageId) return { outcome: "skipped", detail: "no_message_id" };
  const resolved = resolveDeps(deps);
  const rewrite = await rewriteOutboundToGmail(resolved.db, messageId);
  if (!rewrite.rewritten) {
    return { outcome: "skipped", detail: rewrite.detail };
  }
  const statuses = extra.httpStatuses || [];
  const fetchImpl = extra.fetchImpl
    ? wrapFetch(extra.fetchImpl, statuses)
    : (extra.captureHttp ? wrapFetch(globalThis.fetch, statuses) : extra.fetchImpl);
  const result = await resolved.dispatchMessage(resolved.db, messageId, {
    env: sendEnv(),
    fetchImpl
  });
  return {
    ...result,
    to_address: rewrite.to_address,
    http_status: statuses.length ? statuses[statuses.length - 1] : null
  };
}

export async function proveOneKey(key, { client, deps, extra }) {
  if (key === SKIP_REPAIR_DELIVERY) {
    return { key, skipped: true, reason: "skip_repair_delivery" };
  }
  if (SKIP_PACKS.includes(key)) {
    return { key, skipped: true, reason: "skip_pack_already_sent" };
  }
  if (isGhlLeftoverKey(key)) {
    return { key, skipped: true, reason: "skip_ghl_leftover" };
  }
  const tpl = await loadTemplate(deps.db, key);
  const reason = skipReason(key, tpl);
  if (reason) return { key, skipped: true, reason };
  const messageId = await queueProveRow(deps.db, { client, tpl, key });
  if (!messageId) return { key, skipped: true, reason: "insert_failed" };
  const dispatch = await dispatchQueued(messageId, deps, extra);
  return {
    key,
    skipped: false,
    message_id: messageId,
    outcome: dispatch.outcome || null,
    detail: dispatch.detail || null,
    http_status: dispatch.http_status,
    to_address: dispatch.to_address || null
  };
}

export async function proveEmailChannel(opts = {}) {
  fenceProcessEnv();
  const deps = resolveDeps(opts);
  const client = opts.client || await loadSampleClient(deps.db);
  if (!client) return { ok: false, error: "no_sample_client" };

  const keys = Array.isArray(opts.keys) && opts.keys.length ? opts.keys : [...PROVE_KEYS];
  await writeEvidence(deps.db, client.id, {
    status: "started",
    at: new Date().toISOString(),
    keys
  });
  const results = [];
  for (const key of keys) {
    results.push(await proveOneKey(key, { client, deps, extra: { captureHttp: opts.captureHttp !== false, fetchImpl: opts.fetchImpl } }));
  }

  const sent = results.filter((r) => !r.skipped && r.outcome === "sent");
  const skipped = results.filter((r) => r.skipped);
  const failed = results.filter((r) => !r.skipped && r.outcome !== "sent");
  const out = {
    ok: failed.length === 0,
    status: "done",
    at: new Date().toISOString(),
    client: { id: client.id, email: client.email },
    inbox: RESEND_TEST_INBOX,
    sent: sent.map((r) => ({
      key: r.key,
      message_id: r.message_id,
      outcome: r.outcome,
      http_status: r.http_status
    })),
    skipped: skipped.map((r) => ({ key: r.key, reason: r.reason })),
    failed: failed.map((r) => ({
      key: r.key,
      message_id: r.message_id,
      outcome: r.outcome,
      http_status: r.http_status,
      detail: r.detail == null ? null : String(r.detail).slice(0, 180)
    }))
  };
  await writeEvidence(deps.db, client.id, out);
  return out;
}

export function isUsableDatabaseUrl(url) {
  const value = String(url || "").trim();
  if (!value) return false;
  if (value.includes("****") || /^[*]+$/.test(value.replace(/\s/g, ""))) return false;
  if (/@base(\/|:|$)/.test(value)) return false;
  return /^postgres(ql)?:\/\//i.test(value);
}

export async function writeEvidence(database, clientId, payload) {
  if (!clientId) return;
  await database.query(
    `UPDATE clients
        SET custom_fields = COALESCE(custom_fields, '{}'::jsonb)
          || jsonb_build_object('prove_p1_email', $2::jsonb)
      WHERE id = $1`,
    [clientId, JSON.stringify(payload)]
  );
}

export function ensureDatabaseUrl() {
  if (isUsableDatabaseUrl(process.env.DATABASE_URL)) return { ok: true, source: "env" };
  if (process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return { ok: false, source: "runtime", error: "masked_or_missing" };
  }
  try {
    const value = execFileSync(
      "netlify",
      ["env:get", "DATABASE_URL", "--context", "production"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
    if (!isUsableDatabaseUrl(value)) return { ok: false, source: "netlify", error: "masked_or_empty" };
    process.env.DATABASE_URL = value;
    return { ok: true, source: "netlify" };
  } catch {
    return { ok: false, source: "netlify", error: "env_get_failed" };
  }
}

const isMain = process.argv[1] && String(process.argv[1]).endsWith("tmp-email-channel-prove.mjs");
if (isMain) {
  try {
    if (typeof process.loadEnvFile === "function") process.loadEnvFile(".env");
  } catch { /* missing .env is fine */ }
  const dbUrl = ensureDatabaseUrl();
  if (!dbUrl.ok) {
    console.log(JSON.stringify({ ok: false, error: "DATABASE_URL masked_or_missing" }));
    process.exit(1);
  }
  fenceProcessEnv();
  proveEmailChannel()
    .then((out) => {
      console.log(JSON.stringify(out, null, 2));
      if (!out.ok) process.exitCode = 2;
    })
    .catch((err) => {
      console.error(JSON.stringify({ ok: false, error: String(err && err.message || err).slice(0, 500) }));
      process.exitCode = 1;
    })
    .finally(() => close().catch(() => {}));
}

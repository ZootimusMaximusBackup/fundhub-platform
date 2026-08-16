#!/usr/bin/env node
/**
 * One-shot prove: five sample clients, existing UIQ letter PDFs on Resend.
 * No Claude. No Vercel. No GHL. No SMS. Does not drain the paused outbox.
 * Temporary — delete after the prove.
 */
import { randomUUID } from "node:crypto";
import { db, close } from "../src/db.mjs";
import { fakeStep } from "../src/workflows/test-support.mjs";
import { handle as u02 } from "../src/workflows/u-02-analyzer-complete-delivery.mjs";
import { handle as ds02 } from "../src/workflows/ds-02-diy-letters.mjs";
import { dispatchMessage } from "../src/messaging/dispatch.mjs";
import { sendTemplated } from "../src/workflows/messaging.mjs";

export const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const PHONE = "+16616180865";
const ADDRESS = "1100 LYNHURST LN, DENTON, TX 76205";
const SOURCE_CRS = "26fd1c2c-9bd5-464e-91c9-13c5f2fab463";

export const ROSTER = [
  { key: "full", email: "stanbridgejchris+full@gmail.com", first: "Chris", last: "Full", tier: "FULL_FUNDING", mail: "funding" },
  { key: "fpr", email: "stanbridgejchris+fpr@gmail.com", first: "Chris", last: "Fpr", tier: "FUNDING_PLUS_REPAIR", mail: "funding" },
  { key: "prem", email: "stanbridgejchris+prem@gmail.com", first: "Chris", last: "Prem", tier: "PREMIUM_STACK", mail: "funding" },
  { key: "repair", email: "stanbridgejchris+repair@gmail.com", first: "Chris", last: "Repair", tier: "REPAIR_ONLY", mail: "repair" },
  { key: "review", email: "stanbridgejchris+review@gmail.com", first: "Chris", last: "Review", tier: "MANUAL_REVIEW", mail: "none" }
];

/** Resend onboarding rejects plus-aliases. Client rows keep unique plus-alias emails. */
export const RESEND_TEST_INBOX = "stanbridgejchris@gmail.com";

export function fenceProcessEnv() {
  delete process.env.INNGEST_EVENT_KEY;
  delete process.env.GHL_API_KEY;
  delete process.env.GHL_RELAY_API_KEY;
  process.env.CRS_ALLOW_LIVE = "0";
  process.env.ADAPTERS_DRY_RUN = "0";
  process.env.MESSAGING_DRY_RUN = "0";
  if (!process.env.CLAUDE_TIMEOUT) process.env.CLAUDE_TIMEOUT = "180000";
}

function sendEnv() {
  return { ...process.env, MESSAGING_DRY_RUN: "0", CRS_ALLOW_LIVE: "0" };
}

function resolveDeps(opts = {}) {
  return {
    db: opts.db || db,
    dispatchMessage: opts.dispatchMessage || dispatchMessage,
    sendTemplated: opts.sendTemplated || sendTemplated,
    u02: opts.u02 || u02,
    ds02: opts.ds02 || ds02,
    buildLetterPackForClient: opts.buildLetterPackForClient || null
  };
}

function reviewEmails() {
  return ROSTER.filter((r) => r.mail === "none" || r.tier === "MANUAL_REVIEW")
    .map((r) => r.email.toLowerCase());
}

async function loadBuildPack(deps) {
  if (deps.buildLetterPackForClient) return deps.buildLetterPackForClient;
  const mod = await import("../src/underwrite/letter-pack.mjs");
  return mod.buildLetterPackForClient;
}

async function upsertClient(database, row) {
  const found = await database.query(
    `SELECT id FROM clients WHERE org_id = $1 AND lower(email) = lower($2) LIMIT 1`,
    [ORG, row.email]
  );
  const fields = JSON.stringify({ address: ADDRESS, sample_roster: row.key });
  if (found.rows[0]) {
    await database.query(
      `UPDATE clients
          SET first_name = $2, last_name = $3, phone = $4, outcome_tier = $5,
              custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $6::jsonb
        WHERE id = $1`,
      [found.rows[0].id, row.first, row.last, PHONE, row.tier, fields]
    );
    return found.rows[0].id;
  }
  const ins = await database.query(
    `INSERT INTO clients (org_id, first_name, last_name, email, phone, outcome_tier, custom_fields)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
     RETURNING id`,
    [ORG, row.first, row.last, row.email, PHONE, row.tier, fields]
  );
  return ins.rows[0].id;
}

async function copyCrs(database, clientId, tier) {
  const have = await database.query(
    `SELECT id FROM crs_results WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [clientId]
  );
  if (have.rows[0]) {
    await database.query(`UPDATE crs_results SET outcome_tier = $2 WHERE id = $1`, [have.rows[0].id, tier]);
    return have.rows[0].id;
  }
  const ins = await database.query(
    `INSERT INTO crs_results (org_id, client_id, result, outcome_tier)
     SELECT org_id, $1, result, $2 FROM crs_results WHERE id = $3
     RETURNING id`,
    [clientId, tier, SOURCE_CRS]
  );
  return ins.rows[0]?.id || null;
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

export async function dispatchQueued(messageId, deps = {}) {
  if (!messageId) return { outcome: "skipped", detail: "no_message_id" };
  const resolved = resolveDeps(deps);
  const rewrite = await rewriteOutboundToGmail(resolved.db, messageId);
  if (!rewrite.rewritten) {
    return { outcome: "skipped", detail: rewrite.detail };
  }
  return resolved.dispatchMessage(resolved.db, messageId, { env: sendEnv() });
}

export async function retryHeldSampleMail(opts = {}) {
  const deps = resolveDeps(opts);
  const blocked = reviewEmails();
  const { rows } = await deps.db.query(
    `SELECT m.id
       FROM messages m
       JOIN clients c ON c.id = m.client_id
      WHERE c.org_id = $1
        AND c.email ILIKE 'stanbridgejchris+%'
        AND lower(c.email) <> ALL($2::text[])
        AND m.direction = 'outbound'
        AND m.status = 'queued'
        AND jsonb_array_length(COALESCE(m.attachments, '[]'::jsonb)) > 0
        AND m.attempts < 5
      ORDER BY m.created_at`,
    [ORG, blocked]
  );
  const results = [];
  for (const row of rows) {
    results.push({ id: row.id, ...(await dispatchQueued(row.id, deps)) });
  }
  return { ok: results.every((r) => r.outcome === "sent"), count: results.length, results };
}

export async function sendUiqDeliverables(opts = {}) {
  const deps = resolveDeps(opts);
  const blocked = new Set(reviewEmails());
  const emails = (Array.isArray(opts.emails) && opts.emails.length
    ? opts.emails
    : ROSTER.filter((r) => r.mail === "funding").map((r) => r.email)
  ).filter((e) => !blocked.has(String(e).toLowerCase()));
  if (!emails.length) return { ok: false, error: "no_clients" };
  const found = await deps.db.query(
    `SELECT id, email FROM clients WHERE org_id = $1 AND lower(email) = ANY($2::text[])`,
    [ORG, emails.map((e) => e.toLowerCase())]
  );
  const sendable = found.rows.filter((row) => !blocked.has(String(row.email).toLowerCase()));
  if (!sendable.length) return { ok: false, error: "no_clients" };
  const buildPack = await loadBuildPack(deps);
  const pack = await buildPack(deps.db, { clientId: sendable[0].id, pack: "funding" });
  const names = (pack.files || []).map((f) => f.filename);
  const analysisNames = names.filter((n) =>
    /analysis|roadmap|snapshot|lender-match|lender_match/i.test(n)
  );
  if (analysisNames.length < 4) {
    return {
      ok: false,
      error: "missing_uiq_docs",
      files: names,
      deliverableCount: pack.deliverableCount || 0,
      deliverableSkip: pack.deliverableSkip || null,
      engineSkip: pack.engineSkip || null,
      hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY)
    };
  }
  const people = [];
  for (const row of sendable) {
    const queued = await deps.sendTemplated(deps.db, {
      orgId: ORG,
      clientId: row.id,
      channel: "email",
      templateKey: "EMAIL-U02-ANALYZER-FUNDING-DELIVERY",
      eventId: randomUUID(),
      attachments: pack.files,
      subject: "Your Underwrite IQ analysis pack is ready"
    });
    const dispatch = queued.sent && queued.messageId
      ? await dispatchQueued(queued.messageId, deps)
      : { outcome: "skipped", detail: queued.reason };
    await deps.db.query(
      `UPDATE clients
          SET custom_fields = COALESCE(custom_fields, '{}'::jsonb)
            || jsonb_build_object('prove_uiq_deliverables', $2::jsonb)
        WHERE id = $1`,
      [row.id, JSON.stringify({
        at: new Date().toISOString(),
        fileCount: pack.files.length,
        deliverableCount: pack.deliverableCount || 0,
        files: names,
        dispatch: dispatch.outcome || null,
        messageId: queued.messageId || null
      })]
    );
    people.push({
      email: row.email,
      dispatch: dispatch.outcome,
      messageId: queued.messageId || null
    });
  }
  return {
    ok: people.every((p) => p.dispatch === "sent"),
    fileCount: pack.files.length,
    deliverableCount: pack.deliverableCount || 0,
    files: names,
    people
  };
}

function analysisEvent(clientId, tier) {
  return {
    id: randomUUID(),
    orgId: ORG,
    clientId,
    name: "analysis.completed",
    payload: { source: "crs", identityOk: true, outcomeTier: tier, scores: { ex: 650 } }
  };
}

export async function runGauntlet(opts = {}) {
  const deps = resolveDeps(opts);
  const step = fakeStep();
  const people = [];

  for (const row of ROSTER) {
    const clientId = await upsertClient(deps.db, row);
    const crsId = await copyCrs(deps.db, clientId, row.tier);
    const rec = { ...row, clientId, crsId, emailQueued: false, dispatch: null, u02: null, ds02: null };
    people.push(rec);
  }

  const fundingPackOnce = people.find((p) => p.mail === "funding");
  let sharedFunding = null;
  if (fundingPackOnce) {
    const buildPack = await loadBuildPack(deps);
    sharedFunding = await buildPack(deps.db, { clientId: fundingPackOnce.clientId, pack: "funding" });
  }

  for (const rec of people) {
    if (rec.mail === "funding") {
      rec.u02 = await deps.u02({
        event: analysisEvent(rec.clientId, rec.tier),
        db: deps.db,
        step,
        generatePack: async () => sharedFunding
      });
      rec.emailQueued = !!(rec.u02?.email?.sent && rec.u02?.email?.messageId);
      rec.dispatch = rec.emailQueued ? await dispatchQueued(rec.u02.email.messageId, deps) : { outcome: "skipped", detail: rec.u02?.email?.reason || rec.u02?.reason };
    } else if (rec.mail === "repair") {
      rec.ds02 = await deps.ds02({
        event: {
          id: randomUUID(),
          orgId: ORG,
          clientId: rec.clientId,
          name: "payment.received",
          payload: { productName: "Consulting Services Package", amount: 1000 }
        },
        db: deps.db,
        step
      });
      rec.emailQueued = !!(rec.ds02?.email?.sent && rec.ds02?.email?.messageId);
      rec.dispatch = rec.emailQueued ? await dispatchQueued(rec.ds02.email.messageId, deps) : { outcome: "skipped", detail: rec.ds02?.email?.reason || rec.ds02?.reason };
    } else {
      rec.u02 = await deps.u02({
        event: analysisEvent(rec.clientId, rec.tier),
        db: deps.db,
        step,
        generatePack: async () => ({ files: [] })
      });
      rec.emailQueued = false;
      rec.dispatch = { outcome: "skipped", detail: rec.u02?.branch || "no_pack_on_review" };
    }

    await deps.db.query(
      `UPDATE clients
          SET custom_fields = COALESCE(custom_fields, '{}'::jsonb)
            || jsonb_build_object('prove_letter_pack', $2::jsonb)
        WHERE id = $1`,
      [rec.clientId, JSON.stringify({
        key: rec.key,
        tier: rec.tier,
        branch: rec.u02?.branch || rec.ds02?.done && "repair",
        attachmentCount: rec.u02?.attachmentCount || rec.ds02?.email?.attachmentCount || 0,
        dispatch: rec.dispatch?.outcome || null,
        at: new Date().toISOString()
      })]
    );
  }

  const fundingSent = people.filter((p) => p.mail === "funding" && p.dispatch?.outcome === "sent").length;
  const repairSent = people.filter((p) => p.mail === "repair" && p.dispatch?.outcome === "sent").length;
  const reviewQuiet = people.filter((p) => p.mail === "none" && p.dispatch?.outcome !== "sent").length;
  const ok = fundingSent === 3 && repairSent === 1 && reviewQuiet === 1;

  return {
    ok,
    funding_pdfs: sharedFunding?.files?.length || 0,
    people: people.map((p) => ({
      key: p.key,
      email: p.email,
      tier: p.tier,
      clientId: p.clientId,
      branch: p.u02?.branch || (p.ds02 ? "ds02" : null),
      queued: p.emailQueued,
      attachments: p.u02?.attachmentCount || p.ds02?.email?.attachmentCount || 0,
      dispatch: p.dispatch?.outcome || null,
      detail: p.dispatch?.detail || p.u02?.email?.reason || p.ds02?.email?.reason || null
    }))
  };
}

const isMain = process.argv[1] && String(process.argv[1]).endsWith("tmp-letter-gauntlet.mjs");
if (isMain) {
  fenceProcessEnv();
  runGauntlet()
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

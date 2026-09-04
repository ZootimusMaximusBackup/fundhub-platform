#!/usr/bin/env node
// scripts/sim/push-payment.mjs — post a signed "paid" receipt for a client's
// newest open pay link, so the site treats it exactly like a Commas payment.
//
//   DATABASE_URL=… COMMAS_WEBHOOK_SECRET=… node scripts/sim/push-payment.mjs \
//     --email stanbridgejchris+sim-01@gmail.com [--ref <link_ref>] [--site https://fundhub.ai] [--dry]
//
// For the manual walkthrough. There is no test mode at Commas / Fanbasis; every
// real checkout is a real charge. This skips the card and starts at the webhook:
// the same POST /api/webhooks/commas, the same HMAC signature, the same
// api_metadata.link_ref the real checkout carries, so purpose, product and
// client resolve from OUR payment_links row (src/adapters/commas.mjs) and every
// downstream handler — money chain, entitlements, purchase routing, offer
// bucket — runs unchanged. The inbox sweeper drains it within a minute.
//
// REFUSES a `diagnostic` ($32 soft pull) link unless --allow-diagnostic is
// given: paying that link fires diagnostic.paid → workflow C-00 → a REAL bureau
// pull on live. For the walkthrough, credit goes in with push-credit.mjs
// instead. Nothing here charges anyone.

import crypto from "node:crypto";
import { pool, close } from "../../src/db.mjs";
import { resolveDefaultOrg } from "../../src/auth/org.mjs";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}

export function buildReceipt({ link, email, productName, paymentId }) {
  return {
    id: `sim-evt-${paymentId}`,
    type: "payment.succeeded",
    data: {
      payment_id: paymentId,
      amount: Number(link.amount_cents) / 100,
      currency: link.currency || "USD",
      product: { title: productName },
      fan: { email },
      api_metadata: { data: { link_ref: link.link_ref, client_id: link.client_id, org_id: link.org_id } },
      simulated: true,
      simulated_notice: "SIMULATED receipt — manual walkthrough 2026-09-03. No card was charged."
    }
  };
}

export function sign(raw, secret) {
  return crypto.createHmac("sha256", secret).update(raw).digest("hex");
}

/* looksMasked — is this value Netlify's redaction rather than the key itself?
   `netlify env:get` on a var stored with --secret returns a short run of
   asterisks. Signing with that produces a valid-looking HMAC of the wrong bytes,
   so the site answers 401 and the failure reads like a signature bug instead of
   a missing value. Four or more asterisks is not a real key. */
export function looksMasked(value) {
  const v = String(value || "");
  const stars = (v.match(/\*/g) || []).length;
  return stars >= 4;
}

async function main() {
  const email = String(arg("email", "")).trim().toLowerCase();
  const refArg = arg("ref");
  const site = String(arg("site", "https://fundhub.ai")).replace(/\/$/, "");
  const dry = process.argv.includes("--dry");
  const allowDiagnostic = process.argv.includes("--allow-diagnostic");
  if (!email) {
    console.error("usage: node scripts/sim/push-payment.mjs --email <client email> [--ref <link_ref>] [--site https://fundhub.ai] [--dry]");
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(2); }
  /* SIM_WEBHOOK_SECRET FIRST, and this order is the whole point of it existing.
     COMMAS_WEBHOOK_SECRET is a Netlify --secret, so `netlify env:get` returns a
     mask of asterisks and every receipt signed with it was refused 401 (F26,
     2026-09-03). SIM_WEBHOOK_SECRET is set without --secret, so it reads back
     whole. The site accepts it only for a body carrying `simulated: true`, which
     buildReceipt below always stamps. The live key still works if it is real. */
  const secret = process.env.SIM_WEBHOOK_SECRET || process.env.COMMAS_WEBHOOK_SECRET;
  if (!secret && !dry) {
    console.error("neither SIM_WEBHOOK_SECRET nor COMMAS_WEBHOOK_SECRET is set (needed to sign the receipt)");
    process.exit(2);
  }
  /* A masked value signs asterisks and produces a 401 that reads like a broken
     signature. Say what it actually is, before the request goes out. */
  if (secret && !dry && looksMasked(secret)) {
    console.error("the signing key came back MASKED (mostly asterisks), so the receipt would be signed with asterisks and refused.");
    console.error("set SIM_WEBHOOK_SECRET on Netlify WITHOUT --secret, or export it locally, then run again.");
    process.exit(2);
  }

  const db = pool();
  const orgId = await resolveDefaultOrg(db);
  const c = (await db.query(
    `SELECT id, first_name, last_name FROM clients WHERE org_id = $1 AND lower(email) = $2 ORDER BY created_at DESC LIMIT 1`,
    [orgId, email]
  )).rows[0];
  if (!c) { console.error(`no client with email ${email}`); process.exit(1); }

  const link = (await db.query(
    `SELECT pl.*, p.name AS product_name, p.code AS product_code
       FROM payment_links pl LEFT JOIN products p ON p.id = pl.product_id
      WHERE pl.org_id = $1 AND pl.client_id = $2
        AND ($3::text IS NULL OR pl.link_ref = $3)
        AND pl.status IN ('created', 'sent')
      ORDER BY pl.created_at DESC LIMIT 1`,
    [orgId, c.id, refArg]
  )).rows[0];
  if (!link) {
    console.error(`no OPEN pay link for ${email}${refArg ? ` with ref ${refArg}` : ""}. Send the pay link from Present first, then run this.`);
    process.exit(1);
  }
  if (link.purpose === "diagnostic" && !allowDiagnostic) {
    console.error(`refusing: newest open link is the $32 soft pull (purpose diagnostic). Paying it triggers a REAL bureau pull on live. Use push-credit.mjs for credit. Pass --allow-diagnostic only if you mean it.`);
    process.exit(1);
  }

  const productName = link.product_name || link.description || "Simulated purchase";
  const paymentId = `sim-pay-${Date.now()}`;
  const body = buildReceipt({ link, email, productName, paymentId });
  const raw = JSON.stringify(body);

  console.log(`client   ${[c.first_name, c.last_name].filter(Boolean).join(" ")} <${email}>`);
  console.log(`link     ${link.link_ref} · purpose ${link.purpose} · product ${link.product_code || "none"} (${productName}) · $${(Number(link.amount_cents) / 100).toFixed(2)} · status ${link.status}`);
  console.log(`receipt  payment_id ${paymentId} → POST ${site}/api/webhooks/commas`);
  if (dry) { console.log("dry run — nothing posted"); await close(); return; }

  const res = await fetch(`${site}/api/webhooks/commas`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-webhook-signature": sign(raw, secret) },
    body: raw
  });
  const text = await res.text();
  console.log(`site     HTTP ${res.status} ${text.slice(0, 200)}`);
  if (!res.ok) { await close(); process.exit(1); }
  console.log("next     the inbox sweeper runs every minute; the link flips to paid and payment.received fires. Refresh the screen in ~60s.");
  await close();
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(async (e) => { console.error(e); try { await close(); } catch { /* noop */ } process.exit(1); });
}

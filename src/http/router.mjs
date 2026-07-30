// Webhook router — the single entrypoint every inbound provider webhook flows
// through. Framework-agnostic: takes the raw request pieces, picks the adapter,
// hands it the right signature header + secret, and returns { status, body }.
// The thin Vercel function in api/webhooks/[provider].mjs just adapts req/res to
// this. Handlers are registered on first call so a cold serverless start still
// wires the reactions before dispatching.

import { ensureRegistered } from "../register-all.mjs";
import { handleCommasWebhook } from "../adapters/commas.mjs";
import { handleClickFunnelsWebhook } from "../adapters/clickfunnels.mjs";
import { handleBlandWebhook } from "../adapters/bland.mjs";
import { handleCalcomWebhook } from "../adapters/calcom.mjs";
import { handleTwilioWebhook } from "../adapters/twilio.mjs";
import { handleMailgunWebhook } from "../adapters/mailgun.mjs";
import { handleLendflowWebhook, SIGNATURE_HEADER as LENDFLOW_SIG } from "../adapters/lendflow.mjs";

// Standard HMAC-body adapters: same {db, rawBody, signatureHeader, secret} shape.
const STD = {
  commas: { fn: handleCommasWebhook, sig: "x-commas-signature", env: "COMMAS_WEBHOOK_SECRET" },
  clickfunnels: { fn: handleClickFunnelsWebhook, sig: "x-clickfunnels-signature", env: "CLICKFUNNELS_WEBHOOK_SECRET" },
  bland: { fn: handleBlandWebhook, sig: "x-bland-signature", env: "BLAND_WEBHOOK_SECRET" },
  calcom: { fn: handleCalcomWebhook, sig: "x-cal-signature-256", env: "CALCOM_WEBHOOK_SECRET" },
  /* lendflow was written, tested and documented as live — and never registered
     here, so /api/webhooks/lendflow answered 404. It is the SOLE emitter of
     round.started / round.submitted / round.approved / round.funded, so eight
     workflows (f-02, f-03, f-04, f-07, f-08, f-10, sys-01, bc-02) and back-end
     commission accrual had no trigger at all. The adapter's own header comment
     points at this table as the place the wiring belongs. */
  lendflow: { fn: handleLendflowWebhook, sig: LENDFLOW_SIG, env: "LENDFLOW_WEBHOOK_SECRET" }
};

const norm = (res) => ({ status: res.status || (res.ok ? 200 : 400), body: res });

// handleWebhook({ db, provider, rawBody, headers, url, env }) → { status, body }
export async function handleWebhook({ db, provider, rawBody, headers = {}, url, env = process.env }) {
  ensureRegistered();
  const h = (name) => headers[name] ?? headers[String(name).toLowerCase()];

  // Twilio: urlencoded body + signature over the full URL + params (adapter parses).
  if (provider === "twilio") {
    return norm(await handleTwilioWebhook({
      db, rawBody, signatureHeader: h("x-twilio-signature"), secret: env.TWILIO_AUTH_TOKEN, url
    }));
  }

  // Mailgun: JSON body, signature fields live inside it, keyed by the signing key.
  if (provider === "mailgun") {
    let body;
    try { body = rawBody ? JSON.parse(rawBody) : {}; }
    catch { return { status: 400, body: { ok: false, error: "invalid_json" } }; }
    return norm(await handleMailgunWebhook({ db, body, signingKey: env.MAILGUN_SIGNING_KEY }));
  }

  const cfg = STD[provider];
  if (!cfg) return { status: 404, body: { ok: false, error: `unknown provider: ${provider}` } };
  return norm(await cfg.fn({ db, rawBody, signatureHeader: h(cfg.sig), secret: env[cfg.env] }));
}

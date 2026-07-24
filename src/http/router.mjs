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

// Standard HMAC-body adapters: same {db, rawBody, signatureHeader, secret} shape.
const STD = {
  commas: { fn: handleCommasWebhook, sig: "x-commas-signature", env: "COMMAS_WEBHOOK_SECRET" },
  clickfunnels: { fn: handleClickFunnelsWebhook, sig: "x-clickfunnels-signature", env: "CLICKFUNNELS_WEBHOOK_SECRET" },
  bland: { fn: handleBlandWebhook, sig: "x-bland-signature", env: "BLAND_WEBHOOK_SECRET" },
  calcom: { fn: handleCalcomWebhook, sig: "x-cal-signature-256", env: "CALCOM_WEBHOOK_SECRET" }
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

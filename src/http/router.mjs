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
import { handleMailgunWebhook, handleMailgunDeliveryEvent } from "../adapters/mailgun.mjs";
import { handleTwilioStatusWebhook } from "../adapters/twilio-status.mjs";
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

  /* DELIVERY STATUS CALLBACKS — GHL cutover Ticket 2.
     /api/webhooks/twilio-status and /api/webhooks/mailgun-events.

     Registered here rather than as their own entries in the ROUTES map in
     netlify/functions/api.mjs, deliberately. That map's exact keys are looked up
     before the `webhooks/` prefix branch, so a key there would work — and
     src/http/routes.test.mjs asserts nobody adds one, because it would work only
     for as long as those two lookups stay in that order. These reach the same
     door every other provider webhook uses and depend on no ordering at all.

     They are separate provider ids rather than a branch inside the inbound
     handlers because the two directions verify the same signature over
     different payloads and must not share a code path: an inbound bank email
     and a bounce notice are not the same event, and the adapter that conflated
     them is the bug Ticket 2 exists to fix. */
  if (provider === "twilio-status") {
    return norm(await handleTwilioStatusWebhook({
      db, rawBody, signatureHeader: h("x-twilio-signature"), secret: env.TWILIO_AUTH_TOKEN, url
    }));
  }

  if (provider === "mailgun-events") {
    let body;
    try { body = rawBody ? JSON.parse(rawBody) : {}; }
    catch { return { status: 400, body: { ok: false, error: "invalid_json" } }; }
    return norm(await handleMailgunDeliveryEvent({ db, body, signingKey: env.MAILGUN_SIGNING_KEY }));
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

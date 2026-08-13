// Webhook router — the single entrypoint every inbound provider webhook flows
// through. Framework-agnostic: takes the raw request pieces, picks the adapter,
// hands it the right signature header + secret, and returns { status, body }.
// The thin Vercel function in api/webhooks/[provider].mjs just adapts req/res to
// this. Handlers are registered on first call so a cold serverless start still
// wires the reactions before dispatching.

import { ensureRegistered } from "../register-all.mjs";
import {
  handleCommasWebhook,
  SIGNATURE_HEADERS as COMMAS_SIG_HEADERS
} from "../adapters/commas.mjs";
import { handleClickFunnelsWebhook } from "../adapters/clickfunnels.mjs";
import { handleBlandWebhook } from "../adapters/bland.mjs";
import { handleCalcomWebhook } from "../adapters/calcom.mjs";
import { handleTwilioWebhook } from "../adapters/twilio.mjs";
import { handleMailgunWebhook, handleMailgunDeliveryEvent } from "../adapters/mailgun.mjs";
import { handleTwilioStatusWebhook } from "../adapters/twilio-status.mjs";
import { handleLendflowWebhook, SIGNATURE_HEADER as LENDFLOW_SIG } from "../adapters/lendflow.mjs";
import {
  handleInquiryRemovalWebhook,
  SIGNATURE_HEADER as INQUIRY_REMOVAL_SIG
} from "../adapters/inquiry-removal.mjs";
import {
  verifyMailWebhook,
  parseMailDeliveryEvent
} from "../messaging/providers/mail-letter.mjs";
import { onMailDelivered } from "../inquiry-ops/call-scheduler.mjs";

// Standard HMAC-body adapters: same {db, rawBody, signatureHeader, secret} shape.
const STD = {
  /* `sig` may be a LIST, tried in order. Commas signs with
     `x-webhook-signature`; this table named `x-commas-signature`, which no
     delivery has ever carried, so every real payment webhook failed
     verification and answered 401. The old name is kept as a fallback. */
  commas: { fn: handleCommasWebhook, sig: COMMAS_SIG_HEADERS, env: "COMMAS_WEBHOOK_SECRET" },
  /* CF 2.0 docs: X-Webhook-ClickFunnels-Signature (+ Timestamp). Legacy
     x-clickfunnels-signature kept as fallback for internal probes. */
  clickfunnels: {
    fn: handleClickFunnelsWebhook,
    sig: ["x-webhook-clickfunnels-signature", "x-clickfunnels-signature"],
    env: "CLICKFUNNELS_WEBHOOK_SECRET"
  },
  bland: { fn: handleBlandWebhook, sig: "x-bland-signature", env: "BLAND_WEBHOOK_SECRET" },
  calcom: { fn: handleCalcomWebhook, sig: "x-cal-signature-256", env: "CALCOM_WEBHOOK_SECRET" },
  /* lendflow was written, tested and documented as live — and never registered
     here, so /api/webhooks/lendflow answered 404. It is the SOLE emitter of
     round.started / round.submitted / round.approved / round.funded, so eight
     workflows (f-02, f-03, f-04, f-07, f-08, f-10, sys-01, bc-02) and back-end
     commission accrual had no trigger at all. The adapter's own header comment
     points at this table as the place the wiring belongs. */
  lendflow: { fn: handleLendflowWebhook, sig: LENDFLOW_SIG, env: "LENDFLOW_WEBHOOK_SECRET" },
  /* IRA runtime → platform bridge. Writes inquiry_removal_cases / inquiry_log
     and emits inquiry.removed when a case clears. */
  "inquiry-removal": {
    fn: handleInquiryRemovalWebhook,
    sig: INQUIRY_REMOVAL_SIG,
    env: "INQUIRY_REMOVAL_WEBHOOK_SECRET"
  }
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

  // PostGrid letter delivery — call clock starts on delivery.confirmed only.
  if (provider === "postgrid") {
    if (!verifyMailWebhook(rawBody, headers, env)) {
      return { status: 401, body: { ok: false, error: "invalid_signature" } };
    }
    let body;
    try { body = rawBody ? JSON.parse(rawBody) : {}; }
    catch { return { status: 400, body: { ok: false, error: "invalid_json" } }; }
    const parsed = parseMailDeliveryEvent(body);
    if (!parsed.delivered) {
      return { status: 200, body: { ok: true, ignored: true, eventType: parsed.eventType } };
    }
    const result = await onMailDelivered(db, {
      providerId: parsed.letterId,
      deliveredAt: parsed.deliveredAt
    });
    return { status: 200, body: { ok: true, ...result } };
  }

  const cfg = STD[provider];
  if (!cfg) return { status: 404, body: { ok: false, error: `unknown provider: ${provider}` } };
  /* cfg.sig is one header name or a list of them, tried in order. First one
     actually present on the request wins; a provider that renamed its header
     keeps working through the old name without a second code path. */
  const signatureHeader = [].concat(cfg.sig).map((name) => h(name)).find(Boolean);
  return norm(await cfg.fn({
    db, rawBody, signatureHeader, secret: env[cfg.env], headers
  }));
}

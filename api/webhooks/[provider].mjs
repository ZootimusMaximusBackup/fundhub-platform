// Vercel serverless entry for all inbound provider webhooks.
//   POST /api/webhooks/commas   → Commas payments
//   POST /api/webhooks/twilio   → inbound SMS
//   POST /api/webhooks/mailgun  → bank inbox
//   POST /api/webhooks/bland    → voice calls
//   POST /api/webhooks/clickfunnels → funnel entry/survey
// Raw body is required (adapters verify signatures over the exact bytes), so the
// body parser is disabled and we read the stream ourselves.

import { handleWebhook } from "../../src/http/router.mjs";
import { db } from "../../src/db.mjs";

export const config = { api: { bodyParser: false } };

/* readRawBody — the exact bytes the provider signed.

   TWO RUNTIMES, TWO SHAPES. On Vercel `req` is a Node stream and the body parser
   is disabled above, so it has to be drained. On Netlify — the only deployed
   target — netlify/functions/api.mjs has ALREADY read the body and hands the
   handler a plain object carrying `rawBody`. Iterating that object threw
   "req is not async iterable", which the adapter turned into a 500, so every
   inbound webhook from all six providers died before signature verification ever
   ran. Prefer the string the adapter already computed; drain only if it is
   genuinely a stream. */
async function readRawBody(req) {
  if (typeof req?.rawBody === "string") return req.rawBody;
  if (Buffer.isBuffer(req?.rawBody)) return req.rawBody.toString("utf8");
  // A body-parsed object is NOT usable: re-serialising it would not reproduce
  // the bytes the provider signed, so a signature check over it would fail in a
  // way that looks like an attack rather than a bug. Say so instead.
  if (req && typeof req[Symbol.asyncIterator] === "function") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8");
  }
  throw new Error("no raw body available — signature cannot be verified over re-serialised JSON");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  const provider = req.query?.provider;
  const url = `https://${req.headers.host}${req.url}`;
  try {
    // Inside the try. This used to sit outside it, so a body-reading failure
    // escaped to the platform's generic catch as an opaque 500.
    const rawBody = await readRawBody(req);
    const out = await handleWebhook({ db, provider, rawBody, headers: req.headers, url });
    if (out.body?.twiml) {
      res.setHeader("Content-Type", out.body.contentType || "text/xml");
      res.status(out.status).send(out.body.twiml);
      return;
    }
    res.status(out.status).json(out.body);
  } catch (err) {
    res.status(500).json({ ok: false, error: "Internal error" });
  }
}

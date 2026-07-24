// Vercel serverless entry for all inbound provider webhooks.
//   POST /api/webhooks/commas   → Commas payments
//   POST /api/webhooks/twilio   → inbound SMS
//   POST /api/webhooks/mailgun  → bank inbox
//   POST /api/webhooks/calcom   → bookings
//   POST /api/webhooks/bland    → voice calls
//   POST /api/webhooks/clickfunnels → funnel entry/survey
// Raw body is required (adapters verify signatures over the exact bytes), so the
// body parser is disabled and we read the stream ourselves.

import { handleWebhook } from "../../src/http/router.mjs";
import { db } from "../../src/db.mjs";

export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  const provider = req.query?.provider;
  const rawBody = await readRawBody(req);
  const url = `https://${req.headers.host}${req.url}`;
  try {
    const out = await handleWebhook({ db, provider, rawBody, headers: req.headers, url });
    res.status(out.status).json(out.body);
  } catch (err) {
    res.status(500).json({ ok: false, error: "Internal error" });
  }
}

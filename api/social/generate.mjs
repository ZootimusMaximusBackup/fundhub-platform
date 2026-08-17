// POST /api/social/generate — write post captions from the partner's brand.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { resolvePartnerId } from "../../src/http/partner-read-api.mjs";
import { withPartnerScope } from "../../src/partners/rls.mjs";
import { safeError } from "../../src/http/health.mjs";
import { callModel, DEFAULT_MODEL } from "../../src/agents/model.mjs";
import { screen } from "../../src/compliance/screen.mjs";
import {
  assertSuiteEnabled, assertUnderCap, recordUsage, SUITE_OFF, CAP_HIT
} from "../../src/brand/meter.mjs";

const SYSTEM = [
  "You write short social posts for a regulated funding-review firm.",
  "Return a JSON array of strings. No markdown.",
  "Hard rules: never guarantee approval, a funding amount, a credit-score change, or a timeline.",
  "Never invent testimonials. The firm is not a direct lender."
].join("\n");

function parseCaptions(text, want) {
  const raw = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  let arr = [];
  if (start >= 0 && end > start) {
    try { arr = JSON.parse(raw.slice(start, end + 1)); } catch { arr = []; }
  }
  if (!Array.isArray(arr) || !arr.length) {
    arr = raw.split(/\n+/).map((s) => s.replace(/^\s*[-*\d.]+\s*/, "").trim()).filter(Boolean);
  }
  return arr.map((s) => String(s).trim()).filter(Boolean).slice(0, want);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const principal = await requirePrincipal(req, res, ["partner", "staff"], { db });
  if (!principal) return;
  const body = req.body || {};
  const partnerId = resolvePartnerId(principal, {
    partner_id: body.partner_id || (req.query || {}).partner_id
  });
  if (!partnerId) {
    return res.status(400).json({ ok: false, error: "partner_id_required" });
  }
  const count = Math.min(8, Math.max(1, Number(body.count) || 3));
  const offerType = body.offer_type || "funding";

  try {
    const items = await withPartnerScope({ kind: "partner", partnerId }, async (tx) => {
      await assertSuiteEnabled(tx, partnerId);
      await assertUnderCap(tx, partnerId);
      const org = (await tx.query(
        `SELECT org_id FROM partners WHERE id = $1`, [partnerId]
      )).rows[0];
      if (!org) {
        const e = new Error("partner not found");
        e.code = "NOT_FOUND";
        throw e;
      }
      const brand = (await tx.query(
        `SELECT entity_name, voice, ink, display_face FROM partner_brand WHERE partner_id = $1`,
        [partnerId]
      )).rows[0] || {};
      const model = await callModel({
        system: SYSTEM,
        user: [
          `Brand: ${brand.entity_name || "the partner"}`,
          `Voice: ${brand.voice || "plain"}`,
          `Write ${count} distinct posts. Each under 280 characters.`
        ].join("\n"),
        env: process.env,
        model: DEFAULT_MODEL,
        maxTokens: 800
      });
      await recordUsage(tx, {
        orgId: org.org_id,
        partnerId,
        purpose: "social",
        inputTokens: model.usage?.input_tokens,
        outputTokens: model.usage?.output_tokens,
        model: model.request?.model
      });
      if (model.mode === "shadow" || model.error || !model.text) {
        const e = new Error(model.error || "the writing robot is not set on this site");
        e.code = "no_model";
        throw e;
      }
      const captions = parseCaptions(model.text, count);
      const out = [];
      for (const caption of captions) {
        const verdict = await screen(tx, {
          orgId: org.org_id,
          partnerId,
          kind: "social_post",
          offerType,
          platform: null,
          text: caption,
          aiGenerated: true,
          approveBeforeLaunch: true
        });
        const status = verdict.state === "blocked" ? "blocked" : "draft";
        const ins = await tx.query(
          `INSERT INTO marketing_content_queue
             (org_id, partner_id, caption, offer_type, status, blocked_reasons)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb)
           RETURNING *`,
          [org.org_id, partnerId, caption, offerType, status,
           JSON.stringify(verdict.reasons || [])]
        );
        out.push(ins.rows[0]);
      }
      return out;
    });
    return res.status(200).json({ ok: true, items });
  } catch (err) {
    if (err.code === "NOT_FOUND") return res.status(404).json({ ok: false, error: "not_found" });
    if (err.code === SUITE_OFF) {
      return res.status(403).json({ ok: false, error: "suite_off",
        message: "The owner has not turned this on for this partner." });
    }
    if (err.code === CAP_HIT) {
      return res.status(429).json({ ok: false, error: "token_cap",
        message: "This partner has used this month's writing budget.",
        usage: err.usage || null });
    }
    if (err.code === "no_model") {
      return res.status(503).json({ ok: false, error: "no_model",
        message: "The writing robot is not set on this site." });
    }
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}

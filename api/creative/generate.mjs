// POST /api/creative/generate — enqueue a creative generation job.
// Wraps src/creative/generate.mjs enqueue().

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { withPartnerScope } from "../../src/partners/rls.mjs";
import { resolvePartnerId } from "../../src/http/partner-read-api.mjs";
import { enqueue } from "../../src/creative/generate.mjs";
import { safeError } from "../../src/http/health.mjs";

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

  const assetKind = body.asset_kind || body.assetKind || "static";
  const idempotencyKey = body.idempotency_key || body.idempotencyKey;
  if (!idempotencyKey) {
    return res.status(400).json({
      ok: false,
      error: "idempotency_key_required",
      message: "Pass a stable idempotency_key so retries do not double-bill."
    });
  }

  try {
    const result = await withPartnerScope({ kind: "partner", partnerId }, async (tx) => {
      const org = (await tx.query(
        `SELECT org_id FROM partners WHERE id = $1`, [partnerId]
      )).rows[0];
      if (!org) {
        const e = new Error("partner not found");
        e.code = "NOT_FOUND";
        throw e;
      }
      return enqueue(tx, {
        orgId: org.org_id,
        partnerId,
        brandKitId: body.brand_kit_id || null,
        requestedBy: principal.staffId || null,
        assetKind,
        idempotencyKey,
        spec: body.spec || {
          prompt: body.prompt || "",
          formats: body.formats || ["1x1"],
          variants: body.variants || 1
        }
      });
    });

    return res.status(200).json({
      ok: true,
      created: result.created,
      job: result.job,
      note: "Job is queued. Provider credentials (CREATIVE_* env) must be set for run() to produce assets — see docs/STILL-MISSING.md."
    });
  } catch (err) {
    if (err.code === "NOT_FOUND") return res.status(404).json({ ok: false, error: err.message });
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}

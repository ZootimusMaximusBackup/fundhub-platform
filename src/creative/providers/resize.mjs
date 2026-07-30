// Multi-format derivation from a parent asset.
//
// ⚠️ CONFIRM BEFORE THIS RUNS LIVE. Payload shape unverified against a real
// account.
//
// THIS IS THE ONE PROVIDER WHOSE OUTPUT IS NOT DIVERSIFICATION. The spec is
// explicit that "diversity means different hooks and angles, not N crops of one
// image", so the scheduler in ../scheduler.mjs counts resizes as ONE asset toward
// the weekly diversity target no matter how many formats come back. This module
// just records the lineage that makes that countable: every derived asset carries
// parent_asset_id, and the trigger in 045 keeps parent and child on the same
// partner.

import { callProvider, requireKey, assetFrom } from "./_http.mjs";

export const PROVIDER_KEY = "resize";
export const ASSET_KIND = "resize";

/* generate(spec, ctx)

   spec: { parentAsset: { id, kind, format, storage_key, ai_generated,
                          synthetic_performer }, formats: [...] } */
export async function generate(spec = {}, ctx = {}) {
  const key = requireKey("CREATIVE_RESIZE_API_KEY", ctx);
  const parent = spec.parentAsset;
  if (!parent?.id) throw new Error("resize requires a parentAsset with an id");

  const targets = (spec.formats || []).filter((f) => f !== parent.format);
  if (!targets.length) return { assets: [], cost_cents: 0 };

  const assets = [];
  let cost = 0;

  for (const format of targets) {
    const res = await callProvider({
      url: ctx.config?.endpoint || "https://api.example-resize.com/v1/derive",
      key,
      body: {
        source_key: parent.storage_key,
        source_provider_id: parent.provider_asset_id || null,
        target_ratio: format,
        strategy: spec.strategy || ctx.config?.default_strategy || "smart-crop"
      },
      ctx
    });

    const out = res?.data?.[0] || res?.asset;
    if (!out?.url && !out?.id) {
      throw new Error(`resize provider returned no asset for format ${format}`);
    }

    assets.push(assetFrom({
      kind: parent.kind,
      format,
      provider: PROVIDER_KEY,
      providerAssetId: out.id || null,
      sourceUrl: out.url || null,
      durationSec: parent.kind === "video" ? (out.duration_sec ?? parent.duration_sec ?? null) : null,
      parentAssetId: parent.id,
      // INHERITED, not re-derived. A crop of an AI-generated image is still
      // AI-generated, and a crop of a synthetic presenter still shows one — so the
      // disclosure obligations follow the pixels. Recomputing these from the
      // resize request would drop both flags on every derived asset.
      aiGenerated: parent.ai_generated !== false,
      syntheticPerformer: Boolean(parent.synthetic_performer)
    }));
    cost += Number(res?.cost_cents ?? ctx.config?.unit_cost_cents ?? 0);
  }

  return { assets, cost_cents: cost };
}

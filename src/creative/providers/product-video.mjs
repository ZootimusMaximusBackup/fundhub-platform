// Product-placement video — the partner's own product or offer on screen, with no
// synthetic presenter.
//
// ⚠️ CONFIRM BEFORE THIS RUNS LIVE. Payload shape unverified against a real
// account.
//
// synthetic_performer is FALSE by default here and settable by the caller, which
// is the opposite of ugc-video.mjs: this provider renders product footage, so a
// human likeness is possible but not inherent. ai_generated stays true either way
// — the footage is still machine-made and still carries the AI disclosure.

import { callProvider, requireKey, assetFrom } from "./_http.mjs";

export const PROVIDER_KEY = "product-video";
export const ASSET_KIND = "video";

export async function generate(spec = {}, ctx = {}) {
  const key = requireKey("CREATIVE_PRODUCT_VIDEO_API_KEY", ctx);
  const formats = spec.formats?.length ? spec.formats : ["9x16"];
  const variants = Math.max(1, Number(spec.variants) || 1);

  const assets = [];
  let cost = 0;

  for (const format of formats) {
    for (let i = 0; i < variants; i++) {
      const res = await callProvider({
        url: ctx.config?.endpoint || "https://api.example-product-video.com/v1/render",
        key,
        body: {
          product_images: spec.productImages || [],
          scene: pickScene(spec, i),
          aspect_ratio: format,
          duration_sec: spec.durationSec || ctx.config?.default_duration_sec || 15,
          brand: {
            palette: spec.brandKit?.palette || null,
            fonts: spec.brandKit?.fonts || null
          }
        },
        ctx
      });

      const out = res?.video || res?.data?.[0];
      if (!out?.id && !out?.url) {
        throw new Error(`product-video provider returned no asset for format ${format}`);
      }

      assets.push(assetFrom({
        kind: "video",
        format,
        provider: PROVIDER_KEY,
        providerAssetId: out.id || null,
        sourceUrl: out.url || null,
        durationSec: out.duration_sec ?? spec.durationSec ?? null,
        aiGenerated: true,
        syntheticPerformer: Boolean(spec.syntheticPerformer),
        meta: { scene: pickScene(spec, i) }
      }));
      cost += Number(res?.cost_cents ?? ctx.config?.unit_cost_cents ?? 0);
    }
  }

  return { assets, cost_cents: cost };
}

function pickScene(spec, i) {
  const scenes = spec.scenes?.length ? spec.scenes : ["default"];
  return scenes[i % scenes.length];
}

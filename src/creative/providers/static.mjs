// Image generation.
//
// ⚠️ CONFIRM BEFORE THIS RUNS LIVE. The request/response shape below is the
// common one for hosted image APIs, but it has not been proven against a real
// account — same status as the adapters in src/adapters/ that carry this marker.
// Check it against one real call before a partner's money goes through it.
//
// The provider is selected by config row, so switching vendors is a row edit plus
// a sibling of this file, not a change to the service.

import { callProvider, requireKey, assetFrom } from "./_http.mjs";

export const PROVIDER_KEY = "static";
export const ASSET_KIND = "static";

/* generate(spec, ctx) → { assets, cost_cents }

   spec: { prompt, formats: ['1x1','4x5'], variants: n, brandKit }

   ONE CALL PER (format, variant). The batch is expanded here rather than asking
   the provider for N images in one request, because a partial failure inside a
   single multi-image response is indistinguishable from a success with fewer
   images — and the spec forbids degrading to a silent empty result. */
export async function generate(spec = {}, ctx = {}) {
  const key = requireKey("CREATIVE_STATIC_API_KEY", ctx);
  const formats = spec.formats?.length ? spec.formats : ["1x1"];
  const variants = Math.max(1, Number(spec.variants) || 1);

  const assets = [];
  let cost = 0;

  for (const format of formats) {
    for (let i = 0; i < variants; i++) {
      const res = await callProvider({
        url: ctx.config?.endpoint || "https://api.example-image-provider.com/v1/images",
        key,
        body: {
          prompt: buildPrompt(spec, i),
          size: SIZES[format] || SIZES["1x1"],
          n: 1
        },
        ctx
      });

      // A provider that returns 200 with nothing is a failure, not an empty
      // success. Throwing here degrades the job to queued for retry.
      const out = res?.data?.[0];
      if (!out?.url && !out?.id) {
        throw new Error(`static provider returned no asset for format ${format}`);
      }

      assets.push(assetFrom({
        kind: "static",
        format,
        provider: PROVIDER_KEY,
        providerAssetId: out.id || null,
        sourceUrl: out.url || null,
        aiGenerated: true,
        // An image model can render a person. The caller declares whether this
        // spec asks for one; it is never inferred, because guessing wrong in the
        // permissive direction skips a disclosure.
        syntheticPerformer: Boolean(spec.syntheticPerformer)
      }));
      cost += Number(res?.cost_cents ?? ctx.config?.unit_cost_cents ?? 0);
    }
  }

  return { assets, cost_cents: cost };
}

// Diversity, not crops. The spec is explicit that 15-20 assets a week means
// different hooks and angles — so each variant index shifts the ANGLE, and the
// format only changes the canvas.
function buildPrompt(spec, variantIndex) {
  const angles = spec.angles?.length ? spec.angles : [""];
  const angle = angles[variantIndex % angles.length];
  return [spec.prompt, angle, spec.brandKit?.voice_profile?.tone && `Tone: ${spec.brandKit.voice_profile.tone}`]
    .filter(Boolean).join(". ");
}

const SIZES = {
  "1x1": "1024x1024",
  "4x5": "1024x1280",
  "9x16": "1080x1920",
  "16x9": "1920x1080"
};

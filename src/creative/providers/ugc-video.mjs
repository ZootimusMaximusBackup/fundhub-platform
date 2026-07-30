// AI actor video — a synthetic human presenter reading a script.
//
// ⚠️ CONFIRM BEFORE THIS RUNS LIVE. Payload shape unverified against a real
// account.
//
// EVERY ASSET FROM THIS PROVIDER SETS synthetic_performer = true, unconditionally.
// That is the whole nature of the product: there is an AI-generated human likeness
// on screen. It is not a caller-supplied flag here (unlike static.mjs, where a
// prompt may or may not ask for a person) because there is no configuration of
// this provider that produces a video without one. Hardcoding it means a caller
// who forgets to pass the flag still gets the disclosure.

import { callProvider, requireKey, assetFrom } from "./_http.mjs";

export const PROVIDER_KEY = "ugc-video";
export const ASSET_KIND = "video";

export async function generate(spec = {}, ctx = {}) {
  const key = requireKey("CREATIVE_UGC_API_KEY", ctx);
  const formats = spec.formats?.length ? spec.formats : ["9x16"];
  const variants = Math.max(1, Number(spec.variants) || 1);

  const assets = [];
  let cost = 0;

  for (const format of formats) {
    for (let i = 0; i < variants; i++) {
      const script = pickScript(spec, i);
      const res = await callProvider({
        url: ctx.config?.endpoint || "https://api.example-ugc-provider.com/v1/videos",
        key,
        body: {
          script,
          avatar_id: spec.avatarId || ctx.config?.default_avatar_id || null,
          aspect_ratio: format,
          background: spec.background || null
        },
        ctx
      });

      const out = res?.video || res?.data?.[0];
      if (!out?.id && !out?.url) {
        throw new Error(`ugc-video provider returned no asset for format ${format}`);
      }

      assets.push(assetFrom({
        kind: "video",
        format,
        provider: PROVIDER_KEY,
        providerAssetId: out.id || null,
        sourceUrl: out.url || null,
        durationSec: out.duration_sec ?? null,
        aiGenerated: true,
        // Not negotiable, not from spec. See the header.
        syntheticPerformer: true,
        meta: { script_hook: script.slice(0, 120) }
      }));
      cost += Number(res?.cost_cents ?? ctx.config?.unit_cost_cents ?? 0);
    }
  }

  return { assets, cost_cents: cost };
}

// Diversity means different HOOKS, not the same script re-rendered. When the
// caller supplies a hook list, each variant takes a different one.
function pickScript(spec, i) {
  const hooks = spec.hooks?.length ? spec.hooks : [];
  const hook = hooks.length ? hooks[i % hooks.length] : "";
  return [hook, spec.script || spec.prompt || ""].filter(Boolean).join(" ");
}

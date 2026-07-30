// Ad copy via an LLM.
//
// ⚠️ CONFIRM BEFORE THIS RUNS LIVE. Payload shape unverified against a real
// account.
//
// THIS IS THE ONE PROVIDER THAT CALLS A MODEL, AND IT DOES NOT DECIDE ANYTHING.
// It writes candidate copy. Whether that copy may run is decided afterwards, by
// the deterministic engine in src/compliance/screen.mjs — which is why UNIT 4
// lands before UNIT 3 in the build order.
//
// The system prompt below tells the model the rules anyway. That is a yield
// improvement, not a control: it means fewer generations come back blocked and
// fewer credits are wasted. It must never be mistaken for the compliance check.
// If this prompt and screen.mjs ever disagree, screen.mjs is right by
// construction, because a prompt is a request and a regex is a rule.

import { callProvider, requireKey, assetFrom } from "./_http.mjs";

export const PROVIDER_KEY = "copy";
export const ASSET_KIND = "copy";

export async function generate(spec = {}, ctx = {}) {
  const key = requireKey("CREATIVE_COPY_API_KEY", ctx);
  const variants = Math.max(1, Number(spec.variants) || 1);

  const res = await callProvider({
    url: ctx.config?.endpoint || "https://api.example-llm.com/v1/messages",
    key,
    body: {
      model: ctx.config?.model || "claude-sonnet-5",
      max_tokens: Number(ctx.config?.max_tokens || 2000),
      system: systemPrompt(spec),
      messages: [{ role: "user", content: userPrompt(spec, variants) }]
    },
    ctx
  });

  const text = extractText(res);
  if (!text) throw new Error("copy provider returned no text");

  const variantsOut = splitVariants(text, variants);
  if (!variantsOut.length) throw new Error("copy provider returned no usable variants");

  return {
    assets: variantsOut.map((t) => assetFrom({
      kind: "copy",
      // Copy has no canvas, but format is NOT NULL on creative_assets and the
      // library filters by it. 1x1 is the neutral value; the copy is reusable
      // across placements regardless.
      format: spec.format || "1x1",
      provider: PROVIDER_KEY,
      text: t,
      aiGenerated: true,
      syntheticPerformer: false
    })),
    cost_cents: Number(res?.cost_cents ?? ctx.config?.unit_cost_cents ?? 0)
  };
}

/* The rules, restated for the model. A yield improvement, NOT the control — see
   the header. Kept in sync with the seeded rules in 047 by intent rather than by
   generation, because a prompt assembled from regexes reads like nonsense and
   would generate worse copy. */
function systemPrompt(spec) {
  const offer = spec.offerType || "funding";
  const lines = [
    "You write direct-response ad copy for a regulated financial-services advertiser.",
    "Hard rules — copy breaking any of these is discarded by an automated screen:",
    "- Never guarantee approval, a funding amount, a credit score change, or a timeline.",
    "- Never state or imply the reader's income, wealth, or financial distress.",
    "- Never fabricate a testimonial, and never claim results are typical.",
    "- Use 'up to' with qualifying conditions when naming any amount."
  ];
  if (offer === "credit_repair") {
    lines.push(
      "- This is a credit repair offer, governed by CROA. Additionally:",
      "  Never promise to remove, delete or erase accurate or verifiable information.",
      "  Never mention removing late payments, collections, charge-offs or bankruptcies.",
      "  Never reference CPNs, file segregation, or a new credit identity.",
      "  Never request or imply any payment before services are fully performed."
    );
  }
  if (spec.brandKit?.voice_profile?.tone) {
    lines.push(`Brand voice: ${spec.brandKit.voice_profile.tone}.`);
  }
  return lines.join("\n");
}

// Distinct ANGLES, not rewordings — the Andromeda diversification requirement
// applies to copy as much as to imagery.
function userPrompt(spec, variants) {
  const angles = spec.angles?.length
    ? spec.angles
    : ["problem-aware hook", "outcome-led hook", "objection-handling hook", "curiosity hook"];
  return [
    `Write ${variants} distinct ad copy variants for: ${spec.prompt || spec.offer || "the offer"}.`,
    `Each must use a DIFFERENT angle. Available angles: ${angles.join(", ")}.`,
    "Do not reword one idea. Separate each variant with a line containing only ---."
  ].join("\n");
}

function extractText(res) {
  if (typeof res?.content === "string") return res.content;
  if (Array.isArray(res?.content)) {
    return res.content.map((c) => c?.text || "").filter(Boolean).join("\n");
  }
  return res?.choices?.[0]?.message?.content || res?.text || "";
}

function splitVariants(text, want) {
  const parts = String(text).split(/^\s*---\s*$/m).map((s) => s.trim()).filter(Boolean);
  // A model that ignored the separator returns one blob. One good variant beats
  // discarding the call, so it is returned rather than treated as a failure.
  return (parts.length ? parts : [String(text).trim()]).slice(0, want);
}

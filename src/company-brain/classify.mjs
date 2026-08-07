// Propose an access tier from file name, path, and text.
//
// Rules (spec §4.3 + owner-set H-3 2026-08-02):
//   - public / sales / staff may auto-assign
//   - owner / affiliate NEVER auto-assign — review queue, owner-only approve
//   - unclassifiable → propose owner (queue)
//   - fail closed: caller keeps live access_tier at owner until auto/approve

import { ACCESS_TIERS } from "./access.mjs";
import { postJsonTo, INTERNAL } from "../lib/outbound-fetch.mjs";

export const AUTO_TIERS = new Set(["public", "sales", "staff"]);
export const REVIEW_TIERS = new Set(["owner", "affiliate"]);

const RULES = [
  {
    tier: "affiliate",
    rationale: "path/content looks external-partner facing",
    patterns: [
      /\baffiliate/i, /\bwhite[\s_-]?label/i, /\bpartner\s+portal/i,
      /\bpartner\s+kit/i, /\breferral\s+partner/i
    ]
  },
  {
    tier: "owner",
    rationale: "path/content looks legal, financial, or ownership-sensitive",
    patterns: [
      /\bllc\b/i, /\bcap\s*table/i, /\boperating\s+agreement/i,
      /\barticles\s+of\s+(organization|incorporation)/i, /\bfiling/i,
      /\bein\b/i, /\bw-?9\b/i, /\b1099\b/i, /\bk-?1\b/i,
      /\bequity\b/i, /\bcomp\s*math/i, /\bbank\s+statement/i,
      /\bwire\s+instruction/i, /\btax\s+return/i, /\bpayroll\b/i,
      /\bpartner\s+deal/i, /\bmsa\b/i, /\bnda\b/i
    ]
  },
  {
    tier: "sales",
    rationale: "path/content looks like sales/closer material",
    patterns: [
      /\bobjection/i, /\bcloser\b/i, /\broleplay/i, /\brebuttal/i,
      /\bsales\s+script/i, /\bcall\s+script/i, /\bpitch\b/i,
      /\bstudy\s+guide/i
    ]
  },
  {
    tier: "public",
    rationale: "path/content looks like published marketing",
    patterns: [
      /\bvsl\b/i, /\blanding\s+page/i, /\bmarketing\b/i,
      /\bpublished\b/i, /\bad\s+copy/i, /\bpublic\s+facing/i
    ]
  },
  {
    tier: "staff",
    rationale: "path/content looks like internal SOP/training",
    patterns: [
      /\bsop\b/i, /\bstandard\s+operating/i, /\binternal\s+training/i,
      /\bonboarding\b/i, /\bprocess\s+doc/i, /\brunbook\b/i,
      /\bplaybook\b/i, /\bstaff\s+only/i
    ]
  }
];

function haystackOf({ name, path, text, parentNames = [] } = {}) {
  const parts = [
    String(name || ""),
    String(path || ""),
    ...(parentNames || []).map(String),
    String(text || "").slice(0, 4000)
  ];
  return parts.join("\n");
}

/**
 * Pure heuristic classifier. Deterministic; no network.
 * @returns {{ proposedTier, autoAssignable, rationale, source }}
 */
export function classifyHeuristic(input = {}) {
  const hay = haystackOf(input);
  if (!hay.trim()) {
    return {
      proposedTier: "owner",
      autoAssignable: false,
      rationale: "empty content — default owner (fail closed)",
      source: "heuristic"
    };
  }

  for (const rule of RULES) {
    if (rule.patterns.some((re) => re.test(hay))) {
      return {
        proposedTier: rule.tier,
        autoAssignable: AUTO_TIERS.has(rule.tier),
        rationale: rule.rationale,
        source: "heuristic"
      };
    }
  }

  return {
    proposedTier: "owner",
    autoAssignable: false,
    rationale: "unclassifiable — default owner (fail closed)",
    source: "heuristic"
  };
}

/**
 * Optional LLM assist when heuristic is owner/unclassifiable and a key is set.
 * Still never auto-assigns owner/affiliate.
 */
export async function classifyWithModel(input = {}, {
  env = process.env,
  fetchImpl,
  heuristic = classifyHeuristic(input)
} = {}) {
  // If heuristic already found an auto tier, keep it — no spend.
  if (heuristic.autoAssignable) return heuristic;

  const apiKey = env.OPENAI_API_KEY || env.COMPANY_BRAIN_OPENAI_API_KEY;
  if (!apiKey) return heuristic;

  const model = env.COMPANY_BRAIN_CLASSIFY_MODEL || "gpt-4o-mini";
  const baseUrl = String(env.OPENAI_API_BASE || "https://api.openai.com").replace(/\/+$/, "");
  const prompt = {
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Classify a company document into exactly one access tier: public, sales, staff, owner, affiliate. " +
          "Fail closed: if unsure, choose owner. Reply JSON {\"tier\":\"...\",\"rationale\":\"...\"}."
      },
      {
        role: "user",
        content: JSON.stringify({
          name: input.name || "",
          path: input.path || "",
          parentNames: input.parentNames || [],
          textSample: String(input.text || "").slice(0, 3000)
        })
      }
    ]
  };

  const res = await postJsonTo(`${baseUrl}/v1/chat/completions`, {
    headers: { authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(prompt),
    timeoutMs: 30_000,
    fetchImpl,
    fence: INTERNAL,
    what: "document classify"
  });

  if (!res.ok || !res.body) return heuristic;

  try {
    const content = res.body.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(content);
    const tier = String(parsed.tier || "").toLowerCase();
    if (!ACCESS_TIERS.includes(tier)) return heuristic;
    return {
      proposedTier: tier,
      autoAssignable: AUTO_TIERS.has(tier),
      rationale: String(parsed.rationale || heuristic.rationale).slice(0, 500),
      source: "model"
    };
  } catch {
    return heuristic;
  }
}

/** H-3: only the owner role may decide review-queue items. */
export function canApproveClassification(role) {
  return String(role || "").trim().toLowerCase() === "owner";
}

export function normalizeProposedTier(tier) {
  const t = String(tier || "").toLowerCase();
  return ACCESS_TIERS.includes(t) ? t : "owner";
}

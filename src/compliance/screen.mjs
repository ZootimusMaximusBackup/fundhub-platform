// The guardrail engine — the single gate every asset and every campaign payload
// passes through before it can reach a platform.
//
// THIS IS THE HIGHEST-RISK MODULE IN THE FEATURE. Three properties hold, and each
// one is load-bearing:
//
// 1. DETERMINISTIC. Patterns and literals only. Nothing here calls an LLM, and
//    nothing may be added that does. A screen that asks a model whether copy is
//    compliant produces a different answer on Tuesday than on Monday for the same
//    text, which means it is not a control — it is a sampling procedure that will
//    eventually pass an advance-fee promise and produce an audit trail claiming
//    the copy was reviewed.
//
// 2. FAILS CLOSED ON ANY ERROR. A database that is down, a malformed regex, an
//    unreadable payload — every one of them returns `blocked`, never `passed`.
//    The catch at the bottom of screen() is not defensive tidiness; it is the
//    rule. An exception escaping as an unhandled rejection somewhere upstream
//    could be caught by a caller that treats "no result" as "no problem".
//
// 3. THE STRUCTURAL BLOCKS ARE NOT CONFIGURABLE. Most rules are rows in
//    compliance_rules and are meant to be edited without a deploy. Three are not:
//
//      - TikTok + credit_repair is rejected unconditionally, in code, before any
//        rule row is consulted. Also a CHECK constraint in 046.
//      - Meta forces its special ad category, from config, and refuses to
//        proceed when unset.
//      - credit_repair always requires human approval, regardless of the
//        partner's approve_before_launch setting.
//
//    There is no override flag, no `force` argument, no `skipCompliance` option.
//    Do not add one. If a rule is wrong, fix the rule.
//
// RETURN SHAPE. { state, reasons[] } where state is 'passed' | 'blocked' |
// 'needs_approval'. `needs_approval` is NOT a soft block — nothing may reach a
// platform in that state either. It is distinct from `blocked` only so the
// dashboard can tell "a human must look at this" apart from "this can never run".

import { screenTargeting } from "./targeting.mjs";

// Cached rule sets, keyed by org. Compliance rules change rarely and are read on
// every screen; re-querying per asset would put the guardrail in the hot path of
// every generation. TTL rather than manual invalidation so an operator's edit
// takes effect on its own without anyone remembering to flush.
const RULE_TTL_MS = 60_000;
const _cache = new Map();

/* loadRules(db, orgId) → rows

   Throws on failure. Callers must not paper over it: no rules loaded means no
   screening happened, and treating that as "nothing matched" would pass every
   banned phrase in the book. screen() turns this throw into `blocked`. */
export async function loadRules(db, orgId, { now = Date.now } = {}) {
  const hit = _cache.get(orgId);
  if (hit && hit.expires > now()) return hit.rows;

  const { rows } = await db.query(
    `SELECT rule_set, rule_key, offer_types, platforms, match_type, pattern,
            severity, message, citation
       FROM compliance_rules
      WHERE org_id = $1 AND active
      ORDER BY rule_set, rule_key`,
    [orgId]
  );
  _cache.set(orgId, { rows, expires: now() + RULE_TTL_MS });
  return rows;
}

export function clearRuleCache() { _cache.clear(); }

/* screen(db, subject) → { state, reasons[] }

   subject: {
     orgId, partnerId,          — required
     kind,                      — 'creative_asset' | 'campaign' | 'ad' | 'social_post'
     offerType,                 — funding | credit_cards | credit_repair
     platform,                  — meta | tiktok | google | null for an unplaced asset
     text,                      — the copy to screen
     targeting,                 — campaign payloads only
     hasDisclosureAsset,        — credit_repair funnels
     aiGenerated, syntheticPerformer,
     approveBeforeLaunch        — the partner setting; defaults ON
   } */
export async function screen(db, subject = {}) {
  try {
    return await run(db, subject);
  } catch (err) {
    // FAIL CLOSED. Any error at all — no database, bad regex, malformed subject —
    // becomes a block. The message is deliberately generic in the reason the
    // partner sees; the detail goes to the operator via `detail`.
    return {
      state: "blocked",
      reasons: [{
        code: "screen_error",
        rule_set: "engine",
        message: "Compliance screening could not complete, so this is blocked. Try again; if it persists this is a platform fault, not your copy.",
        detail: String(err && err.message || err).slice(0, 300)
      }]
    };
  }
}

async function run(db, subject) {
  const {
    orgId, partnerId, kind = "creative_asset",
    offerType, platform = null,
    text = "", targeting,
    hasDisclosureAsset = false,
    aiGenerated = false, syntheticPerformer = false,
    approveBeforeLaunch = true
  } = subject;

  if (!orgId) throw new Error("screen: orgId is required");
  if (!partnerId) throw new Error("screen: partnerId is required");

  // offer_type is mandatory. A payload that does not say what it is selling
  // cannot be screened against the rules that depend on it, and defaulting it
  // would pick which body of law to apply on the caller's behalf.
  if (!OFFER_TYPES.has(offerType)) {
    return blocked("offer_type_missing", "engine",
      `offer_type must be one of ${[...OFFER_TYPES].join(", ")}; got ${JSON.stringify(offerType)}.`);
  }
  if (platform !== null && !PLATFORMS.has(platform)) {
    return blocked("platform_unknown", "engine",
      `platform must be one of ${[...PLATFORMS].join(", ")} or null; got ${JSON.stringify(platform)}.`);
  }

  const reasons = [];

  // ---- STRUCTURAL BLOCK 1: TikTok never carries credit repair ---------------
  // Checked before anything else and independent of the rule rows, so an operator
  // who deactivates the matching config row does not open this door.
  if (platform === "tiktok" && offerType === "credit_repair") {
    return blocked("tiktok_credit_repair_prohibited", "platform",
      "TikTok prohibits credit repair and debt relief advertising outright. This offer cannot run on TikTok on any account, with any creative. There is no override.");
  }

  // ---- STRUCTURAL BLOCK 2: Meta must carry its special ad category ----------
  if (platform === "meta") {
    const { rows } = await db.query(
      `SELECT special_ad_category FROM ad_platform_category_map
        WHERE org_id = $1 AND platform = 'meta' AND offer_type = $2`,
      [orgId, offerType]
    );
    const category = rows[0]?.special_ad_category || null;
    if (!category) {
      // Unset config is a block, not a pass. The alternative — shipping without a
      // category — is the compliance failure this rule exists to prevent.
      reasons.push(r("special_ad_category_unset", "platform",
        `No special_ad_category is configured for meta/${offerType}. Populate ad_platform_category_map before any Meta launch.`));
    }
  }

  // ---- Targeting ------------------------------------------------------------
  if (targeting !== undefined && platform === "meta") {
    const t = screenTargeting(targeting, { platform });
    reasons.push(...t.reasons);
  }

  // ---- Copy rules, from config ---------------------------------------------
  const rules = await loadRules(db, orgId);
  const applicable = rules.filter((rule) =>
    appliesTo(rule.offer_types, offerType) && appliesTo(rule.platforms, platform));

  const haystack = String(text || "");

  for (const rule of applicable) {
    if (rule.match_type === "required") {
      // Presence rules. The disclosure case is satisfied either by the copy
      // containing it or by a disclosure asset being linked to the campaign —
      // "present and linked" per the spec, and a funnel-level disclosure asset is
      // the normal way that is satisfied.
      const inText = toRegex(rule.pattern).test(haystack);
      if (!inText && !hasDisclosureAsset) {
        reasons.push(fromRule(rule));
      }
      continue;
    }

    // The TikTok platform rule row matches everything by design; it exists to
    // carry a readable message. The structural check above already returned, so
    // reaching it here means platform is not tiktok and it must not fire.
    if (rule.rule_key === "tiktok-credit-repair-prohibited") continue;

    const matched = rule.match_type === "phrase"
      ? haystack.toLowerCase().includes(String(rule.pattern).toLowerCase())
      : toRegex(rule.pattern).test(haystack);

    if (matched) reasons.push(fromRule(rule));
  }

  // ---- AI disclosure --------------------------------------------------------
  // A synthetic human likeness that is not flagged AI-generated cannot be
  // disclosed correctly downstream, so it is blocked here rather than published
  // with a missing label.
  if (syntheticPerformer && !aiGenerated) {
    reasons.push(r("synthetic_without_ai_flag", "disclosure",
      "An asset with a synthetic performer must also be marked ai_generated."));
  }

  const hardBlocks = reasons.filter((x) => x.severity !== "warn");
  if (hardBlocks.length) return { state: "blocked", reasons };

  // ---- Approval gates -------------------------------------------------------
  // STRUCTURAL BLOCK 3. credit_repair always needs a human, whatever the setting
  // says. The setting is not consulted for this branch at all — it cannot be,
  // because there is no value of it that would make this safe.
  if (offerType === "credit_repair") {
    return {
      state: "needs_approval",
      reasons: [...reasons, r("human_approval_required_credit_repair", "approval",
        "Credit-repair creative always requires human approval before launch. This gate cannot be turned off.")]
    };
  }

  if (approveBeforeLaunch) {
    return {
      state: "needs_approval",
      reasons: [...reasons, r("human_approval_required_setting", "approval",
        "This partner has approve_before_launch enabled, so a human must approve before launch.")]
    };
  }

  return { state: "passed", reasons };
}

/* screenAndRecord — screen, then write the compliance_screenings audit row.

   Separate from screen() so the pure function stays testable without a database
   write, and so a caller that only wants a preview does not pollute the audit
   trail. Every path that actually publishes must use this one. */
export async function screenAndRecord(db, subject) {
  const result = await screen(db, subject);
  await db.query(
    `INSERT INTO compliance_screenings
       (org_id, partner_id, subject_type, subject_id, offer_type, platform,
        state, reasons, screened_text)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
    [subject.orgId, subject.partnerId, subject.kind || "creative_asset",
     subject.subjectId || null, subject.offerType || null, subject.platform || null,
     result.state, JSON.stringify(result.reasons),
     String(subject.text || "").slice(0, 8000)]
  );
  return result;
}

// --- helpers ---------------------------------------------------------------

export const OFFER_TYPES = new Set(["funding", "credit_cards", "credit_repair"]);
export const PLATFORMS = new Set(["meta", "tiktok", "google"]);

const r = (code, rule_set, message, extra = {}) => ({ code, rule_set, message, ...extra });
const blocked = (code, rule_set, message) => ({ state: "blocked", reasons: [r(code, rule_set, message)] });

const fromRule = (rule) => ({
  code: rule.rule_key,
  rule_set: rule.rule_set,
  message: rule.message,
  citation: rule.citation || undefined,
  severity: rule.severity
});

/* appliesTo — an empty scope array means "all", which is how a claims rule covers
   every offer type without enumerating them. jsonb arrives as a parsed array from
   pg, but a string is tolerated so the function is usable against fixtures. */
function appliesTo(scope, value) {
  const list = typeof scope === "string" ? JSON.parse(scope) : (scope || []);
  if (!Array.isArray(list) || list.length === 0) return true;
  return value !== null && list.includes(value);
}

/* toRegex — compile with a cache. Throwing on a bad pattern is correct: run()'s
   caller turns it into a block, which is the fail-closed path. A rule we cannot
   compile is a rule we cannot enforce, and skipping it would silently reduce
   coverage while still reporting a pass. */
const _rx = new Map();
function toRegex(pattern) {
  let rx = _rx.get(pattern);
  if (!rx) {
    rx = new RegExp(pattern, "i");
    _rx.set(pattern, rx);
  }
  rx.lastIndex = 0;
  return rx;
}

export default screen;

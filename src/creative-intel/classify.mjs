// LAYER 2 — the hook classifier. One model call per creative, ever.
//
// docs/specs/W2-creative-intelligence.md §7.1, §7.2.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT MAKES THIS CHEAP ENOUGH TO SELL AT $47
//
// Three things, and all three are structural rather than clever:
//
//   1. KEYED ON content_hash. A creative already classified at the current
//      taxonomy version is never sent again. ~31,000 monthly observations
//      collapse to roughly 3,000 distinct creatives (ad_creatives_seen), and of
//      those only the ones not already in ad_creative_classification are asked
//      about. In a steady week that is a few hundred, not thirty thousand.
//
//   2. BATCHED AT 25. Big enough to amortise the taxonomy in the prompt across
//      25 answers, small enough that one malformed row does not poison a whole
//      batch — and small enough that a batch fits comfortably inside a single
//      response without being truncated.
//
//   3. ENUMS, NOT PROSE. The reply is one line per creative of five enum values
//      plus the verbatim hook. Short outputs are what the bill is made of.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// THE MODEL, AND WHY IT IS PINNED TO ANTHROPIC HERE
//
// src/agents/model.mjs prefers OpenAI when OPENAI_API_KEY is set (owner-set
// 2026-08-25) and falls back to Anthropic. This job is specified as an
// Anthropic job, so it passes callModel an env containing ONLY the Anthropic
// key. That is a deliberate narrowing at one call site, not a change to the
// owner's default — every other caller of callModel keeps the owner's routing.
//
// Model id is `claude-opus-5`. Thinking is on by default on that model when the
// parameter is omitted, which is what callModel sends. callModel does not expose
// output_config / structured outputs, so the enum contract is enforced HERE, by
// validateClassification() — the model's answer is parsed, checked against the
// closed lists in taxonomy.mjs, and DROPPED if it does not fit. A row that does
// not validate is not written; it is not coerced to a default. A silently
// defaulted angle puts a creative in the wrong cell of the saturation map and
// nothing anywhere would report it.
//
// NO KEY? callModel returns mode:"shadow" and this function reports
// `skipped_no_model` for the whole batch and writes nothing. It does not
// fabricate classifications, and it does not throw — a missing key is a
// configuration fact, and the honest response is an empty result that says why.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// TOKEN ACCOUNTING — THE CALL THAT IS EASY TO GET WRONG
//
// src/brand/meter.mjs meters a PARTNER against a 250,000-token monthly cap.
// Classifying competitor ads is FUNDHUB'S OWN COST and must never be metered
// against a partner. If it were, one partner opening the board would burn the
// allowance they need for their own ad copy — and they would have no way to
// tell that was what happened.
//
// So metering here is opt-in and takes a parameter named
// `fundhubInternalPartnerId`. There is no code path from an HTTP request to
// this function, and the parameter is deliberately not called `partnerId`, so
// a viewer's id cannot be threaded in by autocomplete. When it is absent,
// nothing is metered and the result says so.

import { callModel } from "../agents/model.mjs";
import { screen } from "../compliance/screen.mjs";
import { recordUsage } from "../brand/meter.mjs";
import { roundHalfUp } from "../commissions/money.mjs";
import {
  TAXONOMY_VERSION, AXIS_KEYS, taxonomyPromptBlock, validateClassification
} from "./taxonomy.mjs";

export const CLASSIFIER_MODEL = "claude-opus-5";
export const BATCH_SIZE = 25;

/* claude-opus-5 list price, in cents per million tokens: $5 in, $25 out.
   Recorded here so a cost figure is reproducible rather than quoted. Integer
   cents per CLAUDE.md §12; the per-creative share of a batch is well under a
   cent and rounds to 0, which is a MEASURED sub-cent value and not a missing
   one — the batch total is on the run summary and is where the real bill is
   read. */
export const PRICE_CENTS_PER_MTOK_IN = 500;
export const PRICE_CENTS_PER_MTOK_OUT = 2500;

export function batchCostCents(inputTokens, outputTokens) {
  if (inputTokens === null || inputTokens === undefined) return null;
  if (outputTokens === null || outputTokens === undefined) return null;
  const cents =
    (Number(inputTokens) / 1_000_000) * PRICE_CENTS_PER_MTOK_IN +
    (Number(outputTokens) / 1_000_000) * PRICE_CENTS_PER_MTOK_OUT;
  return roundHalfUp(cents);
}

/* pendingCreatives(db, orgId, { limit, taxonomyVersion })

   The LEFT JOIN is the 90% saving. Anything already classified at this taxonomy
   version is excluded by the join, not filtered in JS after being loaded. */
export async function pendingCreatives(db, orgId, { limit = 200, taxonomyVersion = TAXONOMY_VERSION } = {}) {
  const { rows } = await db.query(
    `SELECT c.content_hash, c.platform, c.advertiser_id, c.body_text, c.headline,
            c.cta, c.destination_domain, c.media_kind
       FROM ad_creatives_seen c
       LEFT JOIN ad_creative_classification k
              ON k.org_id = c.org_id
             AND k.content_hash = c.content_hash
             AND k.taxonomy_version = $3
      WHERE c.org_id = $1
        AND k.id IS NULL
      ORDER BY c.last_seen_at DESC
      LIMIT $2`,
    [orgId, limit, taxonomyVersion]
  );
  return rows;
}

/* classifyPending(db, { orgId, ... }) → run summary

   Returns { batches, classified, rejected, skipped, costCents, reason }.
   `rejected` is the count the model answered for and the validator refused. It
   is reported rather than hidden: a rejection rate that climbs is how a
   taxonomy change that nobody bumped the version for announces itself. */
export async function classifyPending(db, {
  orgId,
  limit = 200,
  taxonomyVersion = TAXONOMY_VERSION,
  fundhubInternalPartnerId = null,
  env = process.env,
  fetchImpl = undefined,
  model = CLASSIFIER_MODEL
} = {}) {
  if (!orgId) throw new Error("classifyPending: orgId is required");

  const pending = await pendingCreatives(db, orgId, { limit, taxonomyVersion });
  const summary = {
    pending: pending.length, batches: 0, classified: 0, rejected: 0,
    skipped: 0, costCents: 0, inputTokens: 0, outputTokens: 0, reason: null
  };
  if (!pending.length) return summary;

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const out = await classifyBatch(batch, { env, fetchImpl, model });
    summary.batches += 1;

    if (out.reason) {
      // Whole batch unusable — no key, provider error, unparseable reply. Write
      // nothing and carry the reason up. Degrading to "unclassified" is correct;
      // degrading to a guessed classification would not be.
      summary.skipped += batch.length;
      summary.reason = summary.reason || out.reason;
      continue;
    }

    summary.inputTokens += out.inputTokens || 0;
    summary.outputTokens += out.outputTokens || 0;
    const cost = batchCostCents(out.inputTokens, out.outputTokens);
    if (cost !== null) summary.costCents += cost;
    const perRowCost = cost === null ? null : roundHalfUp(cost / batch.length);

    for (const row of batch) {
      const parsed = out.byHash.get(row.content_hash);
      if (!parsed) { summary.skipped += 1; continue; }
      const check = validateClassification(parsed);
      if (!check.ok) { summary.rejected += 1; continue; }

      const verdict = await screenCompetitorCopy(db, orgId, row, parsed);

      await writeClassification(db, orgId, row.content_hash, taxonomyVersion, parsed, {
        model: out.model, inputTokens: null, outputTokens: null,
        costCents: perRowCost, verdict
      });
      summary.classified += 1;
    }

    if (fundhubInternalPartnerId) {
      // FundHub's own row. Never a viewer's — see the header.
      await recordUsage(db, {
        orgId, partnerId: fundhubInternalPartnerId,
        purpose: "ad_intel_classify",
        inputTokens: out.inputTokens, outputTokens: out.outputTokens,
        model: out.model
      });
    } else {
      summary.metered = false;
    }
  }

  if (summary.metered !== false) summary.metered = Boolean(fundhubInternalPartnerId);
  return summary;
}

/* classifyBatch — one model call for up to 25 creatives.

   Exported so a test can drive the parser with a recorded reply and no network,
   and so the prompt can be inspected without running anything. */
export async function classifyBatch(batch, { env = process.env, fetchImpl, model = CLASSIFIER_MODEL } = {}) {
  const result = await callModel({
    system: systemPrompt(),
    user: userPrompt(batch),
    // ANTHROPIC ONLY at this call site — see the header. Passing the whole env
    // would hand the job to OpenAI wherever that key happens to be set.
    env: { ANTHROPIC_API_KEY: (env && env.ANTHROPIC_API_KEY) || "" },
    fetchImpl,
    model,
    // 25 answers of ~60 tokens each plus slack. Not lowballed: a truncated
    // reply loses the tail of the batch silently, and the tail is just as real
    // as the head.
    maxTokens: 4000
  });

  if (result.mode === "shadow") {
    return { byHash: new Map(), reason: "skipped_no_model", model: result.request?.model || model };
  }
  if (result.error) {
    return { byHash: new Map(), reason: `model_error: ${String(result.error).slice(0, 200)}`, model };
  }
  if (!result.text) {
    return { byHash: new Map(), reason: "empty_reply", model };
  }

  const byHash = parseReply(result.text, batch);
  return {
    byHash,
    reason: byHash.size ? null : "unparseable_reply",
    model: result.request?.model || model,
    inputTokens: result.usage?.input_tokens ?? null,
    outputTokens: result.usage?.output_tokens ?? null
  };
}

/* parseReply — one JSON object per line, keyed by the creative's ref.

   JSON LINES, NOT ONE JSON DOCUMENT. A single array means one malformed entry
   makes the entire batch unparseable; a line means one bad line costs one
   creative. Lines that are not JSON are skipped silently — a model that adds a
   preamble should not cost the twenty-five answers underneath it.

   Refs are 1-based positions into the batch rather than content hashes: a
   64-character hex string repeated 25 times in the prompt and again in the
   reply is roughly 3,000 tokens of pure overhead per batch, and the model has
   no use for the value. */
export function parseReply(text, batch) {
  const byHash = new Map();
  for (const line of String(text).split("\n")) {
    const trimmed = line.trim().replace(/^```(?:json)?$/i, "");
    if (!trimmed || trimmed[0] !== "{") continue;
    let obj;
    try { obj = JSON.parse(trimmed); } catch { continue; }
    const ref = Number(obj.ref);
    if (!Number.isInteger(ref) || ref < 1 || ref > batch.length) continue;
    const row = batch[ref - 1];
    const picked = {};
    for (const key of AXIS_KEYS) picked[key] = obj[key];
    // hook_line is copied through UNCHANGED. Not trimmed to a length, not
    // title-cased, not de-quoted. A paraphrased or prettified hook is worthless
    // to someone trying to learn what works.
    picked.hook_line = typeof obj.hook_line === "string" ? obj.hook_line : null;
    byHash.set(row.content_hash, picked);
  }
  return byHash;
}

/* screenCompetitorCopy — the competitor's words through FundHub's own rules.

   ONE DEFINITION OF A BANNED CLAIM, NOT TWO. screen() is the same function that
   decides whether FundHub's own copy may run, and it is called here with
   exactly the same rule rows. Two engines would mean a phrase blocked in a
   FundHub ad and shown as inspiration on a board FundHub sells.

   The offer type is credit_repair when the classifier saw a credit outcome, and
   funding otherwise. That is not cosmetic: screen() applies CROA-derived rules
   only to credit_repair, and a competitor promising to remove collections must
   be screened under those rules or it comes back clean.

   screen() FAILS CLOSED — any error at all becomes `blocked` — so a screening
   failure marks a competitor ad do-not-copy rather than clean. That is the
   right direction to fail in for this table. */
export async function screenCompetitorCopy(db, orgId, row, parsed) {
  const offerType = parsed.compliance_risk === "names_a_credit_outcome"
    ? "credit_repair"
    : "funding";
  return screen(db, {
    orgId,
    // screen() requires a partner id and this copy belongs to no partner. The
    // competitor's advertiser id is not a partner id, so a synthetic marker is
    // not available either — the ORG's own id is passed so the call is
    // well-formed and the rule set that loads is the org's. Nothing is written
    // to any partner-scoped table by screen(); screenAndRecord() is deliberately
    // NOT used, because compliance_screenings is FundHub's own audit trail of
    // FundHub's own copy and competitor ads do not belong in it.
    partnerId: orgId,
    kind: "creative_asset",
    offerType,
    platform: null,
    text: [row.headline, row.body_text].filter(Boolean).join("\n"),
    aiGenerated: false,
    syntheticPerformer: false,
    approveBeforeLaunch: true
  });
}

async function writeClassification(db, orgId, hash, taxonomyVersion, parsed, meta) {
  await db.query(
    `INSERT INTO ad_creative_classification
       (org_id, content_hash, taxonomy_version, angle, ad_format, promise_shape,
        compliance_risk, funnel, hook_line, model, input_tokens, output_tokens,
        cost_cents, screen_state, screen_reasons)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
     ON CONFLICT (org_id, content_hash, taxonomy_version) DO NOTHING`,
    [orgId, hash, taxonomyVersion, parsed.angle, parsed.ad_format, parsed.promise_shape,
     parsed.compliance_risk, parsed.funnel, parsed.hook_line, meta.model,
     meta.inputTokens, meta.outputTokens, meta.costCents,
     meta.verdict ? meta.verdict.state : null,
     JSON.stringify(meta.verdict ? meta.verdict.reasons : [])]
  );
}

/* systemPrompt — the taxonomy, and the two rules that matter.

   The enum lists are BUILT FROM taxonomy.mjs rather than written out again. Two
   copies of a taxonomy drift, and the drift is invisible: the model keeps
   answering with the old value, the validator keeps rejecting it, and the only
   symptom is a classification rate that quietly falls. */
export function systemPrompt() {
  return [
    "You classify advertisements from the small-business-funding and credit-repair market.",
    "You are a labelling instrument. You do not write copy, give advice, or judge whether an ad is good.",
    "",
    "For each ad you are given, answer on FIVE axes. Every value must come from the list for that axis:",
    "",
    taxonomyPromptBlock(),
    "",
    "Also return hook_line: the opening line of the ad, COPIED EXACTLY as written, including its",
    "punctuation and capitalisation. Never paraphrase, shorten, tidy or translate it. If the ad body",
    "is empty, return null.",
    "",
    "compliance_risk is about what the ADVERTISER claimed, not about whether it is true:",
    "  names_a_credit_outcome      — promises a credit score change, or removal/deletion of anything from a credit report",
    "  implies_guaranteed_approval — approval is stated or implied as certain",
    "  uses_no_credit_check        — the phrase 'no credit check' or an equivalent",
    "  clean                       — none of the above",
    "If more than one applies, return the FIRST one in that list that applies.",
    "",
    "Answer with ONE JSON OBJECT PER LINE and nothing else. No prose, no code fences, no summary.",
    'Each line: {"ref":<number>,"angle":"...","ad_format":"...","promise_shape":"...","compliance_risk":"...","funnel":"...","hook_line":"..."}',
    "Emit exactly one line per ad, using the ref number given with that ad."
  ].join("\n");
}

export function userPrompt(batch) {
  const parts = batch.map((row, i) => [
    `--- ref ${i + 1} ---`,
    `platform: ${row.platform}`,
    row.media_kind ? `media: ${row.media_kind}` : "media: unknown",
    row.destination_domain ? `destination: ${row.destination_domain}` : "destination: unknown",
    row.headline ? `headline: ${row.headline}` : "headline: (none)",
    `body: ${row.body_text || "(none)"}`,
    row.cta ? `cta: ${row.cta}` : ""
  ].filter(Boolean).join("\n"));
  return `Classify these ${batch.length} ads.\n\n${parts.join("\n\n")}`;
}

// The classifier, driven with a recorded model reply and no network.
//
// WHAT IS BEING TESTED IS THE CONTRACT, NOT THE MODEL. Whether the model picks
// the right angle is not something a unit test can decide. What a unit test CAN
// decide, and what actually breaks in production, is everything around the call:
//
//   - a reply the taxonomy does not recognise is DROPPED, not defaulted
//   - a reply with a preamble or code fences still yields its 25 answers
//   - the hook line is copied through byte for byte
//   - no key means "skipped", not a fabricated classification
//   - the prompt contains the whole taxonomy, because it is generated from it
//   - the cost arithmetic is integer cents

import { test, describe } from "node:test";
import assert from "node:assert";
import {
  parseReply, systemPrompt, userPrompt, batchCostCents, classifyBatch,
  BATCH_SIZE, CLASSIFIER_MODEL, PRICE_CENTS_PER_MTOK_IN, PRICE_CENTS_PER_MTOK_OUT
} from "./classify.mjs";
import { ANGLES, AD_FORMATS, validateClassification } from "./taxonomy.mjs";

const batch = [
  { content_hash: "hash-a", platform: "meta", body_text: "Need $50,000 in 72 hours?", headline: "Fast", cta: "Apply", destination_domain: "a.test", media_kind: "video" },
  { content_hash: "hash-b", platform: "meta", body_text: "Guaranteed approval, no credit check.", headline: null, cta: null, destination_domain: "b.test", media_kind: "image" }
];

const line = (ref, over = {}) => JSON.stringify({
  ref, angle: "speed_of_money", ad_format: "talking_head_ugc",
  promise_shape: "specific_timeframe", compliance_risk: "clean",
  funnel: "call_booking", hook_line: "Need $50,000 in 72 hours?", ...over
});

describe("parseReply", () => {
  test("one JSON object per line, keyed back to the creative by ref", () => {
    const parsed = parseReply(`${line(1)}\n${line(2, { angle: "debt_rescue" })}`, batch);
    assert.equal(parsed.size, 2);
    assert.equal(parsed.get("hash-a").angle, "speed_of_money");
    assert.equal(parsed.get("hash-b").angle, "debt_rescue");
  });

  test("a preamble and code fences do not cost the batch", () => {
    // JSON LINES rather than one document is exactly why: a model that adds a
    // sentence should not lose twenty-five answers underneath it.
    const reply = `Here are the classifications:\n\`\`\`json\n${line(1)}\n${line(2)}\n\`\`\`\nDone.`;
    assert.equal(parseReply(reply, batch).size, 2);
  });

  test("one malformed line costs one creative, not the batch", () => {
    const parsed = parseReply(`${line(1)}\n{not json\n${line(2)}`, batch);
    assert.equal(parsed.size, 2);
  });

  test("a ref outside the batch is ignored rather than throwing", () => {
    assert.equal(parseReply(`${line(99)}`, batch).size, 0);
  });

  test("the hook line is copied through byte for byte", () => {
    // A paraphrased hook is worthless to someone trying to learn what works, so
    // nothing in the path may tidy it.
    const raw = "  “Need $50,000 — in 72 HOURS?”  ";
    const parsed = parseReply(line(1, { hook_line: raw }), batch);
    assert.equal(parsed.get("hash-a").hook_line, raw);
  });

  test("a non-string hook line becomes null rather than a stringified object", () => {
    const parsed = parseReply(line(1, { hook_line: { text: "x" } }), batch);
    assert.equal(parsed.get("hash-a").hook_line, null);
  });

  test("an off-taxonomy answer parses but fails validation, so it is dropped", () => {
    const parsed = parseReply(line(1, { angle: "vibes" }), batch);
    assert.equal(validateClassification(parsed.get("hash-a")).ok, false);
  });
});

describe("the prompt", () => {
  test("carries every taxonomy value, because it is generated from the lists", () => {
    const sys = systemPrompt();
    for (const v of [...ANGLES, ...AD_FORMATS]) {
      assert.ok(sys.includes(v), `${v} is missing from the system prompt`);
    }
  });

  test("tells the model to copy the hook exactly", () => {
    assert.match(systemPrompt(), /COPIED EXACTLY/);
    assert.match(systemPrompt(), /Never paraphrase/);
  });

  test("asks for one line per ad and nothing else", () => {
    assert.match(systemPrompt(), /ONE JSON OBJECT PER LINE/);
  });

  test("the user prompt numbers each ad and includes its body", () => {
    const u = userPrompt(batch);
    assert.match(u, /--- ref 1 ---/);
    assert.match(u, /--- ref 2 ---/);
    assert.ok(u.includes("Need $50,000 in 72 hours?"));
  });

  test("a missing headline is stated as absent rather than omitted", () => {
    // "(none)" tells the model the field was empty. Omitting the line would let
    // it infer the headline from the body and invent one.
    assert.ok(userPrompt(batch).includes("headline: (none)"));
  });

  test("the batch size is 25, per the spec", () => {
    assert.equal(BATCH_SIZE, 25);
  });

  test("the model is an Anthropic model, named explicitly", () => {
    assert.equal(CLASSIFIER_MODEL, "claude-opus-5");
  });
});

describe("cost", () => {
  test("integer cents, from the published per-million rates", () => {
    assert.equal(PRICE_CENTS_PER_MTOK_IN, 500);
    assert.equal(PRICE_CENTS_PER_MTOK_OUT, 2500);
    // 1M in + 1M out = $5 + $25 = $30.
    assert.equal(batchCostCents(1_000_000, 1_000_000), 3000);
  });

  test("unknown token counts give an unknown cost, not a zero one", () => {
    assert.equal(batchCostCents(null, 100), null);
    assert.equal(batchCostCents(100, undefined), null);
  });
});

describe("classifyBatch without a key", () => {
  test("reports skipped_no_model and classifies nothing", async () => {
    // callModel returns a shadow result when no key is set. The correct
    // behaviour is an empty answer with a stated reason — never an invented
    // classification, and never a throw that loses the rest of the run.
    const out = await classifyBatch(batch, { env: {} });
    assert.equal(out.reason, "skipped_no_model");
    assert.equal(out.byHash.size, 0);
  });

  test("a provider error is reported, not swallowed", async () => {
    const out = await classifyBatch(batch, {
      env: { ANTHROPIC_API_KEY: "test-key" },
      fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: "rate limited" }) })
    });
    assert.match(out.reason, /model_error/);
    assert.equal(out.byHash.size, 0);
  });

  test("a live reply is parsed and the usage is carried back", async () => {
    const out = await classifyBatch(batch, {
      env: { ANTHROPIC_API_KEY: "test-key" },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: "text", text: `${line(1)}\n${line(2, { compliance_risk: "uses_no_credit_check" })}` }],
          usage: { input_tokens: 4000, output_tokens: 2000 }
        })
      })
    });
    assert.equal(out.reason, null);
    assert.equal(out.byHash.size, 2);
    assert.equal(out.byHash.get("hash-b").compliance_risk, "uses_no_credit_check");
    assert.equal(out.inputTokens, 4000);
    assert.equal(batchCostCents(out.inputTokens, out.outputTokens), 7);
  });

  test("OpenAI is not used even when its key is set", async () => {
    // src/agents/model.mjs prefers OpenAI when OPENAI_API_KEY is present. This
    // job is specified as an Anthropic job, so the call site narrows the env.
    // The assertion is on the URL the adapter reached for.
    let url = null;
    await classifyBatch(batch, {
      env: { OPENAI_API_KEY: "sk-openai", ANTHROPIC_API_KEY: "test-key" },
      fetchImpl: async (u) => {
        url = u;
        return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: line(1) }], usage: {} }) };
      }
    });
    assert.match(String(url), /api\.anthropic\.com/);
  });
});

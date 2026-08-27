import { test } from "node:test";
import assert from "node:assert/strict";
import { callModel, liveModelProvider, DEFAULT_OPENAI_MODEL } from "./model.mjs";

test("liveModelProvider prefers OpenAI when that key is set", () => {
  assert.equal(liveModelProvider({}), null);
  assert.equal(liveModelProvider({ OPENAI_API_KEY: "sk-openai" }), "openai");
  assert.equal(liveModelProvider({ COMPANY_BRAIN_OPENAI_API_KEY: "sk-brain" }), "openai");
  assert.equal(liveModelProvider({ ANTHROPIC_API_KEY: "sk-ant" }), "anthropic");
  assert.equal(liveModelProvider({
    OPENAI_API_KEY: "sk-openai",
    ANTHROPIC_API_KEY: "sk-ant"
  }), "openai");
});

test("callModel with no key stays shadow and fetches nothing", async () => {
  let fetched = 0;
  const res = await callModel({
    system: "sys",
    user: "hi",
    env: {},
    fetchImpl: async () => { fetched += 1; throw new Error("should not fetch"); }
  });
  assert.equal(res.mode, "shadow");
  assert.match(res.text, /\[SHADOW — no API key\]/);
  assert.match(res.text, /hi/);
  assert.equal(fetched, 0);
});

test("callModel with only OPENAI_API_KEY posts to OpenAI chat completions", async () => {
  const res = await callModel({
    system: "sys",
    user: "hi",
    env: { OPENAI_API_KEY: "sk-openai" },
    fetchImpl: async (url, opts) => {
      assert.match(url, /api\.openai\.com\/v1\/chat\/completions/);
      assert.equal(opts.headers.authorization, "Bearer sk-openai");
      const body = JSON.parse(opts.body);
      assert.equal(body.model, DEFAULT_OPENAI_MODEL);
      assert.equal(body.messages[0].role, "system");
      assert.equal(body.messages[1].role, "user");
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Why $32?" } }],
          usage: { prompt_tokens: 5, completion_tokens: 7 }
        })
      };
    }
  });
  assert.equal(res.mode, "live");
  assert.equal(res.text, "Why $32?");
  assert.equal(res.request.provider, "openai");
  assert.equal(res.usage.input_tokens, 5);
  assert.equal(res.usage.output_tokens, 7);
});

test("callModel with only ANTHROPIC_API_KEY still posts to Anthropic", async () => {
  const res = await callModel({
    system: "sys",
    user: "hi",
    env: { ANTHROPIC_API_KEY: "test-key" },
    fetchImpl: async (url, opts) => {
      assert.match(url, /anthropic\.com/);
      assert.equal(opts.headers["x-api-key"], "test-key");
      return {
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "Book Thursday at 2?" }],
          usage: { input_tokens: 3, output_tokens: 9 }
        })
      };
    }
  });
  assert.equal(res.mode, "live");
  assert.equal(res.text, "Book Thursday at 2?");
  assert.equal(res.request.provider, "anthropic");
  assert.equal(res.usage.input_tokens, 3);
  assert.equal(res.usage.output_tokens, 9);
});

test("callModel with both keys uses OpenAI, not Anthropic", async () => {
  const res = await callModel({
    system: "sys",
    user: "drill",
    env: { OPENAI_API_KEY: "sk-openai", ANTHROPIC_API_KEY: "sk-ant" },
    fetchImpl: async (url) => {
      assert.match(url, /api\.openai\.com/);
      assert.doesNotMatch(url, /anthropic/);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "I am the buyer." } }]
        })
      };
    }
  });
  assert.equal(res.mode, "live");
  assert.equal(res.text, "I am the buyer.");
  assert.equal(res.request.provider, "openai");
});

import test from "node:test";
import assert from "node:assert/strict";

import { synthesizeAnswer } from "./answer.mjs";

const CHUNKS = [{
  fileName: "Closer script.docx",
  content: "When they say the rate is high, ask what they compared it to.",
  webViewLink: "https://drive.google.com/file/d/x",
  accessTier: "sales"
}];

// Fake Anthropic Messages API. Records the request so we can assert we called
// Claude and not OpenAI. No real network.
function fakeAnthropic({ status = 200, body } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, json: JSON.parse(init.body) });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body ?? {
        content: [{ type: "text", text: "Per [1], ask what they compared the rate to." }]
      }
    };
  };
  return { calls, fetchImpl };
}

test("synthesizeAnswer calls Claude when ANTHROPIC_API_KEY is set", async () => {
  const { calls, fetchImpl } = fakeAnthropic();
  const out = await synthesizeAnswer({
    query: "objection script",
    chunks: CHUNKS,
    env: { ANTHROPIC_API_KEY: "sk-ant-test" },
    fetchImpl
  });

  assert.equal(out.ok, true);
  assert.equal(out.source, "model");
  assert.equal(out.thin, false);
  assert.match(out.text, /compared the rate to/);
  assert.equal(out.citations.length, 1);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(calls[0].init.headers["x-api-key"], "sk-ant-test");
  assert.match(calls[0].json.model, /^claude-/);
  assert.match(calls[0].json.system, /ONLY the numbered sources/);
  assert.match(calls[0].json.messages[0].content, /Closer script/);
});

test("synthesizeAnswer falls back to extractive when no ANTHROPIC_API_KEY", async () => {
  const { calls, fetchImpl } = fakeAnthropic();
  const out = await synthesizeAnswer({
    query: "objection script",
    chunks: CHUNKS,
    env: {},
    fetchImpl
  });

  assert.equal(out.ok, true);
  assert.equal(out.source, "extractive");
  assert.equal(out.thin, true);
  assert.match(out.text, /Closer script/);
  assert.equal(calls.length, 0);
});

test("synthesizeAnswer fallback text does not name OpenAI", async () => {
  const out = await synthesizeAnswer({ query: "q", chunks: CHUNKS, env: {} });
  assert.doesNotMatch(out.text, /OpenAI/i);
});

test("synthesizeAnswer having only OPENAI_API_KEY does not call a model", async () => {
  const { calls, fetchImpl } = fakeAnthropic();
  const out = await synthesizeAnswer({
    query: "objection script",
    chunks: CHUNKS,
    env: { OPENAI_API_KEY: "sk-openai" },
    fetchImpl
  });
  assert.equal(out.source, "extractive");
  assert.equal(calls.length, 0);
});

test("synthesizeAnswer falls back to extractive when Claude errors", async () => {
  const { fetchImpl } = fakeAnthropic({ status: 500, body: { error: "boom" } });
  const out = await synthesizeAnswer({
    query: "objection script",
    chunks: CHUNKS,
    env: { ANTHROPIC_API_KEY: "sk-ant-test" },
    fetchImpl
  });
  assert.equal(out.ok, true);
  assert.equal(out.source, "extractive");
});

test("synthesizeAnswer falls back when Claude returns no text", async () => {
  const { fetchImpl } = fakeAnthropic({ body: { content: [] } });
  const out = await synthesizeAnswer({
    query: "objection script",
    chunks: CHUNKS,
    env: { ANTHROPIC_API_KEY: "sk-ant-test" },
    fetchImpl
  });
  assert.equal(out.source, "extractive");
});

test("synthesizeAnswer with no chunks returns source none and never calls a model", async () => {
  const { calls, fetchImpl } = fakeAnthropic();
  const out = await synthesizeAnswer({
    query: "anything",
    chunks: [],
    env: { ANTHROPIC_API_KEY: "sk-ant-test" },
    fetchImpl
  });
  assert.equal(out.ok, true);
  assert.equal(out.source, "none");
  assert.equal(out.thin, true);
  assert.deepEqual(out.citations, []);
  assert.equal(calls.length, 0);
});

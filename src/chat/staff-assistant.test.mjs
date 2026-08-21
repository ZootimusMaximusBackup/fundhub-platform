import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  answerStaffQuestion,
  staffAssistantSystemPrompt
} from "./staff-assistant.mjs";
import { platformHelpCorpus } from "./platform-help.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const KEYED = { ANTHROPIC_API_KEY: "sk-ant-test" };

function anthropicReply(text) {
  return async () => ({
    ok: true,
    json: async () => ({ content: [{ type: "text", text }] })
  });
}

test("platformHelpCorpus returns entries with answers and cannot mutate the source", () => {
  const a = platformHelpCorpus();
  assert.ok(a.length > 0);
  assert.ok(a[0].answer);
  a[0].keywords.push("mutated");
  assert.equal(platformHelpCorpus()[0].keywords.includes("mutated"), false);
});

test("system prompt embeds the corpus and forbids invention", () => {
  const p = staffAssistantSystemPrompt();
  assert.match(p, /Never invent a screen, button, field, or behavior/);
  assert.match(p, /\[send-contract\]/);
  assert.match(p, /Answer ONLY from the help entries below/);
});

test("system prompt forbids Markdown, which the widget renders literally", () => {
  assert.match(staffAssistantSystemPrompt(), /does not render Markdown/);
});

test("Claude answers the Ask tab when a key is present", async () => {
  const out = await answerStaffQuestion({
    question: "how do I send a contract",
    env: KEYED,
    fetchImpl: anthropicReply("Open Closer Dashboard, pick a wording, press Send.")
  });
  assert.equal(out.source, "claude");
  assert.equal(out.text, "Open Closer Dashboard, pick a wording, press Send.");
  assert.equal(out.thin, false);
});

test("sources come from the ranker, not the model", async () => {
  const out = await answerStaffQuestion({
    question: "how do I send a contract",
    env: KEYED,
    fetchImpl: anthropicReply("Anything at all.")
  });
  assert.ok(out.sources.some((s) => s.id === "send-contract"));
});

test("no Claude key degrades to the old keyword answer", async () => {
  const out = await answerStaffQuestion({
    question: "how do I send a contract",
    env: {}
  });
  assert.equal(out.source, "platform_help");
  assert.match(out.text, /Closer Dashboard/);
});

test("an Anthropic error degrades instead of throwing", async () => {
  const out = await answerStaffQuestion({
    question: "how do I run a soft pull",
    env: KEYED,
    fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) })
  });
  assert.equal(out.source, "platform_help");
  assert.match(out.text, /Finance OS/);
});

test("an empty question never calls the model", async () => {
  let called = false;
  const out = await answerStaffQuestion({
    question: "",
    env: KEYED,
    fetchImpl: async () => { called = true; return { ok: true, json: async () => ({}) }; }
  });
  assert.equal(called, false);
  assert.equal(out.source, "platform_help");
});

test("ask endpoint system mode routes through the staff assistant", () => {
  const src = readFileSync(path.join(ROOT, "api/chat/ask.mjs"), "utf8");
  assert.match(src, /answerStaffQuestion/);
  assert.doesNotMatch(src, /askPlatformHelp/);
});

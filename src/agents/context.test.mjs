import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fetchContext, formatPromptBlock } from "./context.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const CLIENT = "550e8400-e29b-41d4-a716-446655440000";

function mockDb(extra = {}) {
  return {
    async query(sql) {
      if (/FROM clients/i.test(sql)) {
        return {
          rows: [{
            id: CLIENT, first_name: "Jane", last_name: "Doe",
            email: "jane@x.test", phone: null, funded: true,
            funded_amount: 50000, tags: [], outcome_tier: null,
            dnd_sms: false, dnd_email: false, dnd_voice: false
          }]
        };
      }
      if (/FROM conversations/i.test(sql)) return { rows: [] };
      if (/FROM messages/i.test(sql)) return { rows: [] };
      if (/FROM cards/i.test(sql)) return { rows: [] };
      if (/FROM funding_rounds/i.test(sql)) return { rows: [] };
      if (/FROM client_custom_fields/i.test(sql)) return { rows: [{}] };
      if (/FROM customer_insights/i.test(sql)) {
        return { rows: extra.insights || [] };
      }
      if (/FROM call_outcomes/i.test(sql)) {
        return { rows: extra.calls || [] };
      }
      return { rows: [] };
    }
  };
}

test("fetchContext includes interview answers and the recording link", async () => {
  const ctx = await fetchContext(mockDb({
    insights: [{
      stage: "post",
      channel: "google_meet",
      answers: { what_almost_stopped_you: "Price" },
      notes: "Loved the closer",
      recording_url: "https://drive.google.com/file/d/rec",
      meeting_url: "https://meet.google.com/abc",
      occurred_at: "2026-08-15T16:00:00Z"
    }],
    calls: [{
      outcome: "deposit",
      notes: "Closed",
      recording_url: "https://drive.google.com/file/d/call",
      transcript: "three thousand is a start and part of ten percent",
      logged_at: "2026-08-14T16:00:00Z"
    }]
  }), { orgId: ORG, clientId: CLIENT });

  assert.equal(ctx.insights.length, 1);
  assert.equal(ctx.insights[0].answers.what_almost_stopped_you, "Price");
  assert.equal(ctx.recent_calls[0].outcome, "deposit");
  assert.match(ctx.as_prompt_block, /Price/);
  assert.match(ctx.as_prompt_block, /Loved the closer/);
  assert.match(ctx.as_prompt_block, /deposit/);
  assert.match(ctx.as_prompt_block, /three thousand is a start/);
});

test("formatPromptBlock omits empty interview blocks", () => {
  const text = formatPromptBlock({
    client: { first_name: "Jane", last_name: "Doe" },
    snapshot: {},
    survey: {},
    insights: [],
    recent_calls: []
  });
  assert.doesNotMatch(text, /Customer interviews/);
  assert.match(text, /Jane Doe/);
});

test("closer context reads spoken words from call_outcomes.transcript", () => {
  const src = readFileSync(fileURLToPath(new URL("./context.mjs", import.meta.url)), "utf8");
  assert.match(src, /SELECT outcome, notes, recording_url, transcript, logged_at/);
  assert.match(src, /said: /);
});

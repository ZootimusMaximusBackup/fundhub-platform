// Opt-out + quiet-hours respect for the agent reply path.
// Quiet hours and opt-out are enforced by the messaging gate inside
// dispatchMessage — these tests prove the agent compose path does not bypass
// them, and that the runtime short-circuits opt-out before the model.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleInbound } from "./runtime.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPLY_SRC = fs.readFileSync(path.join(HERE, "reply.mjs"), "utf8");
const RUNTIME_SRC = fs.readFileSync(path.join(HERE, "runtime.mjs"), "utf8");

test("reply path always goes through dispatchMessage (gate)", () => {
  assert.match(REPLY_SRC, /dispatchMessage/);
  assert.match(REPLY_SRC, /sender_kind/);
  assert.match(REPLY_SRC, /'agent'/);
  assert.doesNotMatch(REPLY_SRC, /skipCompliance/);
  assert.doesNotMatch(REPLY_SRC, /force:\s*true/);
  // Must call the dispatcher — not a provider — so the gate always runs.
  assert.doesNotMatch(REPLY_SRC, /messaging\/providers/);
});

test("runtime never imports a provider directly", () => {
  assert.doesNotMatch(RUNTIME_SRC, /messaging\/providers/);
  assert.match(RUNTIME_SRC, /composeAgentReply|isOptedOut/);
});

test("runtime: opted-out client → shadow log, no model, no send", async () => {
  let modelCalls = 0;
  const shadows = [];
  const agentRow = {
    code: "GHL-A1", status: "live", agent_class: "client_facing",
    channel: "sms_email", runtime: "anthropic",
    prompt: "Book calls.",
    guardrails: { stop_words: [], authority: { msgcap: 8, disc: 0 }, flags: {} }
  };
  const db = {
    query: async (sql, params) => {
      const s = sql.replace(/\s+/g, " ");
      if (/provider_ref/.test(s) && /FROM messages/.test(s)) {
        return { rows: [{ id: "in-1", conversation_id: "convo-1" }] };
      }
      if (/agent_halted_at/.test(s)) {
        return { rows: [{ id: "convo-1", agent_code: "GHL-A1", agent_halted_at: null }] };
      }
      if (/FROM agents WHERE org_id = \$1 AND code/.test(s)) return { rows: [agentRow] };
      if (/FROM opt_outs/.test(s)) return { rows: [{ "?column?": 1 }] };
      if (/INSERT INTO agent_shadow_log/.test(s)) {
        shadows.push(params[10]);
        return { rows: [{ id: "sh1", agent_code: "GHL-A1", reason: params[10], created_at: new Date() }] };
      }
      return { rows: [] };
    }
  };
  const res = await handleInbound({
    id: "evt-oo", orgId: "o1", clientId: "cl1",
    payload: { channel: "sms", body: "hi", sid: "SM-oo" }
  }, db, {
    env: { ANTHROPIC_API_KEY: "k" },
    callModelFn: async () => { modelCalls += 1; return { mode: "live", text: "nope" }; }
  });
  assert.equal(res.reason, "opted_out");
  assert.equal(modelCalls, 0);
  assert.deepEqual(shadows, ["opted_out"]);
});

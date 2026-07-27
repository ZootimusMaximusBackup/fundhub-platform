// AI-SET-03 — No-Answer SMS Cadence.
// Source: GHL-System-Map.md AI SETTER section.
// Audit fix applied (workflow-coherence-audit.md: "all 3 waits = 1 min → triple-
// texts client in ~2 min. Change to 30 min / 2 hr / 24 hr") — done below. Real,
// compliance-scrubbed copy seeded via src/workflows/templates-seed.mjs. Despite the
// "AI Setter" naming this is pre-scripted "Josh"-voiced SMS, not a live AI agent
// call (no `ai_agent` step in the source crawl) — safe to port as a plain templated
// cadence.
//
// Trigger: call.completed, gated on a no-answer disposition. Exits early (no more
// texts) if the lead rebooks (booking.created fires) during the cadence.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { sendTemplated } from "./messaging.mjs";

export const MSG1_KEY = "SMS-AISET03-MSG1";
export const MSG2_KEY = "SMS-AISET03-MSG2";
export const MSG3_KEY = "SMS-AISET03-MSG3";

async function rebooked(db, clientId) {
  const r = await db.query(`SELECT DISTINCT name FROM events WHERE client_id = $1 AND name = ANY($2)`, [clientId, ["booking.created"]]);
  return r.rows.some((row) => row.name === "booking.created");
}

export async function handle({ event, db, step }) {
  if (!["no_answer", "no-answer", "voicemail"].includes(event.payload?.disposition)) {
    return { done: false, reason: "not_no_answer" };
  }

  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const orgId = event.orgId;
  const eventId = event.id;
  const msg1 = await step.run("send-msg1", () => sendTemplated(db, { orgId, clientId, channel: "sms", templateKey: MSG1_KEY, eventId: `${eventId}:1` }));

  await step.sleep("wait-30-min", "30m");
  if (await step.run("check-rebooked-1", () => rebooked(db, clientId))) return { done: true, exitedAt: "after-msg1", msg1 };
  const msg2 = await step.run("send-msg2", () => sendTemplated(db, { orgId, clientId, channel: "sms", templateKey: MSG2_KEY, eventId: `${eventId}:2` }));

  await step.sleep("wait-2-hr", "2h");
  if (await step.run("check-rebooked-2", () => rebooked(db, clientId))) return { done: true, exitedAt: "after-msg2", msg1, msg2 };
  const msg3 = await step.run("send-msg3", () => sendTemplated(db, { orgId, clientId, channel: "sms", templateKey: MSG3_KEY, eventId: `${eventId}:3` }));

  return { done: true, exitedAt: "completed", msg1, msg2, msg3 };
}

export const aiSet03NoAnswerCadence = inngest.createFunction(
  { id: "ai-set-03-no-answer-cadence", name: "AI-SET-03 — No-Answer SMS Cadence" },
  { event: "call.completed" },
  ({ event, step }) => handle({ event: event.data, db, step })
);

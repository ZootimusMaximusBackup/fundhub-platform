// AI-SET-01 — Josh Setter.
// Source: GHL-System-Map.md AI SETTER section / vendor setter-prompt.js.
// Trigger: booking.created. Dials Josh to confirm the Strategy Session.
//
// THE SCRIPT IS NOT REWRITTEN HERE. Prefer the live AG-04 row (Agent Editor).
// If that row is missing or not ready, Bland's task is SETTER_TASK from
// vendor/inquiry-remover/src/agents/setter-prompt.js — imported, not copied.
//
// Transmission is only src/messaging/providers/bland-voice.mjs placeCall
// (CLAUDE.md §12). That function honours MESSAGING_DRY_RUN / the outbound
// fence. Unset, empty, or on means no phone rings.

import setterPrompt from "../../vendor/inquiry-remover/src/agents/setter-prompt.js";
import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { placeCall, agentReadiness, normalizePhone } from "../messaging/providers/bland-voice.mjs";
import { inQuietHours } from "../messaging/gate.mjs";
import { nextQuietHoursEnd } from "../messaging/dispatch.mjs";

export const JOSH_CODE = "AG-04";
export const VENDOR_SETTER_TASK = setterPrompt.SETTER_TASK;

function vendorJoshAgent() {
  return {
    code: JOSH_CODE,
    name: "Setter Josh",
    status: "live",
    runtime: "bland",
    prompt: VENDOR_SETTER_TASK
  };
}

async function resolveJoshAgent(database, orgId) {
  const { rows } = await database.query(
    `SELECT code, name, status, channel, agent_class, runtime, prompt
       FROM agents WHERE org_id = $1 AND code = $2 LIMIT 1`,
    [orgId, JOSH_CODE]
  );
  const row = rows[0] || null;
  if (row && agentReadiness(row).ok) return { agent: row, source: "ag-04" };
  return { agent: vendorJoshAgent(), source: "vendor_prompt" };
}

async function resolvePhone(database, clientId, payload) {
  const { rows } = await database.query(
    `SELECT email, phone FROM clients WHERE id = $1`,
    [clientId]
  );
  return normalizePhone(rows[0]?.phone) || normalizePhone(payload?.phone);
}

export async function handle({ event, db: database, step, placeCallImpl = placeCall, env = process.env, now = () => new Date() }) {
  const clientId = await step.run("resolve-client", () => resolveClient(database, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const phone = await step.run("resolve-phone", () => resolvePhone(database, clientId, event.payload));
  if (!phone) return { done: false, reason: "no_phone" };

  const { agent, source } = await step.run("resolve-josh", () => resolveJoshAgent(database, event.orgId));

  // Same 11pm–11am Eastern window as SMS. Memoize the wake time so a replay
  // after morning does not schedule a second dial.
  const wakeAt = await step.run("quiet-hours-wake", () => {
    const when = now();
    if (!inQuietHours(when)) return null;
    return nextQuietHoursEnd(when).toISOString();
  });
  if (wakeAt) await step.sleepUntil("wait-quiet-hours", new Date(wakeAt));

  const call = await step.run("place-josh-call", () => placeCallImpl({
    agent,
    phone,
    clientId,
    metadata: { org_id: event.orgId, source: "ai-set-01-josh-setter" },
    env
  }));

  return { done: true, call, agentSource: source };
}

export const aiSet01JoshSetter = inngest.createFunction(
  {
    id: "ai-set-01-josh-setter",
    name: "AI-SET-01 — Josh Setter",
    cancelOn: [
      {
        event: "booking.cancelled",
        if: "event.data.payload.bookingUid != null && event.data.payload.bookingUid == async.data.payload.bookingUid"
      },
      {
        event: "booking.cancelled",
        if: "event.data.payload.email != null && event.data.payload.email == async.data.payload.email"
      }
    ]
  },
  { event: "booking.created" },
  ({ event, step }) => handle({ event: event.data, db, step })
);

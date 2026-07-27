// N-01 — Long-Term Cold Nurture.
// Source: GHL workflow c1172aa2-9a44-4eef-a439-8347457f60bd (ghl-crm-source-of-truth.md).
// Filed in GHL under the "DECOMMISSIONED WORKFLOWS" folder alongside its own true
// DECOM duplicate — the folder name is misleading (see workflow-migration-table.md);
// this ports the live definition, not the [AGENT DRAFT] copy (excluded per instructions).
//
// Original GHL trigger was "Tag Added: nurture:cold", assigned by an undocumented
// side-automation. Replaced with funnel-depth classification (Darwin's call, flagged
// for Chris in workflow-migration-table.md) — see src/config/lead-temperature.mjs.
// Only entry.captured can newly put a lead into "cold" (survey.submitted only ever
// moves a lead OUT of cold), so that's the only trigger needed.
//
// SMS copy is confirmed missing in GHL (Chris's own tracking note, session-notes.md).
// The SMS step is wired but gated on a template existing — never invented here.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { currentTemperature } from "../config/lead-temperature.mjs";
import { sendTemplated } from "./messaging.mjs";

export const EMAIL_TEMPLATE_KEY = "EMAIL-N01-COLD-NURTURE";
export const SMS_TEMPLATE_KEY = "SMS-N01-COLD-NURTURE";

// handle — pure business logic, directly testable without Inngest or a live db.
export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { sent: false, reason: "no_client" };

  const temperature = await step.run("classify-temperature", () => currentTemperature(db, clientId));
  if (temperature !== "cold") return { sent: false, reason: `not_cold:${temperature}` };

  const orgId = event.orgId;
  const eventId = event.id;
  const email = await step.run("send-email", () =>
    sendTemplated(db, { orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId }));
  const sms = await step.run("send-sms", () =>
    sendTemplated(db, { orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId }));

  return { sent: true, email, sms };
}

export const n01ColdNurture = inngest.createFunction(
  { id: "n-01-cold-nurture", name: "N-01 — Long-Term Cold Nurture" },
  { event: "entry.captured" },
  ({ event, step }) => handle({ event: event.data, db, step })
);

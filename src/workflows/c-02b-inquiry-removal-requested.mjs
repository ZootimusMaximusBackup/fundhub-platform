// C-02B — Inquiry Removal Requested.
// Source: the CRM system map CREDIT OPS WORKFLOWS section (single-step workflow).
// Trigger: deposit.paid — Spec §4.2's explicit auto-trigger: "deposit.paid -> set
// run_inquiry_removal -> IRA schedule-call flow". This is that trigger, ported
// directly.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { addTags } from "./tags.mjs";

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  await step.run("set-run-inquiry-removal", () => mergeCustomFields(db, clientId, { run_inquiry_removal: true }));
  await step.run("tag-queued", () => addTags(db, clientId, ["inquiry-removal-queued"]));

  return { done: true };
}

export const c02bInquiryRemovalRequested = inngest.createFunction(
  { id: "c-02b-inquiry-removal-requested", name: "C-02B — Inquiry Removal Requested" },
  { event: "deposit.paid" },
  ({ event, step }) => handle({ event: event.data, db, step })
);

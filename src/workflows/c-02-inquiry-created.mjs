// C-02 — Inquiry Created -> Assign Inquiry Specialist.
// Source: GHL-System-Map.md CREDIT OPS WORKFLOWS section.
// Trigger: analysis.completed, gated on the payload carrying newly found inquiries
// (payload.newInquiries — an array of { bureau, inquiry } pairs). Logs each into
// inquiry_log, flags the round on hold, and raises the specialist-assignment task.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { addTags } from "./tags.mjs";

const SOURCE_WORKFLOW = "c-02-inquiry-created";

async function logInquiriesOnce(db, { orgId, clientId, inquiries }) {
  let created = 0;
  for (const inq of inquiries) {
    const dup = await db.query(`SELECT 1 FROM inquiry_log WHERE client_id = $1 AND bureau = $2 AND inquiry = $3`, [clientId, inq.bureau, inq.inquiry]);
    if (dup.rows[0]) continue;
    await db.query(
      `INSERT INTO inquiry_log (org_id, client_id, bureau, inquiry, status) VALUES ($1,$2,$3,$4,'New')`,
      [orgId, clientId, inq.bureau, inq.inquiry]
    );
    created += 1;
  }
  return created;
}

async function createTaskOnce(db, { orgId, clientId, eventId }) {
  const dup = await db.query(`SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = $2 AND body = $3`, [clientId, SOURCE_WORKFLOW, eventId]);
  if (dup.rows[0]) return { created: false };
  await db.query(
    `INSERT INTO tasks (org_id, client_id, assignee, title, body, due_at, source_workflow)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [orgId, clientId, null, "Remove inquiries — round in progress", eventId, null, SOURCE_WORKFLOW]
  );
  return { created: true };
}

export async function handle({ event, db, step }) {
  const inquiries = event.payload?.newInquiries;
  if (!Array.isArray(inquiries) || inquiries.length === 0) return { done: false, reason: "no_new_inquiries" };

  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const orgId = event.orgId;
  const eventId = event.id;
  const logged = await step.run("log-inquiries", () => logInquiriesOnce(db, { orgId, clientId, inquiries }));
  await step.run("set-hold-reason", () => mergeCustomFields(db, clientId, { round_hold_reason: "New Inquiries", employee_next_action: "Remove Inquiries" }));
  await step.run("tag-inquiry-pending", () => addTags(db, clientId, ["inquiry:pending", "ops:action-required"]));
  const task = await step.run("create-task", () => createTaskOnce(db, { orgId, clientId, eventId }));

  return { done: true, logged, task };
}

export const c02InquiryCreated = inngest.createFunction(
  { id: "c-02-inquiry-created", name: "C-02 — Inquiry Created" },
  { event: "analysis.completed" },
  ({ event, step }) => handle({ event: event.data, db, step })
);

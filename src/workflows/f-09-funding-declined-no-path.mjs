// F-09 — Funding Declined / No Path.
// Source: GHL workflow 2af6ed68-3661-4b3b-821f-5b4e49c0e52a (ghl-crm-source-of-truth.md).
//
// Original trigger was "Tag Added: funding:no-path" — an undocumented upstream
// assigner, same shape as N-01/02/03's tag problem. Here there's an actual concrete
// upstream signal already flowing through the system: F-11's Bank Email Event Router
// (src/workflows/f-11-bank-email-event-router.mjs) reacts to the same mail.response
// event and classifies DENIED bank replies. F-09 is that classification's deeper
// follow-through (ops flag + hold reason + review task) rather than F-11's bare
// "note it and exit" — so it reacts to the identical trigger: mail.response with
// classification === "DENIED". Gate: Product Path = Funding (src/config/product-path.mjs).
//
// Sets hold_reason on the client's most recent funding_round — bank_inbox has no
// funding_round_id column to pin the exact round, so "most recent round for this
// client" is the reasonable stand-in (logged in workflow-migration-table.md).

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { clientOutcomeTier, isFundingPath } from "../config/product-path.mjs";
import { addTags } from "./tags.mjs";

const SOURCE_WORKFLOW = "f-09-funding-declined-no-path";
const TASK_TITLE = "Funding no-path decision";

async function setLatestRoundHoldReason(db, clientId, reason) {
  const r = await db.query(`SELECT id, hold_reason FROM funding_rounds WHERE client_id = $1 ORDER BY round_number DESC LIMIT 1`, [clientId]);
  const round = r.rows[0];
  if (!round) return { updated: false };
  await db.query(`UPDATE funding_rounds SET hold_reason = $2 WHERE id = $1`, [round.id, reason]);
  return { updated: true, roundId: round.id };
}

// Returns true only when every application in the latest round is DENIED (or there
// are no applications yet, which also means no remaining path).
async function allApplicationsDenied(db, clientId) {
  const roundRow = await db.query(
    `SELECT id FROM funding_rounds WHERE client_id = $1 ORDER BY round_number DESC LIMIT 1`,
    [clientId]
  );
  if (!roundRow.rows[0]) return true; // no round → nothing pending
  const roundId = roundRow.rows[0].id;
  const apps = await db.query(
    `SELECT status FROM applications WHERE funding_round_id = $1`,
    [roundId]
  );
  if (apps.rows.length === 0) return true; // no apps tracked → treat as final
  return apps.rows.every((a) => a.status === "DENIED");
}

async function createTaskOnce(db, { orgId, clientId, eventId }) {
  const dup = await db.query(`SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = $2 AND body = $3`, [clientId, SOURCE_WORKFLOW, eventId]);
  if (dup.rows[0]) return { created: false };
  await db.query(
    `INSERT INTO tasks (org_id, client_id, assignee, title, body, due_at, source_workflow)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT DO NOTHING`,
    [orgId, clientId, null, TASK_TITLE, eventId, null, SOURCE_WORKFLOW]
  );
  return { created: true };
}

export async function handle({ event, db, step }) {
  if (event.payload?.classification !== "DENIED") return { done: false, reason: "not_denied" };

  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const outcomeTier = await step.run("check-product-path", () => clientOutcomeTier(db, clientId));
  if (!isFundingPath(outcomeTier)) return { done: false, reason: `not_funding_path:${outcomeTier}` };

  const allDenied = await step.run("check-all-denied", () => allApplicationsDenied(db, clientId));
  if (!allDenied) return { done: false, reason: "pending_applications" };

  await step.run("tag-ops-action-required", () => addTags(db, clientId, ["ops:action-required"]));
  const round = await step.run("set-hold-reason", () => setLatestRoundHoldReason(db, clientId, "Internal Review"));
  const task = await step.run("create-task", () => createTaskOnce(db, { orgId: event.orgId, clientId, eventId: event.id }));

  return { done: true, round, task };
}

export const f09FundingDeclinedNoPath = inngest.createFunction(
  { id: "f-09-funding-declined-no-path", name: "F-09 — Funding Declined / No Path" },
  { event: "mail.response" },
  ({ event, step }) => handle({ event: event.data, db, step })
);

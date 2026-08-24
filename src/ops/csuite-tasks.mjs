// C-suite task helper for the Ops / AI COO brain.
//
// The brain does not hire, fire, raise, or bonus anyone itself. It writes a
// task. A human acts. CEO = owner. Chris is owner today.
//
// Hire tasks go to sales_manager (owner-set on the v1 brief). Fire tasks go
// to owner. Neither path calls inviteStaff or suspendStaff.
//
// Dedupe: stable `body` + createTask. client_id is null (company work, not a
// client file). createTask's early SELECT uses `client_id = $1`, which misses
// NULL, so this helper looks up with IS NOT DISTINCT FROM first.

import { createTask as defaultCreateTask } from "../lib/create-task.mjs";

export const CSUITE_SOURCE = "ops-coo";

const MONTHLY_KINDS = new Set(["hire", "diagnose", "ads_review"]);

export const CSUITE_KINDS = Object.freeze({
  hire: Object.freeze({
    kind: "hire",
    assigneeRole: "sales_manager",
    title: "Hire a closer — the calendar is packed",
    bodyPrefix: "hire-closer:packed:"
  }),
  diagnose: Object.freeze({
    kind: "diagnose",
    assigneeRole: "owner",
    title: "Look at team gaps",
    bodyPrefix: "diagnose:gaps:"
  }),
  ads_review: Object.freeze({
    kind: "ads_review",
    assigneeRole: "owner",
    title: "Look at ads spend",
    bodyPrefix: "ads-review:"
  }),
  fire: Object.freeze({
    kind: "fire",
    assigneeRole: "owner",
    title: "Review a fire decision",
    bodyPrefix: "fire:"
  }),
  raise: Object.freeze({
    kind: "raise",
    assigneeRole: "owner",
    title: "Look at a raise",
    bodyPrefix: "raise:"
  }),
  bonus: Object.freeze({
    kind: "bonus",
    assigneeRole: "owner",
    title: "Look at a bonus",
    bodyPrefix: "bonus:"
  })
});

export function monthKey(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function csuiteBody(kind, { now = new Date(), dedupeKey } = {}) {
  const spec = CSUITE_KINDS[kind];
  if (!spec) throw new Error(`createCsuiteTask: unknown kind "${kind}"`);
  if (MONTHLY_KINDS.has(kind)) return `${spec.bodyPrefix}${monthKey(now)}`;
  const key = String(dedupeKey || "").trim();
  if (!key) throw new Error(`createCsuiteTask: ${kind} needs a stable dedupeKey`);
  return `${spec.bodyPrefix}${key}`;
}

async function findExisting(db, { body }) {
  const { rows } = await db.query(
    `SELECT id FROM tasks
      WHERE client_id IS NOT DISTINCT FROM $1
        AND source_workflow = $2
        AND body = $3
      LIMIT 1`,
    [null, CSUITE_SOURCE, body]
  );
  return rows[0] || null;
}

/**
 * createCsuiteTask(db, spec) → { created, id, kind, body, assigneeRole, reason }
 *
 * kind: hire | diagnose | ads_review | fire | raise | bonus
 * Fire / raise / bonus are shapes only. Do not auto-enqueue them unless a
 * locked rule exists. None is locked as of 2026-08-24.
 */
export async function createCsuiteTask(db, {
  kind,
  orgId,
  now = new Date(),
  dedupeKey,
  detail,
  title,
  createTask = defaultCreateTask
} = {}) {
  const spec = CSUITE_KINDS[kind];
  if (!spec) throw new Error(`createCsuiteTask: unknown kind "${kind}"`);
  if (!orgId) throw new Error("createCsuiteTask: orgId is required");

  const body = csuiteBody(kind, { now, dedupeKey });
  const existing = await findExisting(db, { body });
  if (existing) {
    return {
      created: false,
      id: existing.id,
      kind,
      body,
      assigneeRole: spec.assigneeRole,
      reason: "duplicate_event"
    };
  }

  const taskTitle = title || spec.title;
  const result = await createTask(db, {
    orgId,
    clientId: null,
    title: taskTitle,
    sourceWorkflow: CSUITE_SOURCE,
    assigneeRole: spec.assigneeRole,
    body,
    eventId: body
  });

  if (!result.created && !result.id) {
    const again = await findExisting(db, { body });
    if (again) {
      return {
        created: false,
        id: again.id,
        kind,
        body,
        assigneeRole: spec.assigneeRole,
        reason: result.reason || "duplicate_event"
      };
    }
  }

  return {
    created: result.created === true,
    id: result.id,
    kind,
    body,
    assigneeRole: spec.assigneeRole,
    reason: result.reason,
    detail: detail || null
  };
}

export default createCsuiteTask;

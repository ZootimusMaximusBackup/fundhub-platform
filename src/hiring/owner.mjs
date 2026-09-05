// Who owns a hiring req, and the words that describe the job.
//
// Owner-described 2026-09-05: "depending on the role — if it's a sales rep or
// CSM or something like that, it goes to Sarah, or the role, which would be the
// sales manager. If it's anything other than that, it goes to either a hiring
// manager or the COO. For now it's just give the COO, which is me, the CEO."
//
// The rule is stored in db/migrations/294 as hiring_roles.owner_role. This file
// is the only place that reads it, so the resolution order lives in one place.

import { TASK_ROLES } from "../lib/create-task.mjs";

/* THE BACKSTOP IS 'owner', NOT NULL.
   A req that resolves to nobody is a req nobody works, and nothing surfaces
   that: the candidate simply waits. Routing to the owner is occasionally noisy
   and never silent, which is the trade we want. */
export const FALLBACK_OWNER_ROLE = "owner";

/* ownerFor(tx, { orgId, roleKey }) → { staffId, role, source }

   Resolution order, most specific first:
     1. "person"  — hiring_manager_staff_id names someone for this req.
     2. "rule"    — owner_role is the standing rule for this kind of role.
     3. "fallback"— neither is usable. Goes to the owner.

   source is returned rather than inferred because "the sales manager got this
   because of the rule" and "the sales manager got this because someone named
   them" are different facts when a req is routed wrong, and the second is the
   only one worth arguing with.

   Returns staffId: null on the rule and fallback paths. That is not a failure —
   createTask takes assigneeRole without a staff id, and the role queue is the
   correct destination when no individual is named. */
export async function ownerFor(tx, { orgId, roleKey } = {}) {
  if (!orgId) throw new Error("ownerFor: orgId is required");
  if (!roleKey) throw new Error("ownerFor: roleKey is required");

  const { rows } = await tx.query(
    `SELECT r.hiring_manager_staff_id, r.owner_role, s.status AS manager_status
       FROM hiring_roles r
       LEFT JOIN staff s ON s.id = r.hiring_manager_staff_id
      WHERE r.org_id = $1 AND r.key = $2`,
    [orgId, String(roleKey).trim().toLowerCase()]);

  const role = rows[0];
  if (!role) {
    const e = new Error(`ownerFor: no hiring role "${roleKey}"`);
    e.code = "NOT_FOUND";
    throw e;
  }

  /* A named manager who has left routes nowhere. 051 declares the column
     ON DELETE SET NULL, which covers a deleted staff row, but leavers are
     marked inactive rather than deleted — so the id survives and points at
     somebody who will never open the task. */
  if (role.hiring_manager_staff_id && role.manager_status === "active") {
    return {
      staffId: role.hiring_manager_staff_id,
      role: null,
      source: "person"
    };
  }

  /* The CHECK on owner_role and TASK_ROLES must agree or a task passes here and
     is rejected by the database. Checked rather than trusted because the two
     live in different files and drift silently. */
  const ruleRole = role.owner_role;
  if (ruleRole && TASK_ROLES.has(ruleRole)) {
    return { staffId: null, role: ruleRole, source: "rule" };
  }

  return { staffId: null, role: FALLBACK_OWNER_ROLE, source: "fallback" };
}

/* assigneeFor(tx, spec) → { assigneeRole, assigneeStaffId }

   The shape createTask actually wants. Kept separate from ownerFor so the
   resolution can be inspected and tested without a task in the picture.

   assigneeRole is ALWAYS set, even when a person is named, because
   createTask requires it — a task with a staff id and no role has no queue to
   fall back into if that person leaves. */
export async function assigneeFor(tx, { orgId, roleKey } = {}) {
  const owner = await ownerFor(tx, { orgId, roleKey });
  if (owner.source !== "person") {
    return { assigneeRole: owner.role, assigneeStaffId: null };
  }
  const { rows } = await tx.query(
    `SELECT role FROM staff WHERE id = $1`, [owner.staffId]);
  const staffRole = rows[0]?.role;
  return {
    assigneeRole: TASK_ROLES.has(staffRole) ? staffRole : FALLBACK_OWNER_ROLE,
    assigneeStaffId: owner.staffId
  };
}

/* briefFor(tx, { orgId, roleKey }) → { brief, revisions[] }

   brief is null when nobody has written one. That is a real state and callers
   must handle it — see the note in reviseBrief about not inventing text. */
export async function briefFor(tx, { orgId, roleKey } = {}) {
  if (!orgId) throw new Error("briefFor: orgId is required");
  const key = String(roleKey || "").trim().toLowerCase();

  const { rows } = await tx.query(
    `SELECT id, role_brief FROM hiring_roles WHERE org_id = $1 AND key = $2`,
    [orgId, key]);
  const role = rows[0];
  if (!role) {
    const e = new Error(`briefFor: no hiring role "${roleKey}"`);
    e.code = "NOT_FOUND";
    throw e;
  }

  const { rows: revisions } = await tx.query(
    `SELECT v.id, v.brief, v.reason, v.revised_by_agent, v.created_at,
            s.name AS revised_by_name
       FROM hiring_role_brief_revisions v
       LEFT JOIN staff s ON s.id = v.revised_by_staff_id
      WHERE v.role_id = $1
      ORDER BY v.created_at DESC`, [role.id]);

  return { brief: role.role_brief || null, revisions };
}

/* reviseBrief(tx, spec) → { revisionId, brief }

   Writes a new revision AND updates the current text, in that order, so a
   failure leaves the history ahead of the live text rather than behind it.

   Required: orgId, roleKey, brief, reason, and exactly one of byStaffId /
   byAgent. The database enforces the exactly-one rule too; it is repeated here
   so the error names the caller instead of surfacing a constraint violation.

   THIS IS THE ONLY WRITE PATH FOR role_brief. Updating hiring_roles.role_brief
   directly would produce live text with no revision behind it, which is the
   exact thing the history exists to prevent. */
export async function reviseBrief(tx, {
  orgId, roleKey, brief, reason, byStaffId = null, byAgent = null
} = {}) {
  if (!orgId) throw new Error("reviseBrief: orgId is required");
  if (!brief || !String(brief).trim()) {
    throw new Error("reviseBrief: brief is required and cannot be blank");
  }
  if (!reason || !String(reason).trim()) {
    // A brief that changed for no recorded reason cannot be reviewed later,
    // only re-read. That is the whole value of the table.
    throw new Error("reviseBrief: a reason is required for every revision");
  }
  if (Boolean(byStaffId) === Boolean(byAgent)) {
    throw new Error(
      "reviseBrief: pass exactly one of byStaffId or byAgent — " +
      "an automated revision must name the agent that made it");
  }

  const key = String(roleKey || "").trim().toLowerCase();
  const { rows } = await tx.query(
    `SELECT id FROM hiring_roles WHERE org_id = $1 AND key = $2`, [orgId, key]);
  const role = rows[0];
  if (!role) {
    const e = new Error(`reviseBrief: no hiring role "${roleKey}"`);
    e.code = "NOT_FOUND";
    throw e;
  }

  const text = String(brief).trim();
  const { rows: made } = await tx.query(
    `INSERT INTO hiring_role_brief_revisions
       (org_id, role_id, brief, reason, revised_by_staff_id, revised_by_agent)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [orgId, role.id, text, String(reason).trim(), byStaffId, byAgent]);

  await tx.query(
    `UPDATE hiring_roles SET role_brief = $2, updated_at = now() WHERE id = $1`,
    [role.id, text]);

  return { revisionId: made[0].id, brief: text };
}

export default { ownerFor, assigneeFor, briefFor, reviseBrief, FALLBACK_OWNER_ROLE };

// /api/tasks — the work queue the workflows have been writing into.
//
//   GET   ?done=false (default) | true | all
//         ?client_id=<uuid>  ?q=<title search>  ?limit=<n, cap 200>
//         ?role=<employee role> | mine  — whose queue to read
//         ?mine=1                       — shorthand for role=mine
//         ?unclaimed=1                  — role queue only, nobody has picked it up
//         → { ok, tasks: [{ id, client_id, client_name, title, body, due_at,
//                           source_workflow, assignee_role, assignee_staff_id,
//                           assignee_name, done, created_at }] }
//   PATCH { id, done } | { id, claim: true } | { id, assignee_staff_id }
//
// Auth: any staff session.
//
// ?role= and ?mine= are FILTERS, not permissions: any staff session can read any
// role's queue, which is deliberate — covering someone else's work requires
// seeing it. The gate that matters is requireAuth. `mine` resolves to the
// caller's own staff id, never to a value from the query string, so it cannot be
// pointed at another person.
//
// ?role=mine is accepted as well as ?mine=1 because the screens ask both ways.

import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { TASK_ROLES } from "../src/lib/create-task.mjs";

export default async function handler(req, res) {
  const staff = await requireAuth(req, res);
  if (!staff) return;

  if (req.method === "GET") {
    const q = req.query || {};
    const limit = Math.min(parseInt(q.limit ?? "100", 10) || 100, 200);
    const where = [];
    const params = [];
    const add = (sql, val) => { params.push(val); where.push(sql.replace("?", `$${params.length}`)); };

    const done = (q.done ?? "false").toLowerCase();
    if (done === "false") where.push("t.done = false");
    else if (done === "true") where.push("t.done = true");
    if (q.client_id) add("t.client_id = ?", q.client_id);
    if (q.q) add("t.title ILIKE ?", `%${q.q}%`);

    // Whose queue. `mine` is resolved from the authenticated session, so it can
    // never be aimed at another staff member by editing the URL.
    const roleParam = String(q.role ?? "").trim().toLowerCase();
    const mine = q.mine === "1" || q.mine === "true" || roleParam === "mine";
    if (mine) {
      add("t.assignee_staff_id = ?", staff.id);
    } else if (roleParam) {
      if (!TASK_ROLES.has(roleParam)) {
        return res.status(400).json({
          ok: false, error: "unknown_role",
          message: `role must be one of ${[...TASK_ROLES].join(", ")}, or "mine"`
        });
      }
      add("t.assignee_role = ?", roleParam);
    }

    // Unclaimed work in a role queue — what a person picks from.
    if (q.unclaimed === "1" || q.unclaimed === "true") {
      where.push("t.assignee_staff_id IS NULL");
    }

    params.push(limit);
    const sql = `
      SELECT t.id, t.client_id, t.title, t.body, t.due_at,
             t.source_workflow, t.done, t.created_at,
             t.assignee_role, t.assignee_staff_id,
             s.name AS assignee_name,
             TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')) AS client_name
        FROM tasks t
        LEFT JOIN clients c ON c.id = t.client_id
        LEFT JOIN staff   s ON s.id = t.assignee_staff_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY t.due_at ASC NULLS LAST, t.created_at DESC
       LIMIT $${params.length}`;
    try {
      const { rows } = await db.query(sql, params);
      return res.status(200).json({ ok: true, count: rows.length, tasks: rows });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "query_failed", message: err.message });
    }
  }

  if (req.method === "PATCH") {
    const { id, done, claim, assignee_staff_id } = req.body || {};
    const RET = `id, client_id, title, body, due_at, source_workflow,
                 assignee_role, assignee_staff_id, done, created_at`;

    if (!id) return res.status(400).json({ ok: false, error: "id_required" });

    try {
      // claim — take a task off the role queue. Deliberately conditional on
      // assignee_staff_id IS NULL: two people hitting Claim on the same row must
      // not both win, and the loser needs to be told, not silently overwritten.
      if (claim === true) {
        const { rows } = await db.query(
          `UPDATE tasks SET assignee_staff_id = $2, updated_at = now()
            WHERE id = $1 AND assignee_staff_id IS NULL
            RETURNING ${RET}`,
          [id, staff.id]
        );
        if (rows[0]) return res.status(200).json({ ok: true, task: rows[0] });

        // Distinguish "gone" from "somebody got there first".
        const cur = await db.query(
          `SELECT ${RET} FROM tasks WHERE id = $1`, [id]);
        if (!cur.rows[0]) return res.status(404).json({ ok: false, error: "not_found" });
        if (cur.rows[0].assignee_staff_id === staff.id) {
          return res.status(200).json({ ok: true, task: cur.rows[0] });  // already mine
        }
        return res.status(409).json({
          ok: false, error: "already_claimed", task: cur.rows[0]
        });
      }

      // Reassign or hand back. null puts it back in the role queue.
      if (assignee_staff_id !== undefined) {
        const { rows } = await db.query(
          `UPDATE tasks SET assignee_staff_id = $2, updated_at = now()
            WHERE id = $1 RETURNING ${RET}`,
          [id, assignee_staff_id || null]
        );
        if (!rows[0]) return res.status(404).json({ ok: false, error: "not_found" });
        return res.status(200).json({ ok: true, task: rows[0] });
      }

      if (typeof done !== "boolean") {
        return res.status(400).json({ ok: false, error: "done_claim_or_assignee_required" });
      }
      const { rows } = await db.query(
        `UPDATE tasks SET done = $2, updated_at = now() WHERE id = $1
         RETURNING ${RET}`,
        [id, done]
      );
      if (!rows[0]) return res.status(404).json({ ok: false, error: "not_found" });
      return res.status(200).json({ ok: true, task: rows[0] });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "update_failed", message: err.message });
    }
  }

  return res.status(405).json({ ok: false, error: "method_not_allowed" });
}

// /api/tasks — the work queue the workflows have been writing into.
//
//   GET   ?done=false (default) | true | all
//         ?client_id=<uuid>  ?q=<title search>  ?limit=<n, cap 200>
//         → { ok, tasks: [{ id, client_id, client_name, assignee, title, body,
//                           due_at, source_workflow, done, created_at }] }
//   PATCH { id, done } → { ok, task }
//
// Auth: any staff session. Role-filtered views arrive with the assignee_role
// patch after Wave 2 merges; until then this is the whole queue, visible.

import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";

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

    params.push(limit);
    const sql = `
      SELECT t.id, t.client_id, t.assignee, t.title, t.body, t.due_at,
             t.source_workflow, t.done, t.created_at,
             TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')) AS client_name
        FROM tasks t
        LEFT JOIN clients c ON c.id = t.client_id
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
    const { id, done } = req.body || {};
    if (!id || typeof done !== "boolean") {
      return res.status(400).json({ ok: false, error: "id_and_done_required" });
    }
    try {
      const { rows } = await db.query(
        `UPDATE tasks SET done = $2, updated_at = now() WHERE id = $1
         RETURNING id, client_id, assignee, title, body, due_at, source_workflow, done, created_at`,
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

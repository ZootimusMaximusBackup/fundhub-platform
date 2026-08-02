// GET /api/read/agents — the AI agent registry from 037.
//
// Read-only. Auth + role gate + pagination from src/http/read-api.mjs.
//
// Prompt and guardrails ARE returned: the Agent Editor (public/app/agent-editor.html)
// is the screen that edits them, and Save only means something if a reload can
// paint what was stored. prompt_missing / guardrails_missing stay so other
// screens can still ask "is it set?" without reading the bodies.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";

export const run = readHandler({
  roles: ROLE_SETS.STAFF,
  // The org filter binds the CALLER's org, not orgs.is_default. is_default is
  // one fixed org — with a second org in the table it served org A's rows to
  // org B's staff. A session with no org_id binds null, which matches no row:
  // an empty page, never the whole table and never the default org's.
  fetch: (db, { limit, offset, query, staff }) =>
    db.query(`
      SELECT code, name, agent_class, channel, status, runtime, runtime_ref,
             runtime_notes, owner_label, went_live_at, retired_at, sort_order,
             prompt, guardrails,
             (prompt IS NULL OR btrim(prompt) = '') AS prompt_missing,
             (guardrails = '{}'::jsonb)             AS guardrails_missing
        FROM agents
       WHERE org_id = $4::uuid
         AND ($3::text IS NULL OR status = $3)
       ORDER BY sort_order, code
       LIMIT $1 OFFSET $2`,
      [limit + 1, offset, query.status || null, (staff && staff.org_id) || null]).then((r) => r.rows)
});

export default (req, res) => run(req, res, { db, requireAuth });

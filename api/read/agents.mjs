// GET /api/read/agents — the AI agent registry from 037.
//
// Read-only. Auth + role gate + pagination + redaction from
// src/http/read-api.mjs. Prompts and guardrails are NOT returned: they are
// operational configuration, not screen data, and the registry ships them empty
// anyway (see 037). prompt_missing / guardrails_missing say whether each is set.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";

const run = readHandler({
  roles: ROLE_SETS.STAFF,
  fetch: (db, { limit, offset, query }) =>
    db.query(`
      SELECT code, name, agent_class, channel, status, runtime, runtime_ref,
             runtime_notes, owner_label, went_live_at, retired_at, sort_order,
             (prompt IS NULL OR btrim(prompt) = '') AS prompt_missing,
             (guardrails = '{}'::jsonb)             AS guardrails_missing
        FROM agents
       WHERE org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1)
         AND ($3::text IS NULL OR status = $3)
       ORDER BY sort_order, code
       LIMIT $1 OFFSET $2`,
      [limit + 1, offset, query.status || null]).then((r) => r.rows)
});

export default (req, res) => run(req, res, { db, requireAuth });

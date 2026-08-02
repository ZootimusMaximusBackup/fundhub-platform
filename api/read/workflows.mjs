// GET /api/read/workflows — the real workflow registry, all 47.
//
// The registry is CODE, not a database table: every workflow is an
// inngest.createFunction() export in src/workflows/*.mjs, collected in
// src/workflows/index.mjs's `functions` array. This endpoint introspects those
// live function objects (f.opts.id / f.opts.name / f.opts.triggers) rather than
// hand-maintaining a parallel list — the two drifting apart is exactly the bug
// automations.html had before this endpoint existed.
//
// ENGINE STATE IS REAL, NOT DECORATIVE. src/events/bus.mjs only forwards an
// event to Inngest when process.env.INNGEST_EVENT_KEY is set (see its emit()).
// Per CLAUDE.md, flipping that key on is one of three actions this repo asks a
// human before taking — it has never been asked for, so as of this endpoint
// none of the 47 functions have ever run in this environment. engine_active
// reports that honestly instead of a screen inventing "went out fine" copy for
// automations nobody has switched on.
//
// last_triggered_at is the freshest thing that IS real: bus.mjs's emit() always
// appends to the org-scoped `events` table before it even checks the Inngest
// key, so "when did this workflow's trigger last fire" is answerable from that
// table regardless of engine_active. If the events query fails (e.g. no
// database reachable), the registry rows still come back with
// last_triggered_at: null rather than failing the whole request — the registry
// itself needs no database at all.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";
import { functions as workflowFunctions } from "../../src/workflows/index.mjs";

/* categoryOf — the code family a workflow id belongs to, derived from the id
   itself (the leading letters before its first numbered segment), not from a
   hand-authored label. "af-02-referral-ownership-capture" -> "AF",
   "ai-set-03-no-answer-cadence" -> "AI-SET". An id with no numbered segment
   (e.g. "round-started-client-notify") has no family and falls to "OTHER". */
export function categoryOf(id) {
  const parts = String(id || "").split("-");
  const idx = parts.findIndex((p) => /^[0-9]/.test(p));
  if (idx <= 0) return "OTHER";
  return parts.slice(0, idx).join("-").toUpperCase();
}

/* registryRows — the 47 functions, shaped for the screen. No database. */
export function registryRows() {
  return workflowFunctions
    .map((fn) => {
      const id = fn.opts && fn.opts.id;
      const name = fn.opts && fn.opts.name;
      const triggers = (fn.opts && fn.opts.triggers) || [];
      return {
        id,
        name,
        category: categoryOf(id),
        events: triggers.map((t) => t.event).filter(Boolean),
        crons: triggers.map((t) => t.cron).filter(Boolean)
      };
    })
    .filter((r) => r.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function lastTriggeredByEvent(db, { orgId, eventNames }) {
  if (!orgId || !eventNames.length) return {};
  const r = await db.query(
    `SELECT name, max(created_at) AS last_at
       FROM events
      WHERE org_id = $1 AND name = ANY($2::text[])
      GROUP BY name`,
    [orgId, eventNames]
  );
  const out = {};
  for (const row of r.rows) out[row.name] = row.last_at;
  return out;
}

const run = readHandler({
  roles: ROLE_SETS.STAFF,
  fetch: async (db, { staff }) => {
    const rows = registryRows();
    const engineActive = Boolean(process.env.INNGEST_EVENT_KEY);
    const orgId = (staff && staff.org_id) || null;
    const allEvents = [...new Set(rows.flatMap((r) => r.events))];

    let lastByEvent = {};
    try {
      lastByEvent = await lastTriggeredByEvent(db, { orgId, eventNames: allEvents });
    } catch (_) {
      // The registry does not need a database; a query failure here must not
      // take the whole endpoint down with it. Rows fall back to null below.
      lastByEvent = {};
    }

    return rows.map((r) => {
      const lastTriggeredAt = r.events.reduce((latest, ev) => {
        const at = lastByEvent[ev];
        if (!at) return latest;
        return !latest || new Date(at) > new Date(latest) ? at : latest;
      }, null);
      return {
        id: r.id,
        name: r.name,
        category: r.category,
        events: r.events,
        crons: r.crons,
        engine_active: engineActive,
        last_triggered_at: lastTriggeredAt,
        status: !engineActive ? "dormant" : lastTriggeredAt ? "live" : "never_triggered"
      };
    });
  }
});

export default (req, res) => run(req, res, { db, requireAuth });

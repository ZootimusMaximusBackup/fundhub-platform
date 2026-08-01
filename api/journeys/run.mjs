/* POST /api/journeys/run — walk every branch of every journey and report what
 * the code actually did.
 *
 * Owner/admin only, same gate as /api/journeys and /api/journeys/ask and for
 * the same reason: a run drives the real event bus into the real workflows.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE WHOLE RUN HAPPENS INSIDE ONE TRANSACTION THAT IS ALWAYS ROLLED BACK
 *
 * This is the answer to "a synthetic client must never show up on the closer
 * dashboard next to a real one", and it is a stronger answer than filtering
 * every read path would be:
 *
 *   * nothing the run writes is ever visible to anything else — not the
 *     clients it mints, not the messages, not the tasks, not the events
 *   * it needs no deletes, which CLAUDE.md §11 reserves for the owner
 *   * it cannot be forgotten, because the rollback is in the `finally`
 *
 * The routing flip to the memory provider lives inside the same transaction,
 * so the org's real routing configuration is never modified — the UPDATE is
 * visible only to this run and dies with it.
 *
 * The synthetic marker still goes on every client. Belt and braces: the
 * transaction protects this path, the marker protects any other.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY IT WALKS THE SEEDED TREES WHEN THE TABLE IS EMPTY
 *
 * The journeys table has no SQL seed — a row appears only once someone opens
 * the editor and saves. Refusing to run on a fresh database would make the
 * harness useless exactly when it is most useful, so the runner falls back to
 * src/journeys/seed-journeys.mjs and SAYS SO in the response `source` field.
 * It never silently mixes the two.
 */

import { db, pool } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requireRole, ROLE_SETS } from "../../src/http/read-api.mjs";
import { safeError } from "../../src/http/health.mjs";

import { run as walk } from "../../src/journeys/runner/index.mjs";
import { gather } from "../../src/journeys/runner/facts.mjs";
import { diff } from "../../src/journeys/runner/diff.mjs";
import { summary, headline, text } from "../../src/journeys/runner/report.mjs";
import { SEED_JOURNEYS } from "../../src/journeys/seed-journeys.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === "string" && UUID_RE.test(v.trim());

/* Journeys from the table, or the seeded fallback. Never a blend of the two:
   a half-real, half-example run would report on a journey nobody has. */
async function loadJourneys(client, orgId) {
  const { rows } = await client.query(
    `SELECT key, name, start_when, end_when, description, nodes FROM journeys WHERE org_id = $1`,
    [orgId]
  );
  if (!rows.length) return { source: "seed", journeys: SEED_JOURNEYS };
  const journeys = {};
  for (const r of rows) {
    journeys[r.key] = { name: r.name, start: r.start_when, end: r.end_when, desc: r.description, nodes: r.nodes || [] };
  }
  return { source: "database", journeys };
}

export default async function handler(req, res) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.FINANCE)) return;

  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  // FAIL CLOSED ON A SESSION WITH NO ORG. Every query below is org-scoped and
  // an unscoped run would mint clients into somebody else's tenant.
  const orgId = staff.org_id;
  if (!isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "forbidden", message: "this session has no organisation" });
  }

  const body = req.body || {};
  const only = typeof body.journey === "string" && body.journey.trim() ? body.journey.trim() : null;
  const format = body.format === "text" ? "text" : "json";
  const runId = `run-${Date.now().toString(36)}`;

  let client;
  try {
    client = await pool().connect();
  } catch (err) {
    return res.status(503).json({ ok: false, error: "db_unavailable", db: "down", message: safeError(err) });
  }

  try {
    await client.query("BEGIN");

    // The routing flip. Ticket 8's rule: the memory provider is selected ONLY
    // through message_channel_routing, never an env var or a test flag. Inside
    // the transaction, so the org's real configuration is untouched.
    await client.query(
      `UPDATE message_channel_routing SET provider = 'memory' WHERE org_id = $1`,
      [orgId]
    );

    const { source, journeys } = await loadJourneys(client, orgId);
    if (only && !journeys[only]) {
      await client.query("ROLLBACK");
      return res.status(400).json({ ok: false, error: "unknown_journey", allowed: Object.keys(journeys) });
    }

    const report = await walk(client, { journeys, orgId, runId, env: process.env, only });
    const facts = await gather(client, { orgId, env: process.env, journeys });
    const diffed = diff(only ? { [only]: journeys[only] } : journeys, facts, report);
    const s = summary(report, diffed);

    if (format === "text") {
      res.setHeader("content-type", "text/plain; charset=utf-8");
      return res.status(200).send(text(report, diffed));
    }

    return res.status(200).json({
      ok: true,
      runId,
      journeySource: source,
      headline: headline(s),
      summary: s,
      paths: report.paths.map((p) => ({
        pathId: p.pathId,
        branches: p.branches,
        steps: p.steps,
        events: p.events.map((e) => ({ name: e.name, at: e.at, workflows: e.workflows.map((w) => w.id) })),
        workflowsFired: p.workflowsFired,
        messages: p.messages,
        dispatched: p.dispatched,
        virtualElapsedMs: p.virtualElapsedMs,
        terminal: p.terminal,
        failure: p.failure
      }))
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "run_failed", message: safeError(err) });
  } finally {
    /* ALWAYS. Not conditional on success, not skipped on an early return —
       every exit from the block above passes through here. A committed journey
       run is a bug, so there is deliberately no code path that commits. */
    try {
      await client.query("ROLLBACK");
    } catch {
      /* the connection is already broken; releasing it is what matters */
    }
    client.release();
  }
}

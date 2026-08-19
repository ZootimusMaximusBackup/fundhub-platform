// GET/PUT /api/journeys — the Journeys editor's persisted automation steps
// (public/app/journeys.html): the SMS/email/pipeline workflow each of the
// six journey keys (client, setter, closer, advisor, affiliate, partner)
// runs, stored as the same nested step tree the editor renders.
//
//   GET             → { ok, journeys: { <key>: {name, start, end, desc, nodes, updatedAt} } }
//   PUT { key, name, start, end, desc, nodes }  → upsert one journey
//
// Gated owner/admin, same as api/journeys/ask.mjs and for the same reason: a
// journey's steps are live SMS/email copy and pipeline wiring, not a read
// screen. Scoped by org_id, same convention as message_templates
// (db/schema/001_init.sql) — this is internal operating automation, not
// partner-branded content.

import { db } from "../src/db.mjs";
import { requireRole } from "../src/http/middleware/requireRole.mjs";
import { safeError } from "../src/http/health.mjs";
import { findSingleBraceTagsInNodes } from "../src/journeys/copy-tags.mjs";

const KEYS = new Set(["client", "setter", "closer", "advisor", "affiliate", "partner"]);

/* ═══════════════════════════════════════════════════════════════════════════
 * STEP SHAPE VALIDATION, AND WHY IT IS HERE RATHER THAN NOWHERE
 *
 * This used to check Array.isArray(body.nodes) and the merge-tag braces, then
 * store the JSON verbatim. Nothing looked at a step's type or its settings. So
 * a step could be saved with a type nothing renders, or a wait with no length
 * on it at all — and the first anyone heard of it was the "Test against the
 * code" report saying `wait unit "undefined" is not one of minutes/hours/days`,
 * which tells the owner nothing about which step or how to fix it.
 *
 * WHAT IS CHECKED IS DELIBERATELY NARROW. Only the settings whose absence makes
 * a step meaningless rather than unfinished:
 *
 *   * the step type must be one the editor and the runner both know
 *   * a wait must have a length and a unit, or it is not a wait
 *   * a question must have something to check and its two paths, or the walker
 *     produces no paths at all for the whole journey
 *   * moving a card must name a pipeline and a stage, or it has nowhere to go
 *
 * NOT CHECKED: empty message copy, an empty note, an unset payment amount. The
 * editor creates those steps empty on purpose and the author fills them in
 * afterwards; refusing the save would break authoring to prevent a draft. A
 * message with no words is caught later, by the run, which is the right place.
 * ═══════════════════════════════════════════════════════════════════════════ */
const STEP_TYPES = new Set([
  "sms", "email", "wait", "condition", "stage", "assign", "handoff", "agent", "payment", "record"
]);
const WAIT_UNITS = new Set(["minutes", "hours", "days"]);
const filled = (v) => typeof v === "string" && v.trim().length > 0;

function stepProblem(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return "is not a step at all";
  if (!filled(node.type)) return "has no step type";
  if (!STEP_TYPES.has(node.type)) {
    return `is a "${node.type}" step, and there is no such kind of step — the allowed kinds are ${[...STEP_TYPES].join(", ")}`;
  }
  const cfg = node.cfg;
  if (cfg != null && (typeof cfg !== "object" || Array.isArray(cfg))) return "has its settings stored as something other than a list of settings";
  const c = cfg || {};

  if (node.type === "wait") {
    const amount = Number(c.amount);
    if (!WAIT_UNITS.has(c.unit) || !Number.isFinite(amount) || amount <= 0) {
      return `is a wait with no proper length on it (it says "${c.amount} ${c.unit}") — it needs a number and one of minutes, hours or days`;
    }
  }
  if (node.type === "condition") {
    if (!filled(c.field)) return "is a question with nothing to check";
    /* A question with NO paths is the one that has to be refused: the walker
       enumerates paths through a question by walking its lanes, so a question
       with none produces zero paths for the WHOLE journey — the journey then
       tests as if it were empty, and nothing on the report says why. One lane
       is odd but walkable, so it is left alone rather than refused; the editor
       always writes two. */
    if (!Array.isArray(node.branches) || node.branches.length === 0) {
      return "is a question with no paths coming off it — a question with no paths stops the whole journey being walked";
    }
    for (const b of node.branches) {
      if (!b || typeof b !== "object" || !Array.isArray(b.nodes)) return "is a question whose paths are not stored properly";
    }
  }
  if (node.type === "stage" && !(filled(c.stage) && filled(c.pipeline))) {
    return "moves the card but names no pipeline and stage, so the card has nowhere to land";
  }
  return null;
}

/* Every step, including the ones inside a question's two paths. Returns one row
   per bad step — the author needs to know WHICH step, not just that one exists. */
export function findBadSteps(nodes, trail = []) {
  const out = [];
  nodes.forEach((node, i) => {
    const where = [...trail, i + 1];
    const problem = stepProblem(node);
    if (problem) {
      out.push({
        nodeId: node && typeof node === "object" ? (node.id ?? null) : null,
        title: node && typeof node === "object" && filled(node.title) ? node.title : `step ${where.join(".")}`,
        type: node && typeof node === "object" ? (node.type ?? null) : null,
        reason: problem
      });
    }
    if (node && Array.isArray(node.branches)) {
      node.branches.forEach((b, bi) => {
        if (b && Array.isArray(b.nodes)) out.push(...findBadSteps(b.nodes, [...where, bi + 1]));
      });
    }
  });
  return out;
}

export default async function handler(req, res) {
  const staff = await requireRole("owner", "admin")(req, res);
  if (!staff) return;

  if (req.method === "GET") {
    try {
      const { rows } = await db.query(
        `SELECT key, name, start_when, end_when, description, nodes, updated_at
           FROM journeys WHERE org_id = $1`, [staff.org_id]);
      const journeys = {};
      for (const r of rows) {
        journeys[r.key] = {
          name: r.name, start: r.start_when, end: r.end_when,
          desc: r.description, nodes: r.nodes, updatedAt: r.updated_at
        };
      }
      return res.status(200).json({ ok: true, journeys });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "query_failed", message: "Something went wrong loading journeys. Try again in a moment.", detail: safeError(err) });
    }
  }

  if (req.method === "PUT") {
    const body = req.body || {};
    const key = String(body.key || "");
    if (!KEYS.has(key)) {
      return res.status(400).json({ ok: false, error: "invalid_key", allowed: [...KEYS] });
    }
    if (typeof body.name !== "string" || !body.name.trim()) {
      return res.status(400).json({ ok: false, error: "name_required" });
    }
    if (typeof body.start !== "string" || !body.start.trim() ||
        typeof body.end !== "string" || !body.end.trim()) {
      return res.status(400).json({ ok: false, error: "start_and_end_required" });
    }
    if (!Array.isArray(body.nodes)) {
      return res.status(400).json({ ok: false, error: "nodes_must_be_an_array" });
    }
    // A single-brace tag like {first_name} is not a token render-template.mjs can
    // see — it only matches {{double braces}} — so it would send as literal brace
    // characters instead of the client's name. Refused here, not just warned,
    // because a saved single-brace tag is a live outbound message defect the
    // editor itself cannot show the author once it round-trips through the DB.
    /* Shape first, then copy. A step with no type is not something the brace
       scan can say anything useful about. */
    const badSteps = findBadSteps(body.nodes);
    if (badSteps.length) {
      return res.status(400).json({
        ok: false,
        error: "steps_not_set_up",
        message: `${badSteps.length} step${badSteps.length === 1 ? " is" : "s are"} missing something they need. Fix ${badSteps.length === 1 ? "it" : "them"} and save again.`,
        violations: badSteps
      });
    }
    const braceViolations = findSingleBraceTagsInNodes(body.nodes);
    if (braceViolations.length) {
      return res.status(400).json({
        ok: false,
        error: "single_brace_tags",
        message: "Some steps use one curly brace instead of two, like {first_name} instead of {{first_name}}. Fix those and save again.",
        violations: braceViolations
      });
    }
    try {
      const { rows } = await db.query(
        `INSERT INTO journeys (org_id, key, name, start_when, end_when, description, nodes, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
         ON CONFLICT (org_id, key) DO UPDATE SET
           name = $3, start_when = $4, end_when = $5, description = $6,
           nodes = $7::jsonb, updated_by = $8, updated_at = now()
         RETURNING key, updated_at`,
        [staff.org_id, key, body.name.trim(), body.start, body.end, String(body.desc || ""),
         JSON.stringify(body.nodes), staff.id]);
      return res.status(200).json({ ok: true, key: rows[0].key, updatedAt: rows[0].updated_at });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "write_failed", message: "Something went wrong saving that journey. Try again in a moment.", detail: safeError(err) });
    }
  }

  res.setHeader("Allow", "GET, PUT");
  return res.status(405).json({ ok: false, error: "method_not_allowed" });
}

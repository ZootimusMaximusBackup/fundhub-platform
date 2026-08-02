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
      return res.status(500).json({ ok: false, error: "query_failed", message: safeError(err) });
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
      return res.status(500).json({ ok: false, error: "write_failed", message: safeError(err) });
    }
  }

  res.setHeader("Allow", "GET, PUT");
  return res.status(405).json({ ok: false, error: "method_not_allowed" });
}

// POST /api/read/company-brain { question }
//
// Company Brain search. Role comes from the session (requireAuth), never from
// the request body. Tier filter runs inside retrieveChunks before ranking.
//
// Returns an answer (synthesized when OpenAI is configured, extractive otherwise)
// plus cited sources with Drive links.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../src/http/read-api.mjs";
import { canQueryBrain } from "../../src/company-brain/access.mjs";
import { retrieveChunks } from "../../src/company-brain/retrieve.mjs";
import { synthesizeAnswer } from "../../src/company-brain/answer.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const retrieve = deps.retrieveChunks || retrieveChunks;
  const answer = deps.synthesizeAnswer || synthesizeAnswer;

  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = deps.requireAuth
    ? await deps.requireAuth(req, res, { db: database })
    : await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  // External roles must use /api/read/company-brain-affiliate — never this path.
  if (!canQueryBrain(staff.role)) {
    return res.status(403).json({ ok: false, error: "forbidden_role" });
  }

  if (!staff.org_id) return res.status(403).json({ ok: false, error: "no_org_scope" });

  const question = String((req.body && req.body.question) || "").trim();
  if (!question) return res.status(400).json({ ok: false, error: "question_required" });
  if (question.length > 2000) {
    return res.status(400).json({ ok: false, error: "question_too_long" });
  }

  const found = await retrieve(database, {
    orgId: staff.org_id,
    role: staff.role, // session only
    query: question,
    limit: Number((req.body && req.body.limit) || 8),
    env: deps.env || process.env,
    fetchImpl: deps.fetchImpl
  });

  if (!found.ok) {
    const status = found.reason === "forbidden_role" ? 403 : 502;
    return res.status(status).json({ ok: false, error: found.reason || "retrieve_failed" });
  }

  const synthesized = await answer({
    query: question,
    chunks: found.chunks,
    env: deps.env || process.env,
    fetchImpl: deps.fetchImpl
  });

  return res.status(200).json({
    ok: true,
    question,
    answer: {
      text: synthesized.text,
      thin: !!synthesized.thin,
      source: synthesized.source
    },
    sources: synthesized.citations || [],
    role: staff.role
  });
}

// POST /api/chat/ask — ask-the-system or company knowledge (chat widget).
//
//   { mode: "system"|"knowledge", question }
//
// system  → platform-help corpus (C-1)
// knowledge → Company Brain retrieve (same as /api/read/company-brain)
//
// Staff only. Affiliates use company-brain-affiliate directly; they do not get
// the widget in v1 (C-3).

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../src/http/read-api.mjs";
import { canQueryBrain } from "../../src/company-brain/access.mjs";
import { retrieveChunks } from "../../src/company-brain/retrieve.mjs";
import { synthesizeAnswer } from "../../src/company-brain/answer.mjs";
import { askPlatformHelp } from "../../src/chat/platform-help.mjs";
import { safeError } from "../../src/http/health.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = deps.requireAuth
    ? await deps.requireAuth(req, res, { db: database })
    : await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;
  if (!staff.org_id) return res.status(403).json({ ok: false, error: "no_org_scope" });

  const body = req.body || {};
  const mode = String(body.mode || "system").toLowerCase();
  const question = String(body.question || "").trim();
  if (!question) return res.status(400).json({ ok: false, error: "question_required" });
  if (question.length > 2000) return res.status(400).json({ ok: false, error: "question_too_long" });

  try {
    if (mode === "system" || mode === "howto" || mode === "help") {
      const result = askPlatformHelp(question);
      return res.status(200).json({
        ok: true,
        mode: "system",
        question,
        answer: { text: result.answer, thin: result.thin, source: "platform_help" },
        sources: result.sources
      });
    }

    if (mode === "knowledge" || mode === "brain") {
      if (!canQueryBrain(staff.role)) {
        return res.status(403).json({ ok: false, error: "forbidden_role" });
      }
      const retrieve = deps.retrieveChunks || retrieveChunks;
      const answer = deps.synthesizeAnswer || synthesizeAnswer;
      const found = await retrieve(database, {
        orgId: staff.org_id,
        role: staff.role,
        query: question,
        limit: Number(body.limit) || 8,
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
        mode: "knowledge",
        question,
        answer: {
          text: synthesized.text,
          thin: !!synthesized.thin,
          source: synthesized.source
        },
        sources: synthesized.citations || []
      });
    }

    return res.status(400).json({ ok: false, error: "unknown_mode", allowed: ["system", "knowledge"] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}

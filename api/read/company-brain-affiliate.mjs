// POST /api/read/company-brain-affiliate { question }
//
// EXTERNAL Company Brain path for affiliate + white-label partner roles.
// Hits ONLY the owner-approved allowlist (access_tier = affiliate AND
// brain_affiliate_allowlist). Never falls back to internal tiers.
//
// Staff must use /api/read/company-brain — this endpoint refuses them.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import {
  canQueryAffiliateBrain,
  isExternalBrainRole
} from "../../src/company-brain/access.mjs";
import { retrieveAffiliateChunks } from "../../src/company-brain/retrieve.mjs";
import { synthesizeAnswer } from "../../src/company-brain/answer.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const auth = deps.requireAuth || requireAuth;
  const retrieve = deps.retrieveAffiliateChunks || retrieveAffiliateChunks;
  const answer = deps.synthesizeAnswer || synthesizeAnswer;

  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await auth(req, res, { db: database });
  if (!staff) return;

  // Do NOT use ROLE_SETS.STAFF — affiliates are outside it.
  if (!isExternalBrainRole(staff.role) || !canQueryAffiliateBrain(staff.role)) {
    return res.status(403).json({ ok: false, error: "forbidden_role" });
  }

  const orgId = staff.org_id;
  if (!orgId) return res.status(403).json({ ok: false, error: "no_org_scope" });

  const question = String((req.body && req.body.question) || "").trim();
  if (!question) return res.status(400).json({ ok: false, error: "question_required" });
  if (question.length > 2000) {
    return res.status(400).json({ ok: false, error: "question_too_long" });
  }

  const found = await retrieve(database, {
    orgId,
    role: staff.role,
    query: question,
    limit: Number((req.body && req.body.limit) || 8),
    env: deps.env || process.env,
    fetchImpl: deps.fetchImpl
  });

  if (!found.ok) {
    const status = found.reason === "forbidden_role" ? 403 : 502;
    return res.status(status).json({ ok: false, error: found.reason || "retrieve_failed" });
  }

  // Hard check: every returned chunk must be affiliate-tier. Fail closed.
  const leaked = (found.chunks || []).filter((c) => c.accessTier !== "affiliate");
  if (leaked.length) {
    return res.status(500).json({ ok: false, error: "affiliate_tier_violation" });
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
    role: staff.role,
    scope: "affiliate_allowlist"
  });
}

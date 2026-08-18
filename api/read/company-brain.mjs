// POST /api/read/company-brain { question }
//
// Company Brain search. Role comes from the session (requireAuth), never from
// the request body. Tier filter runs inside retrieveChunks before ranking.
//
// Returns an answer (synthesized when OpenAI is configured, extractive otherwise)
// plus cited sources with Drive links.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, isUuid, requireRole } from "../../src/http/read-api.mjs";
import { canQueryBrain } from "../../src/company-brain/access.mjs";
import { retrieveChunks } from "../../src/company-brain/retrieve.mjs";
import { synthesizeAnswer } from "../../src/company-brain/answer.mjs";
import {
  appendMessage,
  createThread,
  getThread,
  titleFromQuestion
} from "../../src/company-brain/threads.mjs";

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

  // Chat history (board §3.4). Best effort on purpose: an answer is never
  // withheld because a log write failed.
  const history = await saveTurn(database, {
    orgId: staff.org_id,
    staffId: staff.id,
    requestedThreadId: (req.body && req.body.thread_id) || null,
    question,
    synthesized,
    deps
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
    thread_id: history.threadId,
    ...(history.saved ? {} : { history_saved: false })
  });
}

/* saveTurn — write the question and the answer to the conversation.
   Returns the thread it used and whether the write landed; it never throws,
   because losing the answer to a failed log write is the worse outcome.

   A thread_id the session does not own resolves to a NEW thread rather than an
   error: the answer still lands somewhere the asker can see, and nothing is
   ever appended to another person's conversation. */
async function saveTurn(database, {
  orgId, staffId, requestedThreadId, question, synthesized, deps
}) {
  const load = deps.getThread || getThread;
  const create = deps.createThread || createThread;
  const append = deps.appendMessage || appendMessage;

  let threadId = null;
  try {
    const asked = String(requestedThreadId || "").trim();
    if (isUuid(asked)) {
      const found = await load(database, { orgId, staffId, threadId: asked });
      if (found.ok) threadId = found.thread.id;
    }
    if (!threadId) {
      const made = await create(database, {
        orgId,
        staffId,
        title: titleFromQuestion(question)
      });
      if (!made.ok) return { threadId: null, saved: false };
      threadId = made.thread.id;
    }

    const user = await append(database, {
      orgId, threadId, role: "user", text: question
    });
    const assistant = await append(database, {
      orgId,
      threadId,
      role: "assistant",
      text: synthesized.text || "",
      sources: synthesized.citations || [],
      answerSource: synthesized.source || null,
      thin: !!synthesized.thin
    });
    return { threadId, saved: !!(user.ok && assistant.ok) };
  } catch {
    return { threadId, saved: false };
  }
}

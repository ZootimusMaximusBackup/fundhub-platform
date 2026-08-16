// customer_insights — save and list mid / post interview answers.
// COMPLIANCE REVIEW REQUIRED: quotes may later be used in ads. This module only stores.

import { isUuid } from "../http/read-api.mjs";

export const STAGES = ["mid", "post"];
export const CHANNELS = ["call", "ai_reachout", "google_meet"];

const ANSWER_MAX = 4000;
const NOTES_MAX = 20000;
const URL_MAX = 2000;

export class InsightError extends Error {
  constructor(message, { status = 400, code = "bad_request" } = {}) {
    super(message);
    this.name = "InsightError";
    this.status = status;
    this.code = code;
  }
}

function cleanStr(v, max) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

export function parseAnswers(raw) {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new InsightError("answers must be an object of question id to text");
  }
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = String(k).trim().slice(0, 80);
    if (!key) continue;
    if (v == null || v === "") continue;
    out[key] = String(v).trim().slice(0, ANSWER_MAX);
  }
  return out;
}

export function parseInsightInput(input = {}) {
  const clientId = input.client_id || input.clientId;
  if (!isUuid(clientId)) {
    throw new InsightError("client_id is required and must be a uuid");
  }

  const stage = String(input.stage || "").trim().toLowerCase();
  if (!STAGES.includes(stage)) {
    throw new InsightError("stage must be mid or post");
  }

  const channel = String(input.channel || "").trim().toLowerCase();
  if (!CHANNELS.includes(channel)) {
    throw new InsightError("channel must be call, ai_reachout, or google_meet");
  }

  const productId = input.product_id || input.productId || null;
  if (productId && !isUuid(productId)) {
    throw new InsightError("product_id must be a uuid");
  }

  const taskId = input.task_id || input.taskId || null;
  if (taskId && !isUuid(taskId)) {
    throw new InsightError("task_id must be a uuid");
  }

  let occurredAt = input.occurred_at || input.occurredAt || null;
  if (occurredAt) {
    const d = new Date(occurredAt);
    if (Number.isNaN(d.getTime())) {
      throw new InsightError("occurred_at must be a real date");
    }
    occurredAt = d.toISOString();
  }

  return {
    clientId: String(clientId).trim(),
    productId: productId ? String(productId).trim() : null,
    taskId: taskId ? String(taskId).trim() : null,
    stage,
    channel,
    answers: parseAnswers(input.answers),
    notes: cleanStr(input.notes, NOTES_MAX),
    meetingUrl: cleanStr(input.meeting_url || input.meetingUrl, URL_MAX),
    recordingUrl: cleanStr(input.recording_url || input.recordingUrl, URL_MAX),
    occurredAt
  };
}

export function presentInsight(row) {
  if (!row) return null;
  return {
    id: row.id,
    org_id: row.org_id,
    client_id: row.client_id,
    product_id: row.product_id || null,
    task_id: row.task_id || null,
    stage: row.stage,
    channel: row.channel,
    answers: row.answers && typeof row.answers === "object" ? row.answers : {},
    notes: row.notes || null,
    meeting_url: row.meeting_url || null,
    recording_url: row.recording_url || null,
    recorded_by: row.recorded_by,
    occurred_at: row.occurred_at,
    created_at: row.created_at
  };
}

export async function saveInsight(db, { orgId, staffId, input }) {
  if (!orgId) throw new InsightError("org is required", { status: 403, code: "forbidden" });
  if (!staffId) throw new InsightError("staff is required", { status: 401, code: "unauthorized" });

  const parsed = parseInsightInput(input);

  const client = await db.query(
    `SELECT id FROM clients WHERE id = $1 AND org_id = $2`,
    [parsed.clientId, orgId]
  );
  if (!client.rows[0]) {
    throw new InsightError("client not found", { status: 404, code: "not_found" });
  }

  if (parsed.productId) {
    const p = await db.query(
      `SELECT id FROM products WHERE id = $1 AND org_id = $2`,
      [parsed.productId, orgId]
    );
    if (!p.rows[0]) {
      throw new InsightError("product not found", { status: 404, code: "not_found" });
    }
  }

  if (parsed.taskId) {
    const t = await db.query(
      `SELECT id FROM tasks WHERE id = $1 AND org_id = $2`,
      [parsed.taskId, orgId]
    );
    if (!t.rows[0]) {
      throw new InsightError("task not found", { status: 404, code: "not_found" });
    }
  }

  const ins = await db.query(
    `INSERT INTO customer_insights
       (org_id, client_id, product_id, task_id, stage, channel,
        answers, notes, meeting_url, recording_url, recorded_by, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,COALESCE($12::timestamptz, now()))
     RETURNING *`,
    [
      orgId,
      parsed.clientId,
      parsed.productId,
      parsed.taskId,
      parsed.stage,
      parsed.channel,
      JSON.stringify(parsed.answers),
      parsed.notes,
      parsed.meetingUrl,
      parsed.recordingUrl,
      staffId,
      parsed.occurredAt
    ]
  );

  return presentInsight(ins.rows[0]);
}

export async function listInsights(db, { orgId, clientId = null, stage = null, limit, offset }) {
  if (!orgId) throw new InsightError("org is required", { status: 403, code: "forbidden" });

  const params = [orgId];
  let where = "org_id = $1";
  if (isUuid(clientId)) {
    params.push(String(clientId).trim());
    where += ` AND client_id = $${params.length}`;
  }
  if (stage && STAGES.includes(String(stage).toLowerCase())) {
    params.push(String(stage).toLowerCase());
    where += ` AND stage = $${params.length}`;
  }
  params.push(limit + 1, offset);

  const r = await db.query(
    `SELECT * FROM customer_insights
      WHERE ${where}
      ORDER BY occurred_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return r.rows.map(presentInsight);
}

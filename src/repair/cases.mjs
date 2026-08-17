// Repair desk queue — optimization pipeline cards plus letter counts.
// List payloads never include letter bodies. Detail does, for a human send.

export const NEED_ME_STAGES = Object.freeze([
  "letters_generated",
  "ready_to_send",
  "response_received",
  "stalled"
]);

export const STAGE_LABELS = Object.freeze({
  intake: "Setting up",
  awaiting_documents: "Waiting on papers",
  analysis: "Reviewing the report",
  letters_generated: "Letters made",
  ready_to_send: "Ready to send",
  in_transit: "In the mail",
  awaiting_response: "Waiting on the bureau",
  response_received: "Answer in",
  round_complete: "Round done",
  program_complete: "Done",
  on_hold: "On hold",
  stalled: "Stuck",
  cancelled: "Cancelled",
  round_sent: "Round sent",
  bureau_processing: "Bureau working",
  portal_updated: "Portal updated",
  upgrade_invite: "Upgrade invite"
});

const READY_LETTER = new Set(["generated", "ready"]);

export function stageLabel(key) {
  const k = String(key || "");
  return STAGE_LABELS[k] || k || "Unknown";
}

export function isNeedMeStage(key) {
  return NEED_ME_STAGES.includes(String(key || ""));
}

export function countNeedMe(files = []) {
  return files.filter((f) => f && f.need_me).length;
}

function clientName(row) {
  const n = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  return n || row.email || "Unnamed";
}

function mapFile(row) {
  const stageKey = row.stage_key;
  const ready = Number(row.letters_ready) || 0;
  return {
    card_id: row.card_id,
    client_id: row.client_id,
    name: clientName(row),
    email: row.email || null,
    stage_key: stageKey,
    stage_label: stageLabel(stageKey),
    updated_at: row.updated_at,
    need_me: isNeedMeStage(stageKey),
    round: row.round || null,
    bureaus: Array.isArray(row.bureaus) ? row.bureaus.filter(Boolean) : [],
    letters_ready: ready,
    letters_sent: Number(row.letters_sent) || 0,
    case_count: Number(row.case_count) || 0,
    can_send: ready > 0
  };
}

const LIST_SQL = `
SELECT c.id AS card_id,
       c.client_id,
       cl.first_name,
       cl.last_name,
       cl.email,
       ps.key AS stage_key,
       c.updated_at,
       dc.round,
       dc.bureaus,
       COALESCE(dc.case_count, 0) AS case_count,
       COALESCE(dl.letters_ready, 0) AS letters_ready,
       COALESCE(dl.letters_sent, 0) AS letters_sent
  FROM cards c
  JOIN pipeline_stages ps ON ps.id = c.stage_id
  JOIN pipelines p ON p.id = c.pipeline_id AND p.key = 'optimization'
  LEFT JOIN clients cl ON cl.id = c.client_id AND cl.org_id = c.org_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS case_count,
           MAX(round) AS round,
           ARRAY_AGG(DISTINCT bureau) AS bureaus
      FROM dispute_cases
     WHERE org_id = c.org_id
       AND client_id = c.client_id
       AND status NOT IN ('closed', 'cancelled')
  ) dc ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*) FILTER (WHERE status IN ('generated', 'ready'))::int AS letters_ready,
           COUNT(*) FILTER (WHERE status IN ('sent', 'delivered'))::int AS letters_sent
      FROM dispute_letters
     WHERE org_id = c.org_id
       AND client_id = c.client_id
  ) dl ON TRUE
 WHERE c.org_id = $1::uuid
`;

export async function listRepairCases(db, { orgId, limit = 100 } = {}) {
  if (!orgId) throw new Error("orgId required");
  const cap = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const r = await db.query(
    `${LIST_SQL}
     ORDER BY (ps.key = ANY($2::text[])) DESC, c.updated_at DESC
     LIMIT $3`,
    [orgId, [...NEED_ME_STAGES], cap]
  );
  const files = (r.rows || []).map(mapFile);
  return {
    files,
    need_me: countNeedMe(files),
    ready: files.filter((f) => f.stage_key === "ready_to_send" || f.can_send).length,
    waiting: files.filter((f) => f.stage_key === "awaiting_response" || f.stage_key === "in_transit").length,
    stalled: files.filter((f) => f.stage_key === "stalled").length
  };
}

export async function getRepairCase(db, { orgId, clientId } = {}) {
  if (!orgId) throw new Error("orgId required");
  if (!clientId) throw new Error("clientId required");
  const fileRes = await db.query(`${LIST_SQL} AND c.client_id = $2::uuid LIMIT 1`, [orgId, clientId]);
  const file = fileRes.rows[0] ? mapFile(fileRes.rows[0]) : null;
  const lettersRes = await db.query(
    `SELECT id, bureau, round, status, body_text, rule_ids
       FROM dispute_letters
      WHERE org_id = $1::uuid AND client_id = $2::uuid
      ORDER BY created_at DESC
      LIMIT 50`,
    [orgId, clientId]
  );
  const itemsRes = await db.query(
    `SELECT id, rule_id, severity, field, creditor, account_last4, round, status, outcome
       FROM dispute_items
      WHERE org_id = $1::uuid AND client_id = $2::uuid
      ORDER BY CASE severity
                 WHEN 'deletion' THEN 0
                 WHEN 'strong' THEN 1
                 WHEN 'moderate' THEN 2
                 ELSE 3
               END,
               created_at DESC
      LIMIT 100`,
    [orgId, clientId]
  );
  const letters = (lettersRes.rows || []).map((row) => ({
    id: row.id,
    bureau: row.bureau,
    round: row.round,
    status: row.status,
    rule_ids: row.rule_ids || [],
    html: READY_LETTER.has(row.status) ? row.body_text || "" : null,
    can_send: READY_LETTER.has(row.status) && Boolean(row.body_text)
  }));
  return {
    file,
    letters,
    items: itemsRes.rows || [],
    can_send: letters.some((l) => l.can_send)
  };
}

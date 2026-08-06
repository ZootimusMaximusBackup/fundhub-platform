/* Inquiry removal cases — queue + clear/close actions. */

export const CASE_STATUSES = Object.freeze([
  "Queued",
  "Scheduled",
  "In Progress",
  "Completed",
  "Escalated",
  "Blocked",
  "Canceled"
]);

const CASE_SET = new Set(CASE_STATUSES);
const ACTIVE = new Set(["Queued", "Scheduled", "In Progress", "Escalated", "Blocked"]);

function publicCase(row) {
  if (!row) return null;
  return {
    ...row,
    open_inquiry_count: row.open_inquiry_count != null ? Number(row.open_inquiry_count) : 0
  };
}

export async function listCases(db, {
  orgId,
  activeOnly = true,
  case_status = null,
  assigned_remover = null,
  clientId = null,
  limit = 100,
  offset = 0
} = {}) {
  const params = [orgId];
  const where = ["c.org_id = $1::uuid"];
  if (case_status && CASE_SET.has(case_status)) {
    params.push(case_status);
    where.push(`c.case_status = $${params.length}::inquiry_case_status`);
  } else if (activeOnly) {
    params.push([...ACTIVE]);
    where.push(`c.case_status::text = ANY($${params.length}::text[])`);
  }
  if (assigned_remover) {
    params.push(String(assigned_remover));
    where.push(`c.assigned_remover = $${params.length}`);
  }
  if (clientId) {
    params.push(clientId);
    where.push(`c.client_id = $${params.length}::uuid`);
  }
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 500));
  params.push(Math.max(Number(offset) || 0, 0));
  const r = await db.query(
    `SELECT c.*,
            cl.first_name AS client_first_name,
            cl.last_name AS client_last_name,
            cl.email AS client_email,
            trim(both ' ' FROM concat_ws(' ', cl.first_name, cl.last_name)) AS client_name
       FROM inquiry_removal_cases c
       LEFT JOIN clients cl ON cl.id = c.client_id
      WHERE ${where.join(" AND ")}
      ORDER BY c.requested_at DESC NULLS LAST, c.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return r.rows.map(publicCase);
}

export async function getActiveCaseForClient(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT *
       FROM inquiry_removal_cases
      WHERE org_id = $1::uuid
        AND client_id = $2::uuid
        AND case_status::text = ANY($3::text[])
      ORDER BY requested_at DESC
      LIMIT 1`,
    [orgId, clientId, [...ACTIVE]]
  );
  return publicCase(r.rows[0] || null);
}

export async function createCase(db, { orgId, row }) {
  const caseId = String(row?.case_id || `IRC-${Date.now()}`).slice(0, 80);
  const status = CASE_SET.has(row?.case_status) ? row.case_status : "Queued";
  const r = await db.query(
    `INSERT INTO inquiry_removal_cases (
       org_id, client_id, funding_round_id, case_id, case_status,
       selected_bureaus_raw, ghl_contact_id, ai_call_scheduled_for,
       ai_call_status, request_source, requested_by, requested_at,
       assigned_remover, open_inquiry_count, master_call_state,
       hold_duration_display, remover_notes, inquiry_remover_user_id
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4, $5::inquiry_case_status,
       $6, $7, $8,
       $9, $10, $11, COALESCE($12::timestamptz, now()),
       $13, COALESCE($14, 0), $15,
       $16, $17, $18
     ) RETURNING *`,
    [
      orgId,
      row.client_id,
      row.funding_round_id || null,
      caseId,
      status,
      row.selected_bureaus_raw || null,
      row.ghl_contact_id || null,
      row.ai_call_scheduled_for || null,
      row.ai_call_status || null,
      row.request_source || null,
      row.requested_by || null,
      row.requested_at || null,
      row.assigned_remover || null,
      row.open_inquiry_count != null ? Number(row.open_inquiry_count) : 0,
      row.master_call_state || null,
      row.hold_duration_display || null,
      row.remover_notes || null,
      row.inquiry_remover_user_id || null
    ]
  );
  return publicCase(r.rows[0]);
}

export async function updateCase(db, { orgId, id, patch }) {
  const sets = [];
  const params = [orgId, id];
  const writable = [
    "case_status", "selected_bureaus_raw", "ghl_contact_id",
    "ai_call_scheduled_for", "ai_call_status", "assigned_remover",
    "fraud_alert_after", "remover_notes", "inquiry_remover_user_id",
    "open_inquiry_count", "master_call_state", "hold_duration_display",
    "funding_round_id"
  ];
  for (const k of writable) {
    if (patch[k] === undefined) continue;
    if (k === "case_status" && !CASE_SET.has(patch[k])) continue;
    params.push(patch[k]);
    if (k === "case_status") sets.push(`case_status = $${params.length}::inquiry_case_status`);
    else if (k === "funding_round_id") sets.push(`funding_round_id = $${params.length}::uuid`);
    else if (k === "ai_call_scheduled_for") sets.push(`ai_call_scheduled_for = $${params.length}::timestamptz`);
    else sets.push(`${k} = $${params.length}`);
  }
  if (!sets.length) {
    const cur = await db.query(
      `SELECT * FROM inquiry_removal_cases WHERE org_id = $1::uuid AND id = $2::uuid`,
      [orgId, id]
    );
    return publicCase(cur.rows[0] || null);
  }
  const r = await db.query(
    `UPDATE inquiry_removal_cases
        SET ${sets.join(", ")}, updated_at = now()
      WHERE org_id = $1::uuid AND id = $2::uuid
      RETURNING *`,
    params
  );
  return publicCase(r.rows[0] || null);
}

/**
 * Mark case completed/cleared. Caller emits inquiry.removed on the bus.
 */
export async function closeCase(db, {
  orgId,
  id,
  case_status = "Completed",
  notes = null,
  staff = null
} = {}) {
  const status = CASE_SET.has(case_status) ? case_status : "Completed";
  const params = [orgId, id, status];
  let sql = `UPDATE inquiry_removal_cases
                SET case_status = $3::inquiry_case_status,
                    closed_at = COALESCE(closed_at, now()),
                    completed_at = CASE
                      WHEN $3::text = 'Completed' THEN COALESCE(completed_at, now())
                      ELSE completed_at
                    END,
                    updated_at = now()`;
  if (notes != null) {
    params.push(notes);
    sql += `, remover_notes = COALESCE(remover_notes || E'\\n', '') || $${params.length}`;
  }
  if (staff) {
    params.push(String(staff.id || staff.email || "").slice(0, 200));
    sql += `, inquiry_remover_user_id = COALESCE(inquiry_remover_user_id, $${params.length})`;
  }
  sql += ` WHERE org_id = $1::uuid AND id = $2::uuid RETURNING *`;
  const r = await db.query(sql, params);
  return publicCase(r.rows[0] || null);
}

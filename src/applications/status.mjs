/* Application status transitions — always write application_decisions. */

import { APPLICATION_STATUS_SET } from "../lenders/tables.mjs";

export class ApplicationStatusError extends Error {
  constructor(message, { code = "application_status_error", status = 400 } = {}) {
    super(message);
    this.name = "ApplicationStatusError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Set application status and append an audit row. No silent status changes.
 *
 * @param {import("pg").Pool|object} db
 * @param {object} opts
 */
export async function setApplicationStatus(db, {
  orgId,
  applicationId,
  status,
  eventType = "status_change",
  staff = null,
  notes = null,
  patch = null
} = {}) {
  const next = String(status || "").trim();
  if (!APPLICATION_STATUS_SET.has(next)) {
    throw new ApplicationStatusError(
      `status must be one of: ${[...APPLICATION_STATUS_SET].join(", ")}`,
      { code: "invalid_status" }
    );
  }

  const sets = [
    "status = $3",
    "status_updated_date = now()",
    "updated_at = now()"
  ];
  const params = [orgId, applicationId, next];

  if (patch && typeof patch === "object") {
    for (const [k, v] of Object.entries(patch)) {
      if (![
        "lender_name", "product_name", "application_url", "lender_row_url",
        "requested_amount", "approved_amount", "condition_text", "bank",
        "submitted_date", "lender_id", "client_id"
      ].includes(k)) continue;
      params.push(v);
      if (k === "lender_id" || k === "client_id") {
        sets.push(`${k} = $${params.length}::uuid`);
      } else if (k === "submitted_date") {
        sets.push(`${k} = $${params.length}::date`);
      } else {
        sets.push(`${k} = $${params.length}`);
      }
    }
    if (patch.lender_name != null && patch.bank === undefined) {
      params.push(patch.lender_name);
      sets.push(`bank = COALESCE(bank, $${params.length})`);
    }
  }

  const updated = await db.query(
    `UPDATE applications
        SET ${sets.join(", ")}
      WHERE org_id = $1::uuid AND id = $2::uuid
      RETURNING *`,
    params
  );
  const row = updated.rows[0];
  if (!row) {
    throw new ApplicationStatusError("application not found", {
      code: "not_found",
      status: 404
    });
  }

  // Sync legacy bank column from lender_name when status path sets name.
  if (row.lender_name && row.bank !== row.lender_name) {
    await db.query(
      `UPDATE applications SET bank = $2 WHERE id = $1 AND (bank IS NULL OR bank = '')`,
      [row.id, row.lender_name]
    );
  }

  await db.query(
    `INSERT INTO application_decisions (
       org_id, application_id, event_type, status, lender_table, decided_at, created_by, notes
     ) VALUES (
       $1::uuid, $2::uuid, $3, $4, $5::lender_table, now(), $6, $7
     )`,
    [
      orgId,
      row.id,
      String(eventType || "status_change").slice(0, 80),
      next,
      row.lender_table || null,
      staff ? String(staff.name || staff.email || staff.id || "").slice(0, 200) : null,
      notes || null
    ]
  );

  return row;
}

export async function listApplicationDecisions(db, { orgId, applicationId, limit = 50 }) {
  const r = await db.query(
    `SELECT *
       FROM application_decisions
      WHERE org_id = $1::uuid AND application_id = $2::uuid
      ORDER BY decided_at DESC
      LIMIT $3`,
    [orgId, applicationId, Math.min(Math.max(Number(limit) || 50, 1), 200)]
  );
  return r.rows;
}

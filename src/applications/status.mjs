/* Application status transitions — always write application_decisions. */

import { APPLICATION_STATUS_SET } from "../lenders/tables.mjs";
import { toCents, fromCents } from "../commissions/money.mjs";

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
function cleanPlayName(playName) {
  const s = String(playName || "").trim();
  return s ? s.slice(0, 120) : null;
}

/**
 * A dollar amount a staff member typed -> the fixed 2dp string
 * applications.approved_amount (numeric(14,2)) wants.
 *
 * ABSENT IS UNKNOWN, NOT ZERO. Blank/undefined returns null, and the caller
 * must then leave the column alone rather than writing 0 over it — a zero says
 * the bank approved nothing, which is a different claim from "nobody has told
 * us yet" (docs/CLOSEOUT-FEE-BASIS.md). Never let a missing amount become 0.
 *
 * Goes through integer cents so 450.10 cannot arrive as 450.09: toCents does
 * the rounding once, fromCents renders it back as dollars. Cents stay inside
 * this function — the column holds dollars.
 *
 * The browser validates first (public/app/money-input.js); this repeats it
 * because a handler must never trust what a client sent.
 */
export function normalizeApprovedAmount(value) {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim();
  if (raw === "") return null;

  // Accept what people type: "$45,000", "45000.50", " 45000 ".
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new ApplicationStatusError(
      "approved_amount must be a dollar amount greater than zero, like 45000 or 45000.50",
      { code: "invalid_approved_amount" }
    );
  }
  let cents;
  try {
    cents = toCents(cleaned);
  } catch {
    throw new ApplicationStatusError(
      "approved_amount is out of range",
      { code: "invalid_approved_amount" }
    );
  }
  if (!(cents > 0)) {
    throw new ApplicationStatusError(
      "approved_amount must be greater than zero. If the bank approved nothing, that is a denial, not an approval.",
      { code: "invalid_approved_amount" }
    );
  }
  return fromCents(cents);
}

export async function setApplicationStatus(db, {
  orgId,
  applicationId,
  status,
  eventType = "status_change",
  staff = null,
  notes = null,
  playName = null,
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
       org_id, application_id, event_type, status, lender_table, decided_at, created_by, notes, play_name
     ) VALUES (
       $1::uuid, $2::uuid, $3, $4, $5::lender_table, now(), $6, $7, $8
     )`,
    [
      orgId,
      row.id,
      String(eventType || "status_change").slice(0, 80),
      next,
      row.lender_table || null,
      staff ? String(staff.name || staff.email || staff.id || "").slice(0, 200) : null,
      notes || null,
      cleanPlayName(playName)
    ]
  );

  return row;
}

/** Find or mint the application row for this client + lender, then stamp yes/no. */
export async function logBankDecision(db, {
  orgId,
  applicationId = null,
  clientId = null,
  lenderId = null,
  status,
  playName = null,
  staff = null,
  notes = null,
  approvedAmount = null
} = {}) {
  // Validate the money BEFORE any row is created, so a bad amount cannot leave
  // a half-made application behind.
  const approvedDollars = normalizeApprovedAmount(approvedAmount);
  let appId = applicationId;
  if (!appId) {
    if (!clientId || !lenderId) {
      throw new ApplicationStatusError(
        "application_id or client_id + lender_id is required",
        { code: "application_id required" }
      );
    }
    const found = await db.query(
      `SELECT id FROM applications
        WHERE org_id = $1::uuid AND client_id = $2::uuid AND lender_id = $3::uuid
        ORDER BY updated_at DESC LIMIT 1`,
      [orgId, clientId, lenderId]
    );
    if (found.rows[0]) {
      appId = found.rows[0].id;
    } else {
      const lender = await db.query(
        `SELECT id, name, product_name, application_url, lender_table
           FROM lenders WHERE org_id = $1::uuid AND id = $2::uuid`,
        [orgId, lenderId]
      );
      const L = lender.rows[0];
      if (!L) {
        throw new ApplicationStatusError("lender not found", {
          code: "lender_not_found",
          status: 404
        });
      }
      let round = await db.query(
        `SELECT id FROM funding_rounds
          WHERE org_id = $1::uuid AND client_id = $2::uuid
          ORDER BY round_number DESC LIMIT 1`,
        [orgId, clientId]
      );
      if (!round.rows[0]) {
        round = await db.query(
          `INSERT INTO funding_rounds (org_id, client_id, round_number, status, product)
           VALUES ($1::uuid, $2::uuid, 1, 'open', 'card_stacking')
           RETURNING id`,
          [orgId, clientId]
        );
      }
      const created = await db.query(
        `INSERT INTO applications (
           org_id, funding_round_id, client_id, lender_id, bank, lender_name,
           product_name, application_url, lender_table, status
         ) VALUES (
           $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9::lender_table, 'Apply'
         ) RETURNING id`,
        [
          orgId,
          round.rows[0].id,
          clientId,
          lenderId,
          L.name || null,
          L.name || null,
          L.product_name || null,
          L.application_url || null,
          L.lender_table || null
        ]
      );
      appId = created.rows[0].id;
    }
  }

  return setApplicationStatus(db, {
    orgId,
    applicationId: appId,
    status,
    eventType: "bank_decision",
    staff,
    notes,
    playName,
    // null means "not told" — no patch key, so the column keeps what it had.
    patch: approvedDollars != null ? { approved_amount: approvedDollars } : null
  });
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

/** Latest named plays for a client's bank yes/no rows. Newest first. */
export async function listClientDecisionPlays(db, { orgId, clientId, limit = 50 }) {
  const r = await db.query(
    `SELECT d.play_name, d.status, d.decided_at, d.application_id,
            a.lender_id, a.lender_name
       FROM application_decisions d
       JOIN applications a ON a.id = d.application_id AND a.org_id = d.org_id
      WHERE d.org_id = $1::uuid
        AND a.client_id = $2::uuid
        AND d.play_name IS NOT NULL
        AND btrim(d.play_name) <> ''
      ORDER BY d.decided_at DESC
      LIMIT $3`,
    [orgId, clientId, Math.min(Math.max(Number(limit) || 50, 1), 200)]
  );
  return r.rows;
}

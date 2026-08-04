/* Inquiry prep staging — promote to inquiry_log when Ready for Cleanup. */

import { isLenderTable } from "../lenders/tables.mjs";

export const PREP_STATES = Object.freeze([
  "staging",
  "Ready for Cleanup",
  "promoted",
  "discarded"
]);

/**
 * Promote a prep row into inquiry_log. Business status starts as 'open'.
 * call_state stays not_started — phone-work is a separate concern.
 */
export async function promotePrep(db, { orgId, prepId }) {
  const prepR = await db.query(
    `SELECT * FROM inquiry_prep
      WHERE org_id = $1::uuid AND id = $2::uuid
      FOR UPDATE`,
    [orgId, prepId]
  );
  const prep = prepR.rows[0];
  if (!prep) {
    const err = new Error("prep not found");
    err.code = "not_found";
    err.status = 404;
    throw err;
  }
  if (prep.prep_state === "promoted" && prep.promoted_inquiry_record) {
    return { prep, inquiry: null, already: true };
  }
  if (prep.prep_state !== "Ready for Cleanup") {
    const err = new Error('prep_state must be "Ready for Cleanup" to promote');
    err.code = "not_ready";
    err.status = 400;
    throw err;
  }
  if (!prep.client_id) {
    const err = new Error("prep row needs a client_id");
    err.code = "client_required";
    err.status = 400;
    throw err;
  }

  const inq = await db.query(
    `INSERT INTO inquiry_log (
       org_id, client_id, bureau, inquiry, status, call_state, attempt_count
     ) VALUES (
       $1::uuid, $2::uuid, $3, $4, 'open', 'not_started', 0
     ) RETURNING *`,
    [
      orgId,
      prep.client_id,
      prep.bureau || null,
      prep.inquiry_name || null
    ]
  );

  const updated = await db.query(
    `UPDATE inquiry_prep
        SET prep_state = 'promoted'::inquiry_prep_state,
            promoted_inquiry_record = $3::uuid,
            updated_at = now()
      WHERE id = $1 AND org_id = $2::uuid
      RETURNING *`,
    [prepId, orgId, inq.rows[0].id]
  );

  return { prep: updated.rows[0], inquiry: inq.rows[0], already: false };
}

export async function createPrep(db, { orgId, row }) {
  const state = PREP_STATES.includes(row?.prep_state) ? row.prep_state : "staging";
  const lenderTable = isLenderTable(row?.lender_table) ? row.lender_table : null;
  const r = await db.query(
    `INSERT INTO inquiry_prep (
       org_id, client_id, prep_state, bureau, inquiry_name, inquiry_date, lender_table
     ) VALUES (
       $1::uuid, $2::uuid, $3::inquiry_prep_state, $4, $5, $6::date, $7::lender_table
     ) RETURNING *`,
    [
      orgId,
      row.client_id || null,
      state,
      row.bureau || null,
      row.inquiry_name || null,
      row.inquiry_date || null,
      lenderTable
    ]
  );
  return r.rows[0];
}

export async function listPrep(db, { orgId, prep_state = null, limit = 100 }) {
  const params = [orgId];
  const where = ["org_id = $1::uuid"];
  if (prep_state && PREP_STATES.includes(prep_state)) {
    params.push(prep_state);
    where.push(`prep_state = $${params.length}::inquiry_prep_state`);
  }
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 500));
  const r = await db.query(
    `SELECT * FROM inquiry_prep
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params
  );
  return r.rows;
}

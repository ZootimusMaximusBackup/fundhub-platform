/* DB access for lenders + bureau observations. */

import { INLINE_EDIT_FIELDS, LENDER_CSV_COLUMNS, isLenderTable } from "./tables.mjs";
import { buildObservation } from "./observations.mjs";
import { parseLenderCsv, serializeLenderCsv } from "./csv.mjs";
import { matchLenders } from "./match.mjs";
import { orgDemoModeEnabled } from "../demo/exclude-demo.mjs";

const SELECT_COLS = `
  id, org_id, lender_table, name, product_name, application_url, lender_row_url,
  eligible_states,
  bureaus_pulled, business_bureau_pulled, double_pull, multiple_llc_allowed,
  stated_requirements, docs_requested, application_method, approval_speed,
  typical_approval_range, average_starting_loc, max_known_loc, apr_terms,
  repayment_terms, draw_period_renewal, relationship_required,
  deposit_balance_impact, known_friendly_states, insider_tips, priority_tier,
  last_updated_by, last_updated_date, notes, active, branch_location_info,
  prequal_soft_pull, intro_offers, requires_account_opening, minimum_deposit,
  underwriter_interaction, relationship_manager, documentation_required,
  minimum_time_in_business_years, minimum_revenue_threshold, collateral_required,
  renewal_terms, loan_type, apr_range_pct, repayment_terms_months, funding_speed,
  loc_type, external_row_id, created_at, updated_at, is_demo
`;

function publicLender(row) {
  if (!row) return null;
  const out = { ...row };
  for (const k of [
    "typical_approval_range", "average_starting_loc", "max_known_loc",
    "minimum_deposit", "minimum_revenue_threshold", "apr_range_pct",
    "minimum_time_in_business_years"
  ]) {
    if (out[k] != null) out[k] = Number(out[k]);
  }
  if (out.priority_tier != null) out.priority_tier = Number(out.priority_tier);
  out.active = out.active !== false;
  out.is_demo = !!out.is_demo;
  if (out.is_demo && out.name && !String(out.name).startsWith("DEMO")) out.name = "DEMO · " + out.name;
  return out;
}

/**
 * @param {import("pg").Pool|object} db
 * @param {object} filters
 */
export async function listLenders(db, {
  orgId,
  lender_table = null,
  bureau = null,
  priority_tier = null,
  active = null,
  state = null,
  q = null,
  limit = 200,
  offset = 0,
  includeDemo = null,
  forExport = false
} = {}) {
  const params = [orgId];
  const where = ["org_id = $1::uuid"];
  if (lender_table && isLenderTable(lender_table)) {
    params.push(lender_table);
    where.push(`lender_table = $${params.length}::lender_table`);
  }
  if (priority_tier != null && priority_tier !== "") {
    params.push(Number(priority_tier));
    where.push(`priority_tier = $${params.length}`);
  }
  if (active === true || active === false || active === "true" || active === "false") {
    params.push(active === true || active === "true");
    where.push(`active = $${params.length}`);
  }
  if (bureau) {
    params.push(`%${String(bureau).trim()}%`);
    where.push(`bureaus_pulled ILIKE $${params.length}`);
  }
  if (state) {
    params.push(`%${String(state).trim()}%`);
    where.push(`(eligible_states ILIKE $${params.length} OR eligible_states IS NULL OR btrim(eligible_states) = '')`);
  }
  if (q) {
    params.push(`%${String(q).trim()}%`);
    where.push(`(name ILIKE $${params.length} OR notes ILIKE $${params.length})`);
  }
  const demoOn = forExport ? false : (includeDemo == null ? await orgDemoModeEnabled(db, orgId) : !!includeDemo);
  if (!demoOn) where.push("COALESCE(is_demo, false) = false");
  params.push(Math.min(Math.max(Number(limit) || 200, 1), 500));
  params.push(Math.max(Number(offset) || 0, 0));
  const sql = `
    SELECT ${SELECT_COLS}
      FROM lenders
     WHERE ${where.join(" AND ")}
     ORDER BY priority_tier NULLS LAST, lower(name), id
     LIMIT $${params.length - 1} OFFSET $${params.length}`;
  const r = await db.query(sql, params);
  return r.rows.map(publicLender);
}

export async function getLender(db, { orgId, id }) {
  const r = await db.query(
    `SELECT ${SELECT_COLS} FROM lenders WHERE org_id = $1::uuid AND id = $2::uuid`,
    [orgId, id]
  );
  return publicLender(r.rows[0] || null);
}

function stamp(staff) {
  const by = (staff && (staff.name || staff.email || staff.id)) || "system";
  const date = new Date().toISOString().slice(0, 10);
  return { last_updated_by: String(by).slice(0, 200), last_updated_date: date };
}

const WRITABLE = new Set([
  ...LENDER_CSV_COLUMNS.filter((c) => c !== "lender_table"),
  "lender_table",
  ...INLINE_EDIT_FIELDS
]);

/**
 * Partial update — auto-stamps last_updated_*.
 */
export async function updateLender(db, { orgId, id, patch, staff }) {
  const meta = stamp(staff);
  const sets = [];
  const params = [orgId, id];
  for (const [k, v] of Object.entries(patch || {})) {
    if (!WRITABLE.has(k)) continue;
    if (k === "lender_table" && !isLenderTable(v)) continue;
    params.push(v);
    const cast = k === "lender_table" ? "::lender_table" : "";
    sets.push(`${k} = $${params.length}${cast}`);
  }
  if (!sets.length) return getLender(db, { orgId, id });
  params.push(meta.last_updated_by);
  sets.push(`last_updated_by = $${params.length}`);
  params.push(meta.last_updated_date);
  sets.push(`last_updated_date = $${params.length}::date`);
  const r = await db.query(
    `UPDATE lenders SET ${sets.join(", ")}
      WHERE org_id = $1::uuid AND id = $2::uuid
      RETURNING ${SELECT_COLS}`,
    params
  );
  return publicLender(r.rows[0] || null);
}

export async function createLender(db, { orgId, row, staff }) {
  if (!isLenderTable(row?.lender_table)) {
    const err = new Error("invalid_lender_table");
    err.code = "invalid_lender_table";
    throw err;
  }
  const name = String(row?.name || "").trim();
  if (!name) {
    const err = new Error("name_required");
    err.code = "name_required";
    throw err;
  }
  const meta = stamp(staff);
  const cols = ["org_id", "lender_table", "name", "last_updated_by", "last_updated_date"];
  const vals = [orgId, row.lender_table, name, meta.last_updated_by, meta.last_updated_date];
  for (const k of LENDER_CSV_COLUMNS) {
    if (k === "lender_table" || k === "name") continue;
    if (row[k] === undefined) continue;
    cols.push(k);
    vals.push(row[k]);
  }
  const placeholders = vals.map((_, i) => {
    const col = cols[i];
    if (col === "org_id") return `$${i + 1}::uuid`;
    if (col === "lender_table") return `$${i + 1}::lender_table`;
    if (col === "last_updated_date") return `$${i + 1}::date`;
    return `$${i + 1}`;
  });
  const r = await db.query(
    `INSERT INTO lenders (${cols.join(", ")})
     VALUES (${placeholders.join(", ")})
     RETURNING ${SELECT_COLS}`,
    vals
  );
  return publicLender(r.rows[0]);
}

/**
 * Upsert by (org_id, external_row_id) when present, else insert.
 * @returns {{ imported: number, updated: number, errors: string[] }}
 */
export async function importLendersCsv(db, { orgId, text, staff }) {
  const { rows, errors } = parseLenderCsv(text);
  let imported = 0;
  let updated = 0;
  for (const row of rows) {
    try {
      if (row.external_row_id) {
        const existing = await db.query(
          `SELECT id FROM lenders
            WHERE org_id = $1::uuid AND external_row_id = $2
            LIMIT 1`,
          [orgId, row.external_row_id]
        );
        if (existing.rows[0]) {
          await updateLender(db, {
            orgId,
            id: existing.rows[0].id,
            patch: row,
            staff
          });
          updated++;
          continue;
        }
      }
      await createLender(db, { orgId, row, staff });
      imported++;
    } catch (e) {
      errors.push(`${row.name}: ${e.message || e.code || "failed"}`);
    }
  }
  return { imported, updated, errors, parsed: rows.length };
}

export async function exportLendersCsv(db, { orgId, ...filters }) {
  const rows = await listLenders(db, { orgId, ...filters, limit: 500, forExport: true });
  return serializeLenderCsv(rows);
}

export async function logObservation(db, { orgId, input, staff }) {
  // Fill expected from lender row when not supplied.
  let expected = input.expected_bureaus_raw;
  let lenderName = input.lender_name;
  let lenderTable = input.lender_table;
  if (input.lender_row_id && (expected == null || !lenderName)) {
    const L = await getLender(db, { orgId, id: input.lender_row_id });
    if (L) {
      if (expected == null) expected = L.bureaus_pulled;
      if (!lenderName) lenderName = L.name;
      if (!lenderTable) lenderTable = L.lender_table;
    }
  }
  const row = buildObservation({
    ...input,
    expected_bureaus_raw: expected,
    lender_name: lenderName,
    lender_table: lenderTable,
    created_by: (staff && (staff.name || staff.email || staff.id)) || null
  });
  const r = await db.query(
    `INSERT INTO lender_bureau_observations (
       org_id, application_id, client_id, funding_round_id,
       lender_name, lender_table, lender_row_id, expected_bureaus_raw,
       observed_bureau, observation_source, mismatch_flag, review_status,
       notes, created_by
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid,
       $5, $6::lender_table, $7::uuid, $8,
       $9, $10, $11, $12::lender_observation_review_status,
       $13, $14
     ) RETURNING *`,
    [
      orgId,
      row.application_id,
      row.client_id,
      row.funding_round_id,
      row.lender_name,
      row.lender_table,
      row.lender_row_id,
      row.expected_bureaus_raw,
      row.observed_bureau,
      row.observation_source,
      row.mismatch_flag,
      row.review_status,
      row.notes,
      row.created_by
    ]
  );
  return r.rows[0];
}

export async function listObservations(db, {
  orgId,
  mismatch_only = false,
  review_status = "pending",
  limit = 100,
  offset = 0
} = {}) {
  const params = [orgId];
  const where = ["org_id = $1::uuid"];
  if (mismatch_only) where.push("mismatch_flag = true");
  if (review_status) {
    params.push(review_status);
    where.push(`review_status = $${params.length}::lender_observation_review_status`);
  }
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 500));
  params.push(Math.max(Number(offset) || 0, 0));
  const r = await db.query(
    `SELECT *
       FROM lender_bureau_observations
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return r.rows;
}

export async function reviewObservation(db, { orgId, id, review_status, notes, staff }) {
  const params = [orgId, id, review_status];
  let sql = `UPDATE lender_bureau_observations
                SET review_status = $3::lender_observation_review_status`;
  if (notes != null) {
    params.push(notes);
    sql += `, notes = $${params.length}`;
  }
  if (staff) {
    params.push(String(staff.name || staff.email || staff.id || "").slice(0, 200));
    sql += `, created_by = COALESCE(created_by, $${params.length})`;
  }
  sql += ` WHERE org_id = $1::uuid AND id = $2::uuid RETURNING *`;
  const r = await db.query(sql, params);
  return r.rows[0] || null;
}

/**
 * Round-planning match for one client.
 */
export async function matchForClient(db, {
  orgId,
  clientId,
  lenderTable = null,
  recentInquiryDays = 30
} = {}) {
  const clientR = await db.query(
    `SELECT id, custom_fields
       FROM clients
      WHERE org_id = $1::uuid AND id = $2::uuid`,
    [orgId, clientId]
  );
  const client = clientR.rows[0];
  if (!client) return null;

  const cf = client.custom_fields || {};
  const clientState =
    cf.business_state ||
    cf.state ||
    cf.home_state ||
    null;

  const inq = await db.query(
    `SELECT bureau, status, created_at
       FROM inquiry_log
      WHERE org_id = $1::uuid AND client_id = $2::uuid
      ORDER BY created_at DESC
      LIMIT 200`,
    [orgId, clientId]
  );

  // Resolved once and handed to both gates. listLenders would otherwise look
  // it up again, and matchLenders now defaults to excluding demo rows, which
  // would drop them even with Demo Mode on unless it is told.
  const demoMode = await orgDemoModeEnabled(db, orgId);

  const lenders = await listLenders(db, {
    orgId,
    lender_table: lenderTable,
    active: true,
    limit: 500,
    includeDemo: demoMode
  });

  const cases = await db.query(
    `SELECT id, selected_bureaus_raw, case_status, gate_override_by, gate_override_at
       FROM inquiry_removal_cases
      WHERE org_id = $1::uuid
        AND client_id = $2::uuid
        AND case_status::text = ANY($3::text[])`,
    [orgId, clientId, ["Queued", "Scheduled", "In Progress", "Escalated", "Blocked"]]
  );

  return matchLenders({
    lenders,
    clientState,
    inquiryLog: inq.rows,
    cases: cases.rows,
    lenderTable,
    recentInquiryDays,
    includeDemo: demoMode
  });
}

export { matchLenders, publicLender };

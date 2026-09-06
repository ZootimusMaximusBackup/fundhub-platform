/* DB access for lenders + bureau observations. */

import { INLINE_EDIT_FIELDS, LENDER_CSV_COLUMNS, isLenderTable } from "./tables.mjs";
import { isTipRow } from "./tips.mjs";
import { buildObservation } from "./observations.mjs";
import { parseLenderCsv, serializeLenderCsv } from "./csv.mjs";
import {
  matchLenders,
  resolveMatchState,
  resolveMatchStates,
  resolveCreditProfile
} from "./match.mjs";
import { orgDemoModeEnabled } from "../demo/exclude-demo.mjs";
import { logoPathOrPlaceholder } from "./resolve-logo.mjs";
import { triMerge, utilisation } from "../http/client-detail.mjs";

const SELECT_COLS = `
  id, org_id, lender_table, name, product_name, logo_path, application_url, lender_row_url,
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
  out.logo_path = logoPathOrPlaceholder(out.logo_path);
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
  limit = 500,
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
  params.push(Math.min(Math.max(Number(limit) || 500, 1), 500));
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
  "logo_path",
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
  if (row.logo_path !== undefined && !cols.includes("logo_path")) {
    cols.push("logo_path");
    vals.push(row.logo_path);
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
export async function importLendersCsv(db, { orgId, text, staff, logoByExternalId = null }) {
  const { rows, errors } = parseLenderCsv(text);
  let imported = 0;
  let updated = 0;
  let skipped_tips = 0;
  for (const row of rows) {
    if (isTipRow(row.name)) {
      skipped_tips++;
      continue;
    }
    try {
      const logoPath = logoByExternalId && row.external_row_id
        ? logoByExternalId[row.external_row_id]
        : undefined;
      const payload = logoPath ? { ...row, logo_path: logoPath } : row;
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
            patch: payload,
            staff
          });
          updated++;
          continue;
        }
      }
      await createLender(db, { orgId, row: payload, staff });
      imported++;
    } catch (e) {
      errors.push(`${row.name}: ${e.message || e.code || "failed"}`);
    }
  }
  return { imported, updated, errors, parsed: rows.length, skipped_tips };
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
  const bizR = await db.query(
    `SELECT entity_data
       FROM businesses
      WHERE org_id = $1::uuid AND client_id = $2::uuid
      ORDER BY created_at ASC`,
    [orgId, clientId]
  );
  /* THE HOME ADDRESS. The soft-pull consent form asks for the client's own
     current street address ("Enter your current street address, city, state,
     and ZIP") and api/soft-pull-approve.mjs stores it on
     pii_identity.addresses. That is the only place a personal state is held,
     and without it an Arizona client with a Florida business reads as Florida
     only. Same direct read src/inquiry-ops/call-scheduler.mjs already does for
     the dispute return address — the state alone, no SSN and no reveal. */
  let identityAddresses = [];
  try {
    const idR = await db.query(
      `SELECT addresses
         FROM pii_identity
        WHERE org_id = $1::uuid AND client_id = $2::uuid
        LIMIT 1`,
      [orgId, clientId]
    );
    const raw = idR.rows[0]?.addresses;
    identityAddresses = Array.isArray(raw)
      ? raw
      : (typeof raw === "string" ? JSON.parse(raw || "[]") : []);
  } catch {
    /* No identity row, or the column is unreadable. Unknown stays unknown:
       the home lane is simply empty, and an unknown state blocks nobody. */
    identityAddresses = [];
  }

  const { home, business, states } = resolveMatchStates(cf, bizR.rows, identityAddresses);

  /* THE CREDIT FILE (funding finding 7). Five rows, not one: triMerge walks
     back past sandbox fixtures and past pulls that carried no score, so
     handing it only the newest row returns nothing whenever the newest row is
     one of those. Same extraction the closer's credit panel uses, so the score
     the matcher screens on is the score on the screen beside it. */
  const crs = await db.query(
    `SELECT result, outcome_tier, created_at
       FROM crs_results
      WHERE org_id = $1::uuid AND client_id = $2::uuid
      ORDER BY created_at DESC
      LIMIT 5`,
    [orgId, clientId]
  );
  const merged = triMerge(crs.rows);
  const util = utilisation(crs.rows, { custom_fields: cf });
  const newest = crs.rows[0] || null;
  const payload = safeResult(newest && newest.result);
  const credit = resolveCreditProfile({
    scores: { EX: merged.experian, EQ: merged.equifax, TU: merged.transunion },
    utilizationPct: util.percent,
    tier: newest ? newest.outcome_tier : null,
    // Stored estimate, same precedence as tierReasoning(): the CRM field the
    // client was actually quoted wins over the raw engine number.
    fundingEstimate: cf.total_funding_estimate ?? payload.fundingEstimate ?? null,
    pulledAt: merged.asOf || (newest ? newest.created_at : null)
  });

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

  /* IS THERE A COMPANY? Owner rule 2026-09-06: no business on file, no
     business credit cards. Two things count as a business being on file — a
     row in `businesses`, or a business state written on the client record.
     Either one is enough; requiring both would hold back cards from a client
     who does have a company we only half recorded. This is a real false, not
     an unknown: the query above returns every business row this client has,
     so an empty result plus no business state IS "no company". */
  const businessOnFile = bizR.rows.length > 0 || !!business;

  return matchLenders({
    lenders,
    homeState: home,
    businessState: business,
    businessOnFile,
    clientStates: states,
    inquiryLog: inq.rows,
    cases: cases.rows,
    lenderTable,
    recentInquiryDays,
    includeDemo: demoMode,
    credit
  });
}

/** crs_results.result is jsonb, but a text column shows up as a string here. */
function safeResult(v) {
  if (!v) return {};
  if (typeof v === "object") return v;
  try {
    const parsed = JSON.parse(v);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export {
  matchLenders,
  resolveMatchState,
  resolveMatchStates,
  resolveCreditProfile,
  publicLender
};

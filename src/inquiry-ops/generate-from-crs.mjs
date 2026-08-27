// Write inquiry_log items onto an inquiry case from the client's latest CRS pull.
// Inquiries only — never PII. Does not mail. Does not dial. Does not call repair.

import { extractFromCrsResult, BUREAU_KEYS, normBureau } from "./extract-disputables.mjs";
import { upsertInquiry } from "../inquiry-removal/cases.mjs";

function nameKey(row) {
  return String(row?.inquiry_name || row?.inquiry || "").trim().toLowerCase();
}

function bureauKey(raw) {
  return normBureau(raw) || String(raw || "").trim().toUpperCase();
}

function sameInquiry(row, item) {
  return bureauKey(row.bureau) === bureauKey(item.bureau) && nameKey(row) === nameKey(item);
}

function flattenInquiries(buckets) {
  const out = [];
  for (const b of BUREAU_KEYS) {
    for (const item of buckets[b]?.inquiries || []) {
      if (!item?.inquiry_name) continue;
      out.push({
        bureau: item.bureau,
        inquiry_name: item.inquiry_name,
        inquiry_date: item.inquiry_date || null
      });
    }
  }
  return out;
}

async function refreshOpenCount(db, caseId) {
  const res = await db.query(
    `UPDATE inquiry_removal_cases c
        SET open_inquiry_count = (
              SELECT COUNT(*)::int FROM inquiry_log i
               WHERE i.case_id = c.id AND i.is_open = true
            ),
            updated_at = now()
      WHERE c.id = $1
      RETURNING *`,
    [caseId]
  );
  return res.rows[0] || null;
}

/**
 * Stage inquiry items from the latest credit file onto this case.
 * @returns {Promise<object>} 200-shaped body; httpStatus 404 when the case is missing.
 */
export async function generateFromCrs(db, { orgId, caseId } = {}) {
  const caseRes = await db.query(
    `SELECT * FROM inquiry_removal_cases
      WHERE id = $1::uuid AND org_id = $2::uuid`,
    [caseId, orgId]
  );
  const caseRow = caseRes.rows[0];
  if (!caseRow) {
    return {
      ok: false,
      httpStatus: 404,
      reason: "not_found",
      message: "Case not found."
    };
  }

  const crs = await db.query(
    `SELECT id, result, created_at
       FROM crs_results
      WHERE org_id = $1::uuid AND client_id = $2::uuid
      ORDER BY created_at DESC
      LIMIT 1`,
    [orgId, caseRow.client_id]
  );
  if (!crs.rows[0]) {
    return {
      ok: false,
      reason: "no_credit_file",
      message: "No credit report on file yet."
    };
  }

  const items = flattenInquiries(extractFromCrsResult(crs.rows[0].result || null));
  if (!items.length) {
    return {
      ok: false,
      reason: "no_inquiries",
      message: "No inquiries on this credit file."
    };
  }

  const existing = await db.query(
    `SELECT id, case_id, bureau, inquiry, inquiry_name, is_open
       FROM inquiry_log
      WHERE org_id = $1::uuid AND client_id = $2::uuid`,
    [orgId, caseRow.client_id]
  );
  const logRows = [...(existing.rows || [])];

  let written = 0;
  let attached = 0;
  let skipped = 0;

  for (const item of items) {
    const found = logRows.find((row) => sameInquiry(row, item));
    if (found) {
      if (!found.case_id) {
        const updated = await upsertInquiry(db, {
          orgId,
          clientId: caseRow.client_id,
          caseId: caseRow.id,
          inquiryId: found.id,
          bureau: item.bureau,
          inquiryName: item.inquiry_name,
          status: "open",
          isOpen: true
        });
        found.case_id = caseRow.id;
        if (updated) Object.assign(found, updated);
        attached += 1;
      } else {
        skipped += 1;
      }
      continue;
    }

    const row = await upsertInquiry(db, {
      orgId,
      clientId: caseRow.client_id,
      caseId: caseRow.id,
      bureau: item.bureau,
      inquiryName: item.inquiry_name,
      status: "open",
      isOpen: true
    });
    if (row) logRows.push(row);
    written += 1;
  }

  const refreshed = await refreshOpenCount(db, caseRow.id);
  return {
    ok: true,
    written,
    attached,
    skipped,
    open_inquiry_count: Number(refreshed?.open_inquiry_count) || 0,
    case: refreshed
  };
}

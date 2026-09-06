// Write inquiry_log items onto an inquiry case from the client's latest CRS pull.
// Inquiries only — never PII. Does not mail. Does not dial. Does not call repair.

import { extractFromCrsResult, BUREAU_KEYS, normBureau } from "./extract-disputables.mjs";
import { upsertInquiry } from "../inquiry-removal/cases.mjs";
import { parseBureaus } from "../lenders/match.mjs";

function nameKey(row) {
  return String(row?.inquiry_name || row?.inquiry || "").trim().toLowerCase();
}

function bureauKey(raw) {
  return normBureau(raw) || String(raw || "").trim().toUpperCase();
}

function sameInquiry(row, item) {
  return bureauKey(row.bureau) === bureauKey(item.bureau) && nameKey(row) === nameKey(item);
}

/* EACH INQUIRY BELONGS TO THE BUREAU THAT REPORTED IT.
 *
 * Measured 2026-09-06 on the funding walkthrough client: pressing Generate on
 * the Experian case staged all four of the client's inquiries onto Experian —
 * the Equifax one and the TransUnion one included — and the Experian item count
 * jumped from 2 to 4. This function returned every bucket and the loop below
 * attached every returned row to whichever case was open.
 *
 * A dispute letter names inquiries the bureau it is addressed to actually holds.
 * Experian cannot delete a TransUnion inquiry, and asking it to is how a letter
 * gets thrown away. So the case's own bureau is the filter, and a case carrying
 * more than one bureau (selected_bureaus_raw is free text, e.g. "EX/EQ") keeps
 * all of the ones it names.
 *
 * `only` empty means no filter — kept so the shape below reads one way.
 */
function flattenInquiries(buckets, only) {
  const keep = only instanceof Set ? only : null;
  const out = [];
  for (const b of BUREAU_KEYS) {
    if (keep && !keep.has(b)) continue;
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

/** The bureaus this case is addressed to. Empty when the case names none. */
export function caseBureauSet(caseRow) {
  const codes = parseBureaus(caseRow?.selected_bureaus_raw)
    .filter((c) => BUREAU_KEYS.includes(c));
  return new Set(codes);
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

  /* A case with no bureau on it is not a case anything can be generated for:
     there is no bureau to address the letter to and no way to say which of the
     client's inquiries belong on it. Staging all of them, which is what this
     did, is the worst of the available answers. Say so instead. */
  const bureaus = caseBureauSet(caseRow);
  if (!bureaus.size) {
    return {
      ok: false,
      reason: "no_bureau_on_case",
      message: "This case has no credit bureau on it, so there is nothing to generate. "
        + "Set the bureau on the case first."
    };
  }

  const items = flattenInquiries(extractFromCrsResult(crs.rows[0].result || null), bureaus);
  if (!items.length) {
    const named = [...bureaus].join(", ");
    return {
      ok: false,
      reason: "no_inquiries",
      message: bureaus.size === 1
        ? `No ${named} inquiries on this credit file.`
        : `No inquiries on this credit file for ${named}.`
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

  /* THE ROWS THE OLD BEHAVIOUR ALREADY PUT ON THE WRONG CASE.
     Generate has been attaching every bureau's inquiries to whichever case was
     open, so a live Experian case can be carrying Equifax and TransUnion rows
     right now and counting them. Nothing is deleted: the case link is cleared,
     which returns the row to unattached, and running Generate on the case that
     DOES name that bureau picks it straight back up (that is the `attached`
     branch above). Without this the item count stays wrong until someone edits
     the database by hand. */
  const releasedRes = await db.query(
    `UPDATE inquiry_log
        SET case_id = NULL,
            inquiry_removal_case_id = NULL,
            updated_at = now()
      WHERE org_id = $1::uuid
        AND case_id = $2::uuid
        AND (bureau IS NULL OR NOT (upper(bureau) = ANY($3::text[])))
      RETURNING id`,
    [orgId, caseRow.id, [...bureaus]]
  );
  const released = (releasedRes.rows || []).length;

  const refreshed = await refreshOpenCount(db, caseRow.id);
  return {
    ok: true,
    written,
    attached,
    skipped,
    released,
    bureaus: [...bureaus],
    open_inquiry_count: Number(refreshed?.open_inquiry_count) || 0,
    case: refreshed
  };
}

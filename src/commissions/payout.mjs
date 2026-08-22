// Commission payout status transitions — earned → approved → paid.
//
// COMPLIANCE REVIEW REQUIRED — commission timing / payout recording.
// Does NOT send money. Records Approve and Mark paid on commission_ledger only.
// Cash still leaves the company outside this system (ACH / payroll / check).

import { emit } from "../events/bus.mjs";
import { isUuid } from "../http/read-api.mjs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeIds(ids) {
  if (!Array.isArray(ids)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of ids) {
    const id = String(raw || "").trim();
    if (!UUID_RE.test(id) && !isUuid(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function actorLabel(staff) {
  if (!staff) return "unknown";
  const name = String(staff.name || "").trim();
  if (name) return name;
  const email = String(staff.email || "").trim();
  if (email) return email;
  return String(staff.id || "unknown");
}

/**
 * earned → approved for the named rows in this org.
 * Skips rows that are not earned. Never invents amounts.
 */
export async function approveCommissions(db, { orgId, ledgerIds, staff } = {}) {
  if (!orgId) return { status: 400, error: "org_required" };
  const ids = normalizeIds(ledgerIds);
  if (!ids.length) return { status: 400, error: "ledger_ids_required" };

  const approvedBy = actorLabel(staff);
  const result = await db.query(
    `UPDATE commission_ledger
        SET status = 'approved',
            approved_at = now(),
            approved_by = $3
      WHERE org_id = $1::uuid
        AND id = ANY($2::uuid[])
        AND status = 'earned'
        AND COALESCE(is_demo, false) = false
  RETURNING id, staff_id, client_id, amount, currency, status,
            approved_at, approved_by`,
    [orgId, ids, approvedBy]
  );

  for (const row of result.rows) {
    await emit(
      db,
      "commission.approved",
      {
        ledger_id: row.id,
        staff_id: row.staff_id,
        amount: row.amount,
        currency: row.currency || "USD",
        approved_by: row.approved_by,
        approved_at: row.approved_at
      },
      {
        orgId,
        clientId: row.client_id || null,
        idempotencyKey: `commission.approved|${row.id}`,
        skipInngest: true
      }
    );
  }

  return {
    status: 200,
    updated: result.rows.length,
    requested: ids.length,
    skipped: ids.length - result.rows.length,
    rows: result.rows
  };
}

/**
 * approved → paid. Requires a human payout_ref (ACH id, check #, payroll batch).
 * Does not move money — only records that it left.
 */
export async function markCommissionsPaid(db, { orgId, ledgerIds, payoutRef, staff } = {}) {
  if (!orgId) return { status: 400, error: "org_required" };
  const ids = normalizeIds(ledgerIds);
  if (!ids.length) return { status: 400, error: "ledger_ids_required" };
  const ref = String(payoutRef || "").trim();
  if (!ref) return { status: 400, error: "payout_ref_required" };
  if (ref.length > 120) return { status: 400, error: "payout_ref_too_long" };

  const paidBy = actorLabel(staff);
  const result = await db.query(
    `UPDATE commission_ledger
        SET status = 'paid',
            paid_at = now(),
            paid_by = $3,
            payout_ref = $4
      WHERE org_id = $1::uuid
        AND id = ANY($2::uuid[])
        AND status = 'approved'
        AND COALESCE(is_demo, false) = false
  RETURNING id, staff_id, client_id, amount, currency, status,
            paid_at, paid_by, payout_ref`,
    [orgId, ids, paidBy, ref]
  );

  for (const row of result.rows) {
    await emit(
      db,
      "commission.paid",
      {
        ledger_id: row.id,
        staff_id: row.staff_id,
        amount: row.amount,
        currency: row.currency || "USD",
        paid_by: row.paid_by,
        paid_at: row.paid_at,
        payout_ref: row.payout_ref
      },
      {
        orgId,
        clientId: row.client_id || null,
        idempotencyKey: `commission.paid|${row.id}`,
        skipInngest: true
      }
    );
  }

  return {
    status: 200,
    updated: result.rows.length,
    requested: ids.length,
    skipped: ids.length - result.rows.length,
    payout_ref: ref,
    rows: result.rows
  };
}

/* Funding closeout — records the success fee when a round is finalized.
   Hooked from round.funded (money-chain). Idempotent per funding_round_id.

   OWNER DECISION (owner-set 2026-08-30, final — supersedes 2026-08-04):
   The fee basis is CONFIRMED APPROVALS, not funding_rounds.funded_amount.
   Chris: "Approved is correct. They can really be used interchangeably.
   Technically we are getting people approved, NOT funding the actual credit
   cards. But yeah if that is cool then make sure we bill based on confirmed
   approvals."

   "Confirmed approvals" is defined once, in src/funding/success-fee.mjs, and
   both this file and the invoicing workflow (F-07) read it from there so the
   closeout record and the invoice can never disagree. See
   docs/CLOSEOUT-FEE-BASIS.md.

   THE OLD $0 TRAP IS GONE, THE OTHER WAY ROUND. The 2026-08-04 note said a
   funded round with no Approved rows "silently billed $0", and fixed that by
   billing the funded amount. That fix is reversed. A round with nothing
   confirmed now REFUSES with a named reason: no closeout row, no invoice, and
   a task for a person. It still never writes a $0 fee.

   COMPLIANCE REVIEW REQUIRED: fee basis.
*/

import { toCents, fromCents, roundHalfUp } from "../commissions/money.mjs";
import {
  listConfirmedApprovals,
  agreedFeePercent,
  amountOrNull,
  successFeeCents,
  NO_CONFIRMED_APPROVALS,
  NO_AGREED_FEE_PERCENT
} from "./success-fee.mjs";

/**
 * A dollar amount, rounded to cents — or null when it is not a number.
 *
 * THIS USED TO RETURN 0 FOR UNKNOWN, and that was a latent silent $0 invoice:
 * Number(null) is 0 and Number.isFinite(0) is true, so money(null) answered
 * "zero dollars" to a question nobody had answered. Unknown must survive as
 * unknown (CLAUDE.md §12); every caller below treats null as a refusal.
 */
export function money(n) {
  const v = amountOrNull(n);
  if (v == null) return null;
  return Math.round(v * 100) / 100;
}

/**
 * Create or refresh a closeout for a funded round.
 *
 * Fee = feePercentUnits × the confirmed approved total.
 *
 * `feePercentUnits` is in PERCENT UNITS — 10 means 10%, NOT 0.10. The name
 * says "Units" because the funding_closeout.fee_percent COLUMN stores the same
 * rate as a fraction (0.10), and the two were one silent factor of 100 apart.
 * Omit it and the rate is read from the sale this round is linked to.
 *
 * REFUSES, rather than billing zero, when:
 *   - the round does not exist                (closeout_no_round)
 *   - nothing on the round is confirmed       (closeout_no_confirmed_approvals)
 *   - the client's sale agreed no fee percent (closeout_no_fee_percent)
 *
 * @param {import("pg").Pool|object} db
 * @param {{ orgId: string, fundingRoundId: string, feePercentUnits?: number }} opts
 * @returns {Promise<{ closeout: object, items: object[], created: boolean, feeBasis: number }>}
 */
export async function createFundingCloseout(db, {
  orgId,
  fundingRoundId,
  feePercentUnits = null
} = {}) {
  if (!orgId || !fundingRoundId) {
    const err = new Error("orgId and fundingRoundId required");
    err.code = "closeout_args";
    throw err;
  }

  const roundRes = await db.query(
    `SELECT id, funded_amount, approved_amount, status
       FROM funding_rounds
      WHERE org_id = $1::uuid AND id = $2::uuid
      LIMIT 1`,
    [orgId, fundingRoundId]
  );
  const round = roundRes.rows[0];
  if (!round) {
    const err = new Error("funding round not found");
    err.code = "closeout_no_round";
    throw err;
  }

  // Fee basis = confirmed approvals. Every Approved application on this round
  // that carries a real recorded amount, and nothing else. funded_amount and
  // funding_rounds.approved_amount are read for nothing here on purpose.
  const apps = await listConfirmedApprovals(db, { orgId, fundingRoundId });
  let basisCents = 0;
  for (const a of apps) {
    const dollars = money(a.approved_amount);
    if (dollars == null) continue;
    basisCents += toCents(dollars);
  }
  if (!(basisCents > 0)) {
    const err = new Error(
      "no confirmed approvals on this round — nothing to bill. " +
      "An Approved application with no recorded amount is not a confirmed approval."
    );
    err.code = "closeout_no_confirmed_approvals";
    err.reason = NO_CONFIRMED_APPROVALS;
    throw err;
  }

  // The rate the client agreed to, in percent units. Never a default.
  let pct = amountOrNull(feePercentUnits);
  let saleId = null;
  if (pct == null) {
    const agreed = await agreedFeePercent(db, { orgId, fundingRoundId });
    pct = agreed.feePercent;
    saleId = agreed.saleId;
  }
  if (pct == null || !(pct > 0) || pct > 100) {
    const err = new Error(
      "no agreed success fee percent for this round — set agreed_success_fee_percent on the client's sale"
    );
    err.code = "closeout_no_fee_percent";
    err.reason = NO_AGREED_FEE_PERCENT;
    throw err;
  }

  const feeBasis = Number(fromCents(basisCents));
  const totalFeeCents = successFeeCents(feeBasis, pct);
  if (totalFeeCents == null || !(totalFeeCents > 0)) {
    const err = new Error("success fee worked out to nothing — refusing to write a $0 closeout");
    err.code = "closeout_no_confirmed_approvals";
    err.reason = NO_CONFIRMED_APPROVALS;
    throw err;
  }
  const totalFee = fromCents(totalFeeCents);
  const balanceDue = totalFee;
  // The column is called total_approved_amount and, under the 2026-08-30
  // decision, that name is finally accurate: this IS the confirmed approved
  // total. It used to hold the funded amount under a name that said otherwise.
  const totalApproved = fromCents(basisCents);
  // The COLUMN stores the rate as a fraction (numeric(6,4), default 0.10);
  // `pct` above is percent units. This is the only place the two meet.
  const feePctStored = roundHalfUp((pct / 100) * 10000) / 10000;

  const existing = await db.query(
    `SELECT * FROM funding_closeout
      WHERE funding_round_id = $1::uuid
      LIMIT 1`,
    [fundingRoundId]
  );

  let closeout;
  let created = false;
  if (existing.rows[0]) {
    const upd = await db.query(
      `UPDATE funding_closeout
          SET total_approved_amount = $2,
              total_fee = $3,
              balance_due = $4,
              fee_percent = $5,
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [existing.rows[0].id, totalApproved, totalFee, balanceDue, feePctStored]
    );
    closeout = upd.rows[0];
    await db.query(
      `DELETE FROM funding_closeout_items WHERE funding_closeout_id = $1`,
      [closeout.id]
    );
  } else {
    const ins = await db.query(
      `INSERT INTO funding_closeout (
         org_id, funding_round_id, total_approved_amount, total_fee,
         balance_due, fee_percent, status
       ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, 'open')
       RETURNING *`,
      [orgId, fundingRoundId, totalApproved, totalFee, balanceDue, feePctStored]
    );
    closeout = ins.rows[0];
    created = true;
  }

  // Lender breakdown for audit — one row per confirmed approval, which is the
  // same set the basis was summed from. Item fees are proportional shares of
  // totalFee and must sum to it exactly, so the last row takes the remainder
  // rather than re-deriving from its own amount × percent.
  const items = [];
  let allocatedCents = 0;
  for (let i = 0; i < apps.length; i++) {
    const a = apps[i];
    const approvedCents = toCents(money(a.approved_amount));
    const feeCents = i === apps.length - 1
      ? totalFeeCents - allocatedCents
      : roundHalfUp((approvedCents / basisCents) * totalFeeCents);
    if (i !== apps.length - 1) allocatedCents += feeCents;
    const item = await db.query(
      `INSERT INTO funding_closeout_items (
         org_id, funding_closeout_id, application_id,
         approved_amount, fee_amount, lender_name
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6)
       RETURNING *`,
      [
        orgId,
        closeout.id,
        a.id,
        fromCents(approvedCents),
        fromCents(feeCents),
        a.lender_name || a.bank || null
      ]
    );
    items.push(item.rows[0]);
  }

  return { closeout, items, created, feeBasis, feePercent: pct, saleId };
}

/**
 * Safe wrapper for event handlers — never throws into the bus.
 * A refusal comes back as { closeout: null, error: <named reason> }, which is a
 * real answer the caller must surface. It is never a $0 closeout.
 */
export async function createFundingCloseoutSafe(db, opts) {
  try {
    return await createFundingCloseout(db, opts);
  } catch (err) {
    return {
      closeout: null,
      items: [],
      created: false,
      error: err.code || err.message || "closeout_failed"
    };
  }
}

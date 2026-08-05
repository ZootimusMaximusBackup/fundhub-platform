/* Funding closeout — records the 10% success fee when a round is finalized.
   Hooked from round.funded (money-chain). Idempotent per funding_round_id.

   OWNER DECISION (2026-08-04, operational fix from END-TO-END-VERIFICATION):
   The fee basis is funding_rounds.funded_amount — what the client actually
   received / is billed 10% of. Approved application rows are a lender
   breakdown only. Computing the fee from Approved apps alone meant a funded
   round with no per-lender Approved rows silently billed $0.
*/

const DEFAULT_FEE_PERCENT = 0.10;

function money(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

/**
 * Create or refresh a closeout for a funded round.
 *
 * Fee = feePercent × funding_rounds.funded_amount.
 * Approved applications are recorded as line items when present; they do not
 * gate or replace the fee.
 *
 * @param {import("pg").Pool|object} db
 * @param {{ orgId: string, fundingRoundId: string, feePercent?: number }} opts
 * @returns {Promise<{ closeout: object, items: object[], created: boolean }>}
 */
export async function createFundingCloseout(db, {
  orgId,
  fundingRoundId,
  feePercent = DEFAULT_FEE_PERCENT
} = {}) {
  if (!orgId || !fundingRoundId) {
    const err = new Error("orgId and fundingRoundId required");
    err.code = "closeout_args";
    throw err;
  }

  const pct = Number(feePercent);
  const feePct = Number.isFinite(pct) && pct >= 0 && pct <= 1 ? pct : DEFAULT_FEE_PERCENT;

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

  // Fee basis = funded amount on the round. Fall back only if funded is null
  // and approved_amount on the round itself is set (not application rows).
  const feeBasis = money(
    round.funded_amount != null && Number(round.funded_amount) > 0
      ? round.funded_amount
      : round.approved_amount
  );
  const totalFee = money(feeBasis * feePct);
  const balanceDue = totalFee;
  // Column name is historical ("total_approved_amount"); value is the fee basis
  // (funded amount). Do not rename without a migration — screens already read it.
  const totalApproved = feeBasis;

  const apps = await db.query(
    `SELECT id, approved_amount, lender_name, bank, status
       FROM applications
      WHERE org_id = $1::uuid
        AND funding_round_id = $2::uuid
        AND status = 'Approved'
        AND COALESCE(approved_amount, 0) > 0
      ORDER BY created_at ASC`,
    [orgId, fundingRoundId]
  );

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
      [existing.rows[0].id, totalApproved, totalFee, balanceDue, feePct]
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
      [orgId, fundingRoundId, totalApproved, totalFee, balanceDue, feePct]
    );
    closeout = ins.rows[0];
    created = true;
  }

  // Lender breakdown for audit. Item fees are proportional shares of totalFee
  // when apps exist; they must sum to totalFee (not re-derive from app × pct).
  const items = [];
  const appSum = apps.rows.reduce((s, a) => s + money(a.approved_amount), 0);
  let allocated = 0;
  for (let i = 0; i < apps.rows.length; i++) {
    const a = apps.rows[i];
    const approved = money(a.approved_amount);
    let fee;
    if (i === apps.rows.length - 1) {
      fee = money(totalFee - allocated);
    } else if (appSum > 0 && totalFee > 0) {
      fee = money((approved / appSum) * totalFee);
      allocated = money(allocated + fee);
    } else {
      fee = 0;
    }
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
        approved,
        fee,
        a.lender_name || a.bank || null
      ]
    );
    items.push(item.rows[0]);
  }

  return { closeout, items, created, feeBasis };
}

/**
 * Safe wrapper for event handlers — never throws into the bus.
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

export { DEFAULT_FEE_PERCENT };

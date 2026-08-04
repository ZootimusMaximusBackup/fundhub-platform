/* Funding closeout — records the 10% success fee when a round is finalized.
   Hooked from round.funded (money-chain). Idempotent per funding_round_id. */

const DEFAULT_FEE_PERCENT = 0.10;

function money(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

/**
 * Create or refresh a closeout for a funded round from its Approved applications.
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

  let totalApproved = 0;
  for (const a of apps.rows) totalApproved += money(a.approved_amount);
  totalApproved = money(totalApproved);
  const totalFee = money(totalApproved * feePct);
  const balanceDue = totalFee;

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

  const items = [];
  for (const a of apps.rows) {
    const approved = money(a.approved_amount);
    const fee = money(approved * feePct);
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

  return { closeout, items, created };
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

// Insert/update repair_programs and emit repair.enrolled.
// HTTP path calls onRepairEvent directly (handlers are not on the bus here).

import { onRepairEvent } from "./handlers.mjs";

export class RepairEnrollError extends Error {
  constructor(message, { status = 400, code = "repair_enroll" } = {}) {
    super(message);
    this.name = "RepairEnrollError";
    this.status = status;
    this.code = code;
  }
}

function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return null;
  return Math.round(v * 100) / 100;
}

/**
 * @param {object} db
 * @param {{
 *   orgId: string,
 *   clientId: string,
 *   program: 'trial'|'full',
 *   priceTotal: number,
 *   amountPaid?: number,
 *   staffId?: string|null
 * }} opts
 */
export async function enrollRepairProgram(db, {
  orgId,
  clientId,
  program,
  priceTotal,
  amountPaid = 0,
  staffId = null
} = {}) {
  if (!db?.query) throw new RepairEnrollError("db required", { status: 500, code: "db_required" });
  if (!orgId || !clientId) {
    throw new RepairEnrollError("orgId and clientId are required", { code: "missing_ids" });
  }
  if (program !== "trial" && program !== "full") {
    throw new RepairEnrollError("program must be trial or full", { code: "invalid_program" });
  }
  const price = money(priceTotal);
  const paid = money(amountPaid);
  if (price == null) {
    throw new RepairEnrollError("price_total must be a non-negative number", { code: "invalid_price" });
  }
  if (paid == null) {
    throw new RepairEnrollError("amount_paid must be a non-negative number", { code: "invalid_amount_paid" });
  }

  const roundsCap = program === "trial" ? 2 : 6;

  const upsert = await db.query(
    `INSERT INTO repair_programs (
       org_id, client_id, program, rounds_cap, price_total, amount_paid, status
     ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, 'active')
     ON CONFLICT (org_id, client_id) DO UPDATE SET
       program     = EXCLUDED.program,
       rounds_cap  = EXCLUDED.rounds_cap,
       price_total = EXCLUDED.price_total,
       amount_paid = EXCLUDED.amount_paid,
       status      = 'active'
     RETURNING id, org_id, client_id, program, rounds_cap, price_total, amount_paid, status, created_at`,
    [orgId, clientId, program, roundsCap, price, paid]
  );
  const row = upsert.rows[0];
  if (!row) {
    throw new RepairEnrollError("could not save repair program", { status: 500, code: "enroll_failed" });
  }

  const event = await onRepairEvent(db, {
    name: "repair.enrolled",
    orgId,
    clientId,
    payload: {
      staffId,
      program: row.program,
      roundsCap: row.rounds_cap,
      source: "repair_enroll"
    }
  });

  return {
    ok: true,
    program: {
      id: row.id,
      client_id: row.client_id,
      program: row.program,
      rounds_cap: row.rounds_cap,
      price_total: Number(row.price_total),
      amount_paid: Number(row.amount_paid),
      status: row.status
    },
    event
  };
}

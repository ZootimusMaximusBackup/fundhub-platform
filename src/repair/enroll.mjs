// Insert/update repair_programs and emit repair.enrolled.
// HTTP path calls onRepairEvent directly (handlers are not on the bus here).

import { grant } from "../entitlements/entitlements.mjs";
import { onRepairEvent } from "./handlers.mjs";
import { emit } from "../events/bus.mjs";

/** Portal bureau-response door keys off this catalog code (client-portal doors). */
const REPAIR_ENTITLEMENT = "metro2-letter-pack";

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

  const entitlement = await grant(db, {
    orgId,
    clientId,
    code: REPAIR_ENTITLEMENT,
    grantedBy: staffId || null,
    reason: `repair_enroll:${row.program}`,
    reinstate: true
  });

  const payload = {
    staffId,
    program: row.program,
    roundsCap: row.rounds_cap,
    source: "repair_enroll"
  };

  /* The events table is the record that this enrollment happened at all — the
     activity feed, the replay harness and every "what did this client do"
     report read it, and none of them read repair_programs. onRepairEvent below
     moves the card and queues the welcome email but makes NO bus write, so
     before this line enrolling produced a live program, a sent email, and no
     repair.enrolled row anywhere. Confirmed on Sim Repair 27 (2026-08-27):
     program active, welcome delivered, `select ... from events where name like
     'repair%'` empty.

     Keyed on the program row id so a retried or double-submitted enroll dedupes
     into one event instead of stacking. Best-effort on purpose: a failure to
     record must not lose the enrollment or the email, both of which are already
     committed by the time we get here. */
  const idempotencyKey = `repair.enrolled:${row.id}`;
  const recorded = await emit(db, "repair.enrolled", payload, {
    orgId,
    clientId,
    idempotencyKey
  }).catch((err) => ({ id: null, deduped: false, error: String(err?.message || err) }));

  /* Still called directly, and ON THE DEPLOYED SITE IT DOES RUN TWICE.

     An earlier version of this comment said emit() "dispatches only to handlers
     registered via src/workflows/index.mjs, which this HTTP path does not
     import". That premise is false in production: netlify/functions/api.mjs:101
     imports api/read/workflows.mjs, which imports src/workflows/index.mjs:1,
     which calls registerRepairHandlers() — so emit() above already dispatched
     onRepairEvent for this same event before this line runs.

     The comment's CONCLUSION was right even though its reason was wrong, and
     that is the only reason this is not a live bug. Both runs are idempotent:
       - moveRepairCard is an UPDATE
       - the welcome email keys on provider_ref
         `workflow:EMAIL-REPAIR-WELCOME:repair-email:repair.enrolled:<org>:<client>:<staffId>`
         and inserts ON CONFLICT (org_id, provider_ref) DO NOTHING. Both runs
         are handed the same `payload` object, so eventIdFor() returns the same
         string and the second insert writes nothing.

     KEEP THE CALL. In a context that does NOT load the registry — a script, a
     test, a worker that imports this module alone — emit()'s dispatch reaches
     no handler and this line is the only thing that sends the welcome email.

     DO NOT add a side effect to onRepairEvent that is not idempotent. It runs
     twice per enrollment here. src/repair/notify.test.mjs pins that. */
  const event = await onRepairEvent(db, {
    name: "repair.enrolled",
    orgId,
    clientId,
    payload
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
    entitlement,
    event,
    recorded
  };
}

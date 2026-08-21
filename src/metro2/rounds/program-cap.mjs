// Trial round-cap → upsell_pending + repair.program.complete.

import { BUREAU_ROUNDS } from "./state.mjs";
import { onRepairEvent } from "../../repair/handlers.mjs";

export function needsUpsellPending({ items = [], roundsCap = 6, log = [] } = {}) {
  const cap = Math.min(Math.max(Number(roundsCap) || 6, 1), BUREAU_ROUNDS.length);
  if (cap >= 6) return false;

  const last = BUREAU_ROUNDS[cap - 1];
  const blocked = (log || []).some((e) => e.blocked_at_cap)
    || (items || []).some((it) => it.blocked_at_cap);
  const openAtCap = (items || []).some((it) => {
    const st = String(it.status || "");
    return ["open", "sent", "verified", "escalated", "unaddressed"].includes(st)
      && String(it.round || "").toUpperCase() === last;
  });
  return Boolean(blocked || openAtCap);
}

export async function markUpsellPending(db, { orgId, clientId, staffId = null } = {}) {
  if (!db?.query || !orgId || !clientId) {
    return { ok: false, reason: "missing_ids" };
  }
  const r = await db.query(
    `UPDATE repair_programs
        SET status = 'upsell_pending'
      WHERE org_id = $1::uuid AND client_id = $2::uuid
        AND status = 'active' AND program = 'trial'
      RETURNING id, program, rounds_cap, status`,
    [orgId, clientId]
  );
  const row = r.rows[0];
  if (!row) return { ok: false, reason: "no_active_trial" };

  const event = await onRepairEvent(db, {
    name: "repair.program.complete",
    orgId,
    clientId,
    payload: {
      staffId,
      program: "trial",
      rounds_cap: row.rounds_cap,
      source: "round_cap"
    }
  });
  return { ok: true, program: row, event };
}

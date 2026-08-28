// Trial round-cap → upsell_pending + repair.program.complete.

import { BUREAU_ROUNDS } from "./state.mjs";
import { onRepairEvent } from "../../repair/handlers.mjs";

const OPENISH = Object.freeze(["open", "sent", "verified", "escalated", "unaddressed"]);

export async function loadRoundsCap(db, { orgId, clientId, fallback = 6 } = {}) {
  if (!db?.query || !orgId || !clientId) return fallback;
  const r = await db.query(
    `SELECT rounds_cap FROM repair_programs
      WHERE org_id = $1::uuid AND client_id = $2::uuid LIMIT 1`,
    [orgId, clientId]
  );
  const n = r.rows[0]?.rounds_cap;
  return n != null ? Number(n) : fallback;
}

export function needsUpsellPending({ items = [], roundsCap = 6, log = [] } = {}) {
  const cap = Math.min(Math.max(Number(roundsCap) || 6, 1), BUREAU_ROUNDS.length);
  if (cap >= 6) return false;

  const last = BUREAU_ROUNDS[cap - 1];
  const blocked = (log || []).some((e) => e.blocked_at_cap)
    || (items || []).some((it) => it.blocked_at_cap);
  const openAtCap = (items || []).some((it) => {
    const st = String(it.status || "");
    return OPENISH.includes(st)
      && String(it.round || "").toUpperCase() === last;
  });
  const pastCap = (items || []).some((it) => {
    const st = String(it.status || "");
    if (!OPENISH.includes(st)) return false;
    const idx = BUREAU_ROUNDS.indexOf(String(it.round || "").toUpperCase());
    return idx >= cap;
  });
  return Boolean(blocked || openAtCap || pastCap);
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

  const cap = Math.min(Math.max(Number(row.rounds_cap) || 2, 1), BUREAU_ROUNDS.length);
  const last = BUREAU_ROUNDS[cap - 1];
  await db.query(
    `UPDATE dispute_items
        SET round = $3
      WHERE org_id = $1::uuid AND client_id = $2::uuid
        AND round ~ '^R[1-6]$'
        AND CAST(substring(round from 2) AS int) > $4`,
    [orgId, clientId, last, cap]
  );

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

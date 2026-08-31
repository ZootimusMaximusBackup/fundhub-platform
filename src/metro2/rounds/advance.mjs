// Advance dispute items after a confirmed bureau response parse.

import {
  applyItemOutcome,
  caseStatusFromItems,
  itemsNeedingEscalation,
  preDispatchRecheck
} from "./state.mjs";

/**
 * @param {{
 *   items: object[],
 *   outcomes: { itemId: string, outcome: string }[],
 *   latestReportItems?: object[],
 *   roundsCap?: number,
 *   humanConfirmed?: boolean
 * }} input
 *
 * `humanConfirmed` is passed straight to applyItemOutcome, which is the only
 * place the rule lives. Crossing into R4+ needs it; R1→R2 and R2→R3 do not.
 * Defaults false, so a caller that says nothing gets the safe answer.
 */
export function advanceAfterParse({
  items, outcomes, latestReportItems = [], roundsCap = 6, humanConfirmed = false
}) {
  const byId = new Map((items || []).map((it) => [String(it.id), { ...it }]));
  const log = [];
  for (const row of outcomes || []) {
    const it = byId.get(String(row.itemId));
    if (!it) continue;
    const next = applyItemOutcome(it, row.outcome, { roundsCap, humanConfirmed });
    byId.set(String(row.itemId), next);
    log.push({
      itemId: row.itemId,
      from: it.status,
      to: next.status,
      round: next.round,
      outcome: row.outcome,
      blocked_at_cap: !!next.blocked_at_cap,
      held_for_human: !!next.awaiting_human_confirmation,
      ...(next.would_advance_to ? { would_advance_to: next.would_advance_to } : {})
    });
  }
  const updated = [...byId.values()];
  return {
    items: updated,
    caseStatus: caseStatusFromItems(updated),
    escalate: itemsNeedingEscalation(updated),
    log,
    // Any item that wanted to cross into R4+ and was not allowed to. The caller
    // holds the whole parse when this is true, so a person sees it.
    heldForHuman: log.some((row) => row.held_for_human)
  };
}

/** Gate R2+ letters: drop items that vanished on a fresh pull. */
export function filterForDispatch(items, latestReportItems = []) {
  const keep = [];
  const closed = [];
  for (const it of items || []) {
    const r = preDispatchRecheck(it, latestReportItems);
    if (r.proceed) keep.push(r.item);
    else closed.push(r.item);
  }
  return { keep, closed };
}

// Advance dispute items after a confirmed bureau response parse.

import {
  applyItemOutcome,
  caseStatusFromItems,
  itemsNeedingEscalation,
  preDispatchRecheck
} from "./state.mjs";

/**
 * @param {{ items: object[], outcomes: { itemId: string, outcome: string }[], latestReportItems?: object[] }} input
 */
export function advanceAfterParse({ items, outcomes, latestReportItems = [] }) {
  const byId = new Map((items || []).map((it) => [String(it.id), { ...it }]));
  const log = [];
  for (const row of outcomes || []) {
    const it = byId.get(String(row.itemId));
    if (!it) continue;
    const next = applyItemOutcome(it, row.outcome);
    byId.set(String(row.itemId), next);
    log.push({ itemId: row.itemId, from: it.status, to: next.status, round: next.round, outcome: row.outcome });
  }
  const updated = [...byId.values()];
  return {
    items: updated,
    caseStatus: caseStatusFromItems(updated),
    escalate: itemsNeedingEscalation(updated),
    log
  };
}

/**
 * Gate R2/R3 letters: drop items that vanished on a fresh pull.
 */
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

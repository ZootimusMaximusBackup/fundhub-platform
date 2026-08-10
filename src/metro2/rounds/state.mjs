// Per-item round state. Rounds advance per item, not per letter.

export const ITEM_STATUS = Object.freeze({
  OPEN: "open",
  SENT: "sent",
  VERIFIED: "verified",
  DELETED: "deleted",
  UPDATED: "updated",
  UNADDRESSED: "unaddressed",
  CLOSED: "closed",
  ESCALATED: "escalated"
});

export const ROUNDS = Object.freeze(["R1", "R2", "R3"]);

export function nextRound(round) {
  const i = ROUNDS.indexOf(String(round || "R1").toUpperCase());
  if (i < 0 || i >= ROUNDS.length - 1) return null;
  return ROUNDS[i + 1];
}

/** Case status from its items. */
export function caseStatusFromItems(items = []) {
  if (!items.length) return "open";
  const openish = items.some((it) =>
    ["open", "sent", "verified", "escalated", "unaddressed"].includes(it.status)
  );
  if (items.every((it) => ["deleted", "updated", "closed"].includes(it.status))) {
    return "round_complete";
  }
  if (items.some((it) => it.status === "sent")) return "awaiting_response";
  return openish ? "open" : "round_complete";
}

/**
 * Apply a confirmed parse outcome to one item.
 * verified → escalate to next round (status escalated + round bumped)
 * deleted/updated → closed
 * unaddressed → stay open but mark unaddressed (strengthens R2/R3)
 */
export function applyItemOutcome(item, outcome) {
  const o = String(outcome || "").toLowerCase();
  const base = { ...item, outcome: o, updated: true };
  if (o === "deleted") return { ...base, status: ITEM_STATUS.DELETED };
  if (o === "updated") return { ...base, status: ITEM_STATUS.UPDATED };
  if (o === "unaddressed") return { ...base, status: ITEM_STATUS.UNADDRESSED };
  if (o === "verified") {
    const nr = nextRound(item.round);
    if (!nr) return { ...base, status: ITEM_STATUS.CLOSED, round: item.round };
    return { ...base, status: ITEM_STATUS.ESCALATED, round: nr };
  }
  return base;
}

/**
 * Before R2/R3 dispatch: if item gone from latest report, kill letter and close.
 * @returns {{ proceed: boolean, item, reason? }}
 */
export function preDispatchRecheck(item, latestReportItems = []) {
  const key = `${item.creditor || ""}|${item.account_last4 || ""}|${item.rule_id || item.ruleId || ""}`;
  const stillThere = latestReportItems.some((r) => {
    const rk = `${r.creditor || ""}|${r.account_last4 || ""}|${r.rule_id || r.ruleId || ""}`;
    return rk === key || (r.account_last4 && r.account_last4 === item.account_last4 && r.creditor === item.creditor);
  });
  if (!stillThere && latestReportItems.length > 0) {
    return {
      proceed: false,
      item: { ...item, status: ITEM_STATUS.DELETED, outcome: "deleted_on_recheck" },
      reason: "absent_on_fresh_pull"
    };
  }
  return { proceed: true, item };
}

/** Items that need a next-round letter. */
export function itemsNeedingEscalation(items = []) {
  return items.filter((it) => it.status === ITEM_STATUS.ESCALATED || it.status === ITEM_STATUS.VERIFIED);
}

// Per-item round state. Rounds advance per item, not per letter.
// Bureau sequence is R1–R6; trial programs cap earlier via roundsCap (repair_programs).

import { isEscalationRound } from "../letters/catalog.mjs";

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

/** Full bureau round ladder (full program). Trial uses a prefix via roundsCap. */
export const BUREAU_ROUNDS = Object.freeze(["R1", "R2", "R3", "R4", "R5", "R6"]);

/** @deprecated Prefer BUREAU_ROUNDS — kept as alias for callers that imported ROUNDS. */
export const ROUNDS = BUREAU_ROUNDS;

/**
 * Next bureau round under a program cap (default 6).
 * R1→R2→…→R`cap`→null. Trial cap 2 blocks R3+.
 */
export function nextRound(round, roundsCap = 6) {
  const cap = Math.min(Math.max(Number(roundsCap) || 6, 1), BUREAU_ROUNDS.length);
  const sequence = BUREAU_ROUNDS.slice(0, cap);
  const i = sequence.indexOf(String(round || "R1").toUpperCase());
  if (i < 0 || i >= sequence.length - 1) return null;
  return sequence[i + 1];
}

/** True when `round` is allowed under the program cap (FURNISHER always allowed). */
export function roundAllowed(round, roundsCap = 6) {
  const r = String(round || "").toUpperCase();
  if (r === "FURNISHER") return true;
  const cap = Math.min(Math.max(Number(roundsCap) || 6, 1), BUREAU_ROUNDS.length);
  const idx = BUREAU_ROUNDS.indexOf(r);
  return idx >= 0 && idx < cap;
}

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

// ═══════════════════════════════════════════════════════════════════════════════
// THE ONE PLACE A ROUND MOVES — AND THE ONE CROSSING A MACHINE MAY NOT MAKE
//
// COMPLIANCE REVIEW REQUIRED — dispute logic.
//
// A client can upload the bureau's reply from the portal, an AI reads it, and
// when the reading is confident the round advances with NOBODY IN THE LOOP
// (src/repair/parse-loop.mjs runParseAdvanceLoop; src/repair/response-agent.test.mjs
// "C1 clear letter auto-advances" pins that and it is intended behaviour).
//
// That is fine going up the bureau ladder. R1→R2 and R2→R3 produce another
// letter to a credit bureau: a wrong move costs a letter and is recoverable, and
// the speed is worth it. THOSE PATHS ARE UNCHANGED BY THIS BLOCK.
//
// Crossing into R4 is a different class of mistake. R4 and R5 are the CFPB and
// state attorney general complaints (../letters/catalog.mjs ROUND_LADDER), and
// reaching R4 is what releases them into the client's pack
// (../../underwrite/prior-outcome.mjs reachedEscalation). Those two documents are
// signed by the consumer UNDER PENALTY OF PERJURY. A machine reading a scanned
// letter must not be what decides a person swears to something.
//
// Owner-set 2026-08-28: auto-advance stays for R1→R2 and R2→R3; crossing INTO
// the escalation rounds requires a human confirmation.
//
// So: entering an escalation round needs `humanConfirmed`. That flag means a real
// person — a staff id, the confirmation ../inbound/confirm.mjs already
// represents — never a system sentinel and never a default. It arrives false
// unless someone passes it, so the safe answer is the one you get by doing
// nothing.
//
// A refused crossing is NOT a loss. The item stays at its own round with status
// 'verified', which `itemsNeedingEscalation` below still reports, and the parse
// that produced it is held unconfirmed so it surfaces on the exceptions queue
// (api/repair/exceptions.mjs) for a person to confirm. Nothing is dropped; the
// decision is just handed to a human.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * True when advancing out of `round` would land on an escalation round, so a
 * human has to say so. Reuses ../letters/catalog.mjs — one definition of which
 * rounds are escalation, not a second copy here.
 */
export function crossesIntoEscalation(round, roundsCap = 6) {
  const nr = nextRound(round, roundsCap);
  return !!nr && isEscalationRound(nr);
}

/**
 * Apply a confirmed parse outcome to one item.
 * Cap hit → closed + blocked_at_cap (trial → upsell path).
 *
 * @param {object} opts
 * @param {number} [opts.roundsCap]
 * @param {boolean} [opts.humanConfirmed] a real person confirmed this outcome.
 *   Required to cross into R4+. Defaults false — see the block above.
 */
export function applyItemOutcome(item, outcome, opts = {}) {
  const roundsCap = opts.roundsCap == null ? 6 : opts.roundsCap;
  const humanConfirmed = opts.humanConfirmed === true;
  const o = String(outcome || "").toLowerCase();
  const base = { ...item, outcome: o, updated: true };
  if (o === "deleted") return { ...base, status: ITEM_STATUS.DELETED };
  if (o === "updated") return { ...base, status: ITEM_STATUS.UPDATED };
  if (o === "unaddressed") return { ...base, status: ITEM_STATUS.UNADDRESSED };
  if (o === "verified") {
    const nr = nextRound(item.round, roundsCap);
    if (!nr) {
      return {
        ...base,
        status: ITEM_STATUS.CLOSED,
        round: item.round,
        blocked_at_cap: true
      };
    }
    // The crossing a machine may not make on its own. The item keeps its round.
    if (isEscalationRound(nr) && !humanConfirmed) {
      return {
        ...base,
        status: ITEM_STATUS.VERIFIED,
        round: item.round,
        awaiting_human_confirmation: true,
        would_advance_to: nr
      };
    }
    return { ...base, status: ITEM_STATUS.ESCALATED, round: nr };
  }
  return base;
}

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

export function itemsNeedingEscalation(items = []) {
  return items.filter((it) => it.status === ITEM_STATUS.ESCALATED || it.status === ITEM_STATUS.VERIFIED);
}

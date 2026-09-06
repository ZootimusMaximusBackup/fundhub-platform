// Derived facts the four deliverables share.
//
// Straight ports of scripts/black-reports/fundhub_gen.py:262-310
// (ranked_revolving, target_bal, paydown_amt, bureau_status, hero_card,
// fastest_wins).
//
// Every one of these reads the CLIENT dict produced by
// src/underwrite/black-report-client.mjs. Nothing here invents a value: a row
// with no utilization sorts last rather than sorting as 0%, and a target that
// cannot be worked out comes back null.

import { parsePct, parseMoney, usd } from "./format.mjs";

/** revolving row shape: [creditor, bureau, balance, limit, util, target, status] */

/**
 * Python ranked_revolving(): highest utilization first. A row whose utilization
 * is unknown sorts to the bottom on -1 — it is not treated as 0%.
 * Ties keep their original order, which is what Python's stable sorted() does.
 */
export function rankedRevolving(client) {
  const rows = (client?.revolving || []).filter((r) => r && r[0]);
  const key = (r) => {
    const p = parsePct(r.length > 4 ? r[4] : null);
    return p === null ? -1 : p;
  };
  return [...rows].sort((a, b) => key(b) - key(a));
}

/** Python target_bal(): the stated target balance, else 10% of the limit, else null. */
export function targetBal(row) {
  if (row && row.length > 5 && row[5]) {
    const n = parseMoney(row[5]);
    if (n !== null) return n;
  }
  const lim = parseMoney(row && row.length > 3 ? row[3] : null);
  if (lim !== null) return Math.round(lim * 0.1);
  return null;
}

/** Python paydown_amt(): balance minus target, never below zero, null if unknown. */
export function paydownAmt(row) {
  const bal = parseMoney(row && row.length > 2 ? row[2] : null);
  const tgt = targetBal(row);
  if (bal === null || tgt === null) return null;
  return Math.max(0, bal - tgt);
}

/* UNKNOWN READS AS UNKNOWN IN EVERY PLACE THE TARGET IS PRINTED.
   F52. targetBal() returns null for a card with no credit limit — a charge card,
   or an account with no preset spending limit. There is no 10% of a number the
   file does not have. Every site that printed a target fell back to row[5],
   which is the EMPTY STRING for exactly that card, so the sentence ran off the
   end: "Pay AMEX PLATINUM (NPSL) from $5,200 down to ". The paydown table on
   the same page printed "-" for the same card.
   Ported from scripts/black-reports/fundhub_gen.py:289-323, which is the same
   two helpers with the same wording. */

export const TARGET_UNKNOWN = "-";

/** The paydown target as printed, or null when the file cannot know it. */
export function targetText(row) {
  const tgt = targetBal(row);
  return tgt === null ? null : usd(tgt);
}

/** One card's paydown instruction. Never invents a target. */
export function paydownSentence(row) {
  const account = (row && row[0]) || "";
  const bal = row && row.length > 2 ? usd(row[2]) : TARGET_UNKNOWN;
  const tgt = targetText(row);
  if (tgt !== null) return `Pay ${account} from ${bal} down to ${tgt}`;
  return `${account} - ${bal} owed. No credit limit is reported for this card, `
    + "so there is no 10% target to pay down to";
}

/** Open (not CLOSED) revolving rows that carry a real creditor name. */
export function openRevolving(client) {
  return (client?.revolving || []).filter((r) => r && r[0] && r[6] !== "CLOSED");
}

/** How many open cards the file cannot produce a 10% target for. */
export function cardsWithNoTarget(client) {
  return openRevolving(client).filter((r) => targetBal(r) === null).length;
}

/**
 * Does this file support an OVERALL 10% target?
 *
 * F52. black-report-client.mjs used to take 10% of the vendor engine's total
 * limit without asking whether that total was real. The engine sums
 * `effectiveLimit || 0`, so a file whose only open cards report NO limit gives a
 * total limit of 0, and 10% of 0 is 0 — which printed "pay down to under $0" and
 * a total paydown equal to the client's ENTIRE balance. The mapper now leaves
 * both null and every overall figure asks here first.
 */
export function utilTotalsKnown(client) {
  return client?.util_total_limit != null && client?.util_target_balance != null;
}

/**
 * [open to this client today, still locked] out of the CLIENT dict.
 *
 * F45. The vendor matcher answers in two buckets and
 * src/underwrite/black-report-client.mjs:761-762 carries both across as
 * `lenders_now` and `lenders_after`. These four documents only ever read the
 * flattened `lenders` list, so every one of them said "No lenders are matched
 * for immediate funding right now" and filed all fifteen under "after
 * optimization" — including for a client with five open to him today.
 *
 * A CLIENT dict written before those two keys existed carries only the flat
 * list. The honest reading of that is that it does not say which are open now,
 * so nothing goes in the "now" bucket. Same rule as
 * scripts/black-reports/fundhub_gen.py lender_buckets().
 */
export function lenderBuckets(client) {
  const c = client || {};
  if (c.lenders_now != null || c.lenders_after != null) {
    return [[...(c.lenders_now || [])], [...(c.lenders_after || [])]];
  }
  return [[], [...(c.lenders || [])]];
}

/** Python bureau_status(): ["", 0, ""] when that bureau is not on the file. */
export function bureauStatus(client, label) {
  for (const row of client?.bureaus || []) {
    const [name, status, count, note] = row;
    if (String(name || "").toLowerCase() === String(label || "").toLowerCase()) {
      return [status, count, note];
    }
  }
  return ["", 0, ""];
}

/**
 * Python hero_card(): the card every paydown narrative is built around.
 *
 * F52. Every sentence written about the hero states its utilization and its 10%
 * target, so a card that has neither cannot be one. rankedRevolving() already
 * sorts unknown utilization last, so this only bites when the whole file is
 * cards with no reported limit — and then there is no hero, the narrative is
 * skipped, and nothing false is printed in its place. Same rule as
 * scripts/black-reports/fundhub_gen.py:326-341.
 */
export function heroCard(client) {
  for (const row of rankedRevolving(client)) {
    if (parsePct(row.length > 4 ? row[4] : null) === null) continue;
    if (targetBal(row) === null) continue;
    return row;
  }
  return null;
}

/** Python fastest_wins(): the two biggest paydowns, then the first dispute. */
export function fastestWins(client) {
  const wins = [];
  for (const row of rankedRevolving(client).slice(0, 2)) {
    wins.push(paydownSentence(row));
  }
  const negs = client?.negatives || [];
  if (negs.length) {
    const n = negs[0];
    wins.push(`Send dispute letters for ${n.creditor} on ${n.bureau}`);
  }
  return wins;
}

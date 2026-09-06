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

/** Python hero_card(): the highest-utilization revolving card, or null. */
export function heroCard(client) {
  const rows = rankedRevolving(client);
  return rows.length ? rows[0] : null;
}

/** Python fastest_wins(): the two biggest paydowns, then the first dispute. */
export function fastestWins(client) {
  const wins = [];
  for (const row of rankedRevolving(client).slice(0, 2)) {
    const tgt = targetBal(row);
    wins.push(`Pay ${row[0]} from ${usd(row[2])} down to ${tgt !== null ? usd(tgt) : row[5]}`);
  }
  const negs = client?.negatives || [];
  if (negs.length) {
    const n = negs[0];
    wins.push(`Send dispute letters for ${n.creditor} on ${n.bureau}`);
  }
  return wins;
}

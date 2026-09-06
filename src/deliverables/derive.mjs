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

/* THREE STATES, NOT TWO. ZERO IS NOT NULL AND NULL IS NOT ZERO.
   F52b. The limit cell holds one of three things and each one has a different
   honest answer:

     * a positive number  — the file states a ceiling, so 10% of it is a target;
     * the number ZERO    — the file states a ceiling of nothing. That is a
                            KNOWN value, not a missing one, and 10% of it is $0,
                            which is not a paydown target any client can act on;
     * null / ""          — the file does not say. A charge card, or an account
                            with no preset spending limit.

   targetBal() used to ask only `lim !== null`, so the middle case computed
   Math.round(0 * 0.1) = 0 and printed as an instruction: "Pay SECURED CARD from
   $900 down to $0". Reproduced 2026-09-06 on a one-card file (SECURED CARD,
   balance 900, effectiveLimit 0) in credit_analysis_report.html,
   funding_snapshot.html and optimization_roadmap.html, while the paydown table
   on the same page correctly printed dashes for the same card.

   A reported zero and an unreported limit both yield NO target. They do NOT
   yield the same sentence: saying "no credit limit is reported" about a card
   whose limit IS reported, as $0, is its own false statement. */

/** "known" (a positive stated ceiling), "zero" (reported as $0), or "unknown". */
export function limitState(row) {
  const lim = parseMoney(row && row.length > 3 ? row[3] : null);
  if (lim === null) return "unknown";
  return lim > 0 ? "known" : "zero";
}

/**
 * Python target_bal(): the stated target balance, else 10% of a POSITIVE limit,
 * else null. A limit of $0 has no tenth worth printing.
 */
export function targetBal(row) {
  if (row && row.length > 5 && row[5]) {
    const n = parseMoney(row[5]);
    if (n !== null) return n;
  }
  const lim = parseMoney(row && row.length > 3 ? row[3] : null);
  if (lim !== null && lim > 0) return Math.round(lim * 0.1);
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

/**
 * WHY THERE IS NO TARGET, in the client's own words. One phrase, used by every
 * site in every printer, so the three cannot describe the same card two ways.
 * Returns "" for a card that HAS a target.
 */
export function noTargetReason(row) {
  const state = limitState(row);
  if (state === "known") return "";
  if (state === "zero") return "The credit limit reported for this card is $0";
  return "No credit limit is reported for this card";
}

/** The same fact as a table cell: "limit reported as $0" / "no limit reported". */
export function noTargetCell(row) {
  const state = limitState(row);
  if (state === "known") return "";
  return state === "zero" ? "limit reported as $0" : "no limit reported";
}

/** noTargetCell() at the start of a cell: "Limit reported as $0". */
export function noTargetCellCap(row) {
  const s = noTargetCell(row);
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

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
  return `${account} - ${bal} owed. ${noTargetReason(row)}, `
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

/* ───────────────────────────────────────────────────────────────────────────
   EVERY SENTENCE ABOUT THIS CLIENT'S FILE IS BUILT FROM THIS CLIENT'S FILE.
   F53. The roadmap's opening paragraph and its closing paragraph were prose
   literals: "You have a mortgage. You have paid-off auto loans. You have a
   clean TransUnion." and "the two things holding you back right now are maxed
   out credit cards ... and a handful of old negatives". Rendered against a file
   with mortgages: [], installments: [] and one AMEX, every one of those
   sentences was false, and the client pays for the document. Absence of data
   produces no claim. These helpers are the only way such a claim reaches a page.
   ─────────────────────────────────────────────────────────────────────────── */

/** Bureau names this file shows as CLEAN, in the order the mapper listed them. */
export function cleanBureaus(client) {
  return (client?.bureaus || [])
    .filter((row) => row && row[1] === "CLEAN")
    .map((row) => String(row[0] || ""))
    .filter(Boolean);
}

/** "You have a mortgage." and its two siblings — only for rows that exist. */
export function accountFactSentences(client) {
  const c = client || {};
  const out = [];
  if ((c.mortgages || []).length) out.push("You have a mortgage.");
  if ((c.installments || []).length) out.push("You have installment loans.");
  if ((c.revolving || []).length) out.push("You have revolving cards.");
  return out;
}

/** The accounts AND the clean bureaus, as sentences. Empty file, empty list. */
export function fileFactSentences(client) {
  const out = accountFactSentences(client);
  const clean = cleanBureaus(client);
  if (clean.length === 1) out.push(`You have a clean ${clean[0]}.`);
  else if (clean.length > 1) out.push(`You have clean bureaus: ${clean.join(", ")}.`);
  return out;
}

/**
 * How many open cards there actually are to pay down. Never "your two".
 * Shared by the credit analysis card, the funding snapshot's waterfall label and
 * scripts/black-reports/fundhub_gen.py pay_down_cards_line().
 */
export function payDownCardsLine(client) {
  const n = openRevolving(client).length;
  if (!n) return "There are no open revolving cards on this file to pay down.";
  if (n === 1) return "Pay down your open revolving card.";
  return `Pay down your ${n} open revolving cards.`;
}

/** Open cards this file shows at 50% utilization or more. Unknown is not high. */
export function highUtilCards(client) {
  return openRevolving(client).filter((r) => {
    const p = parsePct(r.length > 4 ? r[4] : null);
    return p !== null && p >= 50;
  });
}

/**
 * The two-things-holding-you-back sentence, with only the things that are there.
 * Returns "" when the file shows neither, rather than naming one anyway.
 */
export function holdingYouBack(client) {
  const c = client || {};
  const bits = [];
  const high = highUtilCards(c).length;
  if (high) {
    bits.push(high === 1
      ? "one card carrying a high balance - fixable with a paydown plan"
      : `${high} cards carrying high balances - fixable with a paydown plan`);
  }
  const negs = (c.negatives || []).length;
  if (negs) {
    bits.push(negs === 1
      ? "one negative item - fixable with dispute letters"
      : `${negs} negative items - fixable with dispute letters`);
  }
  if (!bits.length) return "";
  if (bits.length === 1) {
    return `the one thing holding you back right now is ${bits[0]}. `
      + "It is not permanent. It is on the repair list starting Month 1.";
  }
  return `the two things holding you back right now are ${bits[0]} and ${bits[1]}. `
    + "Neither one is permanent. Both are on the repair list starting Month 1.";
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

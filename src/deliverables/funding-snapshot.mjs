// DOCUMENT 2 — Capital Readiness Snapshot (funding snapshot).
// Ported from scripts/black-reports/fundhub_gen.py:1100-1202. Six numbered
// sections: numbers, breakdown, costing you, not a factor, after optimization,
// next step.

import { esc } from "./escape.mjs";
import { usd, median, moneyRange, parsePct } from "./format.mjs";
import { rankedRevolving, targetText, fastestWins, lenderBuckets, utilTotalsKnown,
  payDownCardsLine } from "./derive.mjs";
import { cover, ctaPage, section, table, PB } from "./chrome.mjs";
import { svgWaterfall } from "./charts.mjs";

/** Python str.title() — the status tag on each card in section 02. */
function titleCase(s) {
  return String(s ?? "").toLowerCase().replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

/** The entity's own name when the file carries one, else a neutral noun. */
function entityName(client) {
  return String(client?.business?.name || "").trim() || "A business entity";
}

export function buildFundingSnapshot(client) {
  const c = client || {};
  const med = median(c.scores || {});
  const now = Number(c.preapproval_now);
  const after = Number(c.preapproval_after);
  const delta = Number.isFinite(now) && Number.isFinite(after) ? after - now : null;
  const hasEntity = !!c.business?.hasEntity;
  const h = [cover(c, "funding snapshot", "Capital Readiness Snapshot")];

  // 01 numbers
  h.push(section("01", "numbers", "Your Numbers Right Now"));
  h.push(table(["", "today", "after optimization"], [
    ["Median Score", med, "700+ (projected)"],
    ["Experian Score", c.scores?.experian ?? "", "700+ (projected)"],
    ["Pre-Approval", usd(c.preapproval_now), usd(c.preapproval_after)],
    ["Funding Gap", "", `${usd(delta)} left on the table`]
  ].map((r) => r.map(esc))));
  h.push(svgWaterfall(usd(c.preapproval_now), `+${usd(delta)}`, usd(c.preapproval_after),
    [["TODAY", "Current pre-approval"],
      // F53. "Pay down two cards" for a file that shows one, or five.
      ["UTILIZATION FIX", payDownCardsLine(c)],
      ["PROJECTED", "After optimization"]]));
  h.push('<div class="note">PERSONAL LOAN PRE-APPROVAL BAND · UNDERWRITEIQ</div>');
  /* F53. "You are fundable right now. A personal loan is within reach today."
     was printed for every client, including one this file gives a pre-approval
     of nothing. src/underwrite/black-report-node.mjs prints its equivalent only
     when there is a gap to close; this asks the file the same two questions. */
  const fundableNow = Number.isFinite(now) && now > 0;
  const hasGap = Number.isFinite(delta) && delta > 0;
  if (fundableNow && hasGap) {
    h.push(`<p><b>You are fundable right now at ${esc(usd(c.preapproval_now))}. But you
      are leaving ${esc(usd(delta))} on the table by not fixing a few things first. The biggest fixes
      are fast.</b></p>`);
  } else if (fundableNow) {
    h.push(`<p><b>You are fundable right now at ${esc(usd(c.preapproval_now))}.</b></p>`);
  } else if (hasGap) {
    h.push(`<p><b>You are leaving ${esc(usd(delta))} on the table by not fixing a few things
      first. The biggest fixes are fast.</b></p>`);
  }

  // 02 breakdown
  h.push(section("02", "breakdown", "Breakdown by Category"));
  h.push("<h3>Personal Cards</h3>");
  const cardRows = (c.revolving || []).map(([cr, , bal, lim, util, , st]) => {
    const cls = st === "CRITICAL" ? "tag solid" : (st === "HIGH" ? "tag grey" : "tag open");
    return [esc(cr), `<span class="tag open">${esc(titleCase(st))}</span>`, esc(usd(bal)),
      esc(usd(lim)), `${esc(util || "-")} <span class="${cls}">${esc(st)}</span>`];
  });
  h.push(table(["account", "status", "balance", "limit", "utilization"], cardRows));
  /* F52. "Overall utilization: - This is your #1 problem right now" calls a
     figure the file does not have the client's biggest problem. No percentage,
     no verdict. */
  if (c.util_pct) {
    h.push(`<p><b>Overall utilization: ${esc(c.util_pct)} - This is your #1 problem right now.</b></p>`);
  }

  h.push("<h3>Installment Loans</h3>");
  h.push(table(["account", "status", "balance", "notes"],
    (c.installments || []).map((r) => r.map(esc))));
  h.push("<h3>Mortgage / Real Estate</h3>");
  h.push(table(["account", "status", "balance", "notes"],
    (c.mortgages || []).map((r) => r.map(esc))));
  h.push("<h3>Child Support / Public Obligations</h3>");
  h.push(table(["account", "status", "balance", "notes"],
    (c.public_obligations || []).map((r) => r.map(esc))));
  h.push("<h3>Business Accounts</h3>");
  /* F53. "No business entity on file" was printed even for a client whose file
     names one. The Node printer has always asked c.business first
     (src/underwrite/black-report-node.mjs businessLine()); this now does too. */
  h.push(hasEntity
    ? `<p>${esc(entityName(c))} is on file. The next step is the business credit profile: `
      + "an EIN, a dedicated business checking account, and vendor accounts that report.</p>"
    : "<p>No business entity on file. You are leaving a full suite of business funding "
      + "off the table. We cover how to fix this below.</p>");

  // 03 what is costing you money
  h.push(PB);
  h.push(section("03", "costing you", "What Is Costing You Money"));
  h.push("<p>Each item below is hurting your pre-approval. Fix them in this order.</p>");
  const costing = [];
  for (const row of rankedRevolving(c)) {
    const pct = parsePct(row[4]);
    if (pct === null || pct < 20) continue;
    const tgt = targetText(row);
    /* F52. No reported limit, so "on a $X limit" and a 10% target are both
       figures this file does not have. The row is dropped from a list whose
       whole point is a number to aim at. */
    if (tgt === null) continue;
    costing.push([
      `${row[0]} - ${row[4]} Utilization`,
      `You owe ${usd(row[2])} on a ${usd(row[3])} limit. Pay it down to ${tgt}.`
    ]);
  }
  if (c.util_pct && utilTotalsKnown(c)) {
    costing.push([
      `Overall Utilization - ${c.util_pct}`,
      `You are using ${usd(c.util_total_balance)} out of ${usd(c.util_total_limit)} in `
      + `available credit. Get total balances to ${usd(c.util_target_balance)} or less.`
    ]);
  }
  for (const n of c.negatives || []) {
    costing.push([
      `${n.creditor} - ${n.type} - ${n.balance} - ${n.bureau}`,
      n.why || n.detail || "Dispute this item first."
    ]);
  }
  if (!hasEntity) {
    costing.push([
      "No Business Entity Registered",
      "Without a business entity you cannot access business credit programs. Forming an LLC "
      + "unlocks a whole second tier of funding."
    ]);
  }
  h.push('<div class="steps">' + costing.map(([t, d], i) =>
    `<div class="step"><div class="n">${i + 1}</div><div><div class="t">${esc(t)}</div>`
    + `<div class="small">${esc(d)}</div></div></div>`).join("") + "</div>");

  // 04 what does not affect funding
  h.push(section("04", "not a factor", "What Does Not Affect Your Funding"));
  /* F53. Four of these five lines asserted something about this client's file —
     an authorized-user account, a charge-off, several addresses, several name
     spellings — and printed for every client whether or not the file held any
     of it. Each line now appears only when the row behind it is on the file. */
  const notFactor = ["<li><b>Inquiries.</b> They do NOT affect funding decisions at FundHub."
    + " Cleanup only.</li>"];
  if (c.au_account?.creditor) {
    notFactor.push("<li><b>Authorized user account.</b> Cannot help your funding, but clean and"
      + " not hurting you. Keep it.</li>");
  }
  const hasChargeOff = (c.negatives || [])
    .some((n) => String(n.type || "").toLowerCase().includes("charge"));
  notFactor.push(hasChargeOff
    ? "<li><b>Score alone.</b> The charge-off and utilization hurt you more than the number"
      + " itself.</li>"
    : "<li><b>Score alone.</b> What sits behind the number moves your funding more than the"
      + " number itself.</li>");
  const pdKinds = (c.personal_data || []).map((p) => String(p[0] || "").toLowerCase());
  if (pdKinds.some((k) => k.includes("address"))) {
    notFactor.push("<li><b>Multiple addresses.</b> Does not block funding. Cleaned up by your"
      + " personal info letters.</li>");
  }
  if (pdKinds.some((k) => k.includes("name"))) {
    notFactor.push("<li><b>Name variations.</b> Does not block funding, but needs consolidating"
      + " to your legal name.</li>");
  }
  h.push(`<ul class="plain">${notFactor.join("")}</ul>`);

  // 05 after optimization
  h.push(PB);
  /* F45. "Where You Could Be" is the LOCKED list. It used to print every lender
     the matcher knew, including the ones already open today, so a client saw his
     own available lenders filed under "after optimization".
     src/underwrite/black-report-node.mjs:821 prints this section only when the
     locked bucket has something in it. */
  const [, locked] = lenderBuckets(c);
  if (locked.length) {
    h.push(section("05", "after optimization", "Where You Could Be - After Optimization"));
    const lenderRows = locked.map(([nm, , typ, lo, hi, sc, tib]) => {
      const need = tib === null || tib === undefined ? `Score ${sc}+` : `LLC + Score ${sc}+`;
      return [esc(nm), esc(typ), esc(moneyRange(lo, hi)), esc(need)];
    });
    h.push(table(["lender", "type", "est. range", "what you need"], lenderRows));
  }

  // 06 next step
  h.push(section("06", "next step", "Your Next Step"));
  h.push("<p><b>Do NOT open new accounts before funding.</b> Every new card or loan drops your "
    + "average account age and can trigger automatic declines. Lock in your funding first. "
    + "Build after.</p><p><b>Your fastest wins:</b></p>");
  const wins = fastestWins(c);
  h.push('<ul class="plain">' + wins.map((w) => `<li>${esc(w)}</li>`).join("") + "</ul>");
  /* F53. "Those three moves alone can push your score past 680 and your
     pre-approval past $15,000" printed under a list of one move, for a client
     whose median score was already 700 and whose pre-approval was already
     $50,000. The count is the list's own, and the two figures are this file's
     own projected ones. */
  if (wins.length) {
    h.push(`<p>${esc(wins.length === 1
      ? "That one move is what takes"
      : `Those ${wins.length} moves are what take`)} `
      + `your pre-approval from ${esc(usd(c.preapproval_now))} toward `
      + `${esc(usd(c.preapproval_after))}.</p>`);
  }
  h.push(ctaPage(c));
  return h.join("");
}

// DOCUMENT 4 — 6-Month Business Readiness Roadmap (optimization roadmap).
// Ported from scripts/black-reports/fundhub_gen.py:1309-1574. Nine numbered
// sections: projection, month 1, months 2-3, month 4, month 5, month 6,
// transformation, checklist, call to action.

import { esc } from "./escape.mjs";
import { usd, median, spaced, parseMoney } from "./format.mjs";
import { rankedRevolving, targetBal, paydownAmt, bureauStatus, heroCard, fastestWins } from "./derive.mjs";
import { cover, ctaPage, section, table, PB } from "./chrome.mjs";
import { svgProjection, svgDisputeFlow } from "./charts.mjs";

/**
 * The month strip. `body` carries literal <br> markup, so it is a module
 * literal and goes in raw — nothing from a client reaches it.
 */
const MONTHS = Object.freeze([
  ["month 1", "Launch", "Paydowns<br>Round 1 disputes<br>File LLC", ""],
  ["month 2", "Results", "Balances report<br>Dispute results", ""],
  ["month 3", "Results", "Round 2 escalation<br>Goodwill letters", "EX 650-665"],
  ["month 4", "Final push", "Round 3, CFPB<br>Settlement", ""],
  ["month 5", "Business", "EIN, DUNS<br>Net-30 vendors", "EX 665-680"],
  ["month 6", "Reveal", "Re-pull all three<br>Reapply", ""]
]);

function firstName(client) {
  const raw = String(client?.applicant || "").trim() || "Client";
  return raw.split(/\s+/)[0];
}

export function buildRoadmap(client) {
  const c = client || {};
  const med = median(c.scores || {});
  const now = Number(c.preapproval_now);
  const after = Number(c.preapproval_after);
  const delta = Number.isFinite(now) && Number.isFinite(after) ? after - now : null;
  const first = firstName(c);
  const negatives = c.negatives || [];
  const h = [cover(c, "credit optimization roadmap",
    `${first}'s 6-Month Business Readiness Roadmap`)];

  h.push(`<div class="callout"><p style="margin:0">A note before we dive in: ${esc(first)}, `
    + "I have looked at every inch of your credit file. You have a mortgage. You have "
    + "paid-off auto loans. You have a clean TransUnion. You are not starting from zero. "
    + "What we are doing over the next 6 months is clearing the road so the money can "
    + "flow.</p></div>");

  // 01 projection
  h.push(section("01", "projection", "Your Projected Pre-Approval"));
  h.push(`<div class="hero"><div class="amount">${esc(usd(c.preapproval_after))}</div>`
    + `<div class="small">Up from ${esc(usd(c.preapproval_now))} today - a ${esc(usd(delta))} `
    + "increase</div></div>");

  h.push(svgProjection(med, "680-710"));
  h.push('<div class="mrow">' + MONTHS.map(([k, t, b, ex], i) =>
    `<div class="mcol"><div class="circ">${i + 1}</div><div class="mk">${esc(spaced(k))}</div>`
    + `<div class="mt">${t}</div><div class="mb">${b}</div>`
    + (ex ? `<div class="mex">${ex}</div>` : "") + "</div>").join("") + "</div>");
  h.push(`<div class="note">${esc(spaced("projected median score range · anchored at month 1 and month 6 targets"))}</div>`);

  h.push("<h3>Where You Stand Right Now vs. Where You're Going</h3>");
  const st = c.score_targets || {};
  const stand = [
    ["Median Score", med, st.median || ""],
    ["Experian Score", c.scores?.experian ?? "", st.experian || ""],
    ["TransUnion Score", c.scores?.transunion ?? "", st.transunion || ""],
    ["Equifax Score", c.scores?.equifax ?? "", st.equifax || ""]
  ];
  for (const row of rankedRevolving(c).slice(0, 2)) {
    const tgt = targetBal(row);
    stand.push([
      `${row[0]} Utilization`,
      `${row[4]} (${usd(row[2])} / ${usd(row[3])})`,
      tgt !== null ? `Under 10% (${usd(tgt)})` : "Under 10%"
    ]);
  }
  stand.push(["Overall Utilization", c.util_pct, "Under 10%"]);
  stand.push(["Negative items", negatives.length, 0]);
  stand.push(["Pre-Approval Estimate", usd(c.preapproval_now), usd(c.preapproval_after)]);
  stand.push(["Lenders on this shortlist", 0, (c.lenders || []).length]);
  h.push(table(["", "today", "month 6"], stand.map((r) => r.map(esc))));

  // 02 month 1
  h.push(PB);
  h.push(section("02", "month 1", "Month 1 - Launch"));
  h.push('<p class="mono small">"We fire on all cylinders. Everything starts now."</p>');
  h.push("<h3>Step 1: The Paydown Plan</h3>");
  h.push(`<p>This is your single biggest score lever. Lenders see ${esc(c.util_pct || "your")} `
    + "utilization and they slow down.</p>");
  const payRows = rankedRevolving(c).map((row) => {
    const tgt = targetBal(row);
    const pd = paydownAmt(row);
    return [row[0], usd(row[2]), usd(row[3]),
      tgt !== null ? usd(tgt) : (row[5] || ""),
      pd !== null ? usd(pd) : ""];
  });
  h.push(table(["account", "balance", "limit", "pay down to", "amount to pay"],
    payRows.map((r) => r.map(esc))));
  const totalPd = rankedRevolving(c).reduce((sum, r) => sum + (paydownAmt(r) || 0), 0);
  const hero = heroCard(c);
  const start = hero
    ? `Even getting ${hero[0]} down first moves your score.`
    : "Start with the highest card.";
  h.push(`<p><b>Total paydown to reach 10% utilization: ${esc(usd(totalPd))}.</b> You do not have `
    + `to do this all at once. ${esc(start)}</p>`);

  h.push("<h3>Step 2: Round 1 Dispute Letters - Experian First</h3>");
  const exNegs = negatives.filter((n) => String(n.bureau || "").toLowerCase() === "experian");
  if (exNegs.length) {
    h.push('<ul class="plain">' + exNegs.map((n) =>
      `<li>${esc(n.creditor)} - ${esc(n.type || "")} - ${esc(n.balance || "")}.</li>`).join("")
      + "</ul>");
  } else {
    h.push("<p>No Experian negatives are listed on this file.</p>");
  }
  const personal = c.personal_data || [];
  if (personal.length) {
    h.push('<ul class="plain">' + personal.map((p) =>
      `<li>${esc(p[0])} - ${esc(p[1])}</li>`).join("") + "</ul>");
  }
  h.push("<h3>Step 3: Round 1 Dispute Letters - Equifax</h3>");
  h.push('<ul class="plain">' + negatives.filter((n) => n.bureau === "Equifax").map((n) =>
    `<li><b>${esc(n.creditor)}</b> - ${esc(n.why)}</li>`).join("") + "</ul>");
  h.push("<h3>Step 4: Inquiry Removal Letters - Experian</h3>");
  h.push("<p>Inquiries do NOT affect your funding. But clean is clean. Send removal letters "
    + "for duplicates and for any inquiry that did not result in an open account.</p>");
  h.push("<h3>Step 5: Form Your LLC</h3><ul class='plain'>"
    + `<li>File your LLC in ${esc(c.state)} online with the Secretary of State for `
    + `${esc(usd(c.llc_fee))}.</li>`
    + `<li>Use your address at ${esc(c.address)}.</li>`
    + "<li>Once filed, the clock starts. LLC age matters for lenders.</li>"
    + "<li>Open a dedicated business checking account. Even $100 in it is fine to start.</li></ul>");
  h.push("<h3>Step 6: Secure Your Personal Loan NOW</h3>"
    + "<p>You qualify for a personal loan right now, before any repairs. Current "
    + `pre-approval estimate: ${esc(usd(c.preapproval_now))}. Do NOT open any new credit `
    + "cards or accounts before you lock this in - new accounts lower your average "
    + "account age and trigger hard inquiries. Get the funding first. Build the credit "
    + "profile after.</p>");

  // 03 months 2-3
  h.push(PB);
  h.push(section("03", "months 2-3", "Months 2-3 - Results"));
  h.push('<p class="mono small">"The work starts paying off. Numbers move."</p>');
  h.push("<h3>Why disputes take rounds, not days.</h3>");
  h.push(svgDisputeFlow());
  h.push("<p><b>One round rarely clears everything. Three rounds is normal.</b><br>"
    + "<span style='font-size:9pt'>The 30 day clock is set by law. That is why this takes "
    + "months, not days.</span></p>");
  h.push('<div class="note">THE PROCESS BEHIND EVERY DISPUTE ROUND IN THIS PLAN</div>');
  h.push("<h3>What to Expect in Month 2</h3>");
  h.push("<p>Utilization paydowns hit your score first - balance updates report within 30-45 "
    + "days. Estimated score movement from utilization alone: <b>+25 to +45 points</b>. "
    + "Dispute results start coming back at day 30-45.</p>");
  h.push("<h3>What to Expect in Month 3</h3>");
  h.push("<p>Round 2 escalation letters go out for anything that came back verified. Round 2 "
    + "requests the method of verification, cites specific FCRA violations where the "
    + "process was improper, and escalates the charge-off.</p>");
  h.push("<p><b>Month 3 score projection:</b> Experian 650-665, Equifax 655-670, TransUnion "
    + "holding at 725. Pre-approval estimate climbs toward $12,000-$15,000.</p>");

  // 04 month 4
  h.push(PB);
  h.push(section("04", "month 4", "Month 4 - Final Push"));
  h.push('<p class="mono small">"We go after what\'s left. No item gets a free pass."</p>');
  h.push(`<ul class="plain">
      <li>CFPB complaints filed alongside disputes - bureaus respond faster when regulators are watching.</li>
      <li>Direct creditor disputes, not just bureau disputes.</li>
      <li>Procedural challenges where a bureau took longer than 30 days to respond.</li>
      </ul>`);
  const charge = negatives.find((n) => String(n.type || "").toLowerCase().includes("charge")) || null;
  if (charge) {
    const bal = parseMoney(charge.balance);
    const low = bal ? Math.round(bal * 0.4) : null;
    const high = bal ? Math.round(bal * 0.6) : null;
    h.push(`<h3>Settlement Negotiation - ${esc(charge.creditor)}</h3>`);
    h.push('<div class="callout">"I am calling to discuss this account. '
      + "I am prepared to settle. I can only do so if you agree in "
      + 'writing to delete this account from all three credit bureaus upon payment."</div>');
    if (low !== null) {
      h.push(`<p><b>Your offer range: ${esc(usd(low))} to ${esc(usd(high))} `
        + `(40%-60% of the ${esc(usd(bal))} balance).</b></p>`);
    }
    h.push(`<ul class="plain">
          <li>Do NOT pay without a written pay-for-delete agreement first.</li>
          <li>Get the agreement via email or certified mail.</li>
          <li>Do NOT give bank account numbers over the phone - use a money order or prepaid card.</li>
          <li>Once they confirm deletion in writing, pay and keep the receipt.</li>
          </ul>`);
  }
  const childSources = [
    ...negatives.map((n) => `${n.creditor || ""} ${n.type || ""}`),
    ...(c.public_obligations || []).map((r) => `${r[0] || ""} ${r[1] || ""}`)
  ];
  const child = childSources.some((s) => s.toLowerCase().includes("child"));
  if (child) {
    h.push("<h3>Child Support Accounts - Strategic Note</h3>");
    h.push("<p>Government child support accounts are harder to delete and rarely do "
      + "pay-for-delete. What works: get current so no new lates are added, request a "
      + "payment plan in writing confirmed as current, and dispute individual late payment "
      + "dates for accuracy.</p>");
  }

  // 05 month 5
  h.push(PB);
  h.push(section("05", "month 5", "Month 5 - Business Milestone"));
  h.push(`<ul class="plain">
      <li>Get your EIN from the IRS - free at IRS.gov.</li>
      <li>Register with Dun &amp; Bradstreet for your DUNS number.</li>
      <li>Open a dedicated business checking account under your LLC name.</li>
      <li>Get net-30 vendor accounts (Uline, Quill, Grainger) and start building Paydex.</li>
      </ul>`);
  h.push("<p>Most business lenders require 6-12 months of business age. By Month 5 you are "
    + "halfway to the 12-month threshold that unlocks the larger lines of credit.</p>");

  // 06 month 6
  h.push(PB);
  h.push(section("06", "month 6", "Month 6 - The Reveal"));
  h.push("<p>Pull a fresh tri-merge report and compare it side by side with Month 1.</p>");
  const reveal = [];
  for (const n of negatives) {
    reveal.push([`${n.creditor} ${n.type}`, n.balance || "showing", "Deleted or settled"]);
  }
  for (const row of rankedRevolving(c).slice(0, 2)) {
    reveal.push([`${row[0]} utilization`, row[4], "Under 10%"]);
  }
  reveal.push(["Overall utilization", c.util_pct, "Under 10%"]);
  const [, exC] = bureauStatus(c, "Experian");
  const [, eqC] = bureauStatus(c, "Equifax");
  reveal.push(["Experian negatives", exC, 0]);
  reveal.push(["Equifax negatives", eqC, "reduced"]);
  h.push(table(["item", "month 1", "month 6 (target)"], reveal.map((r) => r.map(esc))));
  h.push('<div class="hero"><div class="mono small">'
    + `${esc(spaced("projected personal loan pre-approval"))}</div>`
    + `<div class="amount">${esc(usd(c.preapproval_after))}</div></div>`);

  // 07 transformation
  //
  // The Python heading reads "Before &amp; After Transformation Table" and is
  // then passed through esc(), so it prints the literal "&amp;". The designed
  // PDF at docs/workflows/gold-deliverables-v5/optimization_roadmap.pdf:541
  // reads "Before & After Transformation Table". The designed output wins.
  h.push(PB);
  h.push(section("07", "transformation", "Before & After Transformation Table"));
  h.push(table(["category", "before", "after (month 6)"], [
    ["Median Score", med, "680-710"],
    ["Experian Score", c.scores?.experian ?? "", "690+"],
    ["Equifax Score", c.scores?.equifax ?? "", "670+"],
    ["TransUnion Score", c.scores?.transunion ?? "", "725+"],
    ["Overall Utilization", c.util_pct, "Under 10%"],
    ["Negative items", negatives.length, 0],
    ["Experian Negatives", exC, 0],
    ["Equifax Negatives", eqC, "reduced"],
    ["Identity mismatches", personal.length, 0],
    ["Personal Pre-Approval", usd(c.preapproval_now), usd(c.preapproval_after)],
    ["Business Pre-Approval", "$0", "$5K-$20K (LLC dependent)"],
    ["Lenders Available", 0, `10-${(c.lenders || []).length} unlocked`],
    ["LLC Formed", "No", "Yes (4-6 months old)"],
    ["Business Credit Profile", "None", "Active (Paydex building)"]
  ].map((r) => r.map(esc))));

  // 08 checklist
  h.push(PB);
  h.push(section("08", "checklist", "Your 6-Month Checklist"));
  const month1 = fastestWins(c);
  if (negatives.length) month1.push("Send Round 1 dispute letters for items on this file");
  month1.push("Send inquiry removal letters for duplicate pulls");
  month1.push(c.state ? `File LLC in ${c.state}` : "File LLC");
  month1.push("Open business checking account");
  month1.push("Apply for personal loan pre-approval NOW");
  const month2 = ["Check dispute results (30-45 days after sending)",
    "Document every deletion and every verification"];
  if (hero) month2.push(`Keep ${hero[0]} balance low`);
  const month4 = ["Send Round 3 letters + CFPB complaints for stubborn items"];
  if (charge) month4.push(`Negotiate pay-for-delete with ${charge.creditor} if still showing`);
  const checklist = [
    ["Month 1", month1],
    ["Month 2", month2],
    ["Month 3", ["Send Round 2 escalation letters for any verified items",
      "Pull updated scores and compare to Month 1"]],
    ["Month 4", month4],
    ["Month 5", ["Get EIN from IRS.gov",
      "Register with Dun & Bradstreet for DUNS number",
      "Open net-30 vendor accounts",
      "Pull scores and check milestone progress"]],
    ["Month 6", ["Pull fresh tri-merge report",
      "Compare to Month 1 baseline",
      "Submit for updated pre-approval",
      "Apply for business funding if LLC is 6+ months old"]]
  ];
  for (const [m, items] of checklist) {
    h.push(`<h3>${esc(m)}</h3>`
      + items.map((i) => `<div class="check">${esc(i)}</div>`).join(""));
  }

  // 09 call to action
  h.push(PB);
  h.push(section("09", "call to action", "Your Call to Action"));
  h.push(`<p>${esc(first)}, the two things holding you back right now are maxed out credit
      cards - fixable with a paydown plan - and a handful of old negatives - fixable with dispute
      letters. Neither one is permanent. Both are on the repair list starting Month 1.</p>
      <p>Book your strategy call at ${esc(c.booking_url)}.</p>`);
  h.push('<p class="small">This roadmap was prepared by your FundHub advisor based on your '
    + "current credit profile. Projected scores and pre-approval amounts are estimates "
    + "based on historical outcomes. Individual results may vary.</p>");
  h.push(ctaPage(c));
  return h.join("");
}

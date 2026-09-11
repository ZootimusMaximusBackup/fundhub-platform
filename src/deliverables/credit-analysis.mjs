// DOCUMENT 1 — Financial Profile Assessment (credit analysis report).
// Ported from scripts/black-reports/fundhub_gen.py:811-1094. Eight numbered
// sections: bureaus, scores, utilization, au accounts, negatives, inquiries,
// personal data, bottom line.

import { esc } from "./escape.mjs";
import { usd, median, spaced, parsePct } from "./format.mjs";
import { rankedRevolving, targetBal, targetText, paydownAmt, paydownSentence, bureauStatus,
  heroCard, utilTotalsKnown, accountFactSentences, payDownCardsLine } from "./derive.mjs";
import { cover, ctaPage, section, table, utilBar, PB } from "./chrome.mjs";
import { svgTwoTrack, svgPaydownBars, svgSeverity } from "./charts.mjs";

const BUREAU_LABEL = Object.freeze({
  experian: "Experian",
  equifax: "Equifax",
  transunion: "TransUnion"
});

function firstName(client) {
  const raw = String(client?.applicant || "").trim() || "Client";
  return raw.split(/\s+/)[0];
}

/**
 * What "full repair" means ON THIS FILE. The literal it replaces read
 * "charge-offs removed, lates addressed, utilization under 10%" for every
 * client, including files carrying no charge-off and no late at all.
 */
function fullRepairMeans(client) {
  const c = client || {};
  const bits = [];
  const kinds = (c.negatives || []).map((n) => String(n.type || "").toLowerCase());
  if (kinds.some((k) => k.includes("charge"))) bits.push("charge-offs removed");
  if (kinds.some((k) => k.includes("late"))) bits.push("lates addressed");
  if (kinds.length && !bits.length) bits.push("the negative items on this file addressed");
  if (utilTotalsKnown(c)) bits.push("utilization under 10%");
  return bits.join(", ");
}

/** Bureau keys ordered lowest score first, the way the Python ranks them. */
function rankedScoreKeys(scores) {
  return Object.entries(scores || {})
    .filter(([, v]) => Number.isFinite(Number(v)))
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map(([k]) => k);
}

export function buildCreditAnalysis(client) {
  const c = client || {};
  const s = c.scores || {};
  const scoreVals = Object.values(s).map(Number).filter(Number.isFinite);
  const med = median(s);
  const spread = scoreVals.length ? Math.max(...scoreVals) - Math.min(...scoreVals) : "";
  const h = [cover(c, "credit analysis report", "Financial Profile Assessment")];

  // Shared with the roadmap's opening paragraph — one derivation, not two.
  const haveTxt = accountFactSentences(c).join(" ") || "You have real credit activity.";
  const first = esc(firstName(c));
  h.push(`<p>${first}, let me be straight with you. ${esc(haveTxt)}
    This report breaks down exactly what is on this file: scores, cards, and what to do next.
    You qualify for funding today based on the numbers in this pack.</p>`);
  h.push("<p><b>Your plan runs on two tracks at the same time.</b></p>");
  h.push(svgTwoTrack(usd(c.preapproval_now), usd(c.preapproval_after)));
  h.push('<p><b>You do not wait for repair to finish before you get money. Both tracks run '
    + 'at the same time.</b><br><span style="font-size:9pt">Each dispute round makes the '
    + "next application round stronger.</span></p>");
  h.push(`<div class="note">YOUR OUTCOME: ${esc(String(c.outcome || "").toLowerCase())} · BOTH TRACKS ARE `
    + "ALREADY IN THIS PLAN</div>");

  // 01 bureaus
  h.push(section("01", "bureaus", "Bureau Health Summary"));
  const bureauRows = (c.bureaus || []).map(([name, status, neg, note]) => {
    const cls = status === "DIRTY" ? "tag solid" : "tag";
    return [esc(name), `<span class="${cls}">${esc(status)}</span>`, esc(neg), esc(note)];
  });
  h.push(table(["bureau", "status", "negative items", "notes"], bureauRows));
  const [exStatus, exCount] = bureauStatus(c, "Experian");
  if (exStatus === "DIRTY") {
    h.push('<div class="callout bar">Experian is the primary bureau lenders pull first. '
      + `It has ${esc(exCount)} negative item${exCount !== 1 ? "s" : ""} sitting on it `
      + "right now. That is job one for repair.</div>");
  } else {
    h.push('<div class="callout bar">Experian is the primary bureau lenders pull first. '
      + "On this file it is clean.</div>");
  }

  // 02 scores
  h.push(section("02", "scores", "Score Breakdown by Bureau"));
  h.push("<p><b>You do not have one credit score. You have three.</b></p>");
  const ranked = rankedScoreKeys(s);
  const lowK = ranked[0];
  const midK = ranked.length === 3 ? ranked[1] : undefined;
  const scoreSub = (label) => {
    const [st, cnt] = bureauStatus(c, label);
    if (st === "CLEAN" || cnt === 0) return "Nothing negative on it";
    return `${cnt} negative item${cnt !== 1 ? "s" : ""}`;
  };
  const scoreTag = (key) => {
    if (key === midK) return "YOUR MIDDLE SCORE";
    if (key === lowK) return "LOWEST";
    return "HIGHEST";
  };
  const scoreBox = (key) => {
    const label = BUREAU_LABEL[key];
    return `<div class="scorebox${midK === key ? " hl" : ""}"><div class="sl">${esc(spaced(label))}</div>`
      + `<div class="sn">${esc(s[key] ?? "")}</div>\n    `
      + `<div class="ss">${esc(scoreSub(label))}</div><div class="sb">${esc(scoreTag(key))}</div></div>`;
  };
  h.push(`
<div class="midlabel">LENDERS PICK THE MIDDLE SCORE</div>
<div class="midarrow">&#8595;</div>
<div class="cards" style="margin-top:0">
  ${scoreBox("experian")}
  ${scoreBox("equifax")}
  ${scoreBox("transunion")}
</div>
<p><b>Line them up from lowest to highest. Lenders use the middle one. Yours is ${esc(med)}.</b><br>
<span style="font-size:9pt">They do not match because not every company reports to all three
bureaus. Your best and worst are ${esc(spread)} points apart. Closing that gap is the job.</span></p>
<div class="note">SCORES FROM YOUR TRI-MERGE REPORT · DETAILS IN THE CARDS BELOW</div>`);

  const cardCopy = (label) => {
    const [st, cnt, note] = bureauStatus(c, label);
    if (st === "CLEAN" || cnt === 0) return ["STRONG", "Your cleanest bureau on this file."];
    return ["NEEDS WORK", note || `${cnt} negative item${cnt !== 1 ? "s" : ""} on this bureau.`];
  };
  const [tuTag, tuBody] = cardCopy("TransUnion");
  const [eqTag, eqBody] = cardCopy("Equifax");
  const [exTag, exBody] = cardCopy("Experian");
  const cards = [
    ["transunion", s.transunion ?? "", tuTag, tuBody],
    ["equifax", s.equifax ?? "", eqTag, eqBody],
    ["experian", s.experian ?? "", exTag, exBody],
    ["median score", med, "MIDDLE SCORE LENDERS USE",
      "This is the number most lenders read. Your other two scores sit around it."]
  ];
  h.push('<div class="cards">' + cards.map(([k, v, t, b]) =>
    `<div class="card"><div class="lbl">${esc(spaced(k))}</div><div class="big">${esc(v)}</div>`
    + `<div class="sub">${esc(spaced(t))}</div><div class="body">${esc(b)}</div></div>`).join("")
    + "</div>");
  if (scoreVals.length) {
    const best = ranked[ranked.length - 1];
    const worst = ranked[0];
    const titleCase = (k) => BUREAU_LABEL[k] || k;
    h.push(`<div class="callout bar">There is a ${esc(spread)}-point spread between your best bureau `
      + `(${esc(titleCase(best))} ${esc(s[best])}) and your worst `
      + `(${esc(titleCase(worst))} ${esc(s[worst])}). Close that gap and your funding `
      + "picture changes dramatically.</div>");
  }

  // 03 utilization
  h.push(PB);
  h.push(section("03", "utilization", "Primary Revolving Cards - Utilization Analysis"));
  const revRows = (c.revolving || []).map(([cr, br, bal, lim, util, tgt, st]) => {
    const cls = st === "CRITICAL" ? "tag solid" : (st === "HIGH" ? "tag grey" : "tag open");
    // util and tgt are the empty string when no limit is reported. A dash says
    // "we do not know"; a blank cell says "nothing to do here".
    return [esc(cr), esc(br), esc(usd(bal)), esc(usd(lim)), esc(util || "-"), esc(tgt || "-"),
      `<span class="${cls}">${esc(st)}</span>`];
  });
  h.push(table(["creditor", "bureau", "balance", "limit", "utilization",
    "target balance", "status"], revRows));
  const hero = heroCard(c);
  if (hero) {
    const hTgt = targetBal(hero);
    const hPay = paydownAmt(hero);
    h.push(`<p><b>Your ${esc(hero[0])} card holds ${esc(usd(hero[3]))}. Right now it is `
      + `${esc(hero[4] || "unknown")} full.</b></p>`);
    h.push(svgPaydownBars(usd(hero[2]), hPay !== null ? usd(hPay) : "-", usd(hTgt)));
    h.push("<p><b>A high balance on a revolving card is what lenders read first.</b><br>"
      + "<span style='font-size:9pt'>Get it under the dotted line and your score jumps. "
      + "Your pre-approval jumps with it.</span></p>");
    h.push(`<div class="note">YOUR NUMBERS FROM THE TABLE ABOVE · ${esc(String(hero[0]).toUpperCase())} `
      + `ON ${esc(String(hero[1] || "").toUpperCase())}</div>`);
    for (const row of rankedRevolving(c).slice(0, 2)) {
      const pct = parsePct(row[4]);
      if (pct === null) continue;
      const tgt = targetText(row);
      // F52. No target, no bar. The bar's whole caption is "pay down to <x>".
      if (tgt === null) continue;
      h.push(utilBar(row[0], `${usd(row[2])} of ${usd(row[3])} · pay down to ${tgt}`, pct));
    }
  }
  /* F52. An overall bar needs an overall percentage AND an overall target. On a
     file whose cards report no limit the engine gives neither, and drawing the
     bar anyway put it at 0% next to "pay down to under $0". */
  const overallPct = parsePct(c.util_pct);
  if (overallPct !== null && utilTotalsKnown(c)) {
    h.push(utilBar("Overall revolving",
      `${usd(c.util_total_balance)} of ${usd(c.util_total_limit)} · `
      + `pay down to under ${usd(c.util_target_balance)}`, overallPct));
  }
  h.push(`<div class="note">${esc(spaced("dashed line marks the 10% utilization threshold lenders look for"))}</div>`);
  if (hero && utilTotalsKnown(c) && c.util_pct) {
    // heroCard() only returns a card with a known target, so this never ends the
    // sentence at "Get that card to ."
    h.push(`<p>Right now you are using ${esc(c.util_pct)} of your available revolving credit -
      ${esc(usd(c.util_total_balance))} in balances against ${esc(usd(c.util_total_limit))} in limits.
      ${esc(hero[0])} is the highest-utilization card at ${esc(hero[4])}. Get that card to
      ${esc(targetText(hero))}. This is the fastest win on your
      entire report.</p>`);
  }
  if (utilTotalsKnown(c) && c.util_pct) {
    h.push('<div class="callout bar">TARGET: Get total revolving balances from '
      + `${esc(usd(c.util_total_balance))} down to under ${esc(usd(c.util_target_balance))}. `
      + `That moves you from ${esc(c.util_pct)} utilization to under 10%. That one move alone `
      + "can add 40-80 points to your score.</div>");
  }

  // 04 AU
  const au = c.au_account || {};
  h.push(section("04", "au accounts", "Authorized User (AU) Accounts"));
  /* F53. "But this one is not hurting you either. Leave it alone." was printed
     under an EMPTY table for every client with no authorized-user account. No
     AU row, no sentence about an AU row. */
  if (au.creditor) {
    h.push(table(["creditor", "bureau", "limit", "balance", "utilization", "age", "impact"],
      [[esc(au.creditor), esc(au.bureau), esc(usd(au.limit)), esc(usd(au.balance)),
        esc(au.util), esc(au.age), '<span class="tag open">NEUTRAL</span>']]));
    h.push("<p>AU accounts cannot help you get funded - lenders do not count them in funding "
      + "decisions. But this one is not hurting you either. Leave it alone.</p>");
  } else {
    h.push("<p>No authorized user accounts are listed on this file.</p>");
  }

  // 05 negatives
  h.push(PB);
  h.push(section("05", "negatives", "Negative Items - One by One"));
  const negatives = c.negatives || [];
  h.push(table(["#", "creditor", "bureau", "type", "balance", "why it matters"],
    negatives.map((n) => [esc(n.n), esc(n.creditor), esc(n.bureau), esc(n.type),
      esc(n.balance), esc(n.why)])));
  if (negatives.length) {
    h.push(`<p><b>Your ${esc(negatives.length)} negative item`
      + `${negatives.length !== 1 ? "s are" : " is"} not equally bad.</b></p>`);
    const sev = [...negatives].reverse()
      .map((n) => [n.n, String(n.creditor || "").slice(0, 22), n.type || "on file"]);
    if (sev.length >= 2) h.push(svgSeverity(sev));
    const firstNeg = negatives[0];
    h.push(`<p><b>Start with ${esc(firstNeg.creditor)} on ${esc(firstNeg.bureau)}.</b></p>`);
    h.push('<div class="note">DOT NUMBERS MATCH THE TABLE ABOVE · ORDER FOLLOWS THIS REPORT</div>');
    for (const n of negatives) {
      const detail = n.detail || n.why || "This item is on the file. Dispute it first.";
      h.push(`<h3>ITEM ${esc(n.n)} - ${esc(n.creditor)} - ${esc(n.type)} - `
        + `${esc(n.balance)} - ${esc(n.bureau)}</h3><p>${esc(detail)}</p>`);
    }
  } else {
    h.push("<p><b>No derogatory items are listed on this file.</b></p>");
  }

  // 06 inquiries
  h.push(PB);
  h.push(section("06", "inquiries", "Inquiries - Cleanup Only. Zero Impact on Funding."));
  h.push("<p><b>IMPORTANT:</b> Inquiries do NOT affect your ability to get funded through "
    + "FundHub. This section is cleanup only.</p>");
  const inquiries = c.inquiries || [];
  h.push(table(["bureau", "total inquiries", "priority for removal", "notes"],
    inquiries.map(([b, t, p, nt]) =>
      [esc(b), esc(t), `<span class="tag open">${esc(p)}</span>`, esc(nt)])));
  const totalInq = inquiries.reduce((sum, i) => sum + (Number(i[1]) || 0), 0);
  h.push(`<p>You have ${esc(totalInq)} total hard inquiries across the bureaus. Same-day clusters `
    + "are the easiest to dispute because creditors often cannot individually verify each "
    + "pull. Do not apply for new credit until your funding is secured.</p>");

  // 07 personal data
  h.push(section("07", "personal data", "Personal Data Cleanup"));
  const personal = c.personal_data || [];
  h.push(table(["item", "issue", "action required", "priority"],
    personal.map(([i, iss, act, pr]) =>
      [esc(i), esc(iss), esc(act),
        `<span class="tag ${pr === "HIGH" ? "solid" : "grey"}">${esc(pr)}</span>`])));
  const highPd = personal.filter((p) => p[3] === "HIGH");
  if (highPd.length) {
    h.push('<div class="callout bar">URGENT - ' + esc(highPd[0][1])
      + " Clean this up before you apply. Mismatched identity data can flag a file.</div>");
  }

  // 08 bottom line
  const now = Number(c.preapproval_now);
  const after = Number(c.preapproval_after);
  const delta = Number.isFinite(now) && Number.isFinite(after) ? after - now : null;
  h.push(PB);
  h.push(section("08", "bottom line", "The Bottom Line - Where You Are vs. Where You Are Going"));
  h.push('<div class="cards">' + [
    `<div class="card"><div class="lbl">${esc(spaced("current pre-approval"))}</div>`
    + `<div class="big">${esc(usd(c.preapproval_now))}</div>`
    + `<div class="sub">${esc(spaced("personal loan - starter band"))}</div>`
    /* F52. "Your utilization penalty () is cutting your base approval hard" is
       an accusation built on a figure the file does not have. No percentage, no
       penalty sentence. */
    + "<div class=\"body\">This is what you qualify for right now."
    + (c.util_pct
      ? ` Your utilization penalty (${esc(c.util_pct)}) is cutting your base approval hard.`
      : "")
    + "</div></div>",
    `<div class="card"><div class="lbl">${esc(spaced("projected pre-approval"))}</div>`
    + `<div class="big">${esc(usd(c.preapproval_after))}</div>`
    + `<div class="sub">${esc(spaced("after utilization fix"))}</div>`
    /* F53. "your two revolving cards" for a file that shows one, or five. */
    + `<div class="body">${esc(payDownCardsLine(c))} That alone moves your pre-approval.</div></div>`,
    `<div class="card"><div class="lbl">${esc(spaced("the delta"))}</div>`
    + `<div class="big">+${esc(usd(delta))}</div>`
    + `<div class="sub">${esc(spaced("gained by paying down cards"))}</div>`
    + "<div class=\"body\">Additional funding power. Just by moving balances.</div></div>"
  ].join("") + "</div>");

  const topTwo = rankedRevolving(c).slice(0, 2);
  const payBits = topTwo.map(paydownAmt).filter((v) => v !== null).map(usd);
  const payTotal = topTwo.reduce((sum, r) => sum + (paydownAmt(r) || 0), 0);
  h.push(`<p><b>How ${esc(payTotal ? usd(payTotal) : "a targeted paydown")} becomes `
    + `${esc(usd(delta))} more funding.</b></p>`);
  h.push(`
<div class="flowrow">
  <div class="flowbox"><div class="fl">STEP 1</div><div class="ft">Pay down cards</div>
      <div class="fs">${esc(payBits.length ? payBits.join(" + ") : "see table")}</div></div>
  <div class="flowarrow">&#10132;</div>
  <div class="flowbox"><div class="fl">WHAT CHANGES</div><div class="ft">Cards drop under 10%</div>
      <div class="fs">${c.util_pct ? `utilization falls from ${esc(c.util_pct)}` : "utilization falls"}</div></div>
  <div class="flowarrow">&#10132;</div>
  <div class="flowbox"><div class="fl">WHAT LENDERS SEE</div><div class="ft">Score jumps</div>
      <div class="fs">+40 to 80 points</div></div>
  <div class="flowarrow">&#10132;</div>
  <div class="flowbox hl"><div class="fl">WHAT YOU GET</div><div class="ft">Pre-approval jumps</div>
      <div class="fs">${esc(usd(c.preapproval_now))} becomes ${esc(usd(c.preapproval_after))}</div></div>
</div>
<p><b>You are not paying to make the debt disappear. You are paying to change what lenders see.</b></p>
<div class="note">EVERY FIGURE COMES FROM SECTIONS 03 AND 08 OF THIS REPORT</div>`);

  const stages = [
    ["Right Now", "Apply for personal loan funding", "None needed",
      `${usd(c.preapproval_now)} available today`]
  ];
  for (const row of rankedRevolving(c).slice(0, 2)) {
    stages.push([
      "Step 1 - Fast Win",
      // F52. This used to end at "from $5,200 to " for a card with no limit.
      paydownSentence(row),
      "Utilization drop",
      `Pre-approval target ${usd(c.preapproval_after)}`
    ]);
  }
  for (const n of negatives.slice(0, 3)) {
    stages.push([
      "Step 2 - Repair",
      `Dispute ${n.creditor} on ${n.bureau}`,
      n.type || "If removed",
      n.why || "Cleans the file"
    ]);
  }
  if (personal.length) {
    stages.push([
      "Step 3 - Polish",
      "Clean up identity mismatches across bureaus",
      "Prevents denial flags",
      "Removes application friction"
    ]);
  }
  stages.push([
    "After Funding", "Form LLC and build business credit profile", "N/A personal",
    "Unlocks business funding"
  ]);
  h.push(table(["stage", "action", "score impact", "funding impact"],
    stages.map((r) => r.map(esc))));
  // F53. Only the repairs this file actually needs are named as repairs.
  const repairMeans = fullRepairMeans(c);
  h.push(`<p>After full repair${repairMeans ? ` - ${esc(repairMeans)}` : ""} - your Experian score
      moves from ${esc(s.experian ?? "")} toward 700+. At that level you unlock
      premium cards, SBA 7(a) loans, and personal loans up to $40,000+. The gap between where you
      are and where you could be is not years of waiting. It is targeted action on a short list.</p>
      <p>Ready to move? Book your strategy call at ${esc(c.booking_url)}.</p>`);

  h.push(ctaPage(c));
  return h.join("");
}

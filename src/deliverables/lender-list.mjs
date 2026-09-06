// DOCUMENT 3 — Capital Partner Shortlist (bank & lender match list).
// Ported from scripts/black-reports/fundhub_gen.py:1208-1303. Four numbered
// sections: available now, shortlist, application order, at a glance.

import { esc } from "./escape.mjs";
import { usd, median, spaced } from "./format.mjs";
import { targetBal, heroCard } from "./derive.mjs";
import { cover, ctaPage, section, table, PB } from "./chrome.mjs";
import { svgScoreRuler, svgShotgun } from "./charts.mjs";

const CAT_NOTES = Object.freeze({
  "Personal Loans": "(No business required. These are your fastest path.)",
  "Personal Cards": "(No business required.)",
  "Business Cards": "(Requires LLC or corporation first.)",
  "Business Lines of Credit": "(Requires LLC + revenue documentation.)",
  "Business Term Loans": ""
});

function firstName(client) {
  const raw = String(client?.applicant || "").trim() || "Client";
  return raw.split(/\s+/)[0];
}

export function buildLenderList(client) {
  const c = client || {};
  const med = median(c.scores || {});
  const medNum = Number(med);
  const lenders = c.lenders || [];
  const h = [cover(c, "bank & lender match list", "Capital Partner Shortlist")];

  // 01 available now
  h.push(section("01", "available now", "Available Right Now"));
  h.push(`<p><b>${esc(firstName(c))}, here's the honest truth.</b></p>
      <p>Your Experian score sits at ${esc(c.scores?.experian ?? "")}. Your median score is ${esc(med)}. And
      your utilization is at ${esc(c.util_pct)} - that's critical.</p>`);
  h.push('<div class="callout bar">No lenders are matched for immediate funding right now.</div>');
  const hero = heroCard(c);
  if (hero) {
    h.push("<p>But here's the good news. You are not far off. Fix the utilization on "
      + `${esc(hero[0])} and your score moves fast. Weeks, not years.</p>`);
  } else {
    h.push("<p>But here's the good news. You are not far off. Weeks, not years.</p>");
  }

  // the score ladder
  const tiers = new Map();
  for (const [nm, , , , , sc] of lenders) {
    if (!tiers.has(sc)) tiers.set(sc, []);
    tiers.get(sc).push(nm);
  }
  const ladder = [...tiers.keys()].sort((a, b) => Number(a) - Number(b)).map((sc) => {
    const names = tiers.get(sc);
    const gap = Number.isFinite(medNum) ? Number(sc) - medNum : "";
    return [
      `<span class="tag solid mono">${esc(sc)}</span>`,
      `<span class="mono small">+${esc(gap)} PTS</span>`,
      `<b>${esc(names.join(", "))}</b>`,
      esc(names.length)
    ];
  });
  // The ruler plots the median on a fixed 615-712 axis. With no median there is
  // nothing to plot, and a zero would read as a real score.
  if (Number.isFinite(medNum)) h.push(svgScoreRuler(medNum));
  h.push(table(["score", "gap", "lenders that unlock", "count"], ladder, [3]));
  h.push(`<div class="note">${esc(spaced("business products additionally require an llc and time in business"))}</div>`);

  // 02 the shortlist
  h.push(PB);
  h.push(section("02", "shortlist", "After Optimization - Your Shortlist"));
  h.push(`<p>These ${esc(lenders.length)} lenders unlock once you repair the key items. `
    + "Here is who fits you and why.</p>");
  const seen = [];
  for (const [nm, cat, typ, lo, hi, sc, tib, rev, why] of lenders) {
    if (!seen.includes(cat)) {
      seen.push(cat);
      h.push(`<h3>${esc(cat)}</h3><p class="small">${esc(CAT_NOTES[cat] || "")}</p>`);
    }
    const kvs = [["type", typ], ["range", `${usd(lo)} - ${usd(hi)}`], ["score needed", sc]];
    if (tib) kvs.push(["time in business", tib]);
    if (rev) kvs.push(["revenue", rev]);
    const gap = Number.isFinite(medNum) ? Number(sc) - medNum : null;
    if (gap !== null && gap > 0) {
      kvs.push(["you need", `${gap} more points on your median score`]);
    }
    const kvHtml = kvs.map(([k, v]) =>
      `<div class="kv"><span class="k">${esc(spaced(k))}</span>`
      + `<span>${esc(v)}</span></div>`).join("");
    h.push(`<div class="lender"><div class="nm">${esc(nm)}</div>${kvHtml}`
      + `<div class="why">${esc(nm)} fits you because ${esc(why)}.</div></div>`);
  }

  // 03 application order
  h.push(PB);
  h.push(section("03", "application order", "Application Order Warning"));
  h.push("<p>Applying to the wrong lender first can burn hard inquiries AND trigger automatic "
    + "declines that follow you to the next application.</p>");
  h.push("<p><b>The order protects your score. Follow it exactly.</b></p>");
  let utilLine = "PAY DOWN THE HIGHEST CARD FIRST";
  if (hero) {
    const tgt = targetBal(hero);
    utilLine = `PAY ${String(hero[0]).toUpperCase()} DOWN TO ${tgt !== null ? usd(tgt) : hero[5]}`;
  }
  const order = [
    ["Fix utilization first", utilLine],
    ["Lowest score floor first", "START WITH THE LOWEST SCORE FLOOR ON THIS LIST"],
    ["One at a time", "WAIT FOR THE DECISION"],
    ["Work up the list", "HIGHER-FLOOR LENDERS ONLY AFTER THE SCORE MOVES"],
    ["Personal before business", "LOCK PERSONAL · THEN FORM THE LLC"]
  ];
  const stepsHtml = '<div class="steps">' + order.map(([t, d], i) =>
    `<div class="step"><div class="n">${i + 1}</div><div><div class="t">${esc(t)}</div>`
    + `<div class="d">${esc(d)}</div></div></div>`).join("") + "</div>";
  h.push(`<div class="side"><div class="grow">${stepsHtml}</div>`
    + `<div style="width:200px">${svgShotgun()}</div></div>`);
  h.push("<p><b>The same five applications in the wrong order get declined. The wrong order "
    + "costs you money and time.</b></p>");

  // 04 at a glance
  h.push(section("04", "at a glance", "Your Numbers at a Glance"));
  h.push(table(["", "today", "after optimization"], [
    ["Median Score", med, "680-700 projected"],
    ["Utilization", c.util_pct, "Under 10% target"],
    ["Personal Loan Pre-Approval", usd(c.preapproval_now), usd(c.preapproval_after)],
    ["Lenders Available", 0, lenders.length]
  ].map((r) => r.map(esc))));
  h.push(ctaPage(c));
  return h.join("");
}

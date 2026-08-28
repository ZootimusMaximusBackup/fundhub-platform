// Live printer for the four black reports. pdf-lib — same stack letters use
// on Netlify. No Python. No Claude. No API.
// COMPLIANCE REVIEW REQUIRED — credit-repair / projected-score adjacent.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { FUNDING_ANALYSIS_FILENAMES } from "./letter-pack-filter.mjs";

const W = 612;
const H = 792;
const M = 50;
const CONTENT = W - M * 2;

const INK = rgb(0.07, 0.07, 0.07);
const WHITE = rgb(1, 1, 1);
const BLACK = rgb(0.047, 0.047, 0.047);
const MUTED = rgb(0.45, 0.45, 0.45);
const LINE = rgb(0.88, 0.88, 0.88);
const RULE = [
  rgb(0.48, 0.36, 1),
  rgb(0.23, 0.63, 1),
  rgb(0.18, 0.84, 0.76),
  rgb(0.48, 0.83, 0.29),
  rgb(0.96, 0.77, 0.26),
  rgb(1, 0.48, 0.27)
];

function clean(s) {
  return String(s ?? "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[—–]/g, "-")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, " ");
}

function usd(v) {
  if (v == null || v === "") return "-";
  if (typeof v === "string" && v.startsWith("$")) return v;
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function moneyRange(lo, hi) {
  const k = (v) => (v % 1000 === 0 ? `$${v / 1000}K` : usd(v));
  if (lo == null || hi == null) return "-";
  return `${k(lo)}-${k(hi)}`;
}

function median(scores) {
  const vals = Object.values(scores || {}).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!vals.length) return "";
  return vals[Math.floor(vals.length / 2)];
}

function wrap(text, font, size, maxW) {
  const words = clean(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const trial = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(trial, size) <= maxW) line = trial;
    else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

class Report {
  constructor(pdf, fonts, footer) {
    this.pdf = pdf;
    this.font = fonts.reg;
    this.bold = fonts.bold;
    this.footer = footer;
    this.pages = [];
    this.page = null;
    this.y = 0;
  }

  addPage(cover = false) {
    this.page = this.pdf.addPage([W, H]);
    this.pages.push({ page: this.page, cover });
    this.y = H - M;
    if (!cover) this.page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: WHITE });
    return this.page;
  }

  need(h) {
    if (this.y - h < M + 28) this.addPage(false);
  }

  rainbow(x, y, w, h = 3) {
    const slice = w / RULE.length;
    RULE.forEach((color, i) => {
      this.page.drawRectangle({ x: x + i * slice, y, width: slice + 0.4, height: h, color });
    });
  }

  text(str, { x = M, size = 10, bold = false, color = INK, max = CONTENT } = {}) {
    const font = bold ? this.bold : this.font;
    const lines = wrap(str, font, size, max);
    for (const line of lines) {
      this.need(size + 4);
      this.page.drawText(line, { x, y: this.y - size, size, font, color });
      this.y -= size + 3;
    }
  }

  gap(n = 8) {
    this.y -= n;
  }

  eyebrow(label) {
    this.gap(10);
    this.text(clean(label).toUpperCase(), { size: 7, color: MUTED });
  }

  heading(title) {
    this.text(title, { size: 15, bold: true });
    this.gap(2);
    this.rainbow(M, this.y, 160, 3);
    this.y -= 12;
  }

  para(str) {
    this.text(str, { size: 10 });
    this.gap(6);
  }

  callout(str) {
    const font = this.font;
    const lines = wrap(str, font, 9, CONTENT - 24);
    const boxH = lines.length * 12 + 16;
    this.need(boxH);
    this.page.drawRectangle({
      x: M, y: this.y - boxH, width: CONTENT, height: boxH,
      color: rgb(0.96, 0.96, 0.96)
    });
    this.page.drawRectangle({
      x: M, y: this.y - boxH, width: 3, height: boxH, color: INK
    });
    let y = this.y - 14;
    for (const line of lines) {
      this.page.drawText(line, { x: M + 12, y, size: 9, font, color: INK });
      y -= 12;
    }
    this.y -= boxH + 10;
  }

  table(headers, rows) {
    if (!headers?.length) return;
    const cols = headers.length;
    const widths = headers.map(() => CONTENT / cols);
    const drawRow = (cells, header) => {
      const font = header ? this.bold : this.font;
      const size = header ? 7 : 8;
      const wrapped = cells.map((c, i) => wrap(c, font, size, widths[i] - 8));
      const linesN = Math.max(1, ...wrapped.map((w) => w.length));
      const rowH = linesN * 11 + (header ? 10 : 8);
      this.need(rowH + 2);
      if (header) {
        this.page.drawLine({
          start: { x: M, y: this.y },
          end: { x: M + CONTENT, y: this.y },
          thickness: 1.2,
          color: INK
        });
      }
      let x = M;
      for (let i = 0; i < cols; i++) {
        let ty = this.y - 12;
        for (const line of wrapped[i]) {
          this.page.drawText(line, { x: x + 2, y: ty, size, font, color: header ? MUTED : INK });
          ty -= 11;
        }
        x += widths[i];
      }
      this.y -= rowH;
      this.page.drawLine({
        start: { x: M, y: this.y },
        end: { x: M + CONTENT, y: this.y },
        thickness: 0.4,
        color: LINE
      });
    };
    drawRow(headers.map((h) => clean(h).toUpperCase()), true);
    for (const row of rows || []) drawRow(row.map((c) => clean(c)), false);
    this.gap(10);
  }

  cards(items) {
    const n = items.length || 1;
    const gap = 8;
    const w = (CONTENT - gap * (n - 1)) / n;
    const h = 88;
    this.need(h + 8);
    items.forEach((item, i) => {
      const x = M + i * (w + gap);
      this.page.drawRectangle({
        x, y: this.y - h, width: w, height: h,
        borderColor: LINE, borderWidth: 1, color: WHITE
      });
      this.page.drawRectangle({ x, y: this.y - 3, width: w, height: 3, color: INK });
      this.page.drawText(clean(item.lbl).toUpperCase(), {
        x: x + 8, y: this.y - 16, size: 6, font: this.font, color: MUTED
      });
      this.page.drawText(clean(String(item.big)), {
        x: x + 8, y: this.y - 40, size: 16, font: this.bold, color: INK
      });
      const body = wrap(item.body || "", this.font, 7, w - 16);
      let by = this.y - 56;
      for (const line of body.slice(0, 3)) {
        this.page.drawText(line, { x: x + 8, y: by, size: 7, font: this.font, color: MUTED });
        by -= 9;
      }
    });
    this.y -= h + 12;
  }

  cover({ doctype, title, applicant, date, outcome, med }) {
    this.addPage(true);
    this.page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: BLACK });
    this.page.drawText("fundhub.", { x: 48, y: H - 64, size: 16, font: this.bold, color: WHITE });
    this.page.drawText("UNDERWRITE IQ / CLIENT DELIVERABLE", {
      x: 130, y: H - 60, size: 7, font: this.font, color: rgb(0.49, 0.49, 0.49)
    });
    this.page.drawText(clean(doctype).toUpperCase(), {
      x: 48, y: H - 280, size: 8, font: this.font, color: rgb(0.49, 0.49, 0.49)
    });
    this.rainbow(48, H - 292, 130, 3);
    const titleLines = wrap(title, this.bold, 28, 420);
    let ty = H - 330;
    for (const line of titleLines) {
      this.page.drawText(line, { x: 48, y: ty, size: 28, font: this.bold, color: WHITE });
      ty -= 32;
    }
    this.page.drawLine({
      start: { x: 48, y: 200 },
      end: { x: W - 48, y: 200 },
      thickness: 1,
      color: rgb(0.23, 0.23, 0.23)
    });
    const metas = [
      ["APPLICANT", applicant || "Client"],
      ["DATE", date || ""],
      ["OUTCOME", outcome || ""],
      ["MEDIAN SCORE", String(med ?? "")]
    ];
    metas.forEach(([k, v], i) => {
      const x = 48 + i * 130;
      this.page.drawText(k, { x, y: 176, size: 6, font: this.font, color: rgb(0.49, 0.49, 0.49) });
      this.page.drawText(clean(v).slice(0, 28), { x, y: 158, size: 10, font: this.font, color: WHITE });
    });
    this.page.drawText("DIAGNOSTIC COMPLETE  UNDERWRITEIQ", {
      x: 48, y: 48, size: 7, font: this.font, color: rgb(0.49, 0.49, 0.49)
    });
    this.page.drawText("FUNDHUB CONFIDENTIAL", {
      x: W - 180, y: 48, size: 7, font: this.font, color: rgb(0.49, 0.49, 0.49)
    });
  }

  cta(c) {
    this.addPage(true);
    this.page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: BLACK });
    this.page.drawText("fundhub.", { x: 48, y: H - 64, size: 16, font: this.bold, color: WHITE });
    this.page.drawText("Let Us Build Your Game Plan Together", {
      x: 48, y: H - 280, size: 20, font: this.bold, color: WHITE
    });
    this.rainbow(48, H - 292, 130, 3);
    const url = c.booking_url || "fundhub.ai";
    this.page.drawText(clean(url), { x: 48, y: H - 340, size: 12, font: this.font, color: WHITE });
    this.page.drawText("Or copy this link into your browser", {
      x: 48, y: H - 360, size: 9, font: this.font, color: rgb(0.55, 0.55, 0.55)
    });
  }

  finish() {
    const body = this.pages.filter((p) => !p.cover);
    body.forEach((p, i) => {
      const label = `${this.footer}  ${i + 1} / ${body.length}`;
      p.page.drawText("fundhub.  confidential", {
        x: M, y: 28, size: 7, font: this.font, color: MUTED
      });
      p.page.drawText(label, {
        x: W - M - this.font.widthOfTextAtSize(label, 7),
        y: 28, size: 7, font: this.font, color: MUTED
      });
    });
  }
}

async function makeDoc(footer) {
  const pdf = await PDFDocument.create();
  const fonts = {
    reg: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold)
  };
  return { pdf, report: new Report(pdf, fonts, footer) };
}

function firstName(c) {
  return clean((c.applicant || "Client").split(/\s+/)[0]);
}

function analysis(c, r) {
  const s = c.scores || {};
  const med = median(s);
  r.cover({
    doctype: "credit analysis report",
    title: "Financial Profile Assessment",
    applicant: c.applicant, date: c.date, outcome: c.outcome, med
  });
  r.addPage(false);
  r.para(`${firstName(c)}, this report is built from your UnderwriteIQ file. Scores, cards, and lenders below are this file — not a sample person.`);
  r.eyebrow("01 / BUREAUS");
  r.heading("Bureau Health Summary");
  r.table(["bureau", "status", "negative items", "notes"], (c.bureaus || []).map((row) => row.map(String)));
  r.eyebrow("02 / SCORES");
  r.heading("Score Breakdown by Bureau");
  r.para("You do not have one credit score. You have three. Lenders pick the middle one.");
  r.cards([
    { lbl: "Experian", big: s.experian ?? "-", body: "Bureau score on file" },
    { lbl: "Equifax", big: s.equifax ?? "-", body: "Middle score when sorted" },
    { lbl: "TransUnion", big: s.transunion ?? "-", body: "Bureau score on file" },
    { lbl: "Median", big: med || "-", body: "The number most lenders read" }
  ]);
  r.eyebrow("03 / UTILIZATION");
  r.heading("Primary Revolving Cards");
  r.table(
    ["creditor", "bureau", "balance", "limit", "util", "target", "status"],
    (c.revolving || []).map((row) => [
      row[0], row[1], usd(row[2]), usd(row[3]), row[4], row[5], row[6]
    ])
  );
  if (c.util_pct) {
    r.callout(`Overall revolving utilization is ${c.util_pct}. Target: get balances to ${usd(c.util_target_balance)} or under 10%.`);
  }
  r.eyebrow("04 / NEGATIVES");
  r.heading("Negative Items");
  if (!(c.negatives || []).length) {
    r.para("No derogatory items are listed on this file.");
  } else {
    r.table(
      ["#", "creditor", "bureau", "type", "balance"],
      c.negatives.map((n) => [n.n, n.creditor, n.bureau, n.type, n.balance])
    );
  }
  r.eyebrow("05 / INQUIRIES");
  r.heading("Inquiries — cleanup only");
  r.para("Inquiries do not affect funding decisions at FundHub.");
  r.table(
    ["bureau", "total", "priority", "notes"],
    (c.inquiries || []).map((row) => row.map(String))
  );
  r.eyebrow("06 / BOTTOM LINE");
  r.heading("Where you are vs where you are going");
  r.cards([
    { lbl: "current pre-approval", big: usd(c.preapproval_now), body: "What this file qualifies for today" },
    { lbl: "projected", big: usd(c.preapproval_after), body: "After utilization work on this file" },
    { lbl: "delta", big: usd((c.preapproval_after || 0) - (c.preapproval_now || 0)), body: "The gap on this file" }
  ]);
  r.cta(c);
}

function snapshot(c, r) {
  const s = c.scores || {};
  r.cover({
    doctype: "funding snapshot",
    title: "Capital Readiness Snapshot",
    applicant: c.applicant, date: c.date, outcome: c.outcome, med: median(s)
  });
  r.addPage(false);
  r.eyebrow("01 / NUMBERS");
  r.heading("Your numbers right now");
  r.table(["", "today", "after optimization"], [
    ["Median score", String(median(s)), c.score_targets?.median || ""],
    ["Experian", String(s.experian ?? ""), c.score_targets?.experian || ""],
    ["Pre-approval", usd(c.preapproval_now), usd(c.preapproval_after)]
  ]);
  r.eyebrow("02 / BREAKDOWN");
  r.heading("Breakdown by category");
  r.para("Personal cards");
  r.table(
    ["account", "status", "balance", "limit", "utilization"],
    (c.revolving || []).map((row) => [row[0], row[6], usd(row[2]), usd(row[3]), row[4]])
  );
  r.para("Installment loans");
  r.table(["account", "status", "balance", "notes"], c.installments || []);
  r.para("Mortgage / real estate");
  r.table(["account", "status", "balance", "notes"], c.mortgages || []);
  r.eyebrow("03 / NEXT");
  r.heading("Your next step");
  r.para("Do not open new accounts before funding. Lock this file first.");
  (c.revolving || []).slice(0, 3).forEach((row) => {
    r.para(`Pay ${row[0]} from ${usd(row[2])} toward ${row[5] || "under 10%"}.`);
  });
  r.cta(c);
}

function lenders(c, r) {
  const s = c.scores || {};
  const med = median(s);
  r.cover({
    doctype: "bank & lender match list",
    title: "Capital Partner Shortlist",
    applicant: c.applicant, date: c.date, outcome: c.outcome, med
  });
  r.addPage(false);
  r.eyebrow("01 / FILE");
  r.heading("Available right now");
  r.para(`${firstName(c)}, Experian is ${s.experian ?? "-"}. Median is ${med || "-"}. Utilization is ${c.util_pct || "-"}.`);
  r.eyebrow("02 / SHORTLIST");
  r.heading("After optimization — your shortlist");
  r.para(`These ${ (c.lenders || []).length } lenders come from this file's match list.`);
  for (const row of c.lenders || []) {
    const [nm, cat, typ, lo, hi, sc, tib, rev, why] = row;
    r.text(nm, { size: 11, bold: true });
    r.table(["field", "value"], [
      ["type", typ || cat],
      ["range", moneyRange(lo, hi)],
      ["score needed", String(sc ?? "")],
      ["time in business", tib || "-"],
      ["revenue", rev || "-"],
      ["why", why || ""]
    ]);
  }
  r.cta(c);
}

function roadmap(c, r) {
  const s = c.scores || {};
  r.cover({
    doctype: "credit optimization roadmap",
    title: `${firstName(c)}'s 6-Month Business Readiness Roadmap`,
    applicant: c.applicant, date: c.date, outcome: c.outcome, med: median(s)
  });
  r.addPage(false);
  r.eyebrow("01 / PROJECTION");
  r.heading("Your projected pre-approval");
  r.cards([
    { lbl: "today", big: usd(c.preapproval_now), body: "On this file now" },
    { lbl: "month 6", big: usd(c.preapproval_after), body: "After the work on this file" }
  ]);
  r.eyebrow("02 / MONTH 1");
  r.heading("Month 1 — Launch");
  r.table(
    ["account", "balance", "limit", "target"],
    (c.revolving || []).map((row) => [row[0], usd(row[2]), usd(row[3]), row[5]])
  );
  if ((c.negatives || []).length) {
    r.para("Round 1 disputes on this file:");
    c.negatives.forEach((n) => r.para(`${n.n}. ${n.creditor} — ${n.type} — ${n.bureau}`));
  } else {
    r.para("No derogatory items are listed. Month 1 is paydown and LLC setup.");
  }
  r.eyebrow("03 / MONTHS 2-6");
  r.heading("The rest of the plan");
  r.para("Month 2-3: balances report. Dispute results come back.");
  r.para("Month 4: escalate anything still on the file.");
  r.para("Month 5: EIN, DUNS, business checking.");
  r.para("Month 6: fresh tri-merge. Re-check pre-approval.");
  r.eyebrow("04 / CHECKLIST");
  r.heading("Your 6-month checklist");
  (c.revolving || []).slice(0, 3).forEach((row) => {
    r.para(`Month 1 — Pay ${row[0]} toward ${row[5] || "under 10%"}.`);
  });
  r.para("Month 1 — File LLC if this file has no entity.");
  r.para("Month 1 — Apply for the personal loan this file already qualifies for.");
  r.cta(c);
}

const BUILDERS = [
  ["credit_analysis_report.pdf", "credit_analysis", "financial profile assessment", analysis],
  ["funding_snapshot.pdf", "funding_snapshot", "capital readiness snapshot", snapshot],
  ["lender_match_list.pdf", "lender_match", "capital partner shortlist", lenders],
  ["optimization_roadmap.pdf", "roadmap", "business readiness roadmap", roadmap]
];

export async function printBlackReportsNode({ client } = {}) {
  if (!client || typeof client !== "object") {
    return { files: [], skip: "no_client" };
  }
  const files = [];
  for (const [fname, type, footer, build] of BUILDERS) {
    const { pdf, report } = await makeDoc(footer);
    build(client, report);
    report.finish();
    const bytes = Buffer.from(await pdf.save());
    if (bytes.subarray(0, 4).toString() !== "%PDF") continue;
    files.push({
      filename: FUNDING_ANALYSIS_FILENAMES[type] || fname,
      contentType: "application/pdf",
      content: bytes,
      type
    });
  }
  return { files, skip: files.length ? null : "render_empty", engine: "pdf-lib" };
}

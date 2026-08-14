"use strict";

/**
 * Gold report shell — print translation of fundhub_pdf_template.py
 * (dark cover/closing, spectrum hairlines, ink chips/callouts).
 * Letters stay in render-pdf.js and must not pick up this branding.
 */

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { rgb } = require("pdf-lib");
const { APPLY_PAGE_URL, drawQrOnPdfPage } = require("./apply-qr");

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 52;
const CONTENT_W = PAGE_W - MARGIN * 2; // 508, matches fh_charts.py
const BODY_TOP = PAGE_H - 58;
const FOOTER_Y = 28;

const INK = rgb(12 / 255, 12 / 255, 13 / 255); // #0C0C0D
const COVER = rgb(10 / 255, 10 / 255, 10 / 255); // #0A0A0A
const WHITE = rgb(1, 1, 1);
const LABEL = rgb(110 / 255, 110 / 255, 118 / 255); // #6E6E76
const MUTED = rgb(154 / 255, 154 / 255, 161 / 255); // #9A9AA1
const HAIR = rgb(221 / 255, 221 / 255, 225 / 255); // #DDDDE1
const RULE = rgb(231 / 255, 231 / 255, 234 / 255); // #E7E7EA
const CARD_BORDER = rgb(227 / 255, 227 / 255, 231 / 255);
const CALLOUT_BG = rgb(246 / 255, 246 / 255, 248 / 255);
const BODY = rgb(38 / 255, 38 / 255, 42 / 255);
const MID_CHIP = rgb(106 / 255, 106 / 255, 114 / 255);
const COVER_LINE = rgb(38 / 255, 38 / 255, 43 / 255);
const COVER_FOOT = rgb(29 / 255, 29 / 255, 34 / 255);
const QR_DASH = rgb(58 / 255, 58 / 255, 65 / 255);
const CLO_SUB = rgb(169 / 255, 169 / 255, 177 / 255);
const DOT = rgb(52 / 255, 211 / 255, 153 / 255); // #34D399

const SPEC_STOPS = [
  rgb(139 / 255, 92 / 255, 246 / 255),
  rgb(59 / 255, 130 / 255, 246 / 255),
  rgb(34 / 255, 211 / 255, 238 / 255),
  rgb(52 / 255, 211 / 255, 153 / 255),
  rgb(251 / 255, 191 / 255, 36 / 255),
  rgb(249 / 255, 112 / 255, 102 / 255)
];

const CHIP_SOLID = new Set([
  "DIRTY",
  "CRITICAL",
  "URGENT",
  "CHARGE-OFF",
  "CHARGE OFF",
  "60-DAY LATES",
  "120-DAY LATES"
]);
const CHIP_MID = new Set(["HIGH", "MEDIUM"]);
const CHIP_LINE = new Set([
  "CLEAN",
  "MONITOR",
  "CLOSED",
  "NEUTRAL",
  "OPEN",
  "PAID",
  "TRANSFERRED",
  "FULL_FUNDING",
  "FUNDING_PLUS_REPAIR",
  "PREMIUM_STACK",
  "REPAIR_ONLY"
]);

const DOC_TITLES = {
  credit_analysis: "Credit Analysis Report",
  roadmap: "Optimization Roadmap",
  funding_snapshot: "Funding Snapshot",
  lender_match: "Lender Match List",
  funding_summary: "Funding Snapshot",
  repair_plan_summary: "Optimization Plan Summary",
  business_prep_summary: "Business Readiness Guide",
  issue_priority_sheet: "Priority Action Sheet"
};

const COVER_COPY = {
  credit_analysis: {
    tag: "UNDERWRITEIQ REPORT",
    eyebrow: "CREDIT FILE",
    title: "Your Credit Analysis Report"
  },
  roadmap: {
    tag: "UNDERWRITEIQ PLAN",
    eyebrow: "SIX MONTHS",
    title: "Your Optimization Roadmap"
  },
  funding_snapshot: {
    tag: "UNDERWRITEIQ SNAPSHOT",
    eyebrow: "CAPITAL READY",
    title: "Your Funding Snapshot"
  },
  lender_match: {
    tag: "UNDERWRITEIQ SHORTLIST",
    eyebrow: "WHERE TO APPLY",
    title: "Your Lender Match List"
  },
  funding_summary: {
    tag: "UNDERWRITEIQ SNAPSHOT",
    eyebrow: "CAPITAL READY",
    title: "Your Funding Snapshot"
  }
};

const SECTION_MAPS = {
  credit_analysis: [
    { re: /\b(02|scores?)\b/i, code: "02", tag: "SCORES" },
    { re: /\b(03|utili|revolv)\b/i, code: "03", tag: "UTILIZATION" },
    { re: /\b(04|authorized|\bau\b)/i, code: "04", tag: "AU ACCOUNTS" },
    { re: /\b(05|negative|derog)\b/i, code: "05", tag: "NEGATIVES" },
    { re: /\b(06|inquir)\b/i, code: "06", tag: "INQUIRIES" },
    { re: /\b(07|personal|identit)\b/i, code: "07", tag: "PERSONAL DATA" },
    { re: /\b(08|bottom|pre-?approval)\b/i, code: "08", tag: "BOTTOM LINE" },
    { re: /\b(01|bureau|picture|situation|stand|file)\b/i, code: "01", tag: "PICTURE" }
  ],
  roadmap: [
    { re: /\b(01|project|hero|month 6)\b/i, code: "01", tag: "PROJECTION" },
    { re: /\b(02|month 1|launch)\b/i, code: "02", tag: "MONTH 1" },
    { re: /\b(03|months? 2|results)\b/i, code: "03", tag: "MONTHS 2-3" },
    { re: /\b(04|month 4|final push)\b/i, code: "04", tag: "MONTH 4" },
    { re: /\b(05|month 5|business|llc)\b/i, code: "05", tag: "MONTH 5" },
    { re: /\b(06|month 6|re-?pull|reveal)\b/i, code: "06", tag: "MONTH 6" },
    { re: /\b(07|before|after|transform)\b/i, code: "07", tag: "BEFORE / AFTER" }
  ],
  funding_snapshot: [
    { re: /\b(01|numbers|hero|current vs)\b/i, code: "01", tag: "NUMBERS" },
    { re: /\b(02|breakdown|categor)\b/i, code: "02", tag: "BREAKDOWN" },
    { re: /\b(03|costing|modifier)\b/i, code: "03", tag: "COSTING YOU" },
    { re: /\b(04|does not|inquir|au )\b/i, code: "04", tag: "DOES NOT AFFECT" }
  ],
  lender_match: [
    { re: /\b(01|available now|matched now)\b/i, code: "01", tag: "AVAILABLE NOW" },
    { re: /\b(02|after opt|later|unlock)\b/i, code: "02", tag: "AFTER OPTIMIZATION" },
    { re: /\b(03|application order|order)\b/i, code: "03", tag: "APPLICATION ORDER" }
  ]
};

const STAMP_TIERS = new Set([
  "FULL_FUNDING",
  "FUNDING_PLUS_REPAIR",
  "PREMIUM_STACK",
  "REPAIR_ONLY"
]);

function stampedOutcome(engineData, personal) {
  const vals = [];
  if (engineData && typeof engineData === "object") {
    vals.push(engineData.outcome);
    vals.push(engineData.outcome_tier);
    if (engineData.client) vals.push(engineData.client.outcome_tier);
    if (engineData.outcomeResult) vals.push(engineData.outcomeResult.outcome);
  }
  if (personal && typeof personal === "object") {
    vals.push(personal.outcome_tier);
    if (personal.client) vals.push(personal.client.outcome_tier);
  }
  const cleaned = vals.map((v) => String(v || "").trim()).filter(Boolean);
  const tier = cleaned.find((v) => STAMP_TIERS.has(v));
  if (tier) return tier;
  const nonManual = cleaned.find((v) => v !== "MANUAL_REVIEW");
  if (nonManual) return nonManual;
  return cleaned[0] || "";
}

function drawSpectrum(page, x, y, width, height) {
  const slice = width / SPEC_STOPS.length;
  SPEC_STOPS.forEach((color, i) => {
    page.drawRectangle({
      x: x + i * slice,
      y,
      width: slice + 0.4,
      height,
      color
    });
  });
}

function safeText(s) {
  if (typeof s !== "string") return s == null ? "" : String(s);
  return s
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u2022\u25AA\u25CF\u00B7\u2043]/g, "-")
    .replace(/[\u2192\u21D2]/g, "->")
    .replace(/[\u2190\u21D0]/g, "<-")
    .replace(/[^\t\n\r\x20-\x7E]/g, "");
}

function textW(font, text, size) {
  try {
    return font.widthOfTextAtSize(safeText(text), size);
  } catch {
    return String(text || "").length * size * 0.5;
  }
}

function paint(page, text, opts) {
  const t = safeText(text);
  if (!t) return;
  page.drawText(t, opts);
}

function wrap(font, text, size, maxWidth) {
  const words = safeText(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let cur = words[0];
  for (let i = 1; i < words.length; i++) {
    const next = cur + " " + words[i];
    if (textW(font, next, size) <= maxWidth) cur = next;
    else {
      lines.push(cur);
      cur = words[i];
    }
  }
  lines.push(cur);
  return lines;
}

function activePage(ctx) {
  return ctx.currentPage;
}

function ensureSpace(ctx, needed) {
  if (ctx.y - needed < MARGIN + 18) {
    const np = ctx.doc.addPage([PAGE_W, PAGE_H]);
    ctx.pages.push(np);
    ctx.currentPage = np;
    ctx.y = BODY_TOP;
  }
}

/**
 * W4 hook. Paints the apply.fundhub.ai QR when apply-qr.js is present.
 * Never draws the string "[ QR CODE ]".
 */
function DRAW_QR_HERE(page, box) {
  const x = box.x;
  const y = box.y;
  const size = box.size || 128;
  const black = box.black || INK;
  const white = box.white || WHITE;
  if (typeof drawQrOnPdfPage === "function") {
    drawQrOnPdfPage(page, { x, y, size, black, white });
    return;
  }
  page.drawRectangle({
    x,
    y,
    width: size,
    height: size,
    borderColor: QR_DASH,
    borderWidth: 1,
    borderDashArray: [4, 3]
  });
}

function drawCoverPage(page, { type, personal, engineData, fonts }) {
  const copy = COVER_COPY[type] || {
    tag: "UNDERWRITEIQ REPORT",
    eyebrow: "CLIENT REPORT",
    title: DOC_TITLES[type] || "Client Report"
  };
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: COVER });
  drawSpectrum(page, 0, PAGE_H - 3.5, PAGE_W, 3.5);

  paint(page, "fundhub.", {
    x: MARGIN,
    y: PAGE_H - 64,
    size: 19,
    font: fonts.bold,
    color: WHITE
  });
  const tag = copy.tag;
  paint(page, tag, {
    x: PAGE_W - MARGIN - textW(fonts.mono, tag, 7),
    y: PAGE_H - 58,
    size: 7,
    font: fonts.mono,
    color: LABEL
  });

  const titleY = PAGE_H - 280;
  paint(page, copy.eyebrow, {
    x: MARGIN,
    y: titleY + 28,
    size: 8,
    font: fonts.mono,
    color: MUTED
  });
  const titleLines = wrap(fonts.bold, copy.title, 36, 470);
  let ty = titleY;
  for (const line of titleLines) {
    paint(page, line, { x: MARGIN, y: ty, size: 36, font: fonts.bold, color: WHITE });
    ty -= 40;
  }
  drawSpectrum(page, MARGIN, ty - 8, 62, 2.5);

  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
  const outcome = stampedOutcome(engineData, personal) || "—";
  const median =
    engineData && engineData.consumerSignals && engineData.consumerSignals.scores
      ? engineData.consumerSignals.scores.median
      : null;
  const meta = [
    ["CLIENT", (personal && personal.name) || "Client"],
    ["DATE", today],
    ["OUTCOME", outcome],
    ["SCORE", median != null ? String(median) : "—"]
  ];
  const colW = CONTENT_W / meta.length;
  const metaY = 90;
  meta.forEach((pair, i) => {
    const x = MARGIN + i * colW;
    page.drawRectangle({ x, y: metaY - 4, width: 0.9, height: 28, color: COVER_LINE });
    paint(page, pair[0], { x: x + 10, y: metaY + 16, size: 6, font: fonts.mono, color: LABEL });
    paint(page, String(pair[1]), {
      x: x + 10,
      y: metaY,
      size: 9,
      font: fonts.monoBold || fonts.mono,
      color: rgb(0.95, 0.95, 0.96)
    });
  });

  page.drawRectangle({ x: MARGIN, y: 46, width: CONTENT_W, height: 0.9, color: COVER_FOOT });
  paint(page, "diagnostic complete  ·  underwriteiq", {
    x: MARGIN,
    y: 32,
    size: 7,
    font: fonts.mono,
    color: LABEL
  });
  paint(page, "fundhub confidential", {
    x: PAGE_W - MARGIN - textW(fonts.mono, "fundhub confidential", 7),
    y: 32,
    size: 7,
    font: fonts.mono,
    color: LABEL
  });
  page.drawCircle({ x: MARGIN - 8, y: 35, size: 2.2, color: DOT });
}

function drawClosingPage(ctx, { cta, fonts }) {
  const page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.pages.push(page);
  ctx.currentPage = page;
  ctx.closingPage = page;
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: COVER });
  drawSpectrum(page, 0, PAGE_H - 3.5, PAGE_W, 3.5);

  paint(page, "fundhub.", {
    x: MARGIN,
    y: PAGE_H - 64,
    size: 19,
    font: fonts.bold,
    color: WHITE
  });
  paint(page, "NEXT STEPS", {
    x: PAGE_W - MARGIN - textW(fonts.mono, "NEXT STEPS", 7),
    y: PAGE_H - 58,
    size: 7,
    font: fonts.mono,
    color: LABEL
  });

  const heading = "Let Us Build Your Game Plan Together";
  const hLines = wrap(fonts.bold, heading, 27, 420);
  let hy = PAGE_H - 280;
  for (const line of hLines) {
    const w = textW(fonts.bold, line, 27);
    paint(page, line, { x: (PAGE_W - w) / 2, y: hy, size: 27, font: fonts.bold, color: WHITE });
    hy -= 32;
  }

  const sub =
    typeof cta === "string" && cta
      ? cta
      : "You have clean bureaus ready for funding now. Apply on those while we repair the rest in parallel.";
  const subLines = wrap(fonts.font, sub, 10, 380);
  hy -= 8;
  for (const line of subLines) {
    const w = textW(fonts.font, line, 10);
    paint(page, line, { x: (PAGE_W - w) / 2, y: hy, size: 10, font: fonts.font, color: CLO_SUB });
    hy -= 14;
  }

  const qrSize = 128;
  const qrX = (PAGE_W - qrSize) / 2;
  const qrY = hy - 24 - qrSize;
  DRAW_QR_HERE(page, { x: qrX, y: qrY, size: qrSize, black: INK, white: WHITE });

  const cap = "SCAN TO OPEN APPLY.FUNDHUB.AI";
  paint(page, cap, {
    x: (PAGE_W - textW(fonts.mono, cap, 7)) / 2,
    y: qrY - 16,
    size: 7,
    font: fonts.mono,
    color: LABEL
  });
  const url = APPLY_PAGE_URL.replace(/^https:\/\//, "");
  paint(page, url, {
    x: (PAGE_W - textW(fonts.monoBold || fonts.bold, url, 12)) / 2,
    y: qrY - 36,
    size: 12,
    font: fonts.monoBold || fonts.bold,
    color: WHITE
  });
  const alt = "Or copy this link into your browser";
  paint(page, alt, {
    x: (PAGE_W - textW(fonts.font, alt, 8)) / 2,
    y: qrY - 52,
    size: 8,
    font: fonts.font,
    color: LABEL
  });

  page.drawRectangle({ x: MARGIN, y: 46, width: CONTENT_W, height: 0.9, color: COVER_FOOT });
  page.drawCircle({ x: MARGIN - 8, y: 35, size: 2.2, color: DOT });
  paint(page, "systems nominal  ·  fundhub.ai", {
    x: MARGIN,
    y: 32,
    size: 7,
    font: fonts.mono,
    color: LABEL
  });
  paint(page, "fundhub confidential", {
    x: PAGE_W - MARGIN - textW(fonts.mono, "fundhub confidential", 7),
    y: 32,
    size: 7,
    font: fonts.mono,
    color: LABEL
  });
}

function drawGoldFooters(ctx) {
  const name = ctx.clientName || "client";
  const left = "fundhub.  ·  confidential  ·  prepared for " + String(name).toLowerCase();
  const title = ctx.footerTitle || "";
  const cover = ctx.pages[0];
  const closing = ctx.closingPage;
  const bodyPages = ctx.pages.filter((p) => p !== cover && p !== closing);
  bodyPages.forEach((page, idx) => {
    const right = title + "  ·  " + (idx + 1) + " / " + bodyPages.length;
    paint(page, left, {
      x: MARGIN,
      y: FOOTER_Y,
      size: 6.5,
      font: ctx.mono,
      color: MUTED
    });
    paint(page, right, {
      x: PAGE_W - MARGIN - textW(ctx.mono, right, 6.5),
      y: FOOTER_Y,
      size: 6.5,
      font: ctx.mono,
      color: MUTED
    });
  });
}

function chipKind(raw) {
  const up = String(raw || "").trim().toUpperCase();
  if (CHIP_SOLID.has(up)) return "solid";
  if (CHIP_MID.has(up)) return "mid";
  if (CHIP_LINE.has(up)) return "line";
  return null;
}

function drawChip(page, x, y, label, kind, fonts) {
  const text = String(label || "").toUpperCase();
  const tw = textW(fonts.mono, text, 6.5);
  const w = tw + 10;
  const h = 11;
  if (kind === "solid") {
    page.drawRectangle({ x, y: y - 2, width: w, height: h, color: INK });
    paint(page, text, { x: x + 5, y: y + 1, size: 6.5, font: fonts.mono, color: WHITE });
  } else if (kind === "mid") {
    page.drawRectangle({ x, y: y - 2, width: w, height: h, color: MID_CHIP });
    paint(page, text, { x: x + 5, y: y + 1, size: 6.5, font: fonts.mono, color: WHITE });
  } else {
    page.drawRectangle({
      x,
      y: y - 2,
      width: w,
      height: h,
      borderColor: INK,
      borderWidth: 0.9
    });
    paint(page, text, { x: x + 5, y: y + 1, size: 6.5, font: fonts.mono, color: INK });
  }
  return w;
}

function renderSection(ctx, node) {
  ctx.y -= 10;
  // Keep the eyebrow + title with the first block (gold break-after: avoid).
  ensureSpace(ctx, 96);
  const eyebrow = (node.code || "") + " / " + String(node.tag || "").toUpperCase();
  paint(activePage(ctx), eyebrow, {
    x: MARGIN,
    y: ctx.y,
    size: 7,
    font: ctx.mono,
    color: MUTED
  });
  ctx.y -= 16;
  const title = String(node.title || node.text || "");
  paint(activePage(ctx), title, {
    x: MARGIN,
    y: ctx.y,
    size: 16,
    font: ctx.bold,
    color: INK
  });
  ctx.y -= 12;
  drawSpectrum(activePage(ctx), MARGIN, ctx.y, CONTENT_W, 2);
  ctx.y -= 14;
}

function renderLead(ctx, runsOrText) {
  const text =
    typeof runsOrText === "string"
      ? runsOrText
      : (runsOrText || []).map((r) => r.text).join("");
  const lines = wrap(ctx.font, text, 11, CONTENT_W);
  ensureSpace(ctx, lines.length * 16 + 8);
  for (const line of lines) {
    paint(activePage(ctx), line, { x: MARGIN, y: ctx.y, size: 11, font: ctx.font, color: BODY });
    ctx.y -= 16;
  }
  ctx.y -= 6;
}

function renderParagraph(ctx, runs) {
  const text = (runs || []).map((r) => r.text).join("");
  const lines = wrap(ctx.font, text, 9.75, CONTENT_W);
  ensureSpace(ctx, lines.length * 15 + 6);
  for (const line of lines) {
    paint(activePage(ctx), line, { x: MARGIN, y: ctx.y, size: 9.75, font: ctx.font, color: BODY });
    ctx.y -= 15;
  }
  ctx.y -= 6;
}

function renderH3(ctx, text) {
  ctx.y -= 8;
  ensureSpace(ctx, 18);
  paint(activePage(ctx), String(text || ""), {
    x: MARGIN,
    y: ctx.y,
    size: 12,
    font: ctx.bold,
    color: INK
  });
  ctx.y -= 16;
}

function renderBullet(ctx, runs, numbered, index) {
  const text = (runs || []).map((r) => r.text).join("");
  const lines = wrap(ctx.font, text, 9.3, CONTENT_W - 18);
  ensureSpace(ctx, lines.length * 14 + 4);
  if (numbered) {
    paint(activePage(ctx), String(index), {
      x: MARGIN,
      y: ctx.y,
      size: 8,
      font: ctx.monoBold || ctx.mono,
      color: INK
    });
  } else {
    activePage(ctx).drawRectangle({
      x: MARGIN,
      y: ctx.y + 3,
      width: 3.2,
      height: 3.2,
      color: INK
    });
  }
  let ly = ctx.y;
  for (const line of lines) {
    paint(activePage(ctx), line, {
      x: MARGIN + 14,
      y: ly,
      size: 9.3,
      font: ctx.font,
      color: BODY
    });
    ly -= 14;
  }
  ctx.y = ly - 2;
}

function renderCallout(ctx, node) {
  const title = node.title || "";
  const text = node.text || node.body || "";
  const style = node.style || node.v || "crit";
  const titleLines = title ? wrap(ctx.bold, title, 9.6, CONTENT_W - 26) : [];
  const bodyLines = text ? wrap(ctx.font, text, 9.3, CONTENT_W - 26) : [];
  const boxH = titleLines.length * 14 + bodyLines.length * 14 + 18;
  ctx.y -= 4;
  ensureSpace(ctx, boxH + 8);
  const top = ctx.y + 8;
  const boxY = top - boxH;
  activePage(ctx).drawRectangle({
    x: MARGIN,
    y: boxY,
    width: CONTENT_W,
    height: boxH,
    color: style === "info" ? WHITE : CALLOUT_BG,
    borderColor: style === "info" ? HAIR : undefined,
    borderWidth: style === "info" ? 0.9 : undefined
  });
  if (style === "up") {
    drawSpectrum(activePage(ctx), MARGIN, boxY, 2.6, boxH);
  } else if (style !== "info") {
    activePage(ctx).drawRectangle({
      x: MARGIN,
      y: boxY,
      width: 2.6,
      height: boxH,
      color: INK
    });
  }
  let ty = top - 14;
  for (const line of titleLines) {
    paint(activePage(ctx), line, {
      x: MARGIN + 12,
      y: ty,
      size: 9.6,
      font: ctx.bold,
      color: INK
    });
    ty -= 14;
  }
  for (const line of bodyLines) {
    paint(activePage(ctx), line, {
      x: MARGIN + 12,
      y: ty,
      size: 9.3,
      font: ctx.font,
      color: BODY
    });
    ty -= 14;
  }
  ctx.y = boxY - 10;
}

function renderMetrics(ctx, items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return;
  const n = Math.min(list.length, 4);
  const gap = 8;
  const cardW = (CONTENT_W - gap * (n - 1)) / n;
  const cardH = 72;
  ctx.y -= 4;
  ensureSpace(ctx, cardH + 10);
  const top = ctx.y + 8;
  const boxY = top - cardH;
  for (let i = 0; i < n; i++) {
    const m = list[i] || {};
    const x = MARGIN + i * (cardW + gap);
    activePage(ctx).drawRectangle({
      x,
      y: boxY,
      width: cardW,
      height: cardH,
      borderColor: CARD_BORDER,
      borderWidth: 0.9,
      color: WHITE
    });
    activePage(ctx).drawRectangle({ x, y: boxY + cardH - 2, width: cardW, height: 2, color: INK });
    paint(activePage(ctx), String(m.label || "").toUpperCase(), {
      x: x + 10,
      y: boxY + cardH - 16,
      size: 6.3,
      font: ctx.mono,
      color: LABEL
    });
    paint(activePage(ctx), String(m.value || ""), {
      x: x + 10,
      y: boxY + 28,
      size: 16,
      font: ctx.monoBold || ctx.bold,
      color: INK
    });
    if (m.verdict) {
      paint(activePage(ctx), String(m.verdict).toUpperCase(), {
        x: x + 10,
        y: boxY + 12,
        size: 6.4,
        font: ctx.mono,
        color: INK
      });
    }
  }
  ctx.y = boxY - 12;
}

function renderMetric(ctx, value, label) {
  renderMetrics(ctx, [{ value, label }]);
}

function renderBigstat(ctx, node) {
  const cardH = 78;
  ctx.y -= 4;
  ensureSpace(ctx, cardH + 10);
  const top = ctx.y + 8;
  const boxY = top - cardH;
  activePage(ctx).drawRectangle({
    x: MARGIN,
    y: boxY,
    width: CONTENT_W,
    height: cardH,
    borderColor: CARD_BORDER,
    borderWidth: 0.9,
    color: WHITE
  });
  activePage(ctx).drawRectangle({
    x: MARGIN,
    y: boxY + cardH - 2.6,
    width: CONTENT_W,
    height: 2.6,
    color: INK
  });
  if (node.label) {
    paint(activePage(ctx), String(node.label).toUpperCase(), {
      x: MARGIN + 16,
      y: boxY + cardH - 18,
      size: 7,
      font: ctx.mono,
      color: LABEL
    });
  }
  paint(activePage(ctx), String(node.value || ""), {
    x: MARGIN + 16,
    y: boxY + 28,
    size: 28,
    font: ctx.monoBold || ctx.bold,
    color: INK
  });
  if (node.sub) {
    paint(activePage(ctx), String(node.sub), {
      x: MARGIN + 16,
      y: boxY + 12,
      size: 9,
      font: ctx.font,
      color: LABEL
    });
  }
  ctx.y = boxY - 12;
}

function renderTable(ctx, headers, rows) {
  if (!headers || !headers.length) return;
  const colCount = headers.length;
  const colW = CONTENT_W / colCount;
  const rowH = 22;
  ctx.y -= 4;
  ensureSpace(ctx, rowH * 2);
  drawSpectrum(activePage(ctx), MARGIN, ctx.y + 10, CONTENT_W, 2);
  ctx.y -= 4;
  headers.forEach((h, i) => {
    paint(activePage(ctx), String(h || "").toUpperCase(), {
      x: MARGIN + i * colW,
      y: ctx.y,
      size: 6.6,
      font: ctx.mono,
      color: LABEL
    });
  });
  ctx.y -= 8;
  activePage(ctx).drawRectangle({
    x: MARGIN,
    y: ctx.y,
    width: CONTENT_W,
    height: 1.1,
    color: INK
  });
  ctx.y -= 14;
  for (const row of rows || []) {
    ensureSpace(ctx, rowH);
    (row || []).forEach((cell, i) => {
      const raw = String(cell || "");
      const kind = chipKind(raw);
      const x = MARGIN + i * colW;
      if (kind) {
        drawChip(activePage(ctx), x, ctx.y, raw, kind, { mono: ctx.mono });
      } else {
        const clipped =
          textW(ctx.font, raw, 8.9) > colW - 8 ? raw.slice(0, Math.max(8, Math.floor((colW - 8) / 5))) + "..." : raw;
        const numeric = /^[~+$€£]?\d[\d,.]*%?$/.test(raw.trim());
        paint(activePage(ctx), clipped, {
          x,
          y: ctx.y,
          size: 8.9,
          font: numeric ? ctx.mono : ctx.font,
          color: BODY
        });
      }
    });
    ctx.y -= 6;
    activePage(ctx).drawRectangle({
      x: MARGIN,
      y: ctx.y + 8,
      width: CONTENT_W,
      height: 0.7,
      color: RULE
    });
    ctx.y -= 10;
  }
  ctx.y -= 6;
}

function renderLender(ctx, node) {
  const boxH = 78;
  ctx.y -= 4;
  ensureSpace(ctx, boxH + 8);
  const top = ctx.y + 8;
  const boxY = top - boxH;
  activePage(ctx).drawRectangle({
    x: MARGIN,
    y: boxY,
    width: CONTENT_W,
    height: boxH,
    borderColor: CARD_BORDER,
    borderWidth: 0.9,
    color: WHITE
  });
  activePage(ctx).drawRectangle({
    x: MARGIN,
    y: boxY + boxH - 2,
    width: CONTENT_W,
    height: 2,
    color: INK
  });
  paint(activePage(ctx), String(node.name || ""), {
    x: MARGIN + 12,
    y: boxY + boxH - 18,
    size: 11,
    font: ctx.bold,
    color: INK
  });
  let ky = boxY + boxH - 34;
  for (const pair of node.kv || []) {
    const k = Array.isArray(pair) ? pair[0] : pair.k;
    const v = Array.isArray(pair) ? pair[1] : pair.v;
    paint(activePage(ctx), String(k || "").toUpperCase(), {
      x: MARGIN + 12,
      y: ky,
      size: 6.6,
      font: ctx.mono,
      color: LABEL
    });
    paint(activePage(ctx), String(v || ""), {
      x: MARGIN + 120,
      y: ky,
      size: 8.8,
      font: ctx.font,
      color: BODY
    });
    ky -= 12;
  }
  ctx.y = boxY - 10;
}

function renderCard(ctx, node) {
  const bullets = node.bullets || [];
  const h = 28 + bullets.length * 14 + (node.kv || []).length * 12;
  ensureSpace(ctx, h + 8);
  const top = ctx.y + 8;
  const boxY = top - h;
  activePage(ctx).drawRectangle({
    x: MARGIN,
    y: boxY,
    width: CONTENT_W,
    height: h,
    borderColor: CARD_BORDER,
    borderWidth: 0.9
  });
  paint(activePage(ctx), String(node.title || ""), {
    x: MARGIN + 12,
    y: top - 16,
    size: 10,
    font: ctx.bold,
    color: INK
  });
  let y = top - 32;
  for (const b of bullets) {
    activePage(ctx).drawRectangle({ x: MARGIN + 12, y: y + 3, width: 3, height: 3, color: INK });
    paint(activePage(ctx), String(b), {
      x: MARGIN + 22,
      y,
      size: 9.3,
      font: ctx.font,
      color: BODY
    });
    y -= 14;
  }
  ctx.y = boxY - 10;
}

function renderCost(ctx, node) {
  ensureSpace(ctx, 36);
  if (node.num) {
    paint(activePage(ctx), String(node.num), {
      x: MARGIN,
      y: ctx.y,
      size: 13,
      font: ctx.monoBold || ctx.bold,
      color: INK
    });
  }
  paint(activePage(ctx), String(node.title || ""), {
    x: MARGIN + 26,
    y: ctx.y,
    size: 10,
    font: ctx.bold,
    color: INK
  });
  ctx.y -= 14;
  for (const line of node.lines || []) {
    paint(activePage(ctx), String(line), {
      x: MARGIN + 26,
      y: ctx.y,
      size: 9.1,
      font: ctx.font,
      color: BODY
    });
    ctx.y -= 13;
  }
  ctx.y -= 6;
}

let _charts = undefined;

function chartsRoot() {
  return path.join(__dirname, "..", "..", "..", "..", "..", "src", "underwrite");
}

/** B4 export — gate before calling waterfall / money_chain (DIAGRAM_SPEC §6). */
let shouldDrawChart = null;
try {
  shouldDrawChart = require(path.join(chartsRoot(), "fh-charts.mjs")).shouldDrawChart;
} catch {
  shouldDrawChart = null;
}

function chartGate(charts) {
  if (charts && typeof charts.shouldDrawChart === "function") return charts.shouldDrawChart;
  return typeof shouldDrawChart === "function" ? shouldDrawChart : null;
}

async function loadFhCharts() {
  if (_charts !== undefined) return _charts;
  const chartsPath = path.join(chartsRoot(), "fh-charts.mjs");
  const embedPath = path.join(chartsRoot(), "fh-charts-embed.mjs");
  if (!fs.existsSync(chartsPath)) {
    _charts = null;
    return null;
  }
  try {
    const charts = await import(pathToFileURL(chartsPath).href);
    let embed = {};
    if (fs.existsSync(embedPath)) {
      try {
        embed = await import(pathToFileURL(embedPath).href);
      } catch {
        embed = {};
      }
    }
    _charts = {
      ...charts,
      drawChart: charts.drawChart || embed.drawChart,
      unwrapChart: charts.unwrapChart || embed.unwrapChart
    };
  } catch {
    _charts = null;
  }
  return _charts;
}

/** Call a W2 chart. Missing module, missing args, suppress gate, or a throw → no-op (never a lying picture). */
function tryFhChart(charts, name, args) {
  if (!charts || typeof charts[name] !== "function") return null;
  if (args == null) return null;
  const gate = chartGate(charts);
  if (typeof gate === "function" && !gate(name, args)) return null;
  try {
    const out = Array.isArray(args) ? charts[name](...args) : charts[name](args);
    // Empty-string SVG (CHART_SUPPRESSED) is falsy — treat as no-op.
    return out || null;
  } catch {
    return null;
  }
}

function renderChartSlot(ctx, node) {
  const gate = chartGate(ctx.charts);
  if (typeof gate === "function" && node && (node.name === "waterfall" || node.name === "money_chain")) {
    // Prefer { current, projected } when the slot carried gain totals; else args array.
    const gain =
      node.gain && typeof node.gain === "object"
        ? node.gain
        : node.args;
    if (!gate(node.name, gain)) return;
  }
  const svg = tryFhChart(ctx.charts, node.name, node.args);
  if (!svg) return;
  const draw = ctx.charts && ctx.charts.drawChart;
  const unwrap = ctx.charts && ctx.charts.unwrapChart;
  if (typeof draw !== "function" || typeof unwrap !== "function") return;
  const { heightPt } = unwrap(svg);
  if (!heightPt) return;
  ensureSpace(ctx, heightPt + 15);
  try {
    draw(activePage(ctx), svg, {
      x: MARGIN,
      y: ctx.y - heightPt,
      fonts: {
        sans: ctx.font,
        sansBold: ctx.bold,
        mono: ctx.mono,
        monoBold: ctx.monoBold
      }
    });
  } catch {
    return;
  }
  ctx.y -= heightPt + 15;
}

function usd(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return "$" + Math.round(Number(n)).toLocaleString("en-US");
}

function preapprovalTotal(pa) {
  if (!pa || typeof pa !== "object") return null;
  const n = pa.total != null ? pa.total : pa.totalCombined;
  if (n == null || Number.isNaN(Number(n))) return null;
  return Number(n);
}

function lenderMatchesFrom(engine) {
  if (!engine || typeof engine !== "object") return null;
  const existing = engine.lenderMatches;
  if (existing && typeof existing === "object") {
    return {
      availableNow: existing.availableNow || existing.now || [],
      afterOptimization: existing.afterOptimization || existing.later || []
    };
  }
  try {
    const { matchLenders } = require("./lender-matrix");
    const cs = engine.consumerSignals;
    if (!cs || !cs.scores || typeof matchLenders !== "function") return null;
    const matched = matchLenders(
      cs,
      engine.businessSignals,
      stampedOutcome(engine) || engine.outcome
    );
    if (!matched) return null;
    const availableNow = matched.availableNow || [];
    const afterOptimization = matched.afterOptimization || [];
    if (!availableNow.length && !afterOptimization.length) return null;
    return { availableNow, afterOptimization };
  } catch {
    return null;
  }
}

function unlockLadderArgs(engine) {
  const matches = lenderMatchesFrom(engine);
  if (!matches) return null;
  const all = []
    .concat(matches.availableNow || [], matches.afterOptimization || [])
    .filter((l) => l && l.name && l.minScore != null);
  if (!all.length) return null;
  const byScore = new Map();
  for (const l of all) {
    const s = Number(l.minScore);
    if (!Number.isFinite(s)) continue;
    const names = byScore.get(s) || [];
    names.push(String(l.name));
    byScore.set(s, names);
  }
  const tiers = Array.from(byScore.entries()).sort((a, b) => a[0] - b[0]);
  if (!tiers.length) return null;
  const current =
    engine.consumerSignals && engine.consumerSignals.scores
      ? engine.consumerSignals.scores.median
      : null;
  if (current == null) return null;
  let lo = 620;
  let hi = 710;
  for (const [s] of tiers) {
    if (s < lo) lo = Math.max(300, s - 20);
    if (s > hi) hi = s + 20;
  }
  if (current < lo) lo = Math.max(300, current - 20);
  if (current > hi) hi = current + 20;
  return [current, tiers, lo, hi];
}

function applicationOrderArgs(engine) {
  const steps = [];
  const util = utilizationArgs(engine);
  if (util.tank) {
    const name = String(util.tank[0] || "the hot card").toUpperCase();
    const target = usd(util.tank[3]);
    steps.push([
      "Fix utilization first",
      target ? "PAY " + name + " DOWN TO " + target : "PAY " + name + " TO 10%"
    ]);
  }
  const matches = lenderMatchesFrom(engine);
  const ordered = []
    .concat((matches && matches.availableNow) || [], (matches && matches.afterOptimization) || [])
    .filter((l) => l && l.name && l.minScore != null)
    .sort((a, b) => Number(a.minScore) - Number(b.minScore));
  if (ordered.length) {
    const pair = ordered
      .slice(0, 2)
      .map((l) => String(l.name).toUpperCase() + " AT " + l.minScore);
    steps.push(["Lowest score floor first", pair.join(" / ")]);
    if (ordered[2]) {
      steps.push([
        "Then the next match",
        String(ordered[2].name).toUpperCase() + " AT " + ordered[2].minScore
      ]);
    }
  }
  if (!steps.length) return null;
  steps.push(["Pause if a hard pull lands", "DO NOT STACK INQUIRIES"]);
  steps.push(["Re-check before round two", "FRESH REPORT BEFORE THE NEXT FIVE"]);
  return [steps];
}

function defaultRoadmapMonths(range) {
  return [
    [1, "Pay cards", "utilization first", null],
    [2, "Round 1", "Send letters", null],
    [3, "Wait", "30 day clock", null],
    [4, "Round 2", "Escalate", null],
    [5, "Round 3", "Finish repair", null],
    [6, "Re-check", "Fresh report", String(range.lo) + "-" + String(range.hi)]
  ];
}

function scoreLineupArgs(engine) {
  const cs = engine && engine.consumerSignals;
  const pb = cs && cs.scores && cs.scores.perBureau;
  if (!pb) return null;
  const bn = (cs && cs.bureauNegatives) || {};
  const rows = [
    ["TransUnion", pb.tu, bn.transunion],
    ["Experian", pb.ex, bn.experian],
    ["Equifax", pb.eq, bn.equifax]
  ]
    .filter((r) => r[1] != null)
    .map(([name, score, neg]) => {
      const note = !neg
        ? "file on record"
        : neg.clean
          ? "Nothing negative on it"
          : neg.count === 1
            ? "1 negative item"
            : String(neg.count) + " negative items";
      return [name, score, note];
    });
  return rows.length ? [rows] : null;
}

function utilizationArgs(engine) {
  const tls = (engine && engine.normalized && engine.normalized.tradelines) || [];
  const cards = tls.filter(
    (t) =>
      !t.isAU &&
      t.accountType === "revolving" &&
      t.status === "open" &&
      t.effectiveLimit > 0
  );
  if (!cards.length) return { tank: null, bars: null };
  const ranked = cards
    .map((t) => ({
      name: t.creditorName || "Card",
      limit: t.effectiveLimit,
      balance: t.currentBalance || 0,
      pct: (t.currentBalance || 0) / t.effectiveLimit
    }))
    .sort((a, b) => b.pct - a.pct);
  const worst = ranked[0];
  const target = Math.round(worst.limit * 0.1);
  const pay = Math.max(0, Math.round(worst.balance - target));
  const bars = ranked.map((c) => [
    c.name,
    Math.round(c.pct * 1000) / 10,
    usd(c.balance) + " of " + usd(c.limit)
  ]);
  return {
    tank: [worst.name, worst.limit, worst.balance, target, pay],
    bars: [bars]
  };
}

function severityArgs(engine) {
  const tls = (engine && engine.normalized && engine.normalized.tradelines) || [];
  const negs = tls.filter((t) => t.isDerogatory);
  if (negs.length < 3) return null;
  const max = Math.max(...negs.map((t) => t.ratingSeverity || 0), 1);
  return [
    negs.slice(0, 8).map((t, i) => [
      i + 1,
      String(t.creditorName || "Account").slice(0, 22),
      String(t.currentRatingType || "negative").replace(/([A-Z])/g, " $1").trim().toLowerCase(),
      Math.min(1, (t.ratingSeverity || 0) / max),
      i % 2 === 0 ? "a" : "b"
    ])
  ];
}

function moneyChainArgs(engine) {
  const cur = preapprovalTotal(engine && engine.preapprovals);
  const proj = preapprovalTotal(engine && engine.projectedPreapproval);
  if (cur == null || proj == null || proj <= cur) return null;
  const util = utilizationArgs(engine);
  const pay = util.tank ? usd(util.tank[4]) : "the target";
  return [
    [
      ["STEP 1", "Pay the hot cards", pay || "pay down"],
      ["WHAT CHANGES", "Cards drop under 10%", "utilization falls"],
      ["WHAT LENDERS SEE", "Score jumps", "+40 to 80 points"],
      ["WHAT YOU GET", "Pre-approval jumps", usd(cur) + " becomes " + usd(proj)]
    ],
    "Paying the cards pays you back",
    "Utilization is the fastest lever on this file."
  ];
}

function journeyMapArgs(engine) {
  const currentApproval = preapprovalTotal(engine && engine.preapprovals);
  if (currentApproval == null) return null;
  const projected = preapprovalTotal(engine && engine.projectedPreapproval);
  const cs = engine && engine.consumerSignals;
  return [
    null,
    {
      currentApproval,
      projectedApproval: projected != null ? projected : currentApproval,
      disputeRounds: 3,
      hasCleanBureau: !!(cs && cs.anyBureauClean)
    }
  ];
}

function waterfallArgs(engine) {
  const cur = preapprovalTotal(engine && engine.preapprovals);
  const proj = preapprovalTotal(engine && engine.projectedPreapproval);
  if (cur == null || proj == null || proj <= cur) return null;
  return [
    [
      ["Now", "current pre-approval", cur, "base"],
      ["After work", "projected", proj - cur, "gain"],
      ["Month 6", "new number", proj, "total"]
    ]
  ];
}

function timelineArgs(engine) {
  const range = engine && engine.projectedScoreRange;
  const start =
    engine && engine.consumerSignals && engine.consumerSignals.scores
      ? engine.consumerSignals.scores.median
      : null;
  if (!range || start == null || range.lo == null || range.hi == null) return null;
  const months =
    Array.isArray(engine.roadmapMonths) && engine.roadmapMonths.length
      ? engine.roadmapMonths
      : defaultRoadmapMonths(range);
  return [months, start, range.lo, range.hi];
}

function chartSlotsFor(type, engine) {
  const util = utilizationArgs(engine);
  if (type === "credit_analysis") {
    return [
      { after: "lead", name: "journey_map", args: journeyMapArgs(engine) },
      { after: "02", name: "score_lineup", args: scoreLineupArgs(engine) },
      { after: "03", name: "utilization_tank", args: util.tank },
      { after: "03", name: "utilization_bars", args: util.bars },
      { after: "05", name: "severity_scale", args: severityArgs(engine) },
      { after: "08", name: "money_chain", args: moneyChainArgs(engine) }
    ];
  }
  if (type === "funding_snapshot") {
    return [{ after: "01", name: "waterfall", args: waterfallArgs(engine) }];
  }
  if (type === "lender_match") {
    return [
      { after: "01", name: "unlock_ladder", args: unlockLadderArgs(engine) },
      { after: "03", name: "application_order", args: applicationOrderArgs(engine) }
    ];
  }
  if (type === "roadmap") {
    return [
      { after: "01", name: "timeline", args: timelineArgs(engine) },
      { after: "03", name: "dispute_clock", args: [] }
    ];
  }
  return [];
}

function goldifyHeading(type, text) {
  const raw = String(text || "").trim();
  const coded = raw.match(/^(\d{2})\s*\/\s*([^—\-:]+)(?:\s*[—\-–:]\s*(.+))?$/);
  if (coded) {
    return {
      type: "section",
      code: coded[1],
      tag: coded[2].trim().toUpperCase(),
      title: (coded[3] || coded[2]).trim()
    };
  }
  const maps = SECTION_MAPS[type] || [];
  const hit = maps.find((m) => m.re.test(raw));
  if (!hit) return { type: "h2", text: raw };
  return { type: "section", code: hit.code, tag: hit.tag, title: raw };
}

function applyGoldHeadings(type, nodes) {
  return (nodes || []).map((n) => {
    if (n.type === "h1") return { type: "blank" };
    if (n.type === "h2") return goldifyHeading(type, n.text);
    return n;
  });
}

function promoteLead(nodes) {
  const out = (nodes || []).slice();
  const firstP = out.findIndex((n) => n.type === "paragraph");
  const firstSec = out.findIndex(
    (n) => n.type === "section" || n.type === "h2" || n.type === "h1"
  );
  if (firstP !== -1 && (firstSec === -1 || firstP < firstSec)) {
    out[firstP] = { type: "lead", runs: out[firstP].runs, text: out[firstP].text };
  }
  return out;
}

function injectChartSlots(type, nodes, engine) {
  const gate = chartGate(_charts);
  const cur = preapprovalTotal(engine && engine.preapprovals);
  const proj = preapprovalTotal(engine && engine.projectedPreapproval);
  const slots = chartSlotsFor(type, engine).filter((s) => {
    if (s.args == null) return false;
    if (typeof gate !== "function") return true;
    // money_chain array args do not encode gain — use { current, projected }.
    if (s.name === "waterfall" || s.name === "money_chain") {
      return gate(s.name, { current: cur, projected: proj });
    }
    return gate(s.name, s.args);
  });
  const out = [];
  let leadDone = false;
  for (const node of nodes || []) {
    out.push(node);
    if (node.type === "lead" && !leadDone) {
      leadDone = true;
      for (const s of slots.filter((x) => x.after === "lead")) {
        const n = { type: "chart", name: s.name, args: s.args };
        if (s.name === "waterfall" || s.name === "money_chain") {
          n.gain = { current: cur, projected: proj };
        }
        out.push(n);
      }
    }
    if (node.type === "section") {
      for (const s of slots.filter((x) => x.after === node.code)) {
        const n = { type: "chart", name: s.name, args: s.args };
        if (s.name === "waterfall" || s.name === "money_chain") {
          n.gain = { current: cur, projected: proj };
        }
        out.push(n);
      }
    }
  }
  return out;
}

function prepareGoldNodes(type, nodes, engine) {
  return injectChartSlots(type, promoteLead(applyGoldHeadings(type, nodes)), engine);
}

function runsFrom(text) {
  return [{ text: String(text || "") }];
}

function goldBlockToNodes(block) {
  if (!block || typeof block !== "object") return [];
  const t = String(block.t || block.type || "").toLowerCase();
  if (t === "lead") return [{ type: "lead", runs: runsFrom(block.body || block.text || "") }];
  if (t === "sec" || t === "section") {
    const nodes = [
      {
        type: "section",
        code: String(block.code || ""),
        tag: String(block.tag || ""),
        title: String(block.title || block.text || "")
      }
    ];
    for (const child of block.blocks || []) {
      nodes.push(...goldBlockToNodes(child));
    }
    return nodes;
  }
  if (t === "table") {
    return [{ type: "table", headers: block.headers || [], rows: block.rows || [] }];
  }
  if (t === "metrics") return [{ type: "metrics", items: block.items || [] }];
  if (t === "metric" || t === "metric_row") {
    const content = block.content && typeof block.content === "object" ? block.content : block;
    return [{ type: "metric", value: String(content.value || ""), label: String(content.label || "") }];
  }
  if (t === "callout") {
    return [
      {
        type: "callout",
        style: block.v || block.style || "crit",
        title: block.title || "",
        text: block.body || block.content || block.text || ""
      }
    ];
  }
  if (t === "bigstat") {
    return [{ type: "bigstat", label: block.label, value: block.value, sub: block.sub }];
  }
  if (t === "ul" || t === "check") {
    return (block.items || []).map((i) => ({ type: "bullet", runs: runsFrom(i), depth: 0 }));
  }
  if (t === "ol") {
    return (block.items || []).map((i, idx) => ({
      type: "bullet",
      numbered: true,
      index: idx + 1,
      runs: runsFrom(i),
      depth: 0
    }));
  }
  if (t === "card") return [{ type: "card", title: block.title, kv: block.kv, bullets: block.bullets }];
  if (t === "lender") {
    return [{ type: "lender", name: block.name, kv: block.kv, fit: block.fit }];
  }
  if (t === "cost") {
    return [{ type: "cost", num: block.num, title: block.title, lines: block.lines }];
  }
  if (t === "h3") return [{ type: "h3", text: block.text || block.body || "" }];
  if (t === "h4") return [{ type: "h3", text: block.text || block.body || "" }];
  if (t === "chart") {
    return [{ type: "chart", name: block.name, args: block.args, svg: block.svg }];
  }
  if (t === "quote" || t === "mono") {
    return [{ type: "paragraph", runs: runsFrom(block.text || block.body || "") }];
  }
  if (t === "bold" || t === "small" || t === "p" || t === "paragraph" || t === "text") {
    return [{ type: "paragraph", runs: runsFrom(block.body || block.text || block.content || "") }];
  }
  return [];
}

function goldDocToNodes(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  if (Array.isArray(parsed.body)) {
    const nodes = [];
    for (const b of parsed.body) nodes.push(...goldBlockToNodes(b));
    return nodes.length ? nodes : null;
  }
  if (parsed.t === "sec" || parsed.t === "section") {
    const nodes = goldBlockToNodes(parsed);
    return nodes.length ? nodes : null;
  }
  return null;
}

function renderGoldNode(ctx, node) {
  switch (node.type) {
    case "lead":
      renderLead(ctx, node.runs || node.text || "");
      break;
    case "section":
      renderSection(ctx, node);
      break;
    case "h1":
    case "h2":
      renderSection(ctx, { code: "", tag: "", title: node.text });
      break;
    case "h3":
    case "h4":
      renderH3(ctx, node.text);
      break;
    case "paragraph":
      renderParagraph(ctx, node.runs);
      break;
    case "bullet":
      renderBullet(ctx, node.runs, node.numbered, node.index);
      break;
    case "table":
      renderTable(ctx, node.headers, node.rows);
      break;
    case "callout":
      renderCallout(ctx, node);
      break;
    case "metric":
      renderMetric(ctx, node.value, node.label);
      break;
    case "metrics":
      renderMetrics(ctx, node.items);
      break;
    case "bigstat":
      renderBigstat(ctx, node);
      break;
    case "lender":
      renderLender(ctx, node);
      break;
    case "card":
      renderCard(ctx, node);
      break;
    case "cost":
      renderCost(ctx, node);
      break;
    case "chart":
      renderChartSlot(ctx, node);
      break;
    case "hr":
      ctx.y -= 8;
      drawSpectrum(activePage(ctx), MARGIN, ctx.y, CONTENT_W, 1.2);
      ctx.y -= 12;
      break;
    case "blank":
      ctx.y -= 6;
      break;
    default:
      break;
  }
}

const FONT_SEARCH_DIRS = [
  path.join("docs", "workflows", "gold-deliverables-v5"),
  path.join("docs", "workflows", "gold-deliverables-v5", "fonts"),
  path.join("public", "fonts"),
  path.join("assets", "fonts"),
  path.join("vendor", "underwriteiq-full", "fonts")
];

const FONT_FILES = {
  font: ["Inter-Regular.ttf", "Inter-Regular.otf", "Inter.ttf"],
  bold: ["Inter-Bold.ttf", "Inter-Bold.otf", "Inter-SemiBold.ttf"],
  mono: [
    "JetBrainsMono-Regular.ttf",
    "JetBrainsMonoNL-Regular.ttf",
    "JetBrainsMono-Regular.otf"
  ],
  monoBold: ["JetBrainsMono-Bold.ttf", "JetBrainsMonoNL-Bold.ttf", "JetBrainsMono-Bold.otf"]
};

function findFontFile(names) {
  const root = path.join(__dirname, "..", "..", "..", "..", "..");
  for (const dir of FONT_SEARCH_DIRS) {
    for (const name of names) {
      const p = path.join(root, dir, name);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

async function embedGoldFonts(pdfDoc, fallback) {
  const out = {
    font: fallback && fallback.font,
    bold: fallback && fallback.bold,
    mono: fallback && fallback.mono,
    monoBold: fallback && fallback.monoBold
  };
  for (const slot of Object.keys(FONT_FILES)) {
    const file = findFontFile(FONT_FILES[slot]);
    if (!file) continue;
    try {
      out[slot] = await pdfDoc.embedFont(fs.readFileSync(file));
    } catch {
      // pdf-lib needs fontkit for custom TTF. Keep Helvetica/Courier.
    }
  }
  return out;
}

async function renderGoldDocument(pdfDoc, { type, personal, engineData, nodes, fonts, cta }) {
  const charts = await loadFhCharts();
  const face = await embedGoldFonts(pdfDoc, fonts);
  const cover = pdfDoc.addPage([PAGE_W, PAGE_H]);
  drawCoverPage(cover, { type, personal, engineData, fonts: face });

  const body = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const ctx = {
    doc: pdfDoc,
    pages: [cover, body],
    currentPage: body,
    font: face.font,
    bold: face.bold,
    mono: face.mono,
    monoBold: face.monoBold,
    y: BODY_TOP,
    charts,
    clientName: (personal && personal.name) || "Client",
    footerTitle: DOC_TITLES[type] || type,
    closingPage: null
  };

  const prepared = prepareGoldNodes(type, nodes, engineData);
  for (const node of prepared) {
    renderGoldNode(ctx, node);
  }

  drawClosingPage(ctx, { cta, fonts: face });
  drawGoldFooters(ctx);
  return ctx;
}

module.exports = {
  PAGE_W,
  PAGE_H,
  MARGIN,
  CONTENT_W,
  INK,
  DOC_TITLES,
  COVER_COPY,
  DRAW_QR_HERE,
  stampedOutcome,
  drawSpectrum,
  drawCoverPage,
  drawClosingPage,
  drawGoldFooters,
  goldDocToNodes,
  goldBlockToNodes,
  prepareGoldNodes,
  injectChartSlots,
  tryFhChart,
  loadFhCharts,
  renderGoldNode,
  renderGoldDocument
};

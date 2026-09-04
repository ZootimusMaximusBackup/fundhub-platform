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

  /**
   * A ranked item: the big number, the heading, then one plain line per fact.
   * The reference set's "What Is Costing You Money" and "What Does Not Affect
   * Your Funding" are both built out of these.
   */
  item(n, title, lines) {
    const body = (lines || []).filter(Boolean);
    const wrapped = body.map((l) => wrap(l, this.font, 9, CONTENT - 40));
    const h = 22 + wrapped.reduce((sum, ls) => sum + ls.length * 11, 0) + 8;
    this.need(h + 6);
    const top = this.y;
    if (n != null) {
      this.page.drawRectangle({ x: M, y: top - 18, width: 18, height: 18, color: INK });
      const label = String(n);
      this.page.drawText(label, {
        x: M + 9 - this.bold.widthOfTextAtSize(label, 9) / 2,
        y: top - 13, size: 9, font: this.bold, color: WHITE
      });
    }
    const x = M + (n != null ? 28 : 0);
    for (const line of wrap(title, this.bold, 10, CONTENT - (n != null ? 28 : 0))) {
      this.page.drawText(line, { x, y: this.y - 11, size: 10, font: this.bold, color: INK });
      this.y -= 13;
    }
    for (const ls of wrapped) {
      for (const line of ls) {
        this.need(12);
        this.page.drawText(line, { x, y: this.y - 9, size: 9, font: this.font, color: rgb(0.25, 0.25, 0.25) });
        this.y -= 11;
      }
      this.y -= 2;
    }
    this.y -= 8;
    this.page.drawLine({
      start: { x: M, y: this.y }, end: { x: M + CONTENT, y: this.y },
      thickness: 0.4, color: LINE
    });
    this.y -= 8;
  }

  /**
   * One horizontal bar per card against the 10% line lenders look for. The
   * reference set draws this over the utilisation table; it is the same three
   * numbers, shown so a non-reader can see which card is the problem.
   */
  bars(rows, { target = 10 } = {}) {
    const list = (rows || []).filter((r) => r && r.pct != null);
    if (!list.length) return;
    const barW = CONTENT - 40;
    this.need(list.length * 30 + 24);
    this.page.drawText(`TARGET ${target}%`, {
      x: M + barW * (target / 100) - 22, y: this.y - 8, size: 6, font: this.font, color: MUTED
    });
    this.y -= 14;
    for (const row of list) {
      this.need(30);
      const pct = Math.max(0, Math.min(100, Number(row.pct)));
      const top = this.y;
      this.page.drawText(clean(row.label), { x: M, y: top - 9, size: 8, font: this.bold, color: INK });
      const pctText = `${pct}%`;
      this.page.drawText(pctText, {
        x: M + CONTENT - this.bold.widthOfTextAtSize(pctText, 8),
        y: top - 9, size: 8, font: this.bold, color: INK
      });
      this.page.drawRectangle({ x: M, y: top - 20, width: barW, height: 6, color: rgb(0.93, 0.93, 0.93) });
      this.page.drawRectangle({
        x: M, y: top - 20, width: Math.max(1, barW * (pct / 100)), height: 6,
        color: pct >= 80 ? rgb(0.85, 0.25, 0.25) : pct >= 50 ? rgb(0.96, 0.62, 0.26) : rgb(0.18, 0.7, 0.5)
      });
      this.page.drawRectangle({ x: M + barW * (target / 100), y: top - 23, width: 0.8, height: 12, color: INK });
      if (row.sub) {
        this.page.drawText(clean(row.sub).slice(0, 110), {
          x: M, y: top - 30, size: 7, font: this.font, color: MUTED
        });
      }
      this.y -= 36;
    }
    this.gap(4);
  }

  /** The reference's score ladder: how far each locked lender still is. */
  ladder(rows, median) {
    if (!(rows || []).length) return;
    this.text(`YOUR MEDIAN SCORE ${median ?? "-"}`, { size: 7, color: MUTED });
    this.gap(6);
    for (const step of rows) {
      const names = (step.names || []).join(", ");
      const lines = wrap(names, this.font, 8, CONTENT - 150);
      const h = Math.max(18, lines.length * 10 + 8);
      this.need(h + 4);
      const top = this.y;
      this.page.drawText(String(step.score), { x: M, y: top - 10, size: 10, font: this.bold, color: INK });
      this.page.drawText(`+${step.gap} PTS`, { x: M + 42, y: top - 9, size: 7, font: this.font, color: MUTED });
      let ly = top - 10;
      for (const line of lines) {
        this.page.drawText(line, { x: M + 100, y: ly, size: 8, font: this.font, color: INK });
        ly -= 10;
      }
      const count = String(step.count);
      this.page.drawText(count, {
        x: M + CONTENT - this.bold.widthOfTextAtSize(count, 8),
        y: top - 10, size: 8, font: this.bold, color: MUTED
      });
      this.y -= h;
      this.page.drawLine({
        start: { x: M, y: this.y }, end: { x: M + CONTENT, y: this.y },
        thickness: 0.4, color: LINE
      });
      this.y -= 6;
    }
    this.gap(6);
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

  /**
   * The close. Same layout as the designed reference set's last page: the
   * headline, a scan block, and the booking link written out underneath.
   *
   * THE LINK IS REAL. The reference PDFs print `www.fundhubbookingurl.template`
   * — a placeholder in the template nobody ever replaced — and this printer used
   * to fall back to the bare string "fundhub.ai", which is the marketing site
   * and not a booking page. It now comes from the one resolver every text
   * message and email already uses (../insights/meet.mjs salesMeetBookingUrl),
   * through black-report-client's bookingUrlFor.
   *
   * The scan block is drawn, not encoded. The reference set prints the literal
   * words "[ QR CODE ]" in the same spot, so this matches it; a real scannable
   * code needs a QR encoder, and CLAUDE.md section 8 forbids adding a dependency
   * without asking.
   */
  cta(c) {
    this.addPage(true);
    this.page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: BLACK });
    this.page.drawText("fundhub.", { x: 48, y: H - 64, size: 16, font: this.bold, color: WHITE });
    this.page.drawText("NEXT STEPS", {
      x: W - 140, y: H - 60, size: 7, font: this.font, color: rgb(0.49, 0.49, 0.49)
    });
    this.page.drawText("Let Us Build Your Game Plan Together", {
      x: 48, y: H - 200, size: 20, font: this.bold, color: WHITE
    });
    this.rainbow(48, H - 212, 130, 3);
    const lead = (c.lenders_now || []).length
      ? "You have lenders you can apply to today. Book the call and we will work the list in the right order."
      : "Book the call and we will put the fixes in this pack in the order that unlocks the most money.";
    let ly = H - 246;
    for (const line of wrap(lead, this.font, 10, CONTENT - 20)) {
      this.page.drawText(line, { x: 48, y: ly, size: 10, font: this.font, color: rgb(0.72, 0.72, 0.72) });
      ly -= 14;
    }
    const boxW = 150;
    const boxX = (W - boxW) / 2;
    const boxY = H - 470;
    this.page.drawRectangle({
      x: boxX, y: boxY, width: boxW, height: boxW,
      borderColor: rgb(0.35, 0.35, 0.35), borderWidth: 1
    });
    const ph = "[ QR CODE ]";
    this.page.drawText(ph, {
      x: W / 2 - this.font.widthOfTextAtSize(ph, 9) / 2,
      y: boxY + boxW / 2 - 4, size: 9, font: this.font, color: rgb(0.55, 0.55, 0.55)
    });
    const caption = "SCAN TO BOOK YOUR CALL INSTANTLY";
    this.page.drawText(caption, {
      x: W / 2 - this.font.widthOfTextAtSize(caption, 8) / 2,
      y: boxY - 28, size: 8, font: this.font, color: rgb(0.62, 0.62, 0.62)
    });
    const url = clean(c.booking_url || "");
    if (url) {
      this.page.drawText(url, {
        x: W / 2 - this.bold.widthOfTextAtSize(url, 12) / 2,
        y: boxY - 58, size: 12, font: this.bold, color: WHITE
      });
      const sub = "Or copy this link into your browser";
      this.page.drawText(sub, {
        x: W / 2 - this.font.widthOfTextAtSize(sub, 8) / 2,
        y: boxY - 74, size: 8, font: this.font, color: rgb(0.55, 0.55, 0.55)
      });
    }
    this.page.drawText("systems nominal  fundhub.ai", {
      x: 48, y: 48, size: 7, font: this.font, color: rgb(0.49, 0.49, 0.49)
    });
    this.page.drawText("FUNDHUB CONFIDENTIAL", {
      x: W - 180, y: 48, size: 7, font: this.font, color: rgb(0.49, 0.49, 0.49)
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

/* ─────────────────────────────────────────────────────────────────────────────
   SHARED PIECES OF THE DESIGNED REFERENCE SET

   Every section below exists in Chris's reference PDFs
   (docs/workflows/uwiq-reference-2026-07-25/). Nothing here writes a new claim
   about what will happen to a client's credit: the ranked problem text is the
   vendor engine's own optimization findings, and the headings and section
   numbers are copied from the reference design.
   ───────────────────────────────────────────────────────────────────────────── */

/** "AFTER OPTIMIZATION" for a score. No projected score is invented. */
function afterScore(c, key) {
  const t = c.score_targets?.[key];
  return t ? String(t) : "Set at your next pull";
}

/** The reference's revolving bars: creditor, its percentage, its target. */
function utilBars(c) {
  const rows = (c.revolving || [])
    .filter((row) => row[6] !== "CLOSED" && /%$/.test(String(row[4] || "")))
    .map((row) => ({
      label: row[0],
      pct: Number(String(row[4]).replace("%", "")),
      sub: `${usd(row[2])} of ${usd(row[3])}${row[5] ? ` - pay down to ${row[5]}` : ""}`
    }));
  const total = Number(String(c.util_pct || "").replace("%", ""));
  if (Number.isFinite(total) && c.util_total_limit) {
    rows.push({
      label: "Overall revolving",
      pct: total,
      sub: `${usd(c.util_total_balance)} of ${usd(c.util_total_limit)} - pay down to under ${usd(c.util_target_balance)}`
    });
  }
  return rows;
}

/** "open" -> "Open"; "AsAgreed" -> "Paying on time". Plain words, not codes. */
function titleCase(v) {
  const t = String(v || "").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

const RATING_WORDS = Object.freeze({
  asagreed: "Paying on time",
  current: "Paying on time",
  chargeoff: "Charge-off",
  collectionorchargeoff: "Collection or charge-off",
  paid: "Paid",
  closed: "Closed"
});

function ratingWords(v) {
  const key = String(v || "").replace(/[^a-z]/gi, "").toLowerCase();
  if (!key) return "";
  if (RATING_WORDS[key]) return RATING_WORDS[key];
  if (/late(\d+)days?/.test(key)) return `${key.replace(/\D+/g, "")} days late`;
  return titleCase(String(v));
}

/** Only draw a table that has something in it. An empty header row is noise. */
function typedTable(r, title, rows) {
  if (!(rows || []).length) return;
  r.para(title);
  r.table(
    ["account", "status", "balance", "notes"],
    rows.map((row) => [row[0], titleCase(row[1]), row[2], ratingWords(row[3])])
  );
}

function costingYou(c, r) {
  r.heading("What Is Costing You Money");
  const rows = c.costing_you || [];
  if (!rows.length) {
    r.para("Nothing on this file is holding your funding back right now. Keep it that way: pay on time and do not open new accounts before your funding is locked in.");
    return;
  }
  r.para("Each item below is holding your number down. Fix them in this order.");
  for (const row of rows) r.item(row.n, row.title, row.lines);
}

function notAFactor(c, r) {
  const rows = c.not_a_factor || [];
  if (!rows.length) return;
  r.heading("What Does Not Affect Your Funding");
  r.para("You do not need to lose sleep over these. They are cleanup and upkeep only.");
  for (const row of rows) r.item(null, row.title, row.lines);
}

/** The after-optimization lender table the reference prints in the snapshot. */
function afterOptimizationTable(c, r) {
  const rows = c.lenders_after || [];
  if (!rows.length) return;
  r.heading("Where You Could Be - After Optimization");
  r.table(
    ["lender", "type", "est. range", "what you need"],
    rows.map((row) => [row[0], row[2] || row[1], moneyRange(row[3], row[4]), row[10] || `Score ${row[5]}+`])
  );
}

/**
 * The application-order rules. These are FundHub's own standing rules, the same
 * five in every copy of the reference set; only the account and lender they name
 * come from this client's file.
 */
function applicationOrder(c, r) {
  const first = (c.revolving || []).find((row) => row[6] === "CRITICAL" || row[6] === "HIGH")
    || (c.revolving || [])[0];
  const lowest = [...(c.lenders_after || [])].sort((a, b) => a[5] - b[5])[0];
  r.heading("Application Order Warning");
  r.para("Applying to the wrong lender first burns a hard inquiry AND can trigger automatic declines that follow you to the next application. Follow this order exactly.");
  const steps = [
    first
      ? ["Fix utilization first", `Pay ${first[0]} down to ${first[5] || "under 10% of its limit"} before any application.`]
      : ["Fix utilization first", "Get every card under 10% of its limit before any application."],
    lowest
      ? ["Lowest score floor first", `${lowest[0]} asks for ${lowest[5]}. That is your first target.`]
      : ["Lowest score floor first", "Start with the lender asking the least of you."],
    ["One at a time", "Wait for the decision before you send the next one. Never shotgun applications."],
    ["Work up the list", "Do not apply to the highest thresholds until your score is confirmed there."],
    ["Personal before business", "Lock personal funding in first. Then form or grow the business side."]
  ];
  steps.forEach(([title, line], i) => r.item(i + 1, title, [line]));
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
  r.para(`${firstName(c)}, this report is built from your UnderwriteIQ file. Every score, card, balance and lender below is your file - not a sample person.`);
  r.callout("Your plan runs on two tracks at the same time. TRACK 1 - FUND NOW: apply on your clean file. TRACK 2 - REPAIR: dispute, wait 30 days, verify, then the next round. You do not wait for repair to finish before you get money.");
  r.eyebrow("01 / BUREAUS");
  r.heading("Bureau Health Summary");
  r.table(["bureau", "status", "negative items", "notes"], (c.bureaus || []).map((row) => row.map(String)));
  r.eyebrow("02 / SCORES");
  r.heading("Score Breakdown by Bureau");
  r.para("You do not have one credit score. You have three. Line them up from lowest to highest - lenders use the middle one.");
  const sorted = [
    ["Experian", s.experian], ["Equifax", s.equifax], ["TransUnion", s.transunion]
  ].filter(([, v]) => Number.isFinite(v)).sort((a, b) => a[1] - b[1]);
  const rank = (i) => {
    if (sorted.length < 2) return "Bureau score on file";
    if (i === 0) return "Lowest - priority target";
    if (i === sorted.length - 1) return "Highest - your cleanest bureau";
    return "Your middle score";
  };
  r.cards([
    ...sorted.map(([lbl, big], i) => ({ lbl, big, body: rank(i) })),
    { lbl: "Median", big: med || "-", body: "The number most lenders read" }
  ]);
  if (sorted.length >= 2) {
    const spread = sorted[sorted.length - 1][1] - sorted[0][1];
    r.para(`There is a ${spread}-point spread between your best bureau (${sorted[sorted.length - 1][0]} ${sorted[sorted.length - 1][1]}) and your worst (${sorted[0][0]} ${sorted[0][1]}). They do not match because not every company reports to all three. Closing that gap is the job.`);
  }
  r.eyebrow("03 / UTILIZATION");
  r.heading("Primary Revolving Cards - Utilization Analysis");
  r.table(
    ["creditor", "bureau", "balance", "limit", "util", "target balance", "status"],
    (c.revolving || []).map((row) => [
      row[0], row[1], usd(row[2]), usd(row[3]), row[4], row[5], row[6]
    ])
  );
  r.bars(utilBars(c));
  if (c.util_pct) {
    r.callout(`Overall revolving utilization is ${c.util_pct} - ${usd(c.util_total_balance)} of ${usd(c.util_total_limit)}. Target: get total balances to ${usd(c.util_target_balance)} or less, which puts you under 10%.`);
  }
  r.eyebrow("04 / AU ACCOUNTS");
  r.heading("Authorized User (AU) Accounts");
  const au = c.au_account || {};
  if (au.creditor) {
    r.table(
      ["creditor", "bureau", "limit", "balance", "utilization", "age", "impact"],
      [[au.creditor, au.bureau, usd(au.limit), usd(au.balance), au.util || "", au.age || "", "NEUTRAL"]]
    );
    r.para("An authorized user account cannot help you get funded - lenders do not count them when they make a funding decision. It is not hurting you either. Leave it alone.");
  } else {
    r.para("No authorized user accounts on this file.");
  }
  r.eyebrow("05 / NEGATIVES");
  r.heading("Negative Items - One by One");
  if (!(c.negatives || []).length) {
    r.para("No derogatory items are listed on this file. That is the cleanest position a file can be in going into a funding round.");
  } else {
    r.table(
      ["#", "creditor", "bureau", "type", "balance"],
      c.negatives.map((n) => [n.n, n.creditor, n.bureau, n.type, n.balance])
    );
  }
  r.eyebrow("06 / INQUIRIES");
  r.heading("Inquiries - Cleanup Only. Zero Impact on Funding.");
  r.callout("Inquiries do NOT affect your ability to get funded through FundHub. We do not use inquiry count as a funding factor. This section is cleanup only.");
  if ((c.inquiries || []).length) {
    r.table(
      ["bureau", "total inquiries", "priority for removal", "notes"],
      (c.inquiries || []).map((row) => row.map(String))
    );
  } else {
    r.para("No inquiries on this file to clean up.");
  }
  r.eyebrow("07 / PERSONAL DATA");
  r.heading("Personal Data Cleanup");
  if ((c.personal_data || []).length) {
    r.table(
      ["item", "issue", "action required", "priority"],
      c.personal_data.map((row) => row.map(String))
    );
    r.para("Your personal information dispute letters consolidate all of this to one legal name and one current address.");
  } else {
    r.para("Your name, address and identifiers match across all three bureaus. Nothing to clean up.");
  }
  r.eyebrow("08 / BOTTOM LINE");
  r.heading("The Bottom Line - Where You Are vs. Where You Are Going");
  r.cards([
    { lbl: "current pre-approval", big: usd(c.preapproval_now), body: "What this file qualifies for today" },
    { lbl: "projected pre-approval", big: usd(c.preapproval_after), body: "After the work in this pack" },
    { lbl: "the delta", big: usd((c.preapproval_after || 0) - (c.preapproval_now || 0)), body: "Gained by doing the work" }
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
  r.heading("Your Numbers Right Now");
  const gap = (c.preapproval_after || 0) - (c.preapproval_now || 0);
  r.table(["", "today", "after optimization"], [
    ["Median score", String(median(s)), afterScore(c, "median")],
    ["Experian score", String(s.experian ?? ""), afterScore(c, "experian")],
    ["Utilization", c.util_pct || "", "Under 10% target"],
    ["Pre-approval", usd(c.preapproval_now), usd(c.preapproval_after)],
    ["Funding gap", "", gap > 0 ? `${usd(gap)} left on the table` : "None - you are at the top of this file"]
  ]);
  if (gap > 0) {
    r.callout(`You are fundable right now at ${usd(c.preapproval_now)}. You are leaving ${usd(gap)} on the table by not fixing a few things first. The good news is that the biggest fixes are the fastest.`);
  }
  r.eyebrow("02 / BREAKDOWN");
  r.heading("Breakdown by Category");
  r.para("Personal cards");
  r.table(
    ["account", "bureau", "status", "balance", "limit", "utilization"],
    (c.revolving || []).map((row) => [row[0], row[1], row[6], usd(row[2]), usd(row[3]), row[4]])
  );
  if (c.util_pct) {
    r.para(`Overall utilization: ${c.util_pct} of ${usd(c.util_total_limit)} in available credit.`);
  }
  typedTable(r, "Installment loans", c.installments);
  typedTable(r, "Mortgage / real estate", c.mortgages);
  typedTable(r, "Public obligations", c.public_obligations);
  r.para("Business accounts");
  r.para(businessLine(c));
  r.eyebrow("03 / COSTING YOU");
  costingYou(c, r);
  if ((c.not_a_factor || []).length) r.eyebrow("04 / NOT A FACTOR");
  notAFactor(c, r);
  if ((c.lenders_after || []).length) r.eyebrow("05 / AFTER OPTIMIZATION");
  afterOptimizationTable(c, r);
  r.eyebrow("06 / NEXT STEP");
  r.heading("Your Next Step");
  r.para(`${firstName(c)}, here is the honest truth. You are fundable at ${usd(c.preapproval_now)} right now. The version of you that shows up in 60-90 days - with utilization under 10% and this list worked through - is the version that gets offered more money at better rates.`);
  for (const row of c.strategy || []) r.item(null, row.title, row.lines);
  if (!(c.strategy || []).length) {
    r.para("Do NOT open new accounts before funding. Every new card or loan drops your average account age and can trigger automatic declines. Lock in your funding first. Build after.");
  }
  r.para("Your fastest wins:");
  const wins = (c.revolving || []).filter((row) => row[5] && row[6] !== "CLOSED").slice(0, 3);
  if (wins.length) {
    wins.forEach((row) => r.para(`Pay ${row[0]} from ${usd(row[2])} down to ${row[5]}.`));
  } else {
    r.para("Keep every account paid on time and do not add new credit before your funding is locked in.");
  }
  r.cta(c);
}

/**
 * F44. What this file says about a company. A client with a company on file for
 * six years must never be told to go and form an LLC in a document with his own
 * name on it. `business.hasEntity` comes from an actual `businesses` row, which
 * is the owner's own rule (F15, ../underwrite/business-funding.mjs).
 */
function businessLine(c) {
  const b = c.business || {};
  if (!b.hasEntity) {
    return "No business entity on file. You are leaving a full suite of business funding off the table. Forming an LLC is fast and most states let you do it online.";
  }
  const who = b.name ? `${b.name} is on file` : "You have a business entity on file";
  const age = b.ageMonths == null
    ? ""
    : ` at ${b.ageMonths} months old. Most business lenders want 6 to 12 months, so that clock is already running.`;
  return `${who}${age || "."} The next step is the business credit profile: EIN, a dedicated business checking account, a D-U-N-S number, and net-30 vendor accounts that report.`;
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
  r.eyebrow("01 / AVAILABLE NOW");
  r.heading("Available Right Now");
  r.para(`${firstName(c)}, here is the honest truth. Your median score is ${med || "-"} and your utilization is ${c.util_pct || "-"}.`);
  const now = c.lenders_now || [];
  const after = c.lenders_after || [];
  if (now.length) {
    /* F45. These are the lenders the matcher put in `availableNow`. Until
       2026-09-04 this file flattened both buckets into one list, so this section
       was empty on every document ever printed and all fifteen lenders showed as
       locked. */
    r.table(
      ["lender", "type", "est. range", "score floor"],
      now.map((row) => [row[0], row[2] || row[1], moneyRange(row[3], row[4]), String(row[5])])
    );
    r.callout(`${now.length} lender${now.length === 1 ? " is" : "s are"} open to you today. Work them in the order in section 03 - one at a time, lowest score floor first.`);
  } else {
    r.callout("No lenders are matched for immediate funding right now. You are not far off. The score ladder below shows exactly how many points stand between you and each one.");
  }
  if ((c.score_ladder || []).length) {
    r.para("How far each locked lender still is:");
    r.ladder(c.score_ladder, med);
    r.para("Business products additionally require an entity and time in business.");
  }
  r.eyebrow("02 / SHORTLIST");
  r.heading("After Optimization - Your Shortlist");
  if (!after.length) {
    r.para("Nothing on this list is out of reach. Every lender the matcher knows is already open to you.");
  } else {
    r.para(`These ${after.length} lenders unlock once you work the items in your Funding Snapshot. Here is who fits you and what each one still wants.`);
  }
  let category = null;
  for (const row of after) {
    const [nm, cat, typ, lo, hi, sc, tib, rev, why, , needed] = row;
    if (cat !== category) {
      category = cat;
      r.text(String(cat || ""), { size: 12, bold: true });
      r.gap(4);
    }
    r.text(nm, { size: 11, bold: true });
    r.table(["field", "value"], [
      ["type", typ || cat],
      ["range", moneyRange(lo, hi)],
      ["score needed", String(sc ?? "")],
      ["time in business", tib || "-"],
      ["revenue", rev || "-"],
      ["you still need", needed || "-"],
      ["why it fits", why || ""]
    ]);
  }
  r.eyebrow("03 / APPLICATION ORDER");
  applicationOrder(c, r);
  r.eyebrow("04 / AT A GLANCE");
  r.heading("Your Numbers at a Glance");
  r.table(["", "today", "after optimization"], [
    ["Median score", String(med || ""), afterScore(c, "median")],
    ["Utilization", c.util_pct || "", "Under 10% target"],
    ["Pre-approval", usd(c.preapproval_now), usd(c.preapproval_after)],
    ["Lenders available", String(now.length), String(now.length + after.length)]
  ]);
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
  r.para(`A note before we start. ${firstName(c)}, this plan is built from your own file, not a template. Over the next six months we clear the road so the money can flow.`);
  r.eyebrow("01 / PROJECTION");
  r.heading("Your Projected Pre-Approval");
  r.cards([
    { lbl: "today", big: usd(c.preapproval_now), body: "On this file now" },
    { lbl: "month 6", big: usd(c.preapproval_after), body: "After the work in this plan" }
  ]);
  r.heading("Where You Stand Now vs. Where You Are Going");
  r.table(["", "today", "month 6"], [
    ["Median score", String(median(s) || ""), afterScore(c, "median")],
    ["Experian score", String(s.experian ?? ""), afterScore(c, "experian")],
    ["Equifax score", String(s.equifax ?? ""), afterScore(c, "equifax")],
    ["TransUnion score", String(s.transunion ?? ""), afterScore(c, "transunion")],
    ["Overall utilization", c.util_pct || "", "Under 10%"],
    ["Negative items", String((c.negatives || []).length),
      (c.negatives || []).length ? "Targeted for removal" : "None on file"],
    ["Pre-approval", usd(c.preapproval_now), usd(c.preapproval_after)],
    ["Lenders available", String((c.lenders_now || []).length), String((c.lenders_now || []).length + (c.lenders_after || []).length)]
  ]);

  r.eyebrow("02 / MONTH 1");
  r.heading("Month 1 - Launch");
  r.para("We fire on all cylinders. Nothing waits.");
  let stepNo = 0;
  const step = (line) => r.para(`Step ${++stepNo}: ${line}`);
  step("the paydown plan. This is your single biggest score lever.");
  const cards = (c.revolving || []).filter((row) => row[6] !== "CLOSED");
  r.table(
    ["account", "balance", "limit", "pay down to", "amount to pay"],
    cards.map((row) => {
      const target = Number(String(row[5] || "").replace(/[^0-9]/g, ""));
      const bal = Number(row[2]);
      const owe = Number.isFinite(target) && Number.isFinite(bal) && bal > target ? usd(bal - target) : "-";
      return [row[0], usd(row[2]), usd(row[3]), row[5] || "under 10%", owe];
    })
  );
  if (c.util_target_balance != null) {
    r.callout(`Total paydown to reach 10% utilization: ${usd(Math.max(0, (c.util_total_balance || 0) - c.util_target_balance))}. You do not have to do it all at once - start with the card at the highest percentage.`);
  }
  if ((c.negatives || []).length) {
    step("Round 1 dispute letters. One letter per bureau, naming these items:");
    c.negatives.forEach((n) => r.para(`${n.n}. ${n.creditor} - ${n.type} - ${n.bureau}${n.balance ? ` - ${n.balance}` : ""}`));
  } else {
    step("no derogatory items are listed on this file, so there is nothing to dispute. Month 1 is paydown and business setup.");
  }
  if ((c.personal_data || []).length) {
    step("personal information cleanup letters. Clean personal information makes every other dispute more effective.");
    c.personal_data.forEach((row) => r.para(`${row[0]} - ${row[1]}`));
  }
  if (c.inquiry_total) {
    step(`inquiry removal letters. You have ${c.inquiry_total} inquiries on file. They do NOT affect your funding with us - this is cleanup only, and we send letters for every inquiry with no matching open account.`);
  }
  step(`${c.business?.hasEntity ? "grow the business side." : "form your business entity."} ${businessLine(c)}`);
  step(`secure the personal funding you already qualify for. Your pre-approval today is ${usd(c.preapproval_now)}. Do not open any new credit before you lock it in.`);

  r.eyebrow("03 / MONTHS 2-3");
  r.heading("Months 2-3 - Results");
  r.para("This is where it starts showing up. Why disputes take rounds, not days: you send the letters, the law gives the bureaus 30 days, results come back deleted, updated or verified, and anything still verified gets a stronger Round 2 letter.");
  r.para("Balance paydowns hit first. Card balances report within 30 to 45 days of payment, so a Month 1 paydown usually shows in Month 2.");
  r.para("Month 2 to-do: check the dispute responses, write down every result, and keep the balances you paid down where you put them.");
  r.para("Month 3: Round 2 escalation letters go out for anything that came back verified. Round 2 asks the bureau HOW it verified the item and names the specific problem with its answer.");

  r.eyebrow("04 / MONTH 4");
  r.heading("Month 4 - Final Push");
  r.para("Anything still standing gets Round 3, alongside a complaint to the regulator and a dispute sent straight to the original creditor rather than only to the bureau.");
  r.para("Never pay a collector without a written pay-for-delete agreement in hand first. Payment without deletion does nothing for your score.");

  r.eyebrow("05 / MONTH 5");
  r.heading("Month 5 - Business Milestone");
  r.para("Get your EIN from the IRS. Register for a D-U-N-S number. Open a dedicated business checking account. Open net-30 vendor accounts that report, buy something small, and pay in 30 days.");
  r.para("Most business lenders want 6 to 12 months of business age. The sooner the clock starts, the sooner those lenders open.");

  r.eyebrow("06 / MONTH 6");
  r.heading("Month 6 - The Reveal");
  r.para("Pull a fresh tri-merge report and put it side by side with Month 1. Then submit for an updated pre-approval.");
  r.cards([
    { lbl: "projected pre-approval", big: usd(c.preapproval_after), body: "What this plan is worth to you" }
  ]);

  r.eyebrow("07 / CHECKLIST");
  r.heading("Your 6-Month Checklist");
  cards.slice(0, 5).forEach((row) => {
    r.para(`Month 1 - Pay ${row[0]} from ${usd(row[2])} down to ${row[5] || "under 10% of its limit"}.`);
  });
  if ((c.negatives || []).length) r.para("Month 1 - Send Round 1 dispute letters to every bureau named above.");
  if (c.inquiry_total) r.para("Month 1 - Send inquiry removal letters.");
  r.para(c.business?.hasEntity
    ? "Month 1 - Open a dedicated business checking account under the entity on file."
    : "Month 1 - File your business entity and open a business checking account.");
  r.para("Month 1 - Apply for the personal funding this file already qualifies for.");
  r.para("Month 2 - Check dispute results 30 to 45 days after sending. Write down every one.");
  r.para("Month 3 - Send Round 2 escalation letters for anything that came back verified.");
  r.para("Month 4 - Round 3 letters and complaints for anything still standing.");
  r.para("Month 5 - EIN, D-U-N-S number, net-30 vendor accounts.");
  r.para("Month 6 - Fresh tri-merge report. Compare to Month 1. Submit for an updated pre-approval.");
  r.para("Projected pre-approval amounts are estimates from your current file. Individual results vary.");
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

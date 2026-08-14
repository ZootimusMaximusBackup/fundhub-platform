// Deterministic Fundhub deliverable charts. Port of
// docs/workflows/gold-deliverables-v5/fh_charts.py
//
// Pure functions of numeric arguments. No randomness. No model in the
// drawing path. Same inputs always produce identical SVG.
//
// Design lock (matches the approved print system):
//   ink        #0C0C0D   primary bars, rails, markers
//   track      #E8E8EB   empty bar track / inactive rail
//   hairline   #DDDDE1   separators
//   label      #6E6E76   mono axis + caption text
//   spectrum   thin accents only, never a fill
//   type       JetBrains Mono for every number, Inter for names
// All charts must read correctly in grayscale.
//
// Width/height are declared in pt so WeasyPrint (and any CSS px consumer)
// cannot silently scale the chart to 75%.

const W = 508.0;
const INK = "#0C0C0D";
const TRACK = "#E8E8EB";
const HAIR = "#DDDDE1";
const LABEL = "#6E6E76";
const MUTED = "#9A9AA1";

/** Empty string = suppressed chart (DIAGRAM_SPEC §6). Falsy for W3 tryFhChart / renderChartSlot. */
export const CHART_SUPPRESSED = "";

const SPEC_DEF =
  '<defs><linearGradient id="fhspec" x1="0" y1="0" x2="1" y2="0">' +
  '<stop offset="0" stop-color="#8B5CF6"/><stop offset="0.22" stop-color="#3B82F6"/>' +
  '<stop offset="0.45" stop-color="#22D3EE"/><stop offset="0.66" stop-color="#34D399"/>' +
  '<stop offset="0.84" stop-color="#FBBF24"/><stop offset="1" stop-color="#F97066"/>' +
  "</linearGradient></defs>";

function asFinite(n) {
  if (n === null || n === undefined || n === "") return null;
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) ? x : null;
}

function f1(n) {
  const x = asFinite(n);
  return x === null ? "0.0" : x.toFixed(1);
}

function f0(n) {
  const x = asFinite(n);
  return x === null ? "0" : x.toFixed(0);
}

// Python f"{size}" keeps a decimal on float literals (11.0 → "11.0") and
// prints ints as ints (28 → "28", ls=0 → "0").
function pyNum(n) {
  if (n === 0) return "0";
  if (Number.isInteger(n) && Math.abs(n) >= 20) return String(n);
  return Number(n).toFixed(1);
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function comma0(n) {
  const x = asFinite(n);
  if (x === null) return "0";
  const rounded = Math.round(x);
  const sign = rounded < 0 ? "-" : "";
  const digits = String(Math.abs(rounded));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function mono(x, y, t, size = 7.0, fill = LABEL, weight = "500", anchor = "start", ls = 0.6) {
  return (
    `<text x="${f1(x)}" y="${f1(y)}" font-family="JetBrains Mono" font-size="${pyNum(size)}" ` +
    `font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" ` +
    `letter-spacing="${pyNum(ls)}">${escapeXml(t)}</text>`
  );
}

function inter(x, y, t, size = 8.4, fill = INK, weight = "400", anchor = "start") {
  return (
    `<text x="${f1(x)}" y="${f1(y)}" font-family="Inter" font-size="${pyNum(size)}" ` +
    `font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escapeXml(t)}</text>`
  );
}

function wrapNames(names, maxChars) {
  const lines = [];
  let cur = "";
  for (const n of names) {
    const piece = cur ? cur + ", " + n : n;
    if (piece.length > maxChars && cur) {
      lines.push(cur);
      cur = n;
    } else {
      cur = piece;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function wrapWords(text, maxChars) {
  const lines = [];
  let cur = "";
  for (const w of String(text).split(" ")) {
    const piece = cur ? cur + " " + w : w;
    if (piece.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = piece;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function svg(height, body, cap = null) {
  const h0 = asFinite(height);
  if (h0 === null || h0 <= 0) return CHART_SUPPRESSED;
  let caption = "";
  let h = h0;
  // Caption only — ignore non-string / empty. Negative numbers stringify but
  // are harmless labels; absurd length is capped so SVG stays printable.
  if (cap != null && cap !== "" && cap !== false) {
    let capText = String(cap);
    if (capText.length > 240) capText = capText.slice(0, 240);
    caption = mono(0, h0 + 12, capText, 6.4, MUTED, "500", "start", 1.0);
    h = h0 + 16;
  }
  return (
    `<div class="chart"><svg width="${f0(W)}pt" height="${f0(h)}pt" ` +
    `style="width:${f0(W)}pt;height:${f0(h)}pt" ` +
    `viewBox="0 0 ${f0(W)} ${f0(h)}" xmlns="http://www.w3.org/2000/svg" ` +
    `role="img">${SPEC_DEF}${body}${caption}</svg></div>`
  );
}

function scoreRowsOk(rows) {
  if (!Array.isArray(rows) || rows.length < 3) return false;
  let ok = 0;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue;
    if (asFinite(row[1]) === null) continue;
    ok++;
  }
  return ok >= 3;
}

function tankArgsOk(limit, balance, target_bal, pay_amount) {
  const lim = asFinite(limit);
  if (lim === null || lim <= 0) return false;
  return (
    asFinite(balance) !== null &&
    asFinite(target_bal) !== null &&
    asFinite(pay_amount) !== null
  );
}

function waterfallDrawable(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return false;
  let base = null;
  let total = null;
  for (const s of steps) {
    if (!Array.isArray(s) || s.length < 4) return false;
    const val = asFinite(s[2]);
    if (val === null) return false;
    if (s[3] === "base") base = val;
    if (s[3] === "total") total = val;
    if (s[3] === "gain" && val < 0) return false;
  }
  if (total === null || total <= 0) return false;
  // DIAGRAM_SPEC §6: projected <= current → suppress (no invented gain).
  if (base !== null && total <= base) return false;
  return true;
}

/**
 * DIAGRAM_SPEC §6 suppress rules for W3 (gold-report-shell) without editing the shell.
 * Call before embedding: if false, skip the chart slot.
 *
 * Args shapes:
 * - Chart call args array (same as tryFhChart), OR
 * - For money_chain / waterfall gain gate: `{ current, projected }`
 * - journey_map Track 1 is suppressed inside journey_map via opts.hasCleanBureau
 */
export function shouldDrawChart(name, args) {
  const n = String(name || "");
  if (n === "waterfall") {
    if (args && typeof args === "object" && !Array.isArray(args) && ("current" in args || "projected" in args)) {
      const c = asFinite(args.current);
      const p = asFinite(args.projected);
      return c !== null && p !== null && p > c;
    }
    const steps = Array.isArray(args) && Array.isArray(args[0]) && typeof args[0][0] !== "string"
      ? args[0]
      : args;
    return waterfallDrawable(steps);
  }
  if (n === "money_chain") {
    if (args && typeof args === "object" && !Array.isArray(args) && ("current" in args || "projected" in args)) {
      const c = asFinite(args.current);
      const p = asFinite(args.projected);
      return c !== null && p !== null && p > c;
    }
    const steps = Array.isArray(args) ? (Array.isArray(args[0]) ? args[0] : args) : null;
    return Array.isArray(steps) && steps.length >= 2;
  }
  if (n === "score_lineup") {
    const rows = Array.isArray(args) && Array.isArray(args[0]) ? args[0] : args;
    return scoreRowsOk(rows);
  }
  if (n === "utilization_tank") {
    const a = Array.isArray(args) ? args : [];
    return tankArgsOk(a[1], a[2], a[3], a[4]);
  }
  if (n === "utilization_bars") {
    const rows = Array.isArray(args) && Array.isArray(args[0]) ? args[0] : args;
    return Array.isArray(rows) && rows.length > 0 && rows.every((r) => Array.isArray(r) && asFinite(r[1]) !== null);
  }
  if (n === "unlock_ladder") {
    const tiers = Array.isArray(args) ? args[1] : null;
    return Array.isArray(tiers) && tiers.length > 0;
  }
  if (n === "severity_scale") {
    const items = Array.isArray(args) && Array.isArray(args[0]) ? args[0] : args;
    return Array.isArray(items) && items.length >= 3;
  }
  if (n === "timeline") {
    if (args && typeof args === "object" && !Array.isArray(args)) {
      return asFinite(args.end_lo) !== null && asFinite(args.end_hi) !== null;
    }
    const a = Array.isArray(args) ? args : [];
    return Array.isArray(a[0]) && a[0].length > 0 && asFinite(a[1]) !== null && asFinite(a[2]) !== null && asFinite(a[3]) !== null;
  }
  if (n === "application_order") {
    const steps = Array.isArray(args) && Array.isArray(args[0]) ? args[0] : args;
    return Array.isArray(steps) && steps.length > 0;
  }
  // journey_map / dispute_clock always drawable; Track 1 suppress is internal.
  return true;
}

export function waterfall(steps, cap = null) {
  if (!waterfallDrawable(steps)) return CHART_SUPPRESSED;
  const totals = steps.filter((s) => s[3] === "total").map((s) => asFinite(s[2]));
  const total = Math.max(...totals);
  const top = 34.0;
  const baseY = 176.0;
  const plotH = baseY - top;
  const scale = plotH / total;
  const n = steps.length;
  const colw = W / n;
  const barw = Math.min(96.0, colw - 62.0);

  const out = [
    `<line x1="0" y1="${f1(baseY)}" x2="${f0(W)}" y2="${f1(baseY)}" ` +
      `stroke="${INK}" stroke-width="0.9"/>`
  ];
  let running = 0.0;
  let prevTopX = null;
  let prevTopY = null;

  for (let i = 0; i < n; i++) {
    const [lab, sub, rawVal, kind] = steps[i];
    const val = asFinite(rawVal);
    if (val === null) return CHART_SUPPRESSED;
    const cx = colw * i + colw / 2.0;
    const x = cx - barw / 2.0;
    let ty;
    if (kind === "gain") {
      const y0 = baseY - (running + val) * scale;
      const h = val * scale;
      if (!Number.isFinite(y0) || !Number.isFinite(h) || h < 0) return CHART_SUPPRESSED;
      out.push(
        `<rect x="${f1(x)}" y="${f1(y0)}" width="${f1(barw)}" height="${f1(h)}" ` +
          `fill="#F2F2F4" stroke="${INK}" stroke-width="0.8"/>`
      );
      out.push(
        `<rect x="${f1(x)}" y="${f1(y0)}" width="${f1(barw)}" height="2" ` +
          `fill="url(#fhspec)"/>`
      );
      running += val;
      ty = y0;
    } else {
      const h = val * scale;
      const y0 = baseY - h;
      if (!Number.isFinite(y0) || !Number.isFinite(h) || h < 0) return CHART_SUPPRESSED;
      out.push(
        `<rect x="${f1(x)}" y="${f1(y0)}" width="${f1(barw)}" height="${f1(h)}" ` +
          `fill="${INK}"/>`
      );
      running = val;
      ty = y0;
    }
    out.push(
      mono(
        cx,
        ty - 8,
        kind !== "gain" ? `$${comma0(val)}` : `+$${comma0(val)}`,
        11.5,
        INK,
        "700",
        "middle",
        -0.2
      )
    );
    out.push(mono(cx, baseY + 15, String(lab).toUpperCase(), 6.4, LABEL, "500", "middle", 1.2));
    if (sub) {
      out.push(inter(cx, baseY + 27, sub, 7.4, MUTED, "400", "middle"));
    }
    if (prevTopX !== null) {
      out.push(
        `<line x1="${f1(prevTopX)}" y1="${f1(prevTopY)}" x2="${f1(x)}" ` +
          `y2="${f1(prevTopY)}" stroke="${MUTED}" stroke-width="0.7" ` +
          `stroke-dasharray="2.5 2"/>`
      );
    }
    prevTopX = x + barw;
    prevTopY = ty;
  }
  return svg(baseY + 34, out.join(""), cap);
}

export function unlock_ladder(current, tiers, lo = 620, hi = 710, cap = null) {
  if (!Array.isArray(tiers) || tiers.length === 0) return CHART_SUPPRESSED;
  const cur = asFinite(current);
  if (cur === null) return CHART_SUPPRESSED;
  let loN = asFinite(lo);
  let hiN = asFinite(hi);
  if (loN === null || hiN === null) return CHART_SUPPRESSED;
  for (const [s] of tiers) {
    const sn = asFinite(s);
    if (sn === null) return CHART_SUPPRESSED;
    if (sn < loN) loN = sn;
    if (sn > hiN) hiN = sn;
  }
  if (cur < loN) loN = cur;
  if (cur > hiN) hiN = cur;
  if (hiN <= loN) hiN = loN + 1;

  const x0 = 26.0;
  const x1 = W - 12.0;
  const railY = 44.0;

  function px(s) {
    return x0 + ((Number(s) - loN) / (hiN - loN)) * (x1 - x0);
  }

  const out = [
    `<rect x="${f1(x0)}" y="${f1(railY)}" width="${f1(x1 - x0)}" height="2.4" fill="${TRACK}"/>`
  ];
  const cx = px(cur);
  out.push(
    `<rect x="${f1(x0)}" y="${f1(railY)}" width="${f1(cx - x0)}" height="2.4" fill="${INK}"/>`
  );

  for (const [s] of tiers) {
    const gx = px(s);
    out.push(
      `<line x1="${f1(gx)}" y1="${f1(railY - 5)}" x2="${f1(gx)}" y2="${f1(railY + 8)}" ` +
        `stroke="${INK}" stroke-width="0.9"/>`
    );
    out.push(mono(gx, railY + 19, String(s), 7.0, LABEL, "500", "middle", 0.8));
  }

  out.push(
    `<polygon points="${f1(cx)},${f1(railY - 2)} ${f1(cx - 4.6)},${f1(railY - 10)} ` +
      `${f1(cx + 4.6)},${f1(railY - 10)}" fill="${INK}"/>`
  );
  const mark = `YOUR MEDIAN SCORE  ${cur}`;
  const half = (mark.length * (7.2 * 0.6 + 1.0)) / 2.0;
  let lx;
  let anch;
  if (cx - half < 0) {
    lx = 0.0;
    anch = "start";
  } else if (cx + half > W) {
    lx = W;
    anch = "end";
  } else {
    lx = cx;
    anch = "middle";
  }
  out.push(mono(lx, railY - 15, mark, 7.2, INK, "700", anch, 1.0));

  let y = railY + 42;
  for (const [s, names] of tiers) {
    const gap = Number.parseInt(s, 10) - Number.parseInt(cur, 10);
    out.push(
      `<line x1="0" y1="${f1(y - 13)}" x2="${f0(W)}" y2="${f1(y - 13)}" ` +
        `stroke="${HAIR}" stroke-width="0.7"/>`
    );
    out.push(`<rect x="0" y="${f1(y - 9)}" width="30" height="12.5" fill="${INK}"/>`);
    out.push(mono(15, y, String(s), 7.2, "#FFFFFF", "700", "middle", 0.4));
    out.push(mono(38, y, gap > 0 ? `+${gap} PTS` : "UNLOCKED", 6.6, LABEL, "500", "start", 1.0));
    const nameList = Array.isArray(names) ? names : [];
    const lines = wrapNames(nameList, 58);
    for (let j = 0; j < lines.length; j++) {
      out.push(inter(96, y + j * 10.4, lines[j], 8.2, INK, j === 0 ? "600" : "400"));
    }
    out.push(mono(W, y, `${nameList.length}`, 7.6, MUTED, "500", "end", 0));
    y += 14 + 10.4 * Math.max(0, lines.length - 1) + 12;
  }
  return svg(y - 8, out.join(""), cap);
}

export function utilization_bars(rows, target_pct = 10, cap = null) {
  if (!Array.isArray(rows) || rows.length === 0) return CHART_SUPPRESSED;
  const tgt = asFinite(target_pct);
  if (tgt === null) return CHART_SUPPRESSED;
  for (const row of rows) {
    if (!Array.isArray(row) || asFinite(row[1]) === null) return CHART_SUPPRESSED;
  }
  const lx = 0.0;
  const bx = 148.0;
  const bw = W - bx - 46.0;
  const rowh = 40.0;
  const out = [];
  let y = 14.0;
  const tx = bx + bw * (tgt / 100.0);

  for (const [lab, pct, detail] of rows) {
    const p = asFinite(pct);
    out.push(inter(lx, y + 1, lab, 9.0, INK, "700"));
    out.push(`<rect x="${f1(bx)}" y="${f1(y - 8)}" width="${f1(bw)}" height="13" fill="${TRACK}"/>`);
    const fillw = bw * (Math.min(p, 100) / 100.0);
    out.push(`<rect x="${f1(bx)}" y="${f1(y - 8)}" width="${f1(fillw)}" height="13" fill="${INK}"/>`);
    out.push(mono(W, y + 1, `${p}%`, 10.5, INK, "700", "end", -0.2));
    out.push(inter(lx, y + 14, detail, 7.6, MUTED));
    y += rowh;
  }

  const top = 14.0 - 12.0;
  const bot = y - rowh + 8.0;
  out.push(
    `<line x1="${f1(tx)}" y1="${f1(top)}" x2="${f1(tx)}" y2="${f1(bot)}" ` +
      `stroke="${INK}" stroke-width="0.9" stroke-dasharray="3 2.4"/>`
  );
  out.push(mono(tx, top - 4, `TARGET  ${tgt}%`, 6.4, INK, "700", "middle", 1.0));
  return svg(y - 14, out.join(""), cap);
}

export function timeline(months, start_score, end_lo, end_hi, lo = 620, hi = 720, cap = null) {
  if (!Array.isArray(months) || months.length < 2) return CHART_SUPPRESSED;
  const start = asFinite(start_score);
  const eLo = asFinite(end_lo);
  const eHi = asFinite(end_hi);
  if (start === null || eLo === null || eHi === null) return CHART_SUPPRESSED;
  let loN = asFinite(lo);
  let hiN = asFinite(hi);
  if (loN === null || hiN === null) return CHART_SUPPRESSED;
  for (const s of [start, eLo, eHi]) {
    if (s < loN) loN = s;
    if (s > hiN) hiN = s;
  }
  if (hiN <= loN) hiN = loN + 1;

  const n = months.length;
  const colw = W / n;
  const top = 30.0;
  const bandH = 96.0;
  const railY = top + bandH + 16.0;

  function py(score) {
    return top + bandH - ((Number(score) - loN) / (hiN - loN)) * bandH;
  }

  const xFirst = colw / 2.0;
  const xLast = colw * (n - 1) + colw / 2.0;
  const yS = py(start);
  const yLo = py(eLo);
  const yHi = py(eHi);

  const out = [
    `<polygon points="${f1(xFirst)},${f1(yS)} ${f1(xLast)},${f1(yHi)} ` +
      `${f1(xLast)},${f1(yLo)}" fill="#F2F2F4"/>`
  ];
  out.push(
    `<line x1="${f1(xFirst)}" y1="${f1(yS)}" x2="${f1(xLast)}" y2="${f1(yHi)}" ` +
      `stroke="${INK}" stroke-width="1.3"/>`
  );
  out.push(
    `<line x1="${f1(xFirst)}" y1="${f1(yS)}" x2="${f1(xLast)}" y2="${f1(yLo)}" ` +
      `stroke="${MUTED}" stroke-width="0.9" stroke-dasharray="3 2.4"/>`
  );
  out.push(
    `<rect x="${f1(xLast)}" y="${f1(yHi)}" width="2" ` +
      `height="${f1(Math.abs(yLo - yHi))}" fill="url(#fhspec)"/>`
  );

  out.push(`<circle cx="${f1(xFirst)}" cy="${f1(yS)}" r="3.1" fill="${INK}"/>`);
  out.push(mono(xFirst + 8, yS + 3, String(start), 9.5, INK, "700", "start", -0.2));
  out.push(mono(xFirst + 8, yS - 7, "TODAY", 6.0, MUTED, "500", "start", 1.2));
  out.push(mono(xLast - 8, yHi + 1, `${eLo}-${eHi}`, 9.5, INK, "700", "end", -0.2));
  out.push(mono(xLast - 8, yHi - 9, "PROJECTED", 6.0, MUTED, "500", "end", 1.2));

  out.push(
    `<line x1="0" y1="${f1(railY)}" x2="${f0(W)}" y2="${f1(railY)}" ` +
      `stroke="${TRACK}" stroke-width="2.4"/>`
  );

  const wrapped = months.map(([, , a]) => wrapNames(String(a).split(" \u00b7 "), 20));
  const maxlines = Math.max(1, ...wrapped.map((w) => w.length));
  const noteY = railY + 40 + maxlines * 9.4 + 2;

  for (let i = 0; i < n; i++) {
    const [num, phase, , note] = months[i];
    const cx = colw * i + colw / 2.0;
    out.push(`<circle cx="${f1(cx)}" cy="${f1(railY + 1.2)}" r="4.4" fill="${INK}"/>`);
    out.push(mono(cx, railY + 3.6, String(num), 6.0, "#FFFFFF", "700", "middle", 0));
    out.push(mono(cx, railY + 18, `MONTH ${num}`, 6.0, MUTED, "500", "middle", 1.1));
    out.push(inter(cx, railY + 29, phase, 8.4, INK, "700", "middle"));
    for (let j = 0; j < wrapped[i].length; j++) {
      out.push(inter(cx, railY + 40 + j * 9.4, wrapped[i][j], 7.2, MUTED, "400", "middle"));
    }
    if (note) {
      out.push(mono(cx, noteY, note, 6.4, INK, "700", "middle", 0.4));
    }
  }
  return svg(noteY + 12, out.join(""), cap);
}

export function utilization_tank(card_name, limit, balance, target_bal, pay_amount, cap = null) {
  if (!tankArgsOk(limit, balance, target_bal, pay_amount)) return CHART_SUPPRESSED;
  const lim = asFinite(limit);
  const bal = asFinite(balance);
  const tgtBal = asFinite(target_bal);
  const pay = asFinite(pay_amount);
  const pct = (bal / lim) * 100.0;
  const tgtPct = (tgtBal / lim) * 100.0;

  const t1x = 40.0;
  const t2x = 372.0;
  const tw = 96.0;
  const top = 46.0;
  const bot = 214.0;
  const th = bot - top;
  const gapC = (t1x + tw + t2x) / 2.0;

  function fillY(p) {
    return bot - (Math.min(Math.max(p, 0), 100) / 100.0) * th;
  }

  const out = [
    inter(
      0,
      13,
      `Your ${card_name} card holds $${comma0(lim)}. Right now it is ${f0(pct)}% full.`,
      11.0,
      INK,
      "700"
    )
  ];

  out.push(mono(t1x + tw / 2, 38, "TODAY", 7.0, LABEL, "500", "middle", 1.6));
  out.push(mono(t2x + tw / 2, 38, "THE GOAL", 7.0, INK, "700", "middle", 1.6));

  for (const tx of [t1x, t2x]) {
    out.push(
      `<path d="M ${f1(tx)} ${f1(top)} L ${f1(tx)} ${f1(bot)} ` +
        `L ${f1(tx + tw)} ${f1(bot)} L ${f1(tx + tw)} ${f1(top)}" ` +
        `fill="none" stroke="${INK}" stroke-width="1.3"/>`
    );
  }

  const fy1 = fillY(pct);
  out.push(
    `<rect x="${f1(t1x + 0.7)}" y="${f1(fy1)}" width="${f1(tw - 1.4)}" ` +
      `height="${f1(bot - fy1 - 0.7)}" fill="${INK}"/>`
  );
  const fy2 = fillY(tgtPct);
  out.push(
    `<rect x="${f1(t2x + 0.7)}" y="${f1(fy2)}" width="${f1(tw - 1.4)}" ` +
      `height="${f1(bot - fy2 - 0.7)}" fill="${INK}"/>`
  );

  out.push(
    `<line x1="${f1(t1x + tw)}" y1="${f1(fy1)}" x2="${f1(t1x + tw + 16)}" y2="${f1(fy1)}" ` +
      `stroke="${MUTED}" stroke-width="0.7"/>`
  );
  out.push(mono(t1x + tw + 20, fy1 + 4, `$${comma0(bal)}`, 12.5, INK, "700", "start", -0.3));
  out.push(mono(t1x + tw + 20, fy1 + 16, `${f0(pct)}% FULL`, 6.6, LABEL, "500", "start", 1.2));

  out.push(mono(t2x - 10, fy2 + 4, `$${comma0(tgtBal)}`, 10.5, INK, "700", "end", -0.2));

  const sy = fillY(10.0);
  out.push(
    `<line x1="${f1(t1x - 8)}" y1="${f1(sy)}" x2="${f1(t2x + tw + 8)}" y2="${f1(sy)}" ` +
      `stroke="${INK}" stroke-width="0.9" stroke-dasharray="3.2 2.6"/>`
  );
  out.push(
    mono(gapC, sy - 5, "THE SAFE ZONE \u00b7 UNDER 10%", 6.5, INK, "700", "middle", 1.1)
  );

  const ay = 118.0;
  out.push(
    `<line x1="${f1(t1x + tw + 58)}" y1="${f1(ay)}" x2="${f1(t2x - 24)}" y2="${f1(ay)}" ` +
      `stroke="${INK}" stroke-width="1.2"/>`
  );
  out.push(
    `<polygon points="${f1(t2x - 14)},${f1(ay)} ${f1(t2x - 25)},${f1(ay - 4.4)} ` +
      `${f1(t2x - 25)},${f1(ay + 4.4)}" fill="${INK}"/>`
  );
  out.push(mono(gapC, ay - 9, `PAY DOWN $${comma0(pay)}`, 7.6, INK, "700", "middle", 1.0));
  out.push(
    inter(gapC, ay + 15, "the fastest win on your entire report", 7.6, MUTED, "400", "middle")
  );

  const ty = bot + 23;
  out.push(
    inter(0, ty, "A nearly full card tells every lender 'I am maxed out.'", 9.4, INK, "600")
  );
  out.push(
    inter(
      0,
      ty + 15,
      "Get it under the dotted line and your score jumps. Your pre-approval jumps with it.",
      9.0,
      "#45454B"
    )
  );
  return svg(ty + 24, out.join(""), cap);
}

export function score_lineup(rows, cap = null) {
  if (!scoreRowsOk(rows)) return CHART_SUPPRESSED;
  const ranked = [...rows]
    .filter((r) => Array.isArray(r) && asFinite(r[1]) !== null)
    .sort((a, b) => asFinite(a[1]) - asFinite(b[1]))
    .slice(0, 3);
  if (ranked.length < 3) return CHART_SUPPRESSED;
  const loScore = asFinite(ranked[0][1]);
  const midScore = asFinite(ranked[1][1]);
  const hiScore = asFinite(ranked[2][1]);
  const spread = hiScore - loScore;

  const cw = 150.0;
  const gap = 12.0;
  const x0 = (W - (cw * 3 + gap * 2)) / 2.0;
  const top = 62.0;
  const ch = 116.0;

  const out = [
    inter(0, 13, "You do not have one credit score. You have three.", 11.0, INK, "700")
  ];

  const mcx = x0 + cw + gap + cw / 2.0;
  out.push(mono(mcx, 34, "LENDERS PICK THE MIDDLE SCORE", 7.0, INK, "700", "middle", 1.1));
  out.push(
    `<line x1="${f1(mcx)}" y1="${f1(40)}" x2="${f1(mcx)}" y2="${f1(top - 7)}" ` +
      `stroke="${INK}" stroke-width="1.2"/>`
  );
  out.push(
    `<polygon points="${f1(mcx)},${f1(top - 2)} ${f1(mcx - 4.6)},${f1(top - 9)} ` +
      `${f1(mcx + 4.6)},${f1(top - 9)}" fill="${INK}"/>`
  );

  const tags = ["LOWEST", "YOUR MIDDLE SCORE", "HIGHEST"];
  for (let i = 0; i < ranked.length; i++) {
    const [name, score, note] = ranked[i];
    const scoreN = asFinite(score);
    const x = x0 + i * (cw + gap);
    const isMid = i === 1;
    out.push(
      `<rect x="${f1(x)}" y="${f1(top)}" width="${f1(cw)}" height="${f1(ch)}" ` +
        `fill="#FFFFFF" stroke="${isMid ? INK : "#DDDDE1"}" ` +
        `stroke-width="${isMid ? 1.5 : 0.9}"/>`
    );
    if (isMid) {
      out.push(
        `<rect x="${f1(x)}" y="${f1(top)}" width="${f1(cw)}" height="2.4" ` +
          `fill="url(#fhspec)"/>`
      );
    }
    const cx = x + cw / 2.0;
    out.push(
      mono(cx, top + 20, String(name).toUpperCase(), 6.8, isMid ? INK : LABEL, "500", "middle", 1.4)
    );
    out.push(mono(cx, top + 58, String(scoreN), 28, INK, "700", "middle", -1.0));
    out.push(inter(cx, top + 78, note, 7.6, isMid ? "#45454B" : MUTED, "400", "middle"));
    out.push(
      mono(
        cx,
        top + ch - 8,
        tags[i],
        6.0,
        isMid ? INK : MUTED,
        isMid ? "700" : "500",
        "middle",
        1.0
      )
    );
  }

  const ty = top + ch + 22;
  out.push(
    inter(
      0,
      ty,
      `Line them up from lowest to highest. Lenders use the middle one. Yours is ${midScore}.`,
      9.4,
      INK,
      "600"
    )
  );
  out.push(
    inter(
      0,
      ty + 15,
      "They do not match because not every company reports to all three bureaus.",
      9.0,
      "#45454B"
    )
  );
  out.push(
    inter(
      0,
      ty + 29,
      `Your best and worst are ${spread} points apart. Closing that gap is the job.`,
      9.0,
      "#45454B"
    )
  );
  return svg(ty + 38, out.join(""), cap);
}

export function severity_scale(items, cap = null) {
  if (!Array.isArray(items) || items.length < 3) return CHART_SUPPRESSED;
  for (const it of items) {
    if (!Array.isArray(it) || asFinite(it[3]) === null) return CHART_SUPPRESSED;
  }
  const railY = 118.0;
  const rx0 = 10.0;
  const rx1 = W - 10.0;

  const out = [
    inter(0, 13, "Your 7 negative items are not equally bad.", 11.0, INK, "700")
  ];
  out.push(
    `<line x1="${f1(rx0)}" y1="${f1(railY)}" x2="${f1(rx1)}" y2="${f1(railY)}" ` +
      `stroke="${TRACK}" stroke-width="2.6"/>`
  );
  out.push(
    `<polygon points="${f1(rx1 + 6)},${f1(railY)} ${f1(rx1 - 3)},${f1(railY - 4.2)} ` +
      `${f1(rx1 - 3)},${f1(railY + 4.2)}" fill="${INK}"/>`
  );
  out.push(mono(rx0, railY + 15, "HURTS LESS \u00b7 EASIER TO FIX", 6.2, MUTED, "500", "start", 1.1));
  out.push(
    mono(rx1, railY + 15, "HURTS MOST \u00b7 FIX FIRST", 6.2, INK, "700", "end", 1.1)
  );

  for (const [num, name, note, fx, side] of items) {
    const x = rx0 + fx * (rx1 - rx0);
    const lx = Math.min(Math.max(x, 58.0), W - 58.0);
    if (side === "a") {
      const ly = 52.0;
      out.push(
        `<line x1="${f1(x)}" y1="${f1(railY - 8)}" x2="${f1(x)}" y2="${f1(ly + 16)}" ` +
          `stroke="${HAIR}" stroke-width="0.8"/>`
      );
      out.push(`<circle cx="${f1(x)}" cy="${f1(railY)}" r="7.2" fill="${INK}"/>`);
      out.push(mono(x, railY + 2.6, String(num), 6.6, "#FFFFFF", "700", "middle", 0));
      out.push(inter(lx, ly, name, 7.9, INK, "700", "middle"));
      const notes = wrapWords(note, 20);
      for (let j = 0; j < notes.length; j++) {
        out.push(inter(lx, ly + 10 + j * 9.0, notes[j], 7.0, MUTED, "400", "middle"));
      }
    } else {
      const ly = 160.0;
      out.push(
        `<line x1="${f1(x)}" y1="${f1(railY + 8)}" x2="${f1(x)}" y2="${f1(ly - 10)}" ` +
          `stroke="${HAIR}" stroke-width="0.8"/>`
      );
      out.push(`<circle cx="${f1(x)}" cy="${f1(railY)}" r="7.2" fill="${INK}"/>`);
      out.push(mono(x, railY + 2.6, String(num), 6.6, "#FFFFFF", "700", "middle", 0));
      out.push(inter(lx, ly, name, 7.9, INK, "700", "middle"));
      const notes = wrapWords(note, 20);
      for (let j = 0; j < notes.length; j++) {
        out.push(inter(lx, ly + 10 + j * 9.0, notes[j], 7.0, MUTED, "400", "middle"));
      }
    }
  }

  const ty = 206.0;
  out.push(
    inter(
      0,
      ty,
      "Start on the right. The SIGNET BANK charge-off sits on the file most lenders read first.",
      9.4,
      INK,
      "600"
    )
  );
  out.push(
    inter(
      0,
      ty + 15,
      "The two on the far left are paperwork errors. Letters get them removed.",
      9.0,
      "#45454B"
    )
  );
  return svg(ty + 24, out.join(""), cap);
}

export function money_chain(steps, headline, teach, cap = null) {
  if (!Array.isArray(steps) || steps.length < 2) return CHART_SUPPRESSED;
  const n = steps.length;
  const bw = 112.0;
  const bh = 90.0;
  const agap = (W - bw * n) / (n - 1);
  if (!Number.isFinite(agap)) return CHART_SUPPRESSED;
  const top = 30.0;

  const out = [inter(0, 13, headline, 11.0, INK, "700")];
  for (let i = 0; i < n; i++) {
    const [kick, bold, sub] = steps[i];
    const x = i * (bw + agap);
    const last = i === n - 1;
    out.push(
      `<rect x="${f1(x)}" y="${f1(top)}" width="${f1(bw)}" height="${f1(bh)}" ` +
        `fill="${last ? "#F6F6F8" : "#FFFFFF"}" ` +
        `stroke="${last ? INK : "#DDDDE1"}" ` +
        `stroke-width="${last ? 1.4 : 0.9}"/>`
    );
    if (last) {
      out.push(
        `<rect x="${f1(x)}" y="${f1(top)}" width="${f1(bw)}" height="2.4" ` +
          `fill="url(#fhspec)"/>`
      );
    }
    const cx = x + bw / 2.0;
    out.push(mono(cx, top + 15, kick, 5.8, LABEL, "500", "middle", 1.3));
    const blines = wrapWords(bold, 13);
    for (let j = 0; j < blines.length; j++) {
      out.push(inter(cx, top + 32 + j * 11.0, blines[j], 8.8, INK, "700", "middle"));
    }
    const sy = top + 32 + blines.length * 11.0 + 3;
    const slines = wrapWords(sub, 16);
    for (let j = 0; j < slines.length; j++) {
      out.push(mono(cx, sy + j * 9.6, slines[j], 6.9, "#45454B", "500", "middle", 0.2));
    }
    if (!last) {
      const ax0 = x + bw + 4;
      const ax1 = x + bw + agap - 4;
      const ay = top + bh / 2.0;
      out.push(
        `<line x1="${f1(ax0)}" y1="${f1(ay)}" x2="${f1(ax1 - 6)}" y2="${f1(ay)}" ` +
          `stroke="${INK}" stroke-width="1.2"/>`
      );
      out.push(
        `<polygon points="${f1(ax1)},${f1(ay)} ${f1(ax1 - 8)},${f1(ay - 4)} ` +
          `${f1(ax1 - 8)},${f1(ay + 4)}" fill="${INK}"/>`
      );
    }
  }

  const ty = top + bh + 24;
  out.push(inter(0, ty, teach, 9.4, INK, "600"));
  return svg(ty + 10, out.join(""), cap);
}

export function journey_map(cap = null, opts = {}) {
  const currentApproval = opts.currentApproval ?? 7936;
  const projectedApproval = opts.projectedApproval ?? 19841;
  const rawRounds = opts.disputeRounds ?? 3;
  const disputeRounds = Number(rawRounds) > 0 ? Number(rawRounds) : 3;
  const hasCleanBureau = opts.hasCleanBureau !== false;

  const title = hasCleanBureau
    ? "Your plan runs on two tracks at the same time."
    : "Your plan is repair rounds until a file is clean enough to apply.";
  const out = [inter(0, 13, title, 11.0, INK, "700")];

  const t1y = 64.0;
  const t2y = 156.0;
  const my = 110.0;

  out.push(mono(0, 82, "YOU ARE HERE", 6.0, INK, "700", "start", 1.2));
  out.push(`<rect x="0" y="88" width="70" height="44" fill="${INK}"/>`);
  out.push(mono(35, 107, "START", 7.4, "#FFFFFF", "700", "middle", 1.4));
  out.push(mono(35, 120, "DIAGNOSTIC DONE", 4.9, "#B9B9C0", "500", "middle", 0.8));

  const splitYs = hasCleanBureau ? [t1y, t2y] : [t2y];
  for (const yy of splitYs) {
    out.push(
      `<path d="M 70 ${f0(my)} L 82 ${f0(my)} L 82 ${f0(yy)} L 94 ${f0(yy)}" ` +
        `fill="none" stroke="${INK}" stroke-width="1.1"/>`
    );
  }

  if (hasCleanBureau) {
    out.push(mono(96, t1y - 14, "TRACK 1 \u00b7 FUND NOW", 6.4, INK, "700", "start", 1.3));
    out.push(`<rect x="96" y="${f0(t1y - 18 + 2)}" width="0" height="0" fill="none"/>`);
    out.push(
      `<rect x="96" y="${f0(t1y - 16 + 8)}" width="140" height="40" fill="#FFFFFF" ` +
        `stroke="${INK}" stroke-width="1.1"/>`
    );
    out.push(inter(166, t1y + 8, "Apply on your clean file", 7.6, INK, "700", "middle"));
    out.push(
      mono(166, t1y + 20, `$${comma0(currentApproval)} AVAILABLE TODAY`, 5.9, LABEL, "500", "middle", 0.7)
    );
    out.push(
      `<line x1="236" y1="${f0(t1y + 4)}" x2="330" y2="${f0(t1y + 4)}" ` +
        `stroke="${INK}" stroke-width="1.1"/>`
    );
  }

  out.push(mono(96, t2y - 14, "TRACK 2 \u00b7 REPAIR", 6.4, INK, "700", "start", 1.3));
  for (let i = 0; i < disputeRounds; i++) {
    const bx = 96 + i * 76;
    out.push(
      `<rect x="${bx}" y="${f0(t2y - 8)}" width="60" height="40" fill="#FFFFFF" ` +
        `stroke="${INK}" stroke-width="1.1"/>`
    );
    out.push(mono(bx + 30, t2y + 8, `ROUND ${i + 1}`, 6.4, INK, "700", "middle", 0.8));
    out.push(mono(bx + 30, t2y + 19, "DISPUTE", 5.2, MUTED, "500", "middle", 1.0));
    if (i < disputeRounds - 1) {
      out.push(
        `<line x1="${bx + 60}" y1="${f0(t2y + 12)}" x2="${bx + 74}" y2="${f0(t2y + 12)}" ` +
          `stroke="${INK}" stroke-width="1.1"/>`
      );
      out.push(
        `<polygon points="${bx + 76},${f0(t2y + 12)} ${bx + 69},${f0(t2y + 9)} ` +
          `${bx + 69},${f0(t2y + 15)}" fill="${INK}"/>`
      );
    }
  }
  out.push(
    mono(
      96,
      t2y + 46,
      "EACH ROUND: DISPUTE \u00b7 WAIT 30 DAYS \u00b7 VERIFY \u00b7 THEN THE NEXT",
      5.6,
      MUTED,
      "500",
      "start",
      0.9
    )
  );
  const lastBoxRight = 96 + (disputeRounds - 1) * 76 + 60;
  out.push(
    `<line x1="${lastBoxRight}" y1="${f0(t2y + 12)}" x2="330" y2="${f0(t2y + 12)}" ` +
      `stroke="${INK}" stroke-width="1.1"/>`
  );

  const mergeYs = hasCleanBureau ? [t1y + 4, t2y + 12] : [t2y + 12];
  for (const yy of mergeYs) {
    out.push(
      `<path d="M 330 ${f0(yy)} L 342 ${f0(yy)} L 342 ${f0(my)} L 352 ${f0(my)}" ` +
        `fill="none" stroke="${INK}" stroke-width="1.1"/>`
    );
  }
  out.push(`<polygon points="356,${f0(my)} 348,${f0(my - 3.6)} 348,${f0(my + 3.6)}" fill="${INK}"/>`);
  out.push(
    `<rect x="356" y="${f0(my - 20)}" width="62" height="40" fill="#FFFFFF" ` +
      `stroke="${INK}" stroke-width="1.1"/>`
  );
  out.push(mono(387, my - 3, "RE-CHECK", 6.2, INK, "700", "middle", 0.7));
  out.push(mono(387, my + 9, "FRESH REPORT", 5.0, MUTED, "500", "middle", 0.7));
  out.push(
    `<line x1="418" y1="${f0(my)}" x2="432" y2="${f0(my)}" ` +
      `stroke="${INK}" stroke-width="1.1"/>`
  );
  out.push(`<polygon points="436,${f0(my)} 428,${f0(my - 3.6)} 428,${f0(my + 3.6)}" fill="${INK}"/>`);

  out.push(
    `<rect x="436" y="${f0(my - 24)}" width="72" height="48" fill="#F6F6F8" ` +
      `stroke="${INK}" stroke-width="1.4"/>`
  );
  out.push(`<rect x="436" y="${f0(my - 24)}" width="72" height="2.4" fill="url(#fhspec)"/>`);
  out.push(mono(472, my - 2, `$${comma0(projectedApproval)}`, 9.8, INK, "700", "middle", -0.3));
  out.push(mono(472, my + 12, "BIGGER APPROVALS", 4.9, LABEL, "500", "middle", 0.7));

  const ty = t2y + 68;
  if (hasCleanBureau) {
    out.push(
      inter(
        0,
        ty,
        "You do not wait for repair to finish before you get money. Both tracks run at the same time.",
        9.4,
        INK,
        "600"
      )
    );
  } else {
    out.push(
      inter(
        0,
        ty,
        "There is no clean bureau to apply against today. Repair runs until there is.",
        9.4,
        INK,
        "600"
      )
    );
  }
  out.push(
    inter(0, ty + 15, "Each dispute round makes the next application round stronger.", 9.0, "#45454B")
  );
  return svg(ty + 24, out.join(""), cap);
}

export function dispute_clock(cap = null) {
  const bw = 112.0;
  const bh = 64.0;
  const top = 42.0;
  const agap = (W - bw * 4) / 3.0;
  const xs = [0, 1, 2, 3].map((i) => i * (bw + agap));
  const cyc = top + bh / 2.0;

  const out = [inter(0, 13, "Why disputes take rounds, not days.", 11.0, INK, "700")];

  const boxes = [
    ["STEP 1", "Send letters", "round 1 goes out"],
    ["STEP 2", "The 30 day clock", "the law gives bureaus 30 days"],
    ["STEP 3", "Results come back", "deleted \u00b7 updated \u00b7 verified"],
    ["STEP 4", "Still verified?", "we escalate, stronger letter"]
  ];
  for (let i = 0; i < boxes.length; i++) {
    const [kick, bold, sub] = boxes[i];
    const x = xs[i];
    out.push(
      `<rect x="${f1(x)}" y="${f1(top)}" width="${f1(bw)}" height="${f1(bh)}" ` +
        `fill="#FFFFFF" stroke="${INK}" stroke-width="0.9"/>`
    );
    const cx = x + bw / 2.0;
    out.push(mono(cx, top + 13, kick, 5.6, LABEL, "500", "middle", 1.3));
    out.push(inter(cx, top + 28, bold, 8.2, INK, "700", "middle"));
    const slines = wrapWords(sub, 17);
    for (let j = 0; j < slines.length; j++) {
      out.push(mono(cx, top + 41 + j * 9.2, slines[j], 6.0, "#45454B", "500", "middle", 0.2));
    }
    if (i < 3) {
      const ax0 = x + bw + 4;
      const ax1 = x + bw + agap - 4;
      out.push(
        `<line x1="${f1(ax0)}" y1="${f1(cyc)}" x2="${f1(ax1 - 6)}" y2="${f1(cyc)}" ` +
          `stroke="${INK}" stroke-width="1.1"/>`
      );
      out.push(
        `<polygon points="${f1(ax1)},${f1(cyc)} ${f1(ax1 - 8)},${f1(cyc - 4)} ` +
          `${f1(ax1 - 8)},${f1(cyc + 4)}" fill="${INK}"/>`
      );
    }
  }

  const ccx = xs[1] + bw - 16;
  const ccy = top + 14;
  const r = 8.0;
  out.push(
    `<circle cx="${f1(ccx)}" cy="${f1(ccy)}" r="${f1(r)}" fill="#FFFFFF" ` +
      `stroke="${INK}" stroke-width="1.0"/>`
  );
  out.push(
    `<line x1="${f1(ccx)}" y1="${f1(ccy)}" x2="${f1(ccx)}" y2="${f1(ccy - 5.4)}" ` +
      `stroke="${INK}" stroke-width="1.0"/>`
  );
  out.push(
    `<line x1="${f1(ccx)}" y1="${f1(ccy)}" x2="${f1(ccx + 3.8)}" y2="${f1(ccy + 1.6)}" ` +
      `stroke="${INK}" stroke-width="1.0"/>`
  );

  const ex = xs[2] + bw / 2.0;
  out.push(
    `<line x1="${f1(ex)}" y1="${f1(top + bh)}" x2="${f1(ex)}" y2="${f1(top + bh + 16)}" ` +
      `stroke="${INK}" stroke-width="1.1"/>`
  );
  out.push(
    `<polygon points="${f1(ex)},${f1(top + bh + 20)} ${f1(ex - 3.6)},${f1(top + bh + 12)} ` +
      `${f1(ex + 3.6)},${f1(top + bh + 12)}" fill="${INK}"/>`
  );
  out.push(
    mono(ex, top + bh + 31, "DELETED = OFF YOUR REPORT", 6.2, INK, "700", "middle", 0.9)
  );

  const lx0 = xs[3] + bw / 2.0;
  const lx1 = xs[0] + bw / 2.0;
  const ly = 28.0;
  out.push(
    `<path d="M ${f1(lx0)} ${f1(top)} L ${f1(lx0)} ${f1(ly)} L ${f1(lx1)} ${f1(ly)} ` +
      `L ${f1(lx1)} ${f1(top - 4)}" fill="none" stroke="${MUTED}" ` +
      `stroke-width="0.9" stroke-dasharray="3 2.4"/>`
  );
  out.push(
    `<polygon points="${f1(lx1)},${f1(top - 1)} ${f1(lx1 - 3.6)},${f1(top - 8)} ` +
      `${f1(lx1 + 3.6)},${f1(top - 8)}" fill="${MUTED}"/>`
  );
  out.push(mono((lx0 + lx1) / 2.0, ly - 5, "ROUND 2 \u00b7 ROUND 3", 6.0, MUTED, "500", "middle", 1.1));

  const ty = top + bh + 50;
  out.push(
    inter(0, ty, "One round rarely clears everything. Three rounds is normal.", 9.4, INK, "600")
  );
  out.push(
    inter(
      0,
      ty + 15,
      "The 30 day clock is set by law. That is why this takes months, not days.",
      9.0,
      "#45454B"
    )
  );
  return svg(ty + 24, out.join(""), cap);
}

export function application_order(steps, cap = null) {
  if (!Array.isArray(steps) || steps.length === 0) return CHART_SUPPRESSED;
  const out = [
    inter(0, 13, "The order protects your score. Follow it exactly.", 11.0, INK, "700")
  ];
  const top = 36.0;
  const rowh = 37.0;
  const cxch = 11.0;

  const n = steps.length;
  if (n === 1) {
    // Single step: still draw the path without a zero-length rail.
    out.push(`<circle cx="${f1(cxch)}" cy="${f1(top + 6)}" r="8" fill="${INK}"/>`);
    out.push(mono(cxch, top + 8.8, "1", 7.2, "#FFFFFF", "700", "middle", 0));
    out.push(inter(28, top + 5, steps[0][0], 8.8, INK, "700"));
    out.push(mono(28, top + 17, steps[0][1], 6.3, LABEL, "500", "start", 0.5));
    const ty = top + 40;
    out.push(
      inter(0, ty, "The same five applications in the wrong order get declined.", 9.4, INK, "600")
    );
    return svg(ty + 10, out.join(""), cap);
  }
  out.push(
    `<line x1="${f1(cxch)}" y1="${f1(top + 6)}" x2="${f1(cxch)}" ` +
      `y2="${f1(top + (n - 1) * rowh + 6)}" stroke="${TRACK}" stroke-width="2"/>`
  );
  for (let i = 0; i < n; i++) {
    const [bold, sub] = steps[i];
    const y = top + i * rowh;
    out.push(`<circle cx="${f1(cxch)}" cy="${f1(y + 6)}" r="8" fill="${INK}"/>`);
    out.push(mono(cxch, y + 8.8, String(i + 1), 7.2, "#FFFFFF", "700", "middle", 0));
    out.push(inter(28, y + 5, bold, 8.8, INK, "700"));
    out.push(mono(28, y + 17, sub, 6.3, LABEL, "500", "start", 0.5));
  }

  const px = 330.0;
  const pw = 178.0;
  const py = top - 2;
  const ph = (n - 1) * rowh + 16;
  out.push(
    `<rect x="${f1(px)}" y="${f1(py)}" width="${f1(pw)}" height="${f1(ph)}" ` +
      `fill="#F6F6F8" stroke="#DDDDE1" stroke-width="0.9"/>`
  );
  const ccx = px + pw / 2.0;
  const ccy = py + ph / 2.0 - 12;
  out.push(`<circle cx="${f1(ccx)}" cy="${f1(ccy)}" r="4" fill="${MUTED}"/>`);
  for (let k = 0; k < 6; k++) {
    const ang = -80 + k * 33;
    const a = (ang * Math.PI) / 180;
    const ex = ccx + 52 * Math.cos(a);
    const ey = ccy + 52 * Math.sin(a);
    out.push(
      `<line x1="${f1(ccx)}" y1="${f1(ccy)}" x2="${f1(ex)}" y2="${f1(ey)}" ` +
        `stroke="${MUTED}" stroke-width="0.9"/>`
    );
    out.push(
      `<circle cx="${f1(ex)}" cy="${f1(ey)}" r="2.2" fill="none" ` +
        `stroke="${MUTED}" stroke-width="0.9"/>`
    );
  }
  out.push(
    `<line x1="${f1(px + 14)}" y1="${f1(py + 12)}" x2="${f1(px + pw - 14)}" ` +
      `y2="${f1(py + ph - 30)}" stroke="${INK}" stroke-width="2.2"/>`
  );
  out.push(
    `<line x1="${f1(px + pw - 14)}" y1="${f1(py + 12)}" x2="${f1(px + 14)}" ` +
      `y2="${f1(py + ph - 30)}" stroke="${INK}" stroke-width="2.2"/>`
  );
  out.push(mono(ccx, py + ph - 16, "THE SHOTGUN", 6.6, INK, "700", "middle", 1.2));
  out.push(
    mono(ccx, py + ph - 6, "HARD INQUIRIES \u00b7 AUTO-DECLINES", 5.4, MUTED, "500", "middle", 0.8)
  );

  const ty = top + (n - 1) * rowh + 40;
  out.push(
    inter(0, ty, "The same five applications in the wrong order get declined.", 9.4, INK, "600")
  );
  return svg(ty + 10, out.join(""), cap);
}

export { unwrapChart, parseChart, drawChart, SPECTRUM_STOPS } from "./fh-charts-embed.mjs";


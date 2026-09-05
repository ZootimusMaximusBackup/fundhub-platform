// The hand-drawn line art, ported from scripts/black-reports/fundhub_gen.py:
// 602-805. Eight chart builders plus the two shared primitives (ARROW_DEF and
// _box). There is no charting library behind any of it, in Python or here — the
// coordinates are arithmetic and the output is an SVG string.
//
// Ported faithfully: same viewBoxes, same coordinates, same copy. The one
// deliberate difference is that every interpolated value is escaped, where the
// Python left a few of them raw.

import { esc } from "./escape.mjs";

export const ARROW_DEF =
  '<defs><marker id="ah" markerWidth="7" markerHeight="7" refX="6" refY="3.5" '
  + 'orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="#111"/></marker>'
  + '<linearGradient id="rb" x1="0" y1="0" x2="1" y2="0">'
  + '<stop offset="0" stop-color="#7b5cff"/><stop offset=".25" stop-color="#3aa0ff"/>'
  + '<stop offset=".5" stop-color="#2fd6c3"/><stop offset=".7" stop-color="#7bd44a"/>'
  + '<stop offset=".85" stop-color="#f5c542"/><stop offset="1" stop-color="#ff7a45"/>'
  + "</linearGradient></defs>";

/**
 * Python _box(). `lines` is [text, fontSize, fontWeight, colour|null].
 * The text block is centred on the box, 13 units of leading per line.
 */
export function box(x, y, w, h, lines, { fill = "#fff", stroke = "#111", sw = 1.5, tcol = "#111" } = {}) {
  const out = [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" `
    + `stroke="${stroke}" stroke-width="${sw}"/>`
  ];
  let cy = y + h / 2 - (lines.length - 1) * 6;
  for (const [txt, size, weight, col] of lines) {
    out.push(
      `<text x="${x + w / 2}" y="${cy}" text-anchor="middle" font-size="${size}" `
      + `font-weight="${weight}" fill="${col || tcol}" letter-spacing="1">${esc(txt)}</text>`
    );
    cy += 13;
  }
  return out.join("");
}

/** 1/8 — the two-track plan: fund now on the clean file, dispute in parallel. */
export function svgTwoTrack(now, after) {
  const s = [`<svg class="diagram" viewBox="0 0 700 210" width="100%">${ARROW_DEF}`];
  s.push('<text x="8" y="52" font-size="7" letter-spacing="2" fill="#111" '
    + 'font-weight="bold">YOU ARE HERE</text>');
  s.push(box(8, 60, 92, 52, [["START", 9, "bold", "#fff"],
    ["DIAGNOSTIC DONE", 5.5, "normal", "#9a9a9a"]], { fill: "#111" }));
  s.push('<text x="170" y="30" font-size="6.5" letter-spacing="2" fill="#777">TRACK 1 · FUND NOW</text>');
  s.push(box(170, 38, 190, 46, [["Apply on your clean file", 9.5, "bold", null],
    [`${now} AVAILABLE TODAY`, 6.5, "normal", "#999"]]));
  s.push('<text x="170" y="122" font-size="6.5" letter-spacing="2" fill="#777">TRACK 2 · REPAIR</text>');
  [170, 258, 346].forEach((x, i) => {
    s.push(box(x, 130, 74, 44, [[`ROUND ${i + 1}`, 8.5, "bold", null],
      ["DISPUTE", 5.5, "normal", "#999"]]));
    if (i < 2) {
      s.push(`<line x1="${x + 74}" y1="152" x2="${x + 88}" y2="152" stroke="#111" `
        + 'stroke-width="1.5" marker-end="url(#ah)"/>');
    }
  });
  // connectors: start -> both tracks, both tracks -> recheck
  s.push('<path d="M100,74 L134,74 L134,61 L170,61" fill="none" stroke="#111" stroke-width="1.5"/>');
  s.push('<path d="M100,98 L134,98 L134,152 L170,152" fill="none" stroke="#111" stroke-width="1.5"/>');
  s.push('<path d="M360,61 L470,61 L470,96 L492,96" fill="none" stroke="#111" stroke-width="1.5" marker-end="url(#ah)"/>');
  s.push('<path d="M420,152 L470,152 L470,116 L492,116" fill="none" stroke="#111" stroke-width="1.5"/>');
  s.push(box(492, 82, 76, 48, [["RE-CHECK", 8, "bold", null],
    ["FRESH REPORT", 5.5, "normal", "#999"]]));
  s.push('<line x1="568" y1="106" x2="588" y2="106" stroke="#111" stroke-width="1.5" marker-end="url(#ah)"/>');
  s.push('<rect x="590" y="78" width="102" height="6" fill="url(#rb)"/>');
  s.push(box(590, 84, 102, 48, [[after, 12, "bold", null],
    ["BIGGER APPROVALS", 5.5, "normal", "#999"]], { sw: 2 }));
  s.push('<text x="170" y="192" font-size="6" letter-spacing="2" fill="#aaa">'
    + "EACH ROUND: DISPUTE · WAIT 30 DAYS · VERIFY · THEN THE NEXT</text>");
  s.push("</svg>");
  return s.join("");
}

/** 2/8 — today's balance against the under-10% goal. */
export function svgPaydownBars(bal, amt, target) {
  const s = [`<svg class="diagram" viewBox="0 0 700 265" width="100%">${ARROW_DEF}`];
  s.push('<text x="115" y="16" text-anchor="middle" font-size="7" letter-spacing="2" fill="#777">TODAY</text>');
  s.push('<text x="592" y="16" text-anchor="middle" font-size="7" letter-spacing="2" fill="#111" font-weight="bold">THE GOAL</text>');
  s.push('<rect x="55" y="28" width="120" height="212" fill="#111"/>');
  s.push('<line x1="175" y1="34" x2="205" y2="34" stroke="#111" stroke-width="1"/>');
  s.push(`<text x="212" y="38" font-size="14" font-weight="bold">${esc(bal)}</text>`);
  s.push('<text x="212" y="52" font-size="6.5" letter-spacing="2" fill="#999">93% FULL</text>');
  s.push('<text x="390" y="118" text-anchor="middle" font-size="8" font-weight="bold" '
    + `letter-spacing="2">PAY DOWN ${esc(amt)}</text>`);
  s.push('<line x1="255" y1="132" x2="520" y2="132" stroke="#111" stroke-width="2" marker-end="url(#ah)"/>');
  s.push('<text x="390" y="152" text-anchor="middle" font-size="7.5" fill="#999" '
    + 'font-family="Inter">the fastest win on your entire report</text>');
  s.push('<line x1="20" y1="218" x2="680" y2="218" stroke="#111" stroke-width="1" stroke-dasharray="4,4"/>');
  s.push('<text x="350" y="212" text-anchor="middle" font-size="7" letter-spacing="2" '
    + 'font-weight="bold">THE SAFE ZONE · UNDER 10%</text>');
  s.push(`<text x="524" y="224" text-anchor="end" font-size="11" font-weight="bold">${esc(target)}</text>`);
  s.push('<rect x="532" y="222" width="120" height="18" fill="#111"/>');
  s.push('<line x1="532" y1="28" x2="532" y2="240" stroke="#111" stroke-width="1"/>');
  s.push('<line x1="652" y1="28" x2="652" y2="240" stroke="#111" stroke-width="1"/>');
  s.push("</svg>");
  return s.join("");
}

/**
 * 3/8 — the negatives on a severity line, least damaging on the left.
 * `items` is [number, name, sub], and the caller must pass at least two: the
 * spacing divides by (n - 1), exactly as the Python does.
 */
export function svgSeverity(items) {
  const s = [`<svg class="diagram" viewBox="0 0 700 190" width="100%">${ARROW_DEF}`];
  const y = 95;
  s.push(`<line x1="20" y1="${y}" x2="668" y2="${y}" stroke="#111" stroke-width="2"/>`);
  s.push(`<path d="M668,${y - 5} L680,${y} L668,${y + 5} z" fill="#111"/>`);
  const n = items.length;
  items.forEach(([num, name, sub], i) => {
    const x = 55 + i * (590 / (n - 1));
    const above = i % 2 === 0;
    const ly = above ? y - 42 : y + 44;
    s.push(`<line x1="${x}" y1="${y}" x2="${x}" y2="${ly + (above ? 8 : -14)}" `
      + 'stroke="#ccc" stroke-width="1"/>');
    s.push(`<circle cx="${x}" cy="${y}" r="9" fill="#111"/>`);
    s.push(`<text x="${x}" y="${y + 3}" text-anchor="middle" font-size="7.5" fill="#fff">${esc(num)}</text>`);
    s.push(`<text x="${x}" y="${ly}" text-anchor="middle" font-size="8" `
      + `font-weight="bold" font-family="Inter">${esc(name)}</text>`);
    s.push(`<text x="${x}" y="${ly + 11}" text-anchor="middle" font-size="6.8" fill="#999" `
      + `font-family="Inter">${esc(sub)}</text>`);
  });
  s.push(`<text x="30" y="${y + 22}" font-size="6" letter-spacing="2" fill="#999">HURTS LESS · EASIER TO FIX</text>`);
  s.push(`<text x="668" y="${y + 22}" text-anchor="end" font-size="6" letter-spacing="2" `
    + 'font-weight="bold">HURTS MOST · FIX FIRST</text>');
  s.push("</svg>");
  return s.join("");
}

/** 4/8 — today's pre-approval, the gain, and the projected total. */
export function svgWaterfall(vNow, vDelta, vAfter, labels) {
  const s = [`<svg class="diagram" viewBox="0 0 700 250" width="100%">${ARROW_DEF}`];
  const base = 205;
  const top1 = 130;
  const top2 = 45;
  s.push(`<text x="130" y="${top1 - 10}" text-anchor="middle" font-size="13" font-weight="bold">${esc(vNow)}</text>`);
  s.push(`<rect x="65" y="${top1}" width="130" height="${base - top1}" fill="#111"/>`);
  s.push(`<line x1="195" y1="${top1}" x2="290" y2="${top1}" stroke="#aaa" stroke-dasharray="3,3"/>`);
  s.push(`<text x="355" y="${top2 - 10}" text-anchor="middle" font-size="13" font-weight="bold">${esc(vDelta)}</text>`);
  s.push(`<rect x="290" y="${top2}" width="130" height="4" fill="url(#rb)"/>`);
  s.push(`<rect x="290" y="${top2 + 4}" width="130" height="${top1 - top2 - 4}" fill="#f4f4f4" stroke="#111" stroke-width="1.2"/>`);
  s.push(`<line x1="420" y1="${top2}" x2="530" y2="${top2}" stroke="#aaa" stroke-dasharray="3,3"/>`);
  s.push(`<text x="595" y="${top2 - 10}" text-anchor="middle" font-size="13" font-weight="bold">${esc(vAfter)}</text>`);
  s.push(`<rect x="530" y="${top2}" width="130" height="${base - top2}" fill="#111"/>`);
  s.push(`<line x1="30" y1="${base}" x2="680" y2="${base}" stroke="#111" stroke-width="1.2"/>`);
  [130, 355, 595].forEach((cx, i) => {
    const pair = labels[i];
    if (!pair) return;
    const [t, b] = pair;
    s.push(`<text x="${cx}" y="${base + 18}" text-anchor="middle" font-size="6.5" `
      + `letter-spacing="2" fill="#777">${esc(t)}</text>`);
    s.push(`<text x="${cx}" y="${base + 31}" text-anchor="middle" font-size="7.5" fill="#999" `
      + `font-family="Inter">${esc(b)}</text>`);
  });
  s.push("</svg>");
  return s.join("");
}

/** 5/8 — the median score on a ruler of lender score floors. */
export function svgScoreRuler(med, { ticks = [640, 650, 660, 680, 700], lo = 615, hi = 712 } = {}) {
  const X = (v) => 30 + ((v - lo) / (hi - lo)) * 630;
  const s = ['<svg class="diagram" viewBox="0 0 700 60" width="100%">'];
  s.push(`<text x="${X(med) - 4}" y="12" font-size="7.5" letter-spacing="2" `
    + `font-weight="bold">YOUR MEDIAN SCORE ${esc(med)}</text>`);
  s.push('<line x1="30" y1="30" x2="660" y2="30" stroke="#bbb" stroke-width="1.5"/>');
  s.push(`<line x1="30" y1="30" x2="${X(med)}" y2="30" stroke="#111" stroke-width="3"/>`);
  s.push(`<path d="M${X(med) - 6},19 L${X(med) + 6},19 L${X(med)},29 z" fill="#111"/>`);
  for (const t of ticks) {
    s.push(`<line x1="${X(t)}" y1="24" x2="${X(t)}" y2="36" stroke="#888"/>`);
    s.push(`<text x="${X(t)}" y="50" text-anchor="middle" font-size="7.5" fill="#777">${esc(t)}</text>`);
  }
  s.push("</svg>");
  return s.join("");
}

/** 6/8 — the crossed-out "shotgun": applying everywhere at once. */
export function svgShotgun() {
  const s = ['<svg viewBox="0 0 200 190" width="100%">'];
  s.push('<rect x="1" y="1" width="198" height="188" fill="#fafafa" stroke="#ddd"/>');
  const pts = [[52, 38], [120, 30], [158, 55], [165, 95], [140, 132], [68, 128]];
  for (const [px, py] of pts) {
    s.push(`<line x1="100" y1="85" x2="${px}" y2="${py}" stroke="#bbb" stroke-width="1"/>`);
    s.push(`<circle cx="${px}" cy="${py}" r="3.5" fill="#fff" stroke="#999"/>`);
  }
  s.push('<circle cx="100" cy="85" r="4" fill="#888"/>');
  s.push('<line x1="18" y1="18" x2="182" y2="152" stroke="#111" stroke-width="5"/>');
  s.push('<line x1="182" y1="18" x2="18" y2="152" stroke="#111" stroke-width="5"/>');
  s.push('<text x="100" y="166" text-anchor="middle" font-size="8.5" letter-spacing="2" '
    + 'font-weight="bold">THE SHOTGUN</text>');
  s.push('<text x="100" y="179" text-anchor="middle" font-size="6" letter-spacing="1.5" '
    + 'fill="#999">HARD INQUIRIES · AUTO-DECLINES</text>');
  s.push("</svg>");
  return s.join("");
}

/** 7/8 — today's score against the projected range. */
export function svgProjection(today, projected) {
  const s = ['<svg class="diagram" viewBox="0 0 700 140" width="100%">'];
  s.push('<defs><linearGradient id="rb2" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#7b5cff"/><stop offset=".5" stop-color="#2fd6c3"/>'
    + '<stop offset="1" stop-color="#f5c542"/></linearGradient></defs>');
  s.push('<polygon points="90,112 648,42 648,58" fill="#efefef"/>');
  s.push('<line x1="90" y1="112" x2="648" y2="58" stroke="#aaa" stroke-width="1" stroke-dasharray="3,3"/>');
  s.push('<line x1="90" y1="112" x2="648" y2="42" stroke="#111" stroke-width="2"/>');
  s.push('<circle cx="90" cy="112" r="4" fill="#111"/>');
  s.push('<text x="78" y="102" text-anchor="end" font-size="6.5" letter-spacing="2" fill="#999">TODAY</text>');
  s.push(`<text x="78" y="116" text-anchor="end" font-size="10" font-weight="bold">${esc(today)}</text>`);
  s.push('<text x="640" y="20" text-anchor="end" font-size="6.5" letter-spacing="2" fill="#999">PROJECTED</text>');
  s.push(`<text x="640" y="34" text-anchor="end" font-size="10" font-weight="bold">${esc(projected)}</text>`);
  s.push('<rect x="648" y="38" width="5" height="24" fill="url(#rb2)"/>');
  s.push("</svg>");
  return s.join("");
}

/** 8/8 — what one dispute round is, and why it loops. */
export function svgDisputeFlow() {
  const s = [`<svg class="diagram" viewBox="0 0 700 200" width="100%">${ARROW_DEF}`];
  const boxes = [
    ["STEP 1", "Send letters", "round 1 goes out"],
    ["STEP 2", "The 30 day clock", "the law gives|bureaus 30 days"],
    ["STEP 3", "Results come back", "deleted · updated|· verified"],
    ["STEP 4", "Still verified?", "we escalate,|stronger letter"]
  ];
  const bw = 150;
  const bh = 74;
  const y0 = 52;
  const gap = 26;
  const xs = [0, 1, 2, 3].map((i) => 12 + i * (bw + gap));
  s.push(`<text x="${xs[1] + bw + gap / 2}" y="16" text-anchor="middle" font-size="6.5" `
    + 'letter-spacing="2" fill="#999">ROUND 2 · ROUND 3</text>');
  s.push(`<path d="M${xs[3] + bw / 2},${y0} L${xs[3] + bw / 2},26 L${xs[1] + bw / 2},26 L${xs[1] + bw / 2},${y0}" `
    + 'fill="none" stroke="#aaa" stroke-width="1" stroke-dasharray="3,3" marker-end="url(#ah)"/>');
  boxes.forEach(([lbl, t, sub], i) => {
    const x = xs[i];
    s.push(`<rect x="${x}" y="${y0}" width="${bw}" height="${bh}" fill="#fff" stroke="#111" stroke-width="1.5"/>`);
    s.push(`<text x="${x + bw / 2}" y="${y0 + 18}" text-anchor="middle" font-size="6" letter-spacing="2" fill="#999">${lbl}</text>`);
    s.push(`<text x="${x + bw / 2}" y="${y0 + 35}" text-anchor="middle" font-size="9.5" `
      + `font-weight="bold" font-family="Inter">${esc(t)}</text>`);
    sub.split("|").forEach((ln, j) => {
      s.push(`<text x="${x + bw / 2}" y="${y0 + 50 + j * 11}" text-anchor="middle" font-size="6.8" `
        + `fill="#999">${esc(ln)}</text>`);
    });
  });
  for (const x of xs.slice(0, -1)) {
    s.push(`<line x1="${x + bw}" y1="${y0 + bh / 2}" x2="${x + bw + gap - 6}" y2="${y0 + bh / 2}" `
      + 'stroke="#111" stroke-width="1.8" marker-end="url(#ah)"/>');
  }
  const clockX = xs[1] + bw - 14;
  const clockY = y0 + 14;
  s.push(`<circle cx="${clockX}" cy="${clockY}" r="8" fill="#fff" stroke="#111" stroke-width="1.3"/>`);
  s.push(`<line x1="${clockX}" y1="${clockY}" x2="${clockX}" y2="${y0 + 9}" stroke="#111"/>`);
  s.push(`<line x1="${clockX}" y1="${clockY}" x2="${xs[1] + bw - 10}" y2="${clockY}" stroke="#111"/>`);
  const cx = xs[2] + bw / 2;
  s.push(`<line x1="${cx}" y1="${y0 + bh}" x2="${cx}" y2="${y0 + bh + 22}" stroke="#111" `
    + 'stroke-width="1.8" marker-end="url(#ah)"/>');
  s.push(`<text x="${cx}" y="${y0 + bh + 40}" text-anchor="middle" font-size="7.5" `
    + 'letter-spacing="2" font-weight="bold">DELETED = OFF YOUR REPORT</text>');
  s.push("</svg>");
  return s.join("");
}

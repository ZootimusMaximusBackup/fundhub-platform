// pdf-lib cannot embed SVG. Charts stay SVG strings (pure, snapshot-testable).
// This helper unwraps them and draws the closed primitive set onto a pdf-lib
// page: rect, line, polygon, circle, path, text, plus the 2pt spectrum hairline.
//
// W3 must pass embedded Inter + JetBrains Mono (sans/sansBold/mono/monoBold).
// No new npm dependency.

import { rgb } from "pdf-lib";

export const SPECTRUM_STOPS = [
  [0, [0x8b, 0x5c, 0xf6]],
  [0.22, [0x3b, 0x82, 0xf6]],
  [0.45, [0x22, 0xd3, 0xee]],
  [0.66, [0x34, 0xd3, 0x99]],
  [0.84, [0xfb, 0xbf, 0x24]],
  [1, [0xf9, 0x70, 0x66]]
];

const SKIP_TAGS = new Set(["stop", "defs", "linearGradient", "svg"]);

export function unwrapChart(wrapped) {
  const html = String(wrapped);
  const svgMatch = html.match(/<svg\b[\s\S]*<\/svg>/);
  const svg = svgMatch ? svgMatch[0] : html;
  const wm = svg.match(/\bwidth="([\d.]+)pt"/);
  const hm = svg.match(/\bheight="([\d.]+)pt"/);
  return {
    widthPt: wm ? Number(wm[1]) : 508,
    heightPt: hm ? Number(hm[1]) : 0,
    svg
  };
}

function parseAttrs(raw) {
  const o = {};
  const re = /([A-Za-z_:][\w:.-]*)="([^"]*)"/g;
  let m;
  while ((m = re.exec(raw))) o[m[1]] = m[2];
  return o;
}

function decodeXml(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
}

export function parseChart(wrapped) {
  const { widthPt, heightPt, svg } = unwrapChart(wrapped);
  const inner = svg.replace(/^<svg\b[^>]*>/, "").replace(/<\/svg>$/, "");
  const elements = [];
  const re = /<text\b([^>]*)>([^<]*)<\/text>|<([a-zA-Z]+)\b([^>]*)\/>/g;
  let m;
  while ((m = re.exec(inner))) {
    if (m[3]) {
      const tag = m[3];
      if (SKIP_TAGS.has(tag)) continue;
      elements.push({ tag, attrs: parseAttrs(m[4]), text: "" });
    } else {
      elements.push({ tag: "text", attrs: parseAttrs(m[1]), text: decodeXml(m[2]) });
    }
  }
  return { widthPt, heightPt, elements };
}

function hexToRgb(hex) {
  const h = String(hex).replace("#", "");
  if (h.length !== 6) return rgb(0, 0, 0);
  return rgb(
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255
  );
}

function spectrumAt(t) {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < SPECTRUM_STOPS.length; i++) {
    if (x <= SPECTRUM_STOPS[i][0]) {
      const [t0, c0] = SPECTRUM_STOPS[i - 1];
      const [t1, c1] = SPECTRUM_STOPS[i];
      const u = (t1 - t0) === 0 ? 0 : (x - t0) / (t1 - t0);
      return rgb(
        (c0[0] + (c1[0] - c0[0]) * u) / 255,
        (c0[1] + (c1[1] - c0[1]) * u) / 255,
        (c0[2] + (c1[2] - c0[2]) * u) / 255
      );
    }
  }
  const c = SPECTRUM_STOPS[SPECTRUM_STOPS.length - 1][1];
  return rgb(c[0] / 255, c[1] / 255, c[2] / 255);
}

function num(attrs, key, fallback = 0) {
  const v = attrs[key];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function finitePair(x, y) {
  return Number.isFinite(x) && Number.isFinite(y);
}

function dashArray(attrs) {
  const raw = attrs["stroke-dasharray"];
  if (!raw) return undefined;
  const parts = raw.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
  return parts.length ? parts : undefined;
}

function pickFont(fonts, family, weight) {
  const bold = weight === "700" || weight === "600";
  const mono = String(family).includes("JetBrains");
  if (mono) return bold ? fonts.monoBold : fonts.mono;
  return bold ? fonts.sansBold : fonts.sans;
}

function textWidth(font, text, size, spacing) {
  if (!text) return 0;
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    w += font.widthOfTextAtSize(text[i], size);
    if (i < text.length - 1) w += spacing;
  }
  return w;
}

function drawSpaced(page, text, x, y, font, size, color, spacing) {
  let cx = x;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    page.drawText(ch, { x: cx, y, size, font, color });
    cx += font.widthOfTextAtSize(ch, size) + spacing;
  }
}

function drawSpectrumRect(page, x, y, w, h) {
  if (w <= 0 || h <= 0) return;
  const slices = Math.max(1, Math.ceil(w));
  const sw = w / slices;
  for (let i = 0; i < slices; i++) {
    page.drawRectangle({
      x: x + i * sw,
      y,
      width: sw + 0.02,
      height: h,
      color: spectrumAt((i + 0.5) / slices)
    });
  }
}

/**
 * Draw a chart SVG onto a pdf-lib page.
 * `x`,`y` are the bottom-left of the chart box in PDF points.
 * `fonts` must be pdf-lib Font objects: { sans, sansBold, mono, monoBold }.
 */
export function drawChart(page, wrapped, { x, y, fonts }) {
  if (!fonts?.sans || !fonts?.sansBold || !fonts?.mono || !fonts?.monoBold) {
    throw new Error("drawChart needs fonts { sans, sansBold, mono, monoBold } (embed Inter + JetBrains Mono)");
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { widthPt: 0, heightPt: 0 };
  }
  let parsed;
  try {
    parsed = parseChart(wrapped);
  } catch {
    return { widthPt: 0, heightPt: 0 };
  }
  const { widthPt, heightPt, elements } = parsed;
  const ox = x;
  const oy = y + (Number.isFinite(heightPt) ? heightPt : 0);

  for (const el of elements) {
    try {
      const a = el.attrs;
      if (el.tag === "rect") {
        const sx = num(a, "x");
        const sy = num(a, "y");
        const w = num(a, "width");
        const h = num(a, "height");
        if (!finitePair(sx, sy) || !finitePair(w, h) || w <= 0 || h <= 0) continue;
        const px = ox + sx;
        const py = oy - sy - h;
        if (!finitePair(px, py)) continue;
        const fill = a.fill;
        if (fill === "url(#fhspec)") {
          drawSpectrumRect(page, px, py, w, h);
        } else if (fill && fill !== "none") {
          const opts = { x: px, y: py, width: w, height: h, color: hexToRgb(fill) };
          if (a.stroke && a.stroke !== "none") {
            opts.borderColor = hexToRgb(a.stroke);
            opts.borderWidth = num(a, "stroke-width", 1);
          }
          page.drawRectangle(opts);
        } else if (a.stroke && a.stroke !== "none") {
          page.drawRectangle({
            x: px,
            y: py,
            width: w,
            height: h,
            borderColor: hexToRgb(a.stroke),
            borderWidth: num(a, "stroke-width", 1)
          });
        }
      } else if (el.tag === "line") {
        const x1 = ox + num(a, "x1");
        const y1 = oy - num(a, "y1");
        const x2 = ox + num(a, "x2");
        const y2 = oy - num(a, "y2");
        if (!finitePair(x1, y1) || !finitePair(x2, y2)) continue;
        page.drawLine({
          start: { x: x1, y: y1 },
          end: { x: x2, y: y2 },
          thickness: num(a, "stroke-width", 1),
          color: hexToRgb(a.stroke || "#000000"),
          dashArray: dashArray(a)
        });
      } else if (el.tag === "circle") {
        const cx = ox + num(a, "cx");
        const cy = oy - num(a, "cy");
        const r = num(a, "r");
        if (!finitePair(cx, cy) || !Number.isFinite(r) || r <= 0) continue;
        const fill = a.fill;
        const opts = { x: cx, y: cy, size: r };
        if (fill && fill !== "none") opts.color = hexToRgb(fill);
        if (a.stroke && a.stroke !== "none") {
          opts.borderColor = hexToRgb(a.stroke);
          opts.borderWidth = num(a, "stroke-width", 1);
        }
        page.drawCircle(opts);
      } else if (el.tag === "polygon") {
        const pts = String(a.points || "")
          .trim()
          .split(/\s+/)
          .map((p) => p.split(",").map(Number))
          .filter((p) => p.length === 2 && finitePair(p[0], p[1]));
        if (pts.length < 2) continue;
        const d =
          pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ") + " Z";
        const opts = { x: ox, y: oy };
        if (a.fill && a.fill !== "none") opts.color = hexToRgb(a.fill);
        if (a.stroke && a.stroke !== "none") {
          opts.borderColor = hexToRgb(a.stroke);
          opts.borderWidth = num(a, "stroke-width", 1);
        }
        page.drawSvgPath(d, opts);
      } else if (el.tag === "path") {
        const d = a.d;
        if (!d || /NaN|Infinity/i.test(d)) continue;
        const opts = { x: ox, y: oy };
        const fill = a.fill;
        if (fill && fill !== "none") opts.color = hexToRgb(fill);
        if (a.stroke && a.stroke !== "none") {
          opts.borderColor = hexToRgb(a.stroke);
          opts.borderWidth = num(a, "stroke-width", 1);
          const dash = dashArray(a);
          if (dash) opts.borderDashArray = dash;
        }
        page.drawSvgPath(d, opts);
      } else if (el.tag === "text") {
        const size = num(a, "font-size", 8);
        const spacing = num(a, "letter-spacing", 0);
        if (!Number.isFinite(size) || size <= 0) continue;
        const font = pickFont(fonts, a["font-family"], a["font-weight"]);
        const color = hexToRgb(a.fill || "#000000");
        const text = el.text;
        if (!text) continue;
        let tx = ox + num(a, "x");
        const ty = oy - num(a, "y");
        if (!finitePair(tx, ty)) continue;
        const anchor = a["text-anchor"] || "start";
        const tw = textWidth(font, text, size, spacing);
        if (anchor === "middle") tx -= tw / 2;
        else if (anchor === "end") tx -= tw;
        if (!Number.isFinite(tx)) continue;
        drawSpaced(page, text, tx, ty, font, size, color, spacing);
      }
    } catch {
      // Skip one bad primitive; never throw on malformed SVG.
    }
  }

  return { widthPt: Number.isFinite(widthPt) ? widthPt : 0, heightPt: Number.isFinite(heightPt) ? heightPt : 0 };
}

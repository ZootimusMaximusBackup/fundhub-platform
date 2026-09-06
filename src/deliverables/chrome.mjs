// Shared page furniture for the four deliverables, ported from
// scripts/black-reports/fundhub_gen.py:527-600 (cover, cta_page, section,
// table, util_bar, qr_html, PB) and :568-573 (render).
//
// The Python handed a body string and a stylesheet to WeasyPrint as two
// separate arguments. A browser needs one document, so renderDocument() puts the
// CSS in a <style> block. Nothing from a client goes near that block.

import { esc } from "./escape.mjs";
import { median, spaced } from "./format.mjs";
import { BASE_CSS, COVER_CSS, PAGE_CSS } from "./css.mjs";
import { fontFaceCss } from "./fonts.mjs";

/** Python PB — was a page break, is now the gap that opened the next sheet. */
export const PB = '<div class="pagebreak"></div>';

/**
 * Python qr_html(). The Python tried the optional `qrcode` package and fell
 * back to this text placeholder when it was absent (fundhub_gen.py:216-226).
 * Node has no such package here and no new dependency is being added
 * (CLAUDE.md §8), so the placeholder is the whole implementation.
 */
export function qrHtml() {
  return '<div class="qr">[ QR CODE ]</div>';
}

/** Python cover(). `footer_label` was an unused parameter there and is dropped. */
export function cover(client, doctype, title) {
  const med = median(client?.scores || {});
  return `
<div class="cover">
  <div><span class="brand">fundhub.</span>
       <span class="kicker">${spaced("underwrite iq")} / ${spaced("client deliverable")}</span></div>
  <div class="doctype">${esc(spaced(doctype))}</div>
  <div class="accent"></div>
  <h1>${esc(title)}</h1>
  <div class="meta">
    <div><div class="k">${spaced("applicant")}</div><div class="v">${esc(client?.applicant)}</div></div>
    <div><div class="k">${spaced("date")}</div><div class="v">${esc(client?.date)}</div></div>
    <div><div class="k">${spaced("outcome")}</div><div class="v">${esc(client?.outcome)}</div></div>
    <div><div class="k">${spaced("median score")}</div>
         <div class="v">${esc(med)}</div></div>
  </div>
  <div class="foot-dark">
    <span><span class="dot">●</span>${spaced("diagnostic complete")} · ${spaced("underwriteiq")}</span>
    <span>${spaced("fundhub confidential")}</span>
  </div>
</div>`;
}

/** Python cta_page(). */
export function ctaPage(client) {
  return `
<div class="cta-page">
  <div><span class="brand">fundhub.</span>
       <span class="kicker" style="font-family:'JetBrains Mono',monospace;font-size:6.5pt;
             letter-spacing:.3em;color:#7d7d7d;margin-left:10px;">${spaced("next steps")}</span></div>
  <h2>Let Us Build Your Game Plan Together</h2>
  <div class="rule"></div>
  <p>You have clean bureaus ready for funding now. Apply on those while we repair
     the rest in parallel.</p>
  ${qrHtml()}
  <div class="lbl">${spaced("scan to book your call instantly")}</div>
  <p class="url">${esc(client?.booking_url)}</p>
  <p class="small">Or copy this link into your browser</p>
  <div class="foot-dark">
    <span><span class="dot">●</span>${spaced("systems nominal")} · ${spaced("fundhub.ai")}</span>
    <span>${spaced("fundhub confidential")}</span>
  </div>
</div>`;
}

/** Python section(): the numbered eyebrow, the heading, the rainbow rule. */
export function section(num, label, heading) {
  return `<div class="eyebrow">${esc(num)} / ${esc(spaced(label))}</div>`
    + `<h2>${esc(heading)}</h2><div class="rule"></div>`;
}

/**
 * Python table(). Cells are inserted RAW — the same contract the Python had, so
 * a caller can pass a `<span class="tag">` — which means every caller escapes
 * its own client data before it gets here.
 */
export function table(headers, rows, numericCols = []) {
  const num = new Set(numericCols);
  const th = headers.map((h, i) =>
    `<th class="${num.has(i) ? "num" : ""}">${esc(spaced(h))}</th>`).join("");
  const trs = rows.map((r) => {
    const tds = r.map((cell, i) =>
      `<td class="${num.has(i) ? "num" : ""}">${cell}</td>`).join("");
    return `<tr>${tds}</tr>`;
  }).join("");
  return `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

/** Python util_bar(). The dashed mark sits at the 10% threshold. */
export function utilBar(label, sub, pct) {
  return `
<div class="bar-row">
  <div class="head"><span>${esc(label)}</span><span>${esc(pct)}%</span></div>
  <div class="bar-track">
    <div class="bar-fill" style="width:${Math.min(Number(pct) || 0, 100)}%"></div>
    <div class="bar-mark" style="left:10%"></div>
  </div>
  <div class="small">${esc(sub)}</div>
</div>`;
}

/**
 * The running footer. It lived in the @page margin boxes
 * (fundhub_gen.py:319-328) and a browser does not paint those, so it is an
 * ordinary element at the end of the flow. There is no page number: pages stop
 * existing and a faked count would be a lie.
 */
export function runningFoot(client, footerLabel) {
  const who = String(client?.applicant || "").toLowerCase();
  return `<footer class="running-foot">`
    + `<span>fundhub. ·confidential${who ? ` ·prepared for ${esc(who)}` : ""}</span>`
    + `<span>${esc(footerLabel)}</span>`
    + "</footer>";
}

/**
 * Python render(), minus WeasyPrint. Returns one self-contained HTML document.
 *
 * @param {object} args
 * @param {string} args.body      the document body, already built and escaped
 * @param {object} args.client    the CLIENT dict, for the footer only
 * @param {string} args.footerLabel
 * @param {string} args.title     the <title>; browsers need one, PDFs did not
 * @param {string} [args.variant] "" or "v2" — the body class the Python passed
 * @param {string} [args.fontsHref] serve the .ttf files from here instead of
 *                                  embedding them
 */
export function renderDocument({ body, client, footerLabel, title, variant = "", fontsHref = "" }) {
  // PAGE_CSS goes LAST on purpose. It is the frame that replaced @page, and
  // BASE_CSS still carries the print stylesheet's `body { margin: 0 }` — with
  // PAGE_CSS first that rule won and the page stopped centring.
  const css = [fontFaceCss({ href: fontsHref }), BASE_CSS, COVER_CSS, PAGE_CSS]
    .filter(Boolean).join("\n");
  const cls = variant ? ` class="${esc(variant)}"` : "";
  return "<!doctype html>\n"
    + '<html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + `<title>${esc(title)}</title>`
    + `<style>${css}</style>`
    + `</head><body${cls}>${body}${runningFoot(client, footerLabel)}</body></html>`;
}

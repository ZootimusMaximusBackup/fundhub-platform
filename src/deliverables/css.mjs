// The deliverables stylesheet, ported from the two Python literals
// scripts/black-reports/fundhub_gen.py:316-481 (BASE_CSS) and :483-525
// (COVER_CSS).
//
// The Python string was %-formatted, so every literal percent sign was written
// `%%` and two placeholders `%(applicant_lc)s` / `%(footer)s` were substituted
// at render time. Here the nine `%%` are plain `%`, and the two placeholders are
// gone: they only ever fed the @page margin boxes, which no longer exist.
//
// OWNER-SET CHANGES, because this is a web page now and not a printed sheet:
//   * every @page rule is stripped
//   * .cover and .cta-page are ordinary elements with min-height: 100vh, since
//     WeasyPrint painted the @page background and a browser will not
//   * the running footers left the @page margin boxes for normal web flow, and
//     page numbers stop existing — counter(page) is not faked
//   * .pagebreak was `break-after: page`; pages are gone, so it is now the
//     vertical gap that used to sit at the top of the next sheet
//
// NOTHING FROM A CLIENT IS INTERPOLATED INTO THIS FILE. esc() does not escape
// ; { } or ( ), so a client value inside a <style> block would be an injection
// point. Every string below is a module literal.

export const BASE_CSS = `
* { box-sizing: border-box; }
body { font-family: "Inter", "Arial", sans-serif; font-size: 10pt;
       color: #111; line-height: 1.62; margin: 0; }
h1 { font-size: 21pt; letter-spacing: -.02em; margin: 0 0 4px; }
h2 { font-size: 15pt; letter-spacing: -.015em; margin: 0 0 2px; }
h3 { font-size: 11pt; margin: 22px 0 8px; }
p  { margin: 0 0 11px; }

.eyebrow { font-family: "JetBrains Mono", monospace; font-size: 6.5pt;
           letter-spacing: .28em; color: #999; margin: 34px 0 4px; }
.rule { height: 3px; margin: 6px 0 14px;
        background: linear-gradient(90deg,#7b5cff,#3aa0ff,#2fd6c3,#7bd44a,#f5c542,#ff7a45); }
.mono { font-family: "JetBrains Mono", monospace; }
.small { font-size: 8pt; color: #666; }
.note { font-family: "JetBrains Mono", monospace; font-size: 6.5pt;
        letter-spacing: .12em; color: #a5a5a5; margin: 6px 0 14px; }

.callout { border: 1px solid #ddd; padding: 14px 16px; margin: 16px 0 18px; }
.callout.bar { border: none; border-left: 3px solid #111; background: #f5f5f5;
               padding: 11px 14px; }

table { width: 100%; border-collapse: collapse; margin: 6px 0 14px; }
th { font-family: "JetBrains Mono", monospace; font-size: 6.5pt;
     letter-spacing: .18em; color: #888; text-align: left;
     font-weight: normal; padding: 0 8px 7px 0; border-bottom: 1.5px solid #111; }
td { padding: 12px 8px 12px 0; border-bottom: .5px solid #e2e2e2;
     vertical-align: top; font-size: 9.5pt; }
td.num, th.num { text-align: right; padding-right: 0; }

.tag { font-family: "JetBrains Mono", monospace; font-size: 6.5pt;
       letter-spacing: .14em; padding: 2px 6px; border: 1px solid #111;
       white-space: nowrap; }
.tag.solid { background: #111; color: #fff; }
.tag.grey  { background: #7a7a7a; color: #fff; border-color: #7a7a7a; }
.tag.open  { color: #444; border-color: #bbb; }

.cards { display: flex; gap: 10px; margin: 10px 0 14px; }
.card { flex: 1; border: 1px solid #ddd; border-top: 3px solid #111; padding: 14px; }
.card .lbl { font-family: "JetBrains Mono", monospace; font-size: 6.5pt;
             letter-spacing: .2em; color: #999; }
.card .big { font-family: "JetBrains Mono", monospace; font-size: 23pt; margin: 6px 0 2px; }
.card .sub { font-family: "JetBrains Mono", monospace; font-size: 6.5pt;
             letter-spacing: .14em; color: #444; margin-bottom: 6px; }
.card .body { font-size: 8pt; color: #555; line-height: 1.45; }

.hero { border-top: 3px solid #111; border-bottom: 3px solid #111; padding: 20px 22px;
        margin: 10px 0 18px; }
.hero .amount { font-family: "JetBrains Mono", monospace; font-size: 34pt;
                letter-spacing: -.02em; }

/* utilization bars */
.bar-row { margin: 0 0 12px; }
.bar-row .head { display: flex; justify-content: space-between; font-weight: bold;
                 font-size: 9pt; }
.bar-track { position: relative; height: 15px; background: #e6e6e6; margin-top: 4px; }
.bar-fill  { position: absolute; left: 0; top: 0; bottom: 0; background: #111; }
.bar-mark  { position: absolute; top: -3px; bottom: -3px; width: 0;
             border-left: 1px dashed #111; }

/* stepper */
.steps { margin: 8px 0 14px; }
.step { display: flex; gap: 10px; padding: 7px 0; border-bottom: .5px solid #eee; }
.step .n { width: 20px; height: 20px; border-radius: 50%; background: #111; color: #fff;
           font-family: "JetBrains Mono", monospace; font-size: 7.5pt;
           text-align: center; line-height: 20px; flex: none; }
.step .t { font-weight: bold; font-size: 9pt; }
.step .d { font-family: "JetBrains Mono", monospace; font-size: 7pt;
           letter-spacing: .1em; color: #888; }

/* timeline */
.tl { display: flex; margin: 12px 0 6px; border-top: 1.5px solid #111; }
.tl .m { flex: 1; padding: 10px 6px 12px; border-right: .5px solid #e2e2e2; }
.tl .m:last-child { border-right: none; }
.tl .m .k { font-family: "JetBrains Mono", monospace; font-size: 6pt;
            letter-spacing: .16em; color: #999; }
.tl .m .h { font-weight: bold; font-size: 9pt; margin: 2px 0 3px; }
.tl .m .b { font-size: 7.5pt; color: #666; line-height: 1.4; }

/* checklist */
.check { margin: 0 0 4px; font-size: 9pt; }
.check::before { content: "☐  "; font-family: "JetBrains Mono", monospace; color: #777; }

ul.plain { margin: 4px 0 12px; padding-left: 16px; }
ul.plain li { margin-bottom: 7px; }

.lender { border: 1px solid #ddd; padding: 16px 16px; margin: 0 0 14px;
          break-inside: avoid; }
.lender .nm { font-weight: bold; font-size: 11pt; margin-bottom: 6px; }
.lender .kv { display: flex; justify-content: space-between; padding: 3px 0;
              border-bottom: .5px solid #eee; font-size: 8.5pt; }
.lender .kv .k { font-family: "JetBrains Mono", monospace; font-size: 6.5pt;
                 letter-spacing: .16em; color: #888; }
.lender .why { font-size: 8.5pt; color: #444; margin-top: 8px; line-height: 1.45; }

/* was break-after: page. Pages stop existing on a web page, so what is left of
   a page break is the vertical air that used to open the next sheet. */
.pagebreak { height: 0; margin: 34px 0 0; }

/* --- diagrams --- */
svg text { font-family: "JetBrains Mono", monospace; }
.diagram { margin: 18px 0 20px; }
.flowrow { display: flex; align-items: stretch; gap: 0; margin: 10px 0 8px; }
.flowbox { flex: 1; border: 1.5px solid #111; padding: 12px 10px; text-align: center; }
.flowbox .fl { font-family: "JetBrains Mono", monospace; font-size: 6pt;
               letter-spacing: .2em; color: #999; }
.flowbox .ft { font-weight: bold; font-size: 10pt; margin: 4px 0 2px; }
.flowbox .fs { font-family: "JetBrains Mono", monospace; font-size: 6.5pt;
               letter-spacing: .08em; color: #777; }
.flowbox.hl { border-width: 2px;
  border-top: 4px solid; border-image:
  linear-gradient(90deg,#7b5cff,#3aa0ff,#2fd6c3,#7bd44a,#f5c542,#ff7a45) 1; }
.flowarrow { align-self: center; padding: 0 7px; font-size: 13pt; }
.midlabel { text-align: center; font-family: "JetBrains Mono", monospace;
            font-size: 6.5pt; letter-spacing: .2em; font-weight: bold; }
.midarrow { text-align: center; font-size: 12pt; line-height: 1; margin: 2px 0 6px; }
.scorebox { flex: 1; border: 1px solid #ddd; padding: 14px 10px; text-align: center; }
.scorebox .sl { font-family: "JetBrains Mono", monospace; font-size: 6.5pt;
                letter-spacing: .22em; color: #999; }
.scorebox .sn { font-family: "JetBrains Mono", monospace; font-size: 26pt; margin: 8px 0 4px; }
.scorebox .ss { font-size: 8pt; color: #777; }
.scorebox .sb { font-family: "JetBrains Mono", monospace; font-size: 6pt;
                letter-spacing: .22em; color: #999; margin-top: 10px; }
.scorebox.hl { border: 2px solid #111; border-top: 4px solid; border-image:
  linear-gradient(90deg,#7b5cff,#3aa0ff,#2fd6c3,#7bd44a,#f5c542,#ff7a45) 1; }
.scorebox.hl .sb { color: #111; font-weight: bold; }

/* month timeline w/ numbered circles */
.mrow { display: flex; margin: 14px 0 4px; }
.mcol { flex: 1; text-align: center; padding: 0 4px; }
.mcol .circ { width: 17px; height: 17px; border-radius: 50%; background: #111;
              color: #fff; font-family: "JetBrains Mono", monospace; font-size: 8pt;
              line-height: 17px; margin: 0 auto 8px; }
.mcol .mk { font-family: "JetBrains Mono", monospace; font-size: 6pt;
            letter-spacing: .2em; color: #999; }
.mcol .mt { font-weight: bold; font-size: 9.5pt; margin: 2px 0 3px; }
.mcol .mb { font-size: 7.5pt; color: #888; line-height: 1.45; }
.mcol .mex { font-family: "JetBrains Mono", monospace; font-size: 7pt;
             font-weight: bold; margin-top: 8px; }

.side { display: flex; gap: 20px; align-items: flex-start; }
.side .grow { flex: 1; }

/* v2 variant: rainbow gradient stat cards */
body.v2 .scorebox, body.v2 .card {
  background: linear-gradient(160deg,#7b5cff 0%,#3aa0ff 26%,#2fd6c3 50%,
              #7bd44a 66%,#f5c542 82%,#ff7a45 100%);
  border: 1px solid #bbb; }
body.v2 .scorebox .sl, body.v2 .card .lbl { color: rgba(255,255,255,.85); }
body.v2 .scorebox .ss, body.v2 .card .body { color: #10312b; }
body.v2 .card .sub { color: #0e2a25; }
`;

export const COVER_CSS = `
/* --- full-bleed BLACK panels: cover + final CTA ---
   These were @page cover in the PDF. As ordinary elements they must paint their
   own background and claim their own height, because nothing under them does. */
.cover, .cta-page { min-height: 100vh; padding: 26mm 20mm;
                    position: relative; background: #0c0c0c; color: #fff;
                    margin-left: -18mm; margin-right: -18mm; }
.cover { margin-top: -22mm; margin-bottom: 22mm; }
.cta-page { margin-top: 34px; }

.cover .brand, .cta-page .brand { font-size: 15pt; font-weight: bold;
                                  letter-spacing: -.02em; color: #fff; }
.cover .kicker { font-family: "JetBrains Mono", monospace; font-size: 6.5pt;
                 letter-spacing: .3em; color: #7d7d7d; margin-left: 10px; }
.cover .doctype { font-family: "JetBrains Mono", monospace; font-size: 7pt;
                  letter-spacing: .3em; color: #7d7d7d; margin-top: 58mm; }
.cover .accent { height: 3px; width: 46mm; margin: 8px 0 6px;
                 background: linear-gradient(90deg,#7b5cff,#3aa0ff,#2fd6c3,#7bd44a,#f5c542,#ff7a45); }
.cover h1 { font-size: 34pt; line-height: 1.08; margin: 6px 0 40px;
            max-width: 82%; color: #fff; }
.cover .meta { display: flex; gap: 34px; border-top: 1.5px solid #3a3a3a;
               padding-top: 12px; }
.cover .meta .k { font-family: "JetBrains Mono", monospace; font-size: 6pt;
                  letter-spacing: .22em; color: #7d7d7d; }
.cover .meta .v { font-size: 10pt; margin-top: 3px; color: #fff; }
.foot-dark { position: absolute; bottom: 20mm; left: 20mm; right: 20mm;
             display: flex; justify-content: space-between;
             font-family: "JetBrains Mono", monospace; font-size: 6pt;
             letter-spacing: .22em; color: #7d7d7d; }
.foot-dark .dot { color: #35d07f; letter-spacing: 0; margin-right: 6px; }

.cta-page h2 { font-size: 22pt; color: #fff; margin-top: 42mm; }
.cta-page p { color: #cfcfcf; max-width: 70%; }
.cta-page .rule { width: 46mm; }
.qr { border: 1px solid #3a3a3a; background: #161616; width: 120px; height: 120px;
      margin: 22px 0 10px; font-family: "JetBrains Mono", monospace;
      font-size: 6.5pt; color: #6a6a6a; text-align: center; line-height: 120px;
      letter-spacing: .18em; }
.qrimg { width: 118px; height: 118px; background: #fff; padding: 8px;
         margin: 22px 0 12px; }
.cta-page .url { font-family: "JetBrains Mono", monospace; font-size: 9.5pt;
                 color: #fff; margin-top: 10px; }
.cta-page .small { color: #8a8a8a; }
.cta-page .lbl { font-family: "JetBrains Mono", monospace; font-size: 6.5pt;
                 letter-spacing: .22em; color: #7d7d7d; }
`;

/**
 * The page frame. @page carried the Letter sheet and its 22/18/20/18mm margins;
 * a scrolling document needs a measure of its own or the lines run the width of
 * the monitor. 176mm is Letter minus the two 18mm side margins, so a line of
 * body text is the same length it was on paper.
 */
export const PAGE_CSS = `
html { background: #f2f2f2; }
body { background: #fff; max-width: 176mm; margin: 0 auto;
       padding: 22mm 18mm 20mm; overflow-x: hidden; }
img, svg { max-width: 100%; }

/* The running footer. It was @bottom-left / @bottom-right inside @page, which a
   browser does not paint. It sits in normal flow at the end of the document
   instead, and it carries NO page number: a scrolling document has no page
   count, and a faked number would be a lie. */
.running-foot { display: flex; justify-content: space-between; gap: 16px;
                margin: 34px 0 0; padding-top: 10px; border-top: .5px solid #e2e2e2;
                font-family: "JetBrains Mono", monospace; font-size: 6.5pt;
                color: #9a9a9a; letter-spacing: .06em; }

@media (max-width: 700px) {
  body { padding: 16px; }
  .cover, .cta-page { margin-left: -16px; margin-right: -16px; padding: 28px 20px; }
  .cover { margin-top: -16px; }
  .cards, .flowrow, .mrow, .side, .tl { flex-wrap: wrap; }
}
`;

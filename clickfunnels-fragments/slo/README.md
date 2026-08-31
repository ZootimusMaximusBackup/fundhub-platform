FUNDHUB SLO FUNNEL — $297 Complete Funding Diagnostic
Copy source of truth: FundHub-Copy-Source-of-Truth.md (Google Drive) + CRO Pass #1 (see COPY-CHANGELOG-Aug27.md)
Design system: fh-root (matches live fundhub.ai funnel). Built for ClickFunnels.

PAGES (merged working copies — one file per page, open in a browser to review)
  slo-01-sales.html       Sales page. Single fragment, paste as-is into one Custom JS/HTML element.
  slo-02-order.html       Order page. Contains a SPLIT-LINE marker: split there into top/bottom
                          Custom JS/HTML elements with CF's NATIVE checkout element in between.
  slo-03-thank-you.html   Thank-you page (ALL buyers route here). SPLIT-LINE marker: top/bottom
                          elements with CF's NATIVE AppointmentScheduler in between.

THANK-YOU PERSONALIZATION (URL params on the confirmation redirect / email link)
  ?pa=84500        renders $84,500 in the pre-approval card (also accepts ?amount=)
  &track=repair    post-cleanup framing + swaps video to VSL #3
  no params        card still renders with a fallback line

SWAP BEFORE LAUNCH
  Video files:   fundhub.ai/funnel/slo-vsl.mp4 (+ slo-vsl-poster.jpg), slo-vsl2-funding.mp4, slo-vsl3-repair.mp4
  CTA hrefs:     /order  -> live order page path
  Proof:         replace bracket placeholders in slo-01 Section 5 with real results (they auto-hide until then)

--------------------------------------------------------------------------
SIM MODE — LAYOUT PREVIEW (added 2026-08-31, temporary)

The page hides anything it has no real content for, so on a fresh checkout the
proof section and the pre-approval card both render empty. That is correct live
behaviour, but it makes the layout impossible to judge.

Sim mode fills those two spots with clearly-marked samples.

  slo-01-sales.html      3 sample client-result cards in Section 5 (Proof)
  slo-03-thank-you.html  a stand-in pre-approval amount ($84,500)

Both carry an amber bar on screen saying the content is a sample, and every
result card repeats "Sample - not a real client". Nothing here can be mistaken
for a real testimonial.

TURNING IT OFF — one line per file:

  slo-01-sales.html       var FH_SIM = true;   ->  false
  slo-03-thank-you.html   var FH_SIM = true;   ->  false

With FH_SIM off, the original behaviour is back exactly as it was: empty slots
hide themselves, and the pre-approval card falls back to its "amount is in your
Funding Snapshot" line unless a real ?pa= is on the address.

A real ?pa= in the address always wins over the sim amount, on or off.

REMOVE BEFORE LAUNCH. Search each file for "SIM MODE" and delete the marked
block, plus the .sim-flag / .res-card rules in the sales page stylesheet.

--------------------------------------------------------------------------
SEEING THE PAGES IN A BROWSER

These files are ClickFunnels fragments - no <html> or <body> tags - so opening
one directly does not show it inside the shell ClickFunnels wraps around it.

  preview/01-sales.html
  preview/02-order.html
  preview/03-thank-you.html

Open any of those instead. They are generated - rebuild with:

  node clickfunnels-fragments/slo/preview/build.mjs

Marked-up screenshots of what sim mode renders:
  docs/workflows/slo-sim-evidence/

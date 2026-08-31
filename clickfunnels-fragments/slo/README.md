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

// The four client deliverables as hosted WEB PAGES.
//
// OWNER DECISION, 2026-09-05, final: the deliverables stop being PDFs. No
// Python render service, no Paged.js, no Puppeteer, no new npm dependency. The
// design was already HTML and CSS — scripts/black-reports/fundhub_gen.py:572 is
// one line handing a built HTML string and a CSS string to a renderer — so this
// is that program in Node, minus the renderer.
//
// INPUT CONTRACT. The CLIENT dict produced by
// src/underwrite/black-report-client.mjs, unchanged. That mapper already turns
// real UnderwriteIQ engine output into exactly the shape the Python consumed
// (25 of 25 top-level keys). It is finished; nothing here rebuilds it.
//
// NOT WIRED IN. This lane builds the renderer and proves it. Nothing in the
// live document path calls it yet — see this branch's handoff for the wiring
// edit and the netlify.toml `included_files` line the fonts need.
//
// COMPLIANCE REVIEW REQUIRED — credit-repair / projected-score adjacent, the
// same label src/underwrite/black-report-client.mjs carries.

import { renderDocument } from "./chrome.mjs";
import { buildCreditAnalysis } from "./credit-analysis.mjs";
import { buildFundingSnapshot } from "./funding-snapshot.mjs";
import { buildLenderList } from "./lender-list.mjs";
import { buildRoadmap } from "./roadmap.mjs";

export { buildCreditAnalysis, buildFundingSnapshot, buildLenderList, buildRoadmap };

/**
 * The four documents, in the order fundhub_gen.py:1580-1586 lists them and with
 * the same `subtype` keys src/underwrite/black-report-pdf.mjs:44-49 uses, so a
 * later wiring step maps one to one.
 */
export const DELIVERABLE_DOCS = Object.freeze([
  Object.freeze({
    key: "credit_analysis",
    filename: "credit_analysis_report.html",
    title: "Financial Profile Assessment",
    footerLabel: "financial profile assessment",
    variant: "",
    build: buildCreditAnalysis
  }),
  Object.freeze({
    key: "funding_snapshot",
    filename: "funding_snapshot.html",
    title: "Capital Readiness Snapshot",
    footerLabel: "capital readiness snapshot",
    variant: "",
    build: buildFundingSnapshot
  }),
  Object.freeze({
    key: "lender_match",
    filename: "lender_match_list.html",
    title: "Capital Partner Shortlist",
    footerLabel: "capital partner shortlist",
    variant: "",
    build: buildLenderList
  }),
  Object.freeze({
    key: "roadmap",
    filename: "optimization_roadmap.html",
    title: "6-Month Business Readiness Roadmap",
    footerLabel: "business readiness roadmap",
    variant: "",
    build: buildRoadmap
  })
]);

/**
 * The alternate treatment fundhub_gen.py:1582 also emits: the same credit
 * analysis with `body class="v2"`, which paints the stat cards with the rainbow
 * gradient. It is a second rendering of a document already in the four, not a
 * fifth deliverable, so it is kept out of the default set.
 */
export const DELIVERABLE_VARIANTS = Object.freeze([
  Object.freeze({
    key: "credit_analysis_v2",
    filename: "credit_analysis_report_v2.html",
    title: "Financial Profile Assessment",
    footerLabel: "financial profile assessment",
    variant: "v2",
    build: buildCreditAnalysis
  })
]);

function findDoc(key) {
  return DELIVERABLE_DOCS.find((d) => d.key === key)
    || DELIVERABLE_VARIANTS.find((d) => d.key === key)
    || null;
}

/**
 * Render one deliverable to a complete HTML document.
 *
 * @param {object} args
 * @param {object} args.client   the CLIENT dict from buildBlackReportClient()
 * @param {string} args.doc      a key from DELIVERABLE_DOCS / DELIVERABLE_VARIANTS
 * @param {string} [args.fontsHref] base URL the .ttf faces are served from.
 *   Omit it and the four faces the stylesheet uses are embedded in the page.
 * @returns {{ key: string, filename: string, title: string, html: string }}
 */
export function renderDeliverableHtml({ client, doc, fontsHref = "" } = {}) {
  const spec = findDoc(doc);
  if (!spec) throw new Error(`unknown deliverable: ${doc}`);
  if (!client || typeof client !== "object") {
    throw new Error("renderDeliverableHtml: client is required");
  }
  const html = renderDocument({
    body: spec.build(client),
    client,
    footerLabel: spec.footerLabel,
    title: spec.title,
    variant: spec.variant,
    fontsHref
  });
  return { key: spec.key, filename: spec.filename, title: spec.title, html };
}

/**
 * Render the whole set.
 *
 * @param {object} args
 * @param {object} args.client
 * @param {boolean} [args.includeVariants] also render the v2 treatment
 * @param {string} [args.fontsHref]
 */
export function renderAllDeliverables({ client, includeVariants = false, fontsHref = "" } = {}) {
  const specs = includeVariants
    ? [...DELIVERABLE_DOCS, ...DELIVERABLE_VARIANTS]
    : DELIVERABLE_DOCS;
  return specs.map((spec) => renderDeliverableHtml({ client, doc: spec.key, fontsHref }));
}

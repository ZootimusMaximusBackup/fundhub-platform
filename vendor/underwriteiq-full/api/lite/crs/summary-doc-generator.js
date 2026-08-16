"use strict";

/**
 * summary-doc-generator.js — PDF generation for CRS summary documents
 *
 * Generates the 6 summary document types specified by build-documents.js:
 * - funding_summary — Customer-facing pre-approval summary
 * - repair_plan_summary — Customer repair roadmap
 * - issue_priority_sheet — Prioritized credit issue list
 * - hold_notice — Application hold notification
 * - operator_checklist — Internal review checklist
 * - business_prep_summary — Business credit preparation guide
 *
 * These are 1-page Helvetica summaries (no gold shell close page / QR).
 * Full analysis PDFs use gold-report-shell via render-pdf; this path stays
 * for the short Capital Readiness / Optimization Plan attachments.
 */

const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

// ---------------------------------------------------------------------------
// Shared PDF helpers
// ---------------------------------------------------------------------------

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 50;
const LINE_H = 14;

function today() {
  return new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function safeEngine(crsResult) {
  return crsResult && typeof crsResult === "object" ? crsResult : {};
}

function safePersonal(personal) {
  return personal && typeof personal === "object" ? personal : {};
}

/** Strip fences / QR placeholders and flatten for pdf-lib WinAnsi drawText. */
function sanitizePdfText(text) {
  if (text == null) return "";
  let s = String(text);
  s = s.replace(/```json[\s\S]*?```/gi, " ");
  s = s.replace(/```[\s\S]*?```/g, " ");
  s = s.replace(/\[\s*Q\s*R\s*C\s*O\s*D\s*E\s*\]/gi, " ");
  s = s.replace(/\[\s*QR\s*CODE\s*\]/gi, " ");
  s = s.replace(/[\r\n\t]+/g, " ");
  s = s.replace(/[^\x20-\x7E]/g, "");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function money(n) {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return `$${v.toLocaleString()}`;
}

async function initDoc() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  return { doc, font, bold, page, y: PAGE_H - MARGIN };
}

async function savePdf(doc) {
  const buffer = Buffer.from(await doc.save());
  if (!buffer.length || buffer.slice(0, 5).toString() !== "%PDF-") {
    throw new Error("summary PDF emit failed");
  }
  return buffer;
}

function drawTitle(page, bold, y, text) {
  page.drawText(sanitizePdfText(text), { x: MARGIN, y, size: 16, font: bold, color: rgb(0.1, 0.1, 0.3) });
  return y - LINE_H * 2;
}

function drawSubtitle(page, bold, y, text) {
  page.drawText(sanitizePdfText(text), { x: MARGIN, y, size: 12, font: bold });
  return y - LINE_H * 1.5;
}

function drawLine(page, font, y, text, size) {
  size = size || 10;
  const clean = sanitizePdfText(text);
  if (!clean) return y - LINE_H;
  page.drawText(clean, { x: MARGIN, y, size, font });
  return y - LINE_H;
}

function drawBullet(page, font, y, text) {
  const clean = sanitizePdfText(text);
  if (!clean) return y - LINE_H;
  page.drawText(`  \u2022 ${clean}`, { x: MARGIN, y, size: 10, font });
  return y - LINE_H;
}

function drawSeparator(page, y) {
  page.drawLine({
    start: { x: MARGIN, y: y + 4 },
    end: { x: PAGE_W - MARGIN, y: y + 4 },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7)
  });
  return y - LINE_H;
}

// ---------------------------------------------------------------------------
// 1. Funding Summary
// ---------------------------------------------------------------------------

async function generateFundingSummary(crsResult, personal) {
  const engine = safeEngine(crsResult);
  const who = safePersonal(personal);
  const { doc, font, bold, page } = await initDoc();
  let y = PAGE_H - MARGIN;

  y = drawLine(page, font, y, today());
  y -= LINE_H;
  y = drawTitle(page, bold, y, "Capital Readiness Summary");
  y = drawSeparator(page, y);

  y = drawLine(page, font, y, `Applicant: ${who.name || "[Applicant Name]"}`);
  y = drawLine(page, font, y, `Decision: ${engine.decision_label || engine.outcome || "Pending"}`);
  y -= LINE_H;

  y = drawSubtitle(page, bold, y, "Capital Estimates");
  const pa = engine.preapprovals || {};
  y = drawBullet(page, font, y, `Personal Capital: ${money(pa.totalPersonal)}`);
  y = drawBullet(page, font, y, `Business Capital: ${money(pa.totalBusiness)}`);
  y = drawBullet(page, font, y, `Total Combined: ${money(pa.totalCombined)}`);
  if (pa.confidenceBand) {
    y = drawBullet(page, font, y, `Confidence: ${pa.confidenceBand}`);
  }
  y -= LINE_H;

  y = drawSubtitle(page, bold, y, "Profile Snapshot");
  const cs = engine.consumerSignals || {};
  if (cs.scores?.median != null) y = drawBullet(page, font, y, `Median Score: ${cs.scores.median}`);
  if (cs.utilization?.overall != null)
    y = drawBullet(page, font, y, `Utilization: ${cs.utilization.overall}%`);
  y -= LINE_H;

  if (engine.consumer_summary) {
    y = drawSubtitle(page, bold, y, "Summary");
    y = drawLine(page, font, y, String(engine.consumer_summary).substring(0, 200));
  }

  y -= LINE_H * 2;
  y = drawLine(
    page,
    font,
    y,
    "This is a pre-qualification estimate, not a guarantee of capital or approval.",
    8
  );
  drawLine(page, font, y, `Generated: ${today()}`, 8);

  return savePdf(doc);
}

// ---------------------------------------------------------------------------
// 2. Repair Plan Summary
// ---------------------------------------------------------------------------

async function generateRepairPlanSummary(crsResult, personal) {
  const engine = safeEngine(crsResult);
  const who = safePersonal(personal);
  const { doc, font, bold, page } = await initDoc();
  let y = PAGE_H - MARGIN;

  y = drawLine(page, font, y, today());
  y -= LINE_H;
  y = drawTitle(page, bold, y, "Optimization Plan Summary");
  y = drawSeparator(page, y);

  y = drawLine(page, font, y, `Applicant: ${who.name || "[Applicant Name]"}`);
  y -= LINE_H;

  y = drawSubtitle(page, bold, y, "Current Profile Status");
  const cs = engine.consumerSignals || {};
  if (cs.scores?.median != null) y = drawBullet(page, font, y, `Median Score: ${cs.scores.median}`);
  if (cs.utilization?.overall != null)
    y = drawBullet(page, font, y, `Utilization: ${cs.utilization.overall}%`);
  if (cs.derogatories?.active != null)
    y = drawBullet(page, font, y, `Active Derogatories: ${cs.derogatories.active}`);
  y -= LINE_H;

  const findings = engine.optimization_findings || [];
  if (findings.length > 0) {
    y = drawSubtitle(page, bold, y, "Priority Actions");
    for (const f of findings.slice(0, 8)) {
      y = drawBullet(page, font, y, `${f.code || f.category}: ${f.title || f.description || ""}`);
      if (y < MARGIN + 40) break;
    }
    y -= LINE_H;
  }

  const suggestions = engine.suggestions;
  const topMoves = suggestions?.topMoves || suggestions?.flatList || [];
  if (topMoves.length > 0) {
    y = drawSubtitle(page, bold, y, "Top Recommendations");
    for (const s of topMoves.slice(0, 5)) {
      y = drawBullet(page, font, y, s.title || s.problem || s.code || "");
      if (y < MARGIN + 40) break;
    }
  }

  y -= LINE_H * 2;
  y = drawLine(page, font, y, `Generated: ${today()}`, 8);

  return savePdf(doc);
}

// ---------------------------------------------------------------------------
// 3. Issue Priority Sheet
// ---------------------------------------------------------------------------

async function generateIssuePrioritySheet(crsResult) {
  const engine = safeEngine(crsResult);
  const { doc, font, bold, page } = await initDoc();
  let y = PAGE_H - MARGIN;

  y = drawLine(page, font, y, today());
  y -= LINE_H;
  y = drawTitle(page, bold, y, "Credit Issue Priority Sheet");
  y = drawSeparator(page, y);

  const findings = engine.optimization_findings || [];
  if (findings.length === 0) {
    y = drawLine(page, font, y, "No credit issues identified.");
  } else {
    // Group by severity
    const high = findings.filter(f => f.severity === "high" || f.severity === "critical");
    const medium = findings.filter(f => f.severity === "medium");
    const low = findings.filter(f => f.severity === "low" || f.severity === "info");

    if (high.length > 0) {
      y = drawSubtitle(page, bold, y, "HIGH PRIORITY");
      for (const f of high) {
        y = drawBullet(page, font, y, `${f.code || f.category}: ${f.title || f.description || ""}`);
        if (y < MARGIN + 40) break;
      }
      y -= LINE_H;
    }

    if (medium.length > 0) {
      y = drawSubtitle(page, bold, y, "MEDIUM PRIORITY");
      for (const f of medium) {
        y = drawBullet(page, font, y, `${f.code || f.category}: ${f.title || f.description || ""}`);
        if (y < MARGIN + 40) break;
      }
      y -= LINE_H;
    }

    if (low.length > 0) {
      y = drawSubtitle(page, bold, y, "LOW PRIORITY");
      for (const f of low) {
        y = drawBullet(page, font, y, `${f.code || f.category}: ${f.title || f.description || ""}`);
        if (y < MARGIN + 40) break;
      }
    }
  }

  y -= LINE_H * 2;
  y = drawLine(page, font, y, "INTERNAL DOCUMENT — Do not distribute to client.", 8);
  y = drawLine(page, font, y, `Generated: ${today()}`, 8);

  return savePdf(doc);
}

// ---------------------------------------------------------------------------
// 4. Hold Notice
// ---------------------------------------------------------------------------

async function generateHoldNotice(crsResult, personal) {
  const engine = safeEngine(crsResult);
  const who = safePersonal(personal);
  const { doc, font, bold, page } = await initDoc();
  let y = PAGE_H - MARGIN;

  y = drawLine(page, font, y, today());
  y -= LINE_H;
  y = drawTitle(page, bold, y, "Application Hold Notice");
  y = drawSeparator(page, y);

  y = drawLine(page, font, y, `Applicant: ${who.name || "[Applicant Name]"}`);
  y = drawLine(page, font, y, `Status: ${engine.decision_label || "On Hold"}`);
  y -= LINE_H;

  y = drawSubtitle(page, bold, y, "Reason");
  y = drawLine(
    page,
    font,
    y,
    engine.decision_explanation || "Your application requires additional review."
  );
  y -= LINE_H;

  const codes = engine.reason_codes || [];
  if (codes.length > 0) {
    y = drawSubtitle(page, bold, y, "Reason Codes");
    for (const code of codes) {
      y = drawBullet(page, font, y, code);
    }
  }

  y -= LINE_H * 2;
  y = drawLine(page, font, y, "INTERNAL DOCUMENT — Do not distribute to client.", 8);
  y = drawLine(page, font, y, `Generated: ${today()}`, 8);

  return savePdf(doc);
}

// ---------------------------------------------------------------------------
// 5. Operator Checklist
// ---------------------------------------------------------------------------

async function generateOperatorChecklist(crsResult) {
  const engine = safeEngine(crsResult);
  const { doc, font, bold, page } = await initDoc();
  let y = PAGE_H - MARGIN;

  y = drawLine(page, font, y, today());
  y -= LINE_H;
  y = drawTitle(page, bold, y, "Operator Checklist");
  y = drawSeparator(page, y);

  const outcome = engine.outcome || "UNKNOWN";
  y = drawLine(page, font, y, `Outcome: ${outcome}`);
  y = drawLine(page, font, y, `Decision: ${engine.decision_label || ""}`);
  y -= LINE_H;

  // Outcome-specific checklist items
  const checklistItems = getChecklistItems(outcome, engine);

  y = drawSubtitle(page, bold, y, "Action Items");
  for (const item of checklistItems) {
    y = drawBullet(page, font, y, `[ ] ${item}`);
    if (y < MARGIN + 40) break;
  }

  y -= LINE_H;
  y = drawSubtitle(page, bold, y, "Key Metrics");
  const cs = engine.consumerSignals || {};
  const pa = engine.preapprovals || {};
  if (cs.scores?.median != null) y = drawBullet(page, font, y, `Score: ${cs.scores.median}`);
  if (pa.totalCombined)
    y = drawBullet(page, font, y, `Total Pre-Approval: ${money(pa.totalCombined)}`);
  if (engine.confidence) y = drawBullet(page, font, y, `Confidence: ${engine.confidence}`);

  y -= LINE_H * 2;
  y = drawLine(page, font, y, "INTERNAL DOCUMENT — Do not distribute to client.", 8);
  y = drawLine(page, font, y, `Generated: ${today()}`, 8);

  return savePdf(doc);
}

function getChecklistItems(outcome, crsResult) {
  const engine = safeEngine(crsResult);
  switch (outcome) {
    case "FRAUD_HOLD":
      return [
        "Verify applicant identity manually",
        "Review fraud indicators in audit trail",
        "Contact applicant if identity mismatch is resolvable",
        "Escalate to compliance if fraud confirmed"
      ];
    case "MANUAL_REVIEW":
      return [
        "Review audit trail for low-confidence indicators",
        "Verify bureau data completeness",
        "Check if additional documentation is needed",
        "Determine if applicant can be re-pulled with corrections"
      ];
    case "REPAIR_ONLY":
      return [
        "Confirm dispute letters generated for all bureaus",
        "Schedule follow-up for dispute results (30-45 days)",
        "Review repair plan with client",
        "Set credit monitoring alerts",
        "Schedule re-analysis after disputes complete"
      ];
    case "FUNDING_PLUS_REPAIR":
      return [
        "Review conditional items with client",
        "Verify pre-approval amounts are realistic",
        "Begin lender application process",
        "Address optimization findings before submission",
        `Total estimated: ${money(engine.preapprovals?.totalCombined)}`
      ];
    case "FULL_FUNDING":
    case "PREMIUM_STACK":
      return [
        "Begin full lender application stack",
        "Verify business entity if applicable",
        "Submit applications in recommended order",
        "Monitor inquiry impact",
        `Total estimated: ${money(engine.preapprovals?.totalCombined)}`
      ];
    default:
      return ["Review engine output", "Determine next action"];
  }
}

// ---------------------------------------------------------------------------
// 6. Business Prep Summary
// ---------------------------------------------------------------------------

async function generateBusinessPrepSummary(crsResult) {
  const engine = safeEngine(crsResult);
  const { doc, font, bold, page } = await initDoc();
  let y = PAGE_H - MARGIN;

  y = drawLine(page, font, y, today());
  y -= LINE_H;
  y = drawTitle(page, bold, y, "Business Readiness Guide");
  y = drawSeparator(page, y);

  const bs = engine.businessSignals || {};

  if (bs.available) {
    y = drawSubtitle(page, bold, y, "Current Business Profile Status");
    if (bs.scores?.intelliscore != null)
      y = drawBullet(page, font, y, `Intelliscore: ${bs.scores.intelliscore}`);
    if (bs.scores?.fsr != null)
      y = drawBullet(page, font, y, `FSR (Financial Stability): ${bs.scores.fsr}`);
    if (bs.dbt?.value != null) y = drawBullet(page, font, y, `Days Beyond Terms: ${bs.dbt.value}`);
    y -= LINE_H;
  } else {
    y = drawLine(page, font, y, "No business credit report available.");
    y -= LINE_H;
  }

  y = drawSubtitle(page, bold, y, "Preparation Steps");
  const steps = [
    "Establish or verify LLC/Corporation with Secretary of State",
    "Obtain EIN from IRS if not already done",
    "Open business bank account in entity name",
    "Register with Dun & Bradstreet for DUNS number",
    "Establish net-30 trade accounts (Uline, Grainger, etc.)",
    "Monitor business credit reports quarterly",
    "Keep personal utilization below 30%",
    "Address any personal derogatories before business applications"
  ];

  for (const step of steps) {
    y = drawBullet(page, font, y, step);
    if (y < MARGIN + 40) break;
  }

  y -= LINE_H * 2;
  y = drawLine(page, font, y, `Generated: ${today()}`, 8);

  return savePdf(doc);
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

/**
 * Generate a summary document PDF by type.
 *
 * @param {string} docType - One of: funding_summary, repair_plan_summary, issue_priority_sheet, hold_notice, operator_checklist, business_prep_summary
 * @param {Object} crsResult - Full CRS engine result
 * @param {Object} [personal] - { name, address }
 * @returns {Promise<Buffer>} PDF buffer
 */
async function generateSummaryDocument(docType, crsResult, personal) {
  switch (docType) {
    case "funding_summary":
      return generateFundingSummary(crsResult, personal);
    case "repair_plan_summary":
      return generateRepairPlanSummary(crsResult, personal);
    case "issue_priority_sheet":
      return generateIssuePrioritySheet(crsResult);
    case "hold_notice":
      return generateHoldNotice(crsResult, personal);
    case "operator_checklist":
      return generateOperatorChecklist(crsResult);
    case "business_prep_summary":
      return generateBusinessPrepSummary(crsResult);
    default:
      throw new Error(`Unknown summary document type: ${docType}`);
  }
}

/**
 * Generate all summary documents from CRS document specs.
 *
 * @param {Array<{type, description}>} summaryDocSpecs - From buildDocuments().summaryDocuments
 * @param {Object} crsResult - Full CRS engine result
 * @param {Object} [personal] - { name, address }
 * @returns {Promise<Array<{filename, buffer, type}>>}
 */
async function generateAllSummaryDocuments(summaryDocSpecs, crsResult, personal) {
  const results = [];

  for (const spec of summaryDocSpecs || []) {
    try {
      const buffer = await generateSummaryDocument(spec.type, crsResult, personal);
      if (!buffer?.length || buffer.slice(0, 5).toString() !== "%PDF-") continue;
      results.push({
        filename: `${spec.type}.pdf`,
        buffer,
        type: spec.type
      });
    } catch {
      // Skip unknown types / emit failures silently
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  generateSummaryDocument,
  generateAllSummaryDocuments,
  generateFundingSummary,
  generateRepairPlanSummary,
  generateIssuePrioritySheet,
  generateHoldNotice,
  generateOperatorChecklist,
  generateBusinessPrepSummary,
  sanitizePdfText
};

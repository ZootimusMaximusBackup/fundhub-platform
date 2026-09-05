// Persist + load funding-stack PDFs: inquiry_removal, personal_info, and the
// FIVE analysis deliverables. Uses the existing documents registry.
// COMPLIANCE REVIEW REQUIRED — bureau / dispute letter adjacent.
//
// F46 — WHY THERE ARE FIVE ANALYSIS SUBTYPES AND NOT FOUR.
// buildLetterPack (src/underwrite/letter-pack.mjs:460) puts five analysis-shaped
// files in a funding pack, not four. Four come from the black-report printer
// (credit_analysis, funding_snapshot, lender_match, roadmap). The fifth,
// `funding_summary`, comes from a different generator entirely —
// vendor/underwriteiq-full/api/lite/crs/summary-doc-generator.js, reached through
// generateAllSummaryDocuments — and letter-pack names it
// Capital-Readiness-Summary.pdf (:85).
//
// FUNDING_ANALYSIS_SUBTYPE had four keys, so analysisTypeOf() returned null for
// that fifth file and the loop below skipped it. It was built, then dropped on
// the floor, while the delivery email promises it as item 5
// (src/messaging/templates/u02-funding-delivery.html:40).
//
// MEASURED 2026-09-05 on a scratch Postgres, real buildLetterPackForClient over
// the repo's own `academy` simulated credit file (tier FULL_FUNDING): the pack
// carried five files, the saver stored four. With funding_summary added it
// stores five.

import { KINDS, buildDocumentKey } from "../documents/kinds.mjs";
import { storeAndRegister } from "../documents/register.mjs";
import { storeFromEnv } from "../documents/store.mjs";
import {
  FUNDING_LETTER_TYPES,
  isFundingLetterFile,
  isDisputeLetterFile,
  normBureauCode,
  bureauFromFilename,
  pickFundingLetterFile,
  pickFundingLetterPdfBase64,
  pdfContentToBase64
} from "./letter-pack-filter.mjs";

export const FUNDING_LETTER_SUBTYPE = Object.freeze({
  inquiry_removal: "funding_inquiry_removal",
  personal_info: "funding_personal_info"
});

// Key = the `type` letter-pack stamps on the file. Value = the documents.subtype
// row. Both halves are strings that already exist elsewhere in the repo; nothing
// here is invented. `funding_summary` is the vendor generator's own type name
// (build-documents.js:154, summary-doc-generator.js:7) and is the fifth
// deliverable — the DELIVERABLE kind is described as "the five UnderwriteIQ
// deliverables" in src/documents/kinds.mjs. subtype is NOT constrained by the
// database (kinds.mjs header), so no migration is needed to add one.
export const FUNDING_ANALYSIS_SUBTYPE = Object.freeze({
  credit_analysis: "credit_analysis_report",
  roadmap: "credit_optimization_roadmap",
  funding_snapshot: "funding_snapshot",
  lender_match: "bank_lender_match_list",
  funding_summary: "funding_summary"
});

const ANALYSIS_TITLES = Object.freeze({
  credit_analysis: "Credit Analysis Report",
  roadmap: "Credit Optimization Roadmap",
  funding_snapshot: "Funding Snapshot",
  lender_match: "Bank and Lender Match List",
  // The title the vendor renderer itself uses for this type
  // (vendor/underwriteiq-full/api/lite/crs/render-pdf.js:955), and the name the
  // delivery email gives it.
  funding_summary: "Capital Readiness Summary"
});

const TYPE_ORDER = ["inquiry_removal", "personal_info"];

function letterTypeOf(file) {
  if (FUNDING_LETTER_TYPES.has(file?.type)) return file.type;
  if (FUNDING_LETTER_TYPES.has(file?.letterType)) return file.letterType;
  if (FUNDING_LETTER_TYPES.has(file?.letter_type)) return file.letter_type;
  const fn = String(file?.filename || file?.name || file?.path || "").toLowerCase();
  if (/inquiry_/.test(fn)) return "inquiry_removal";
  if (/personal_info_/.test(fn)) return "personal_info";
  return null;
}

function letterBureau(file) {
  return normBureauCode(file?.bureau || file?.bureauCode || file?.bureau_code)
    || bureauFromFilename(file?.filename || file?.name || file?.path);
}

function analysisTypeOf(file) {
  if (FUNDING_ANALYSIS_SUBTYPE[file?.type]) return file.type;
  if (FUNDING_ANALYSIS_SUBTYPE[file?.docType]) return file.docType;
  const fn = String(file?.filename || file?.name || file?.path || "").toLowerCase();
  if (fn.includes("credit_analysis") || fn.includes("credit-analysis")) return "credit_analysis";
  if (fn.includes("optimization_roadmap") || fn.includes("optimization-roadmap") || /(?:^|[\\/_])(?:credit[-_])?optimization[-_]roadmap/.test(fn)) {
    return "roadmap";
  }
  if (fn.includes("funding_snapshot") || fn.includes("funding-snapshot")) return "funding_snapshot";
  if (fn.includes("lender_match") || fn.includes("lender-match") || fn.includes("bank-lender")) return "lender_match";
  // The fifth deliverable. Two spellings reach here: the vendor generator's raw
  // `funding_summary.pdf` (summary-doc-generator.js:455) and the pack's nicer
  // `Capital-Readiness-Summary.pdf` (letter-pack.mjs:85). Neither collides with a
  // rule above, and the repair pack's Optimization-Plan-Summary.pdf matches none
  // of these — that one is `repair_plan_summary` and does not belong on the
  // funding stack.
  if (fn.includes("funding_summary") || fn.includes("funding-summary")
    || fn.includes("capital_readiness") || fn.includes("capital-readiness")) {
    return "funding_summary";
  }
  return null;
}

/**
 * Store funding-stack letter PDFs and the five analysis deliverables.
 * Letters: one row per client+type+bureau. Analysis: one row per subtype.
 * Skips dispute / Metro 2 round letters even if they are in the pack.
 */
export async function persistFundingLetterFiles(db, store, {
  orgId,
  clientId,
  files = [],
  generatedBy = "c-06-crs-results-router",
  sourceEventId = null
} = {}) {
  if (!db || !store || !orgId || !clientId) {
    return { stored: [], skipped: "missing_args" };
  }
  const stored = [];
  for (const file of files || []) {
    const body = file.content || file.buffer || file.pdf || file.bytes;
    if (!body) continue;

    const isLetter = isFundingLetterFile(file) && !isDisputeLetterFile(file);
    const analysisType = analysisTypeOf(file);
    if (!isLetter && !analysisType) continue;

    if (isLetter) {
      const type = letterTypeOf(file);
      const bureau = letterBureau(file);
      const subtype = type ? FUNDING_LETTER_SUBTYPE[type] : null;
      if (!type || !bureau || !subtype) continue;

      const { document } = await storeAndRegister(db, store, {
        orgId,
        clientId,
        kind: KINDS.DELIVERABLE,
        subtype,
        discriminator: bureau,
        title: `${type === "inquiry_removal" ? "Inquiry removal" : "Personal info"} — ${bureau}`,
        body,
        mimeType: "application/pdf",
        filename: file.filename || file.name || `${type}_${bureau.toLowerCase()}.pdf`,
        generatedBy,
        sourceEventId: sourceEventId
          ? `${sourceEventId}:${subtype}:${bureau}`
          : null,
        metadata: { stack: "funding", letterType: type, bureau }
      });
      stored.push({
        bureau,
        type,
        documentId: document?.id || null,
        documentKey: document?.document_key || null
      });
      continue;
    }

    const subtype = FUNDING_ANALYSIS_SUBTYPE[analysisType];
    const { document } = await storeAndRegister(db, store, {
      orgId,
      clientId,
      kind: KINDS.DELIVERABLE,
      subtype,
      title: ANALYSIS_TITLES[analysisType],
      body,
      mimeType: "application/pdf",
      filename: file.filename || file.name || `${analysisType}.pdf`,
      generatedBy,
      sourceEventId: sourceEventId ? `${sourceEventId}:${subtype}` : null,
      // `engine` is stamped on the file by src/underwrite/black-report-pdf.mjs
      // and says which printer produced these bytes: "weasyprint" /
      // "weasyprint-remote" are the designed full-length documents,
      // "pdf-lib" is the short fallback set. It lands on the document row so
      // "did this client get the real documents?" is answerable from the
      // database rather than from the code.
      metadata: {
        stack: "funding",
        docType: analysisType,
        ...(file.engine ? { engine: file.engine } : {})
      }
    });
    stored.push({
      type: analysisType,
      documentId: document?.id || null,
      documentKey: document?.document_key || null
    });
  }
  return { stored, skipped: null };
}

/**
 * Load the funding-stack PDF for one bureau from documents.
 * Prefers inquiry_removal, then personal_info. Never dispute.
 */
export async function loadFundingLetterPdf(db, store, {
  orgId,
  clientId,
  bureau
} = {}) {
  const code = normBureauCode(bureau);
  if (!db || !store || !orgId || !clientId || !code) return null;

  for (const type of TYPE_ORDER) {
    const subtype = FUNDING_LETTER_SUBTYPE[type];
    const documentKey = buildDocumentKey({
      kind: KINDS.DELIVERABLE,
      subtype,
      clientId,
      discriminator: code
    });
    const r = await db.query(
      `SELECT * FROM documents WHERE org_id = $1 AND document_key = $2`,
      [orgId, documentKey]
    );
    const row = r.rows?.[0];
    if (!row?.storage_key) continue;
    const obj = await store.get(row.storage_key, {
      expectedChecksum: row.checksum || undefined
    });
    const b64 = pdfContentToBase64(obj?.body);
    if (b64) return b64;
  }
  return null;
}

export {
  pickFundingLetterFile,
  pickFundingLetterPdfBase64,
  isFundingLetterFile,
  isDisputeLetterFile,
  normBureauCode,
  storeFromEnv
};

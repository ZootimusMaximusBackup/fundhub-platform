// Persist + load funding-stack PDFs: inquiry_removal, personal_info, and the
// analysis deliverables. Uses the existing documents registry.
// COMPLIANCE REVIEW REQUIRED — bureau / dispute letter adjacent.
//
// HOW MANY ANALYSIS DELIVERABLES IS NOT A FIXED NUMBER.
// An ordinary funding client gets FIVE. A thin-file or authorized-user-dominant
// client gets SIX — the sixth is the Business Readiness Guide, and
// vendor/underwriteiq-full/api/lite/crs/build-documents.js:162-168 only adds it
// when `consumerSignals.tradelines.thinFile` is true or
// `consumerSignals.tradelines.auDominance` is over 0.6. Any sentence in this repo
// that says "a funding pack carries five documents" is true only of the ordinary
// client. Do not write the fixed number anywhere.
//
// F46 — WHAT WAS DROPPED, AND WHY IT HAPPENED TWICE.
// buildLetterPack (src/underwrite/letter-pack.mjs:460) puts five or six
// analysis-shaped files in a funding pack. Four come from the black-report
// printer (credit_analysis, funding_snapshot, lender_match, roadmap). The other
// one or two come from a different generator entirely —
// vendor/underwriteiq-full/api/lite/crs/summary-doc-generator.js, reached through
// generateAllSummaryDocuments — and letter-pack names them
// Capital-Readiness-Summary.pdf and Business-Readiness-Guide.pdf (:85, :87).
// letter-pack's FUNDING_SUMMARIES set (:29) lets both into the pack.
//
// FUNDING_ANALYSIS_SUBTYPE listed only the printer's four, so analysisTypeOf()
// returned null for both summaries and the loop below skipped them without a
// word. They were built, then dropped on the floor, while the delivery email
// promises the Capital Readiness Summary as item 5
// (src/messaging/templates/u02-funding-delivery.html:40).
//
// THE ROOT CAUSE WAS THE SILENCE, NOT THE MISSING KEYS. A single unguarded
// `continue` swallowed every file the map did not know, so adding a seventh
// document to the pack tomorrow would vanish it the same way. Every file handed
// to persistFundingLetterFiles now lands in exactly one of three buckets —
// `stored`, `notStored` (a deliberate exclusion, with the reason), or
// `unrecognised`. An unrecognised file is counted, named, and logged with
// console.warn, and `strict: true` makes it throw instead. The three buckets and
// `stored` always add up to the number of files in; the tests assert that.
//
// MEASURED 2026-09-05 on a scratch Postgres, real buildLetterPackForClient over
// the repo's own `academy` simulated credit file (tier FULL_FUNDING):
//   ordinary client                 — 5 files in, 5 rows out
//   authorized-user-dominant client — 6 files in, 5 rows out BEFORE this fix
//                                     (business_prep_summary silently dropped),
//                                     6 rows out after.

import { KINDS, buildDocumentKey } from "../documents/kinds.mjs";
import { storeAndRegister } from "../documents/register.mjs";
import { storeFromEnv } from "../documents/store.mjs";
import { LETTER_TYPES } from "../metro2/letters/catalog.mjs";
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
// here is invented. `funding_summary` and `business_prep_summary` are the vendor
// generator's own type names (build-documents.js:154 and :165,
// summary-doc-generator.js:12) and both are let into the funding pack by
// letter-pack.mjs's FUNDING_SUMMARIES set (:29). subtype is NOT constrained by
// the database (kinds.mjs header), so no migration is needed to add one.
export const FUNDING_ANALYSIS_SUBTYPE = Object.freeze({
  credit_analysis: "credit_analysis_report",
  roadmap: "credit_optimization_roadmap",
  funding_snapshot: "funding_snapshot",
  lender_match: "bank_lender_match_list",
  funding_summary: "funding_summary",
  // Conditional: only a thin-file or authorized-user-dominant client gets this
  // one (build-documents.js:162-168). Its absence from a pack is normal.
  business_prep_summary: "business_prep_summary"
});

const ANALYSIS_TITLES = Object.freeze({
  credit_analysis: "Credit Analysis Report",
  roadmap: "Credit Optimization Roadmap",
  funding_snapshot: "Funding Snapshot",
  lender_match: "Bank and Lender Match List",
  // The title the vendor renderer itself uses for this type
  // (vendor/underwriteiq-full/api/lite/crs/render-pdf.js:955), and the name the
  // delivery email gives it.
  funding_summary: "Capital Readiness Summary",
  // The title its own renderer draws on page one
  // (summary-doc-generator.js:368, generateBusinessPrepSummary).
  business_prep_summary: "Business Readiness Guide"
});

// ── WHAT THE SAVER DELIBERATELY DOES NOT STORE, AND WHY ────────────────────
// A funding pack carries more than the funding stack. These buckets are the
// files this function is supposed to walk past. Anything that is neither stored
// nor in one of these buckets is UNRECOGNISED — reported, never swallowed.
export const NOT_STORED_REASON = Object.freeze({
  /** Metro 2 round letter. Never belongs on the funding stack. */
  DISPUTE: "dispute_letter",
  /** CFPB / state AG complaint and its cover sheet. The client files these. */
  ESCALATION: "escalation_complaint",
  /** The repair pack's own summaries, if a repair pack is ever handed here. */
  REPAIR_SUMMARY: "repair_pack_summary",
  /** Staff-only paperwork the client never sees. */
  INTERNAL: "internal_document",
  /** A funding letter with no bureau or no type — cannot be keyed. */
  LETTER_UNADDRESSED: "letter_missing_bureau_or_type",
  /** Recognised, but arrived with no bytes on it. */
  EMPTY: "empty_file"
});

/** Repair-pack summary types (letter-pack.mjs:30 REPAIR_SUMMARIES). */
const REPAIR_SUMMARY_TYPES = new Set(["repair_plan_summary", "issue_priority_sheet"]);

/** Staff-only summary types (vendor build-documents.js:38, :43, :95, :159). */
const INTERNAL_TYPES = new Set(["operator_checklist", "hold_notice"]);

/** The escalation complaint types (src/metro2/letters/catalog.mjs). */
const ESCALATION_TYPES = new Set([
  LETTER_TYPES.CFPB_COMPLAINT,
  LETTER_TYPES.STATE_AG_COMPLAINT
]);

// The folder every escalation file sits in, including the COVER.txt that carries
// no `type` at all. The literal is COMPLAINT_FOLDER from
// src/metro2/diy/package.mjs:360; it is copied rather than imported so this
// module does not drag the whole Metro 2 PDF tree in behind it. A unit test
// imports the real constant and asserts this still matches, so it cannot drift.
const COMPLAINT_FOLDER_LITERAL = "06-complaints-CONDITIONAL";

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
  // The sixth deliverable, present only for a thin-file or authorized-user-
  // dominant client. Same two spellings: the vendor generator's raw
  // `business_prep_summary.pdf` (summary-doc-generator.js:455) and the pack's
  // `Business-Readiness-Guide.pdf` (letter-pack.mjs:87).
  if (fn.includes("business_prep") || fn.includes("business-prep")
    || fn.includes("business_readiness") || fn.includes("business-readiness")) {
    return "business_prep_summary";
  }
  return null;
}

function fileLabel(file) {
  return String(file?.filename || file?.name || file?.path || "").trim() || "<unnamed>";
}

/**
 * Which deliberate-exclusion bucket this file falls in, or null if the saver is
 * supposed to be interested in it. Never returns a bucket for a file the saver
 * can actually store — the caller checks this first.
 */
function excludedReason(file) {
  const label = fileLabel(file).toLowerCase();
  if (isDisputeLetterFile(file)) return NOT_STORED_REASON.DISPUTE;
  if (ESCALATION_TYPES.has(file?.type)) return NOT_STORED_REASON.ESCALATION;
  if (label.startsWith(`${COMPLAINT_FOLDER_LITERAL.toLowerCase()}/`)) {
    return NOT_STORED_REASON.ESCALATION;
  }
  if (REPAIR_SUMMARY_TYPES.has(file?.type)) return NOT_STORED_REASON.REPAIR_SUMMARY;
  if (INTERNAL_TYPES.has(file?.type)) return NOT_STORED_REASON.INTERNAL;
  return null;
}

/**
 * Store funding-stack letter PDFs and the analysis deliverables — five for an
 * ordinary client, six when the pack also carries the Business Readiness Guide.
 * Letters: one row per client+type+bureau. Analysis: one row per subtype.
 * Skips dispute / Metro 2 round letters even if they are in the pack.
 *
 * EVERY FILE IS ACCOUNTED FOR. `stored` + `notStored` + `unrecognised` always
 * has one entry per file handed in. A file the saver does not recognise is
 * counted, named and logged — with `strict: true` it throws instead. Nothing
 * leaves this function in silence again.
 *
 * @param {boolean} [opts.strict] throw on the first unrecognised file
 * @returns {Promise<{stored:Array, notStored:Array, unrecognised:Array,
 *   filesIn:number, skipped:string|null}>}
 */
export async function persistFundingLetterFiles(db, store, {
  orgId,
  clientId,
  files = [],
  generatedBy = "c-06-crs-results-router",
  sourceEventId = null,
  strict = false
} = {}) {
  if (!db || !store || !orgId || !clientId) {
    return {
      stored: [], notStored: [], unrecognised: [], filesIn: 0, skipped: "missing_args"
    };
  }
  const list = files || [];
  const stored = [];
  const notStored = [];
  const unrecognised = [];
  const skip = (file, reason) => notStored.push({ file: fileLabel(file), reason });

  for (const file of list) {
    const excluded = excludedReason(file);
    if (excluded) {
      skip(file, excluded);
      continue;
    }

    const isLetter = isFundingLetterFile(file);
    const analysisType = analysisTypeOf(file);

    // THE LINE THAT DROPPED TWO DELIVERABLES. It used to be a bare `continue`.
    if (!isLetter && !analysisType) {
      unrecognised.push({ file: fileLabel(file), type: file?.type ?? null });
      if (strict) {
        throw new Error(
          `persistFundingLetterFiles: unrecognised file ${fileLabel(file)} `
          + `(type ${file?.type ?? "none"}). Add it to FUNDING_ANALYSIS_SUBTYPE `
          + `or to a NOT_STORED_REASON bucket — do not let it fall through.`
        );
      }
      continue;
    }

    const body = file.content || file.buffer || file.pdf || file.bytes;
    if (!body) {
      skip(file, NOT_STORED_REASON.EMPTY);
      continue;
    }

    if (isLetter) {
      const type = letterTypeOf(file);
      const bureau = letterBureau(file);
      const subtype = type ? FUNDING_LETTER_SUBTYPE[type] : null;
      if (!type || !bureau || !subtype) {
        skip(file, NOT_STORED_REASON.LETTER_UNADDRESSED);
        continue;
      }

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

  // Loud on purpose. This is the line that would have caught F46 on the day it
  // shipped, and it is what stops a seventh document vanishing next time.
  if (unrecognised.length) {
    console.warn(
      `[funding-letter-pdf] ${unrecognised.length} file(s) NOT SAVED — the saver `
      + `does not recognise them: `
      + unrecognised.map((u) => `${u.file} (type ${u.type ?? "none"})`).join(", ")
    );
  }

  return { stored, notStored, unrecognised, filesIn: list.length, skipped: null };
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

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
// `stored`, `notStored` (with the reason), or `unrecognised`. The three buckets
// always add up to the number of files in; the tests assert that.
//
// A NOT-STORED REASON IS EITHER A DECISION OR A FAULT, AND THEY ARE NOT THE SAME
// THING. Four of the six reasons are decisions — a dispute letter, an escalation
// complaint, a repair-pack summary and staff-only paperwork do not belong on the
// funding stack, and walking past them quietly is correct. Two are FAULTS:
// EMPTY (a deliverable the saver recognised, which arrived with no bytes) and
// LETTER_UNADDRESSED (a real funding letter whose bureau or type could not be
// read). Those two are a file the client should have had and did not get.
// NOT_STORED_FAULT names them, `notStored` entries carry `fault: true`, they are
// repeated in a `faults` array, they are written to the log with console.warn,
// and `strict: true` makes them throw — exactly as an unrecognised file does.
//
// WHAT IS STILL QUIET, STATED PLAINLY RATHER THAN PAPERED OVER:
//   * the four DECISION reasons above. Quiet on purpose; they are in `notStored`.
//   * the only production caller, src/workflows/c-06-crs-results-router.mjs:123,
//     reads `persisted?.stored?.length` and discards `notStored`, `faults` and
//     `unrecognised`. So in production today the loud half reaches the Netlify
//     function log and nothing else. Wiring that into the workflow result is a
//     handoff, not something this module can do to itself.
//   * the printer upstream, src/underwrite/black-report-pdf.mjs collectPrinted(),
//     drops an empty or non-%PDF file with a bare `continue` before the saver
//     ever sees it. Same failure class, different file, not fixed here.
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

// ── WHY A FILE DID NOT GET STORED ──────────────────────────────────────────
// A funding pack carries more than the funding stack. The first four reasons
// below are DECISIONS — files this function is supposed to walk past, quietly.
// The last two are FAULTS — see NOT_STORED_FAULT. Anything that is neither
// stored nor carrying one of these reasons is UNRECOGNISED — never swallowed.
export const NOT_STORED_REASON = Object.freeze({
  /** DECISION. Metro 2 round letter. Never belongs on the funding stack. */
  DISPUTE: "dispute_letter",
  /** DECISION. CFPB / state AG complaint and cover sheet. The client files these. */
  ESCALATION: "escalation_complaint",
  /** DECISION. The repair pack's own summaries, if a repair pack is handed here. */
  REPAIR_SUMMARY: "repair_pack_summary",
  /** DECISION. Staff-only paperwork the client never sees. */
  INTERNAL: "internal_document",
  /** FAULT. A real funding letter whose bureau or type could not be read. */
  LETTER_UNADDRESSED: "letter_missing_bureau_or_type",
  /** FAULT. A deliverable the saver recognised, which arrived with no bytes. */
  EMPTY: "empty_file"
});

/**
 * The subset of NOT_STORED_REASON that means SOMETHING WENT WRONG rather than
 * "this file was never ours to store". A file leaving by one of these is a
 * document the client should have had and did not get, so it is logged and it
 * throws under `strict: true` — the same treatment an unrecognised file gets.
 * Every other reason is a deliberate exclusion and stays quiet.
 */
export const NOT_STORED_FAULT = Object.freeze(new Set([
  NOT_STORED_REASON.LETTER_UNADDRESSED,
  NOT_STORED_REASON.EMPTY
]));

/** True when this not-stored reason is a fault rather than a deliberate exclusion. */
export function isNotStoredFault(reason) {
  return NOT_STORED_FAULT.has(reason);
}

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
 * has one entry per file handed in.
 *
 * THREE WAYS A FILE CAN LEAVE WITHOUT A ROW, AND WHAT EACH ONE DOES:
 *   1. a DECISION — dispute letter, escalation complaint, repair-pack summary,
 *      staff-only paperwork. Lands in `notStored` with `fault: false`. Quiet,
 *      because none of these were ever ours to store.
 *   2. a FAULT — `empty_file` or `letter_missing_bureau_or_type`. Lands in
 *      `notStored` with `fault: true`, is repeated in `faults`, is written to
 *      the log with console.warn, and throws under `strict: true`.
 *   3. UNRECOGNISED — the saver has never heard of it. Lands in `unrecognised`,
 *      is written to the log, and throws under `strict: true`.
 * Being called with no db / store / orgId / clientId drops the whole batch; that
 * also warns, and also throws under `strict: true`, when files were handed in.
 * So the only silent exit is (1), and (1) is a decision, not a drop.
 *
 * @param {boolean} [opts.strict] throw on the first unrecognised file or fault
 * @returns {Promise<{stored:Array, notStored:Array, faults:Array,
 *   unrecognised:Array, filesIn:number, skipped:string|null}>}
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
    // Dropping the whole batch used to be as quiet as dropping one file. It is
    // the same defect at a larger size, so it gets the same treatment.
    const handedIn = (files || []).length;
    if (handedIn) {
      const missing = [
        !db && "db", !store && "store", !orgId && "orgId", !clientId && "clientId"
      ].filter(Boolean).join(", ");
      const msg = `persistFundingLetterFiles: ${handedIn} file(s) NOT SAVED — `
        + `called without ${missing}.`;
      if (strict) throw new Error(msg);
      console.warn(`[funding-letter-pdf] ${msg}`);
    }
    return {
      stored: [],
      notStored: [],
      faults: [],
      unrecognised: [],
      filesIn: handedIn,
      skipped: "missing_args"
    };
  }
  const list = files || [];
  const stored = [];
  const notStored = [];
  const faults = [];
  const unrecognised = [];
  // A deliberate exclusion is recorded and left alone. A fault is recorded,
  // repeated in `faults` for a caller that only wants the bad news, and — under
  // strict — thrown right here rather than returned.
  const skip = (file, reason) => {
    const fault = NOT_STORED_FAULT.has(reason);
    notStored.push({ file: fileLabel(file), reason, fault });
    if (!fault) return;
    faults.push({ file: fileLabel(file), reason, type: file?.type ?? null });
    if (strict) {
      throw new Error(
        `persistFundingLetterFiles: ${fileLabel(file)} `
        + `(type ${file?.type ?? "none"}) was recognised but could not be stored `
        + `— ${reason}. This is a document the client should have had.`
      );
    }
  };

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
  // shipped. It stops a seventh document vanishing INSIDE THIS FUNCTION — it
  // says nothing about the printer above it or the caller below it, both of
  // which are still silent. See "WHAT IS STILL QUIET" in the header.
  if (unrecognised.length) {
    console.warn(
      `[funding-letter-pdf] ${unrecognised.length} file(s) NOT SAVED — the saver `
      + `does not recognise them: `
      + unrecognised.map((u) => `${u.file} (type ${u.type ?? "none"})`).join(", ")
    );
  }

  // The second half of the same rule. A recognised deliverable that could not be
  // stored is a missing document, not a decision, so it is as loud as an
  // unrecognised one. Reached only when strict is false — strict already threw.
  if (faults.length) {
    console.warn(
      `[funding-letter-pdf] ${faults.length} file(s) NOT SAVED — recognised, but `
      + `the saver could not store them: `
      + faults.map((f) => `${f.file} (${f.reason})`).join(", ")
    );
  }

  return {
    stored, notStored, faults, unrecognised, filesIn: list.length, skipped: null
  };
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

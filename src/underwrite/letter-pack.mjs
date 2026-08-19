// In-repo Underwrite IQ pack. Letters from letter-generator. Analysis docs
// from the existing UIQ Claude + render-pdf path (credit analysis, roadmap,
// funding snapshot, lender list). No Vercel. No GoHighLevel.

import letterGenMod from "./vendor/letter-generator.cjs";
import summaryMod from "./vendor/summary-doc-generator.cjs";
import buildDocsMod from "./vendor/build-documents.cjs";
import generateDeliverablesMod from "./vendor/generate-deliverables.cjs";
import renderPdfMod from "./vendor/render-pdf.cjs";
import { runTierEngineFromCrsResult } from "../finance/crs-tier.mjs";
import { documentsFromDeliverables, hasFundingAnalysisPdfs, FUNDING_ANALYSIS_FILENAMES } from "./letter-pack-filter.mjs";

const { generateLetters, generateDisputeLetters } = letterGenMod;
const { generateAllSummaryDocuments } = summaryMod;
const { buildDocuments } = buildDocsMod;
const { generateDeliverables } = generateDeliverablesMod;
const { renderAllPDFs } = renderPdfMod;

const FUNDING_SUMMARIES = new Set(["funding_summary", "business_prep_summary"]);
const REPAIR_SUMMARIES = new Set(["repair_plan_summary", "issue_priority_sheet"]);

// ═══════════════════════════════════════════════════════════════════════════════
// WHY `reason` IS MORE THAN "empty_pack"
//
// Until 2026-08-19 every pack that came out with zero files reported the single
// string "empty_pack". That one string covered three states a human has to tell
// apart:
//
//   1. the tier engine was never handed anything to score (no credit pull yet),
//   2. the tier engine threw (bad or incomplete stored pull), and
//   3. the engine ran fine and this client genuinely has nothing to send.
//
// Only (3) is a normal business outcome. (1) and (2) are faults. Reporting all
// three identically is what let the demo seed sit broken: crs_results.result had
// no `bureaus` key, runTierEngineFromCrsResult threw "no bureau reports to score"
// (src/finance/crs-tier.mjs:37), buildLetterPackForClient caught it into
// engineSkip, and the caller was told "empty_pack" — indistinguishable from a
// clean client with no disputes.
//
// The distinction has to live in `reason` itself, not in a sibling field. Both
// callers collapse the result down to that one string on the failure path —
// src/workflows/c-06-crs-results-router.mjs:93 and
// src/workflows/ds-02-diy-letters.mjs:65 both read `pack.reason || pack.engineSkip`,
// so a non-null `reason` always wins and ds-02 drops `engineSkip` entirely. A new
// field would be silently discarded on the way out.
// ═══════════════════════════════════════════════════════════════════════════════
export const PACK_REASON = Object.freeze({
  /** No engine result was handed to buildLetterPack at all. */
  NO_ENGINE_RESULT: "no_engine_result",
  /** This client has no stored credit pull yet. Normal early state, not a fault. */
  NO_CRS_RESULT: "no_crs_result",
  /** The tier engine threw. Prefixes the real message: `engine_error: <message>`. */
  ENGINE_ERROR: "engine_error",
  /** Engine ran, and produced nothing to send. The only benign empty pack. */
  EMPTY_PACK: "empty_pack",
  MISSING_FUNDING_ANALYSIS: "missing_funding_analysis",
  NO_CLIENT: "no_client",
  PACK_ERROR: "pack_error"
});

const NICE_NAME = {
  ...FUNDING_ANALYSIS_FILENAMES,
  funding_summary: "Capital-Readiness-Summary.pdf",
  repair_plan_summary: "Optimization-Plan-Summary.pdf",
  business_prep_summary: "Business-Readiness-Guide.pdf"
};

export function personalFromClient(row) {
  if (!row) return { name: "Client", address: "" };
  const cf = row.custom_fields && typeof row.custom_fields === "object" ? row.custom_fields : {};
  const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || "Client";
  const street = String(cf.address || cf.mailing_address || cf.street_address || cf.address_line1 || "").trim();
  const city = String(cf.city || cf.mailing_city || "").trim();
  const state = String(cf.state || cf.mailing_state || "").trim();
  const zip = String(cf.zip || cf.postal_code || cf.mailing_zip || "").trim();
  const cityLine = [city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const address = [street, cityLine].filter(Boolean).join("\n");
  return {
    name,
    address,
    city,
    state,
    zip,
    ssn: cf.ssn || cf.social_security_number || null,
    dob: cf.dob || cf.date_of_birth || null,
    employer: cf.employer || cf.current_employer || null
  };
}

function formatIdentityName(n) {
  if (!n || typeof n !== "object") return "";
  return n.full || n.display || [n.first, n.middle, n.last].filter(Boolean).join(" ").trim();
}

export function bureausFromEngine(engine) {
  const empty = () => ({ tradelines: [], inquiries: 0, inquiryList: [], names: [], addresses: [], employers: [], ssns: [], dobs: [] });
  const by = { experian: empty(), transunion: empty(), equifax: empty() };
  if (!engine) return by;
  const tradelines = engine.normalized?.tradelines || [];
  const inquiries = engine.normalized?.inquiries || [];
  const identity = engine.normalized?.identity || {};
  for (const t of tradelines) {
    const key = t.source;
    if (!by[key]) continue;
    by[key].tradelines.push({
      creditor: t.creditorName || t.creditor,
      creditorName: t.creditorName || t.creditor,
      status: t.status,
      is_negative: !!(t.isDerogatory || t.is_negative),
      isDerogatory: !!(t.isDerogatory || t.is_negative),
      balance: t.currentBalance ?? t.balance ?? null,
      currentBalance: t.currentBalance ?? t.balance ?? null,
      pastDue: t.pastDue ?? t.past_due ?? null,
      accountId: t.accountIdentifier || t.accountId || t.accountNumber,
      accountIdentifier: t.accountIdentifier || t.accountId || t.accountNumber,
      dateReported: t.reportedDate || t.dateReported || t.lastReported,
      reportedDate: t.reportedDate || t.dateReported || t.lastReported,
      openedDate: t.openedDate || t.dateOpened || null,
      closedDate: t.closedDate || t.dateClosed || null,
      accountType: t.accountType ?? null,
      currentRatingType: t.currentRatingType || null,
      comments: t.comments || [],
      chargeOffAmount: t.chargeOffAmount ?? null,
      complianceConditionCode: t.complianceConditionCode || null,
      inferredDofd: t.inferredDofd || t.dofd || null,
      ownership: t.ownership || null,
      isAU: !!t.isAU,
      priorOutcome: t.priorOutcome || null
    });
  }
  for (const i of inquiries) {
    if (!by[i.source]) continue;
    by[i.source].inquiries += 1;
    by[i.source].inquiryList.push({
      creditor: i.creditorName || i.creditor || i.subscriber || "Unknown",
      creditorName: i.creditorName || i.creditor || i.subscriber || "Unknown",
      date: i.date || i.inquiryDate || ""
    });
  }
  const idSource = identity.bySource || {};
  for (const key of Object.keys(by)) {
    const named = (arr, pick) => (arr || []).filter((row) => !row || !row.source || row.source === key).map(pick).filter(Boolean);
    const slice = idSource[key];
    by[key].names = slice
      ? (slice.names || []).map((n) => (typeof n === "string" ? n : n.full || n.display || "")).filter(Boolean)
      : named(identity.names, (n) => (typeof n === "string" ? n : formatIdentityName(n)));
    by[key].addresses = slice
      ? (slice.addresses || []).map((a) => (typeof a === "string" ? a : [a.line1, a.city, a.state, a.zip].filter(Boolean).join(", "))).filter(Boolean)
      : named(identity.addresses, (a) => (typeof a === "string" ? a : [a.line1 || a.addressLine1, a.city, a.state, a.zip || a.postalCode].filter(Boolean).join(", ")));
    by[key].employers = slice
      ? (slice.employers || []).map((e) => (typeof e === "string" ? e : e.name || "")).filter(Boolean)
      : named(identity.employers, (e) => (typeof e === "string" ? e : e.name || e.employerName || ""));
    by[key].ssns = slice
      ? (slice.ssns || []).map((s) => (typeof s === "string" ? s : s.value || "")).filter(Boolean)
      : named(identity.ssns, (s) => (typeof s === "string" ? s : s.value || s.ssn || ""));
    by[key].dobs = slice
      ? (slice.dobs || []).map((d) => (typeof d === "string" ? d : d.value || "")).filter(Boolean)
      : named(identity.dobs, (d) => (typeof d === "string" ? d : d.value || d.dob || ""));
  }
  return by;
}

function asFiles(list) {
  return (list || [])
    .filter((p) => p && p.buffer)
    .map((p) => {
      const type = p.docType || p.type || null;
      const bureau = p.bureau || null;
      return {
        filename: NICE_NAME[type] || String(p.filename || "letter.pdf"),
        contentType: "application/pdf",
        content: p.buffer,
        ...(type ? { type } : {}),
        ...(bureau ? { bureau } : {})
      };
    });
}

async function uiqDeliverablePdfs(crsResult, personal, pack, generate = generateDeliverables) {
  if (pack !== "funding") return { files: [], skip: "not_funding" };
  if (!crsResult) return { files: [], skip: "no_engine" };
  if (!process.env.ANTHROPIC_API_KEY) return { files: [], skip: "no_anthropic_key" };
  try {
    const d = await generate(crsResult, personal, { pack: "funding" });
    const documents = documentsFromDeliverables(d.documents);
    if (!documents.length) return { files: [], skip: "claude_empty" };
    const pdfs = await renderAllPDFs({
      documents,
      letters: [],
      personal,
      engineData: crsResult
    });
    const files = asFiles(pdfs);
    if (!files.length) return { files: [], skip: "render_empty" };
    return { files, skip: null };
  } catch (err) {
    return { files: [], skip: String(err && err.message || err).slice(0, 240) };
  }
}

export async function buildLetterPack({
  crsResult,
  personal,
  pack = "funding",
  generateDeliverablesFn = generateDeliverables
} = {}) {
  const who = personal || { name: "Client", address: "" };
  const path = pack === "repair" ? "repair" : "fundable";
  const bureaus = bureausFromEngine(crsResult);
  const letters = await generateLetters({
    path,
    bureaus,
    personal: who,
    underwrite: { fundable: pack !== "repair" }
  });
  // generateLetters only emits bureau Metro 2 letters when path === "repair".
  // Gold funding packs still include those letters (LETTER_SPEC + owner roster).
  if (pack !== "repair" && !letters.some((l) => l?.type === "dispute" || /round\d/.test(l?.filename || ""))) {
    letters.push(...(await generateDisputeLetters({ bureaus, personal: who })));
  }
  let summaries = [];
  // Reported, not just swallowed. This catch used to drop the error on the floor,
  // the same silent-swallow that hid the engine fault below. Summaries are
  // optional to the pack so a failure here must not throw, but it must be visible.
  let summarySkip = crsResult?.normalized ? null : "no_normalized";
  if (crsResult?.normalized) {
    try {
      const outcome = crsResult.outcome
        || (pack === "repair" ? "REPAIR_ONLY" : "FULL_FUNDING");
      const docs = buildDocuments(
        outcome,
        crsResult.suggestions,
        crsResult.normalized,
        crsResult.consumerSignals
      );
      const allow = pack === "repair" ? REPAIR_SUMMARIES : FUNDING_SUMMARIES;
      const specs = (docs.summaryDocuments || []).filter((s) => allow.has(s.type));
      summaries = await generateAllSummaryDocuments(specs, crsResult, who);
    } catch (err) {
      summaries = [];
      summarySkip = String(err && err.message || err).slice(0, 240);
    }
  }
  const uiq = await uiqDeliverablePdfs(crsResult, who, pack, generateDeliverablesFn);
  const files = [...uiq.files, ...asFiles(summaries), ...asFiles(letters)];
  let reason = null;
  // An empty pack with no engine result is a different state from an empty pack
  // the engine produced. See the PACK_REASON block at the top of this file.
  if (!files.length) {
    reason = crsResult ? PACK_REASON.EMPTY_PACK : PACK_REASON.NO_ENGINE_RESULT;
  } else if (pack !== "repair" && !hasFundingAnalysisPdfs(files)) {
    reason = PACK_REASON.MISSING_FUNDING_ANALYSIS;
  }
  return {
    files,
    reason,
    deliverableCount: uiq.files.length,
    deliverableSkip: uiq.skip,
    summarySkip
  };
}

/**
 * Sharpen an empty-pack reason with what actually went wrong upstream.
 *
 * Only ever replaces a "nothing came out" reason — a pack that produced files
 * keeps its own reason (null, or missing_funding_analysis), because an engine
 * fault that still yielded letters is not the headline.
 *
 * `engineFault` is set ONLY when something threw. "no_crs_result" is deliberately
 * not a fault: it means this client has no credit pull on file yet, which is a
 * normal early state and must not be reported as an engine error.
 */
function sharpenEmptyReason(reason, { engineSkip, engineFault }) {
  if (reason !== PACK_REASON.NO_ENGINE_RESULT && reason !== PACK_REASON.EMPTY_PACK) {
    return reason;
  }
  if (engineFault) return `${PACK_REASON.ENGINE_ERROR}: ${engineFault}`;
  if (engineSkip === PACK_REASON.NO_CRS_RESULT) return PACK_REASON.NO_CRS_RESULT;
  return reason;
}

export async function buildLetterPackForClient(
  db,
  { clientId, pack = "funding" } = {},
  { runEngine = runTierEngineFromCrsResult } = {}
) {
  if (!clientId) {
    return { files: [], reason: PACK_REASON.NO_CLIENT, deliverableCount: 0, engineSkip: "no_client", engineOutcome: null };
  }
  let row;
  try {
    const client = await db.query(
      `SELECT first_name, last_name, custom_fields, outcome_tier FROM clients WHERE id = $1`,
      [clientId]
    );
    row = client.rows[0];
  } catch (err) {
    return {
      files: [],
      reason: PACK_REASON.NO_CLIENT,
      deliverableCount: 0,
      engineSkip: String(err && err.message || err).slice(0, 240),
      engineOutcome: null
    };
  }
  if (!row) {
    return { files: [], reason: PACK_REASON.NO_CLIENT, deliverableCount: 0, engineSkip: "no_client", engineOutcome: null };
  }
  const personal = personalFromClient(row);
  let engine = null;
  let engineSkip = null;
  // engineFault mirrors engineSkip but is set only on a throw, so the reason
  // logic can tell a broken pull apart from a client who simply has no pull yet.
  let engineFault = null;
  try {
    const crs = await db.query(
      `SELECT result FROM crs_results WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [clientId]
    );
    if (!crs.rows[0]?.result) engineSkip = PACK_REASON.NO_CRS_RESULT;
    else {
      try {
        engine = runEngine(crs.rows[0].result, {
          submittedName: personal.name,
          submittedAddress: personal.address
        });
      } catch (err) {
        engineFault = String(err && err.message || err).slice(0, 240);
        engineSkip = engineFault;
      }
    }
  } catch (err) {
    engineFault = String(err && err.message || err).slice(0, 240);
    engineSkip = engineFault;
  }
  try {
    const packOut = await buildLetterPack({ crsResult: engine, personal, pack });
    return {
      ...packOut,
      reason: sharpenEmptyReason(packOut.reason, { engineSkip, engineFault }),
      engineSkip,
      engineOutcome: engine?.outcome ?? null
    };
  } catch (err) {
    return {
      files: [],
      reason: PACK_REASON.PACK_ERROR,
      deliverableCount: 0,
      engineSkip: engineSkip || String(err && err.message || err).slice(0, 240),
      engineOutcome: engine?.outcome ?? null
    };
  }
}

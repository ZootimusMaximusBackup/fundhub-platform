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
      return {
        filename: NICE_NAME[type] || String(p.filename || "letter.pdf"),
        contentType: "application/pdf",
        content: p.buffer,
        ...(type ? { type } : {})
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
    } catch {
      summaries = [];
    }
  }
  const uiq = await uiqDeliverablePdfs(crsResult, who, pack, generateDeliverablesFn);
  const files = [...uiq.files, ...asFiles(summaries), ...asFiles(letters)];
  let reason = null;
  if (!files.length) reason = "empty_pack";
  else if (pack !== "repair" && !hasFundingAnalysisPdfs(files)) reason = "missing_funding_analysis";
  return {
    files,
    reason,
    deliverableCount: uiq.files.length,
    deliverableSkip: uiq.skip
  };
}

export async function buildLetterPackForClient(
  db,
  { clientId, pack = "funding" } = {},
  { runEngine = runTierEngineFromCrsResult } = {}
) {
  if (!clientId) {
    return { files: [], reason: "no_client", deliverableCount: 0, engineSkip: "no_client", engineOutcome: null };
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
      reason: "no_client",
      deliverableCount: 0,
      engineSkip: String(err && err.message || err).slice(0, 240),
      engineOutcome: null
    };
  }
  if (!row) {
    return { files: [], reason: "no_client", deliverableCount: 0, engineSkip: "no_client", engineOutcome: null };
  }
  const personal = personalFromClient(row);
  let engine = null;
  let engineSkip = null;
  try {
    const crs = await db.query(
      `SELECT result FROM crs_results WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [clientId]
    );
    if (!crs.rows[0]?.result) engineSkip = "no_crs_result";
    else {
      try {
        engine = runEngine(crs.rows[0].result, {
          submittedName: personal.name,
          submittedAddress: personal.address
        });
      } catch (err) {
        engineSkip = String(err && err.message || err).slice(0, 240);
      }
    }
  } catch (err) {
    engineSkip = String(err && err.message || err).slice(0, 240);
  }
  try {
    const packOut = await buildLetterPack({ crsResult: engine, personal, pack });
    return { ...packOut, engineSkip, engineOutcome: engine?.outcome ?? null };
  } catch (err) {
    return {
      files: [],
      reason: "pack_error",
      deliverableCount: 0,
      engineSkip: engineSkip || String(err && err.message || err).slice(0, 240),
      engineOutcome: engine?.outcome ?? null
    };
  }
}

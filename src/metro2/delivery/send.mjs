// Shared bureau letter mail — PostGrid via mail-letter.sendLetter.
// One pipe for repair DIY, repair DFY, and between-rounds / funding inquiry send.
// Human still presses send; callers must not invoke this from payment.received.

import { sendLetter, bureauMailAddress } from "../../messaging/providers/mail-letter.mjs";
import { findFurnisherAddress } from "../rounds/store.mjs";
import {
  isDisputeLetterFile,
  normBureauCode,
  pickFundingLetterPdfBase64
} from "../../underwrite/letter-pack-filter.mjs";
import {
  loadFundingLetterPdf,
  storeFromEnv
} from "../../underwrite/funding-letter-pdf.mjs";

function hasStreet(addr) {
  if (!addr || typeof addr !== "object") return false;
  return !!(addr.address_line1 || addr.addressLine1 || addr.line1 || addr.street);
}

export function clientReturnAddress(identity) {
  if (!identity || typeof identity !== "object") return null;
  if (!hasStreet(identity)) return null;
  return {
    first_name: identity.firstName || identity.first_name || (identity.fullName || "").split(/\s+/)[0] || null,
    last_name: identity.lastName || identity.last_name || (identity.fullName || "").split(/\s+/).slice(1).join(" ") || null,
    address_line1: identity.addressLine1 || identity.address_line1 || identity.line1 || identity.street,
    address_line2: identity.addressLine2 || identity.address_line2 || identity.line2 || null,
    address_city: identity.city || identity.address_city,
    address_state: identity.state || identity.address_state,
    address_zip: identity.zip || identity.address_zip,
    address_country: identity.country || identity.address_country || "US"
  };
}

function caseBureau(caseRow) {
  return normBureauCode(
    caseRow?.selected_bureaus_raw
    || caseRow?.bureau
    || caseRow?.bureau_code
    || caseRow?.bureauCode
  );
}

function casePdfLooksLikeDispute(caseRow) {
  if (!caseRow || typeof caseRow !== "object") return false;
  return isDisputeLetterFile({
    type: caseRow.letter_type || caseRow.letterType || caseRow.type,
    filename: caseRow.letter_filename || caseRow.filename || caseRow.letter_name
  });
}

/**
 * W3 hook — pick a funding-stack PDF (inquiry_removal + personal_info only).
 * Order: inject → body/case columns (non-dispute) → in-memory pack files →
 * documents registry by client+bureau. Never returns Metro 2 dispute PDFs.
 * Missing pack → null (caller keeps HTML stub).
 */
export async function resolveFundingLetterPdf(caseRow, opts = {}) {
  if (typeof opts.resolveFundingLetterPdf === "function") {
    return (await opts.resolveFundingLetterPdf(caseRow)) || null;
  }
  if (!caseRow || typeof caseRow !== "object") return null;

  if (!casePdfLooksLikeDispute(caseRow)) {
    const fromCase =
      caseRow.letter_pdf
      || caseRow.letter_pdf_base64
      || caseRow.funding_letter_pdf
      || null;
    if (fromCase) return fromCase;
  }

  const bureau = caseBureau(caseRow);
  const packFiles = opts.fundingFiles || opts.packFiles || opts.files || null;
  if (packFiles && bureau) {
    const fromPack = pickFundingLetterPdfBase64(packFiles, bureau);
    if (fromPack) return fromPack;
  }

  const db = opts.db || null;
  const orgId = opts.orgId || caseRow.org_id || caseRow.orgId || null;
  const clientId = opts.clientId || caseRow.client_id || caseRow.clientId || null;
  if (db && orgId && clientId && bureau) {
    const store = opts.store || storeFromEnv(opts.env || process.env);
    const fromDocs = await loadFundingLetterPdf(db, store, { orgId, clientId, bureau });
    if (fromDocs) return fromDocs;
  }

  return null;
}

/**
 * Choose PDF (preferred) or HTML for an inquiry / funding case send.
 * body.letter_pdf wins; then funding-stack PDF hook; then draft HTML stub.
 */
export async function resolveInquiryLetterContent(caseRow, body = {}, opts = {}) {
  const bodyPdf = body.letter_pdf || body.letterPdf || null;
  if (bodyPdf && !isDisputeLetterFile({
    type: body.letter_type || body.letterType || body.type,
    filename: body.letter_filename || body.filename
  })) {
    return { pdf: bodyPdf, html: undefined, source: "pdf" };
  }
  const pdf = (await resolveFundingLetterPdf(caseRow, opts)) || undefined;
  if (pdf) return { pdf, html: undefined, source: "pdf" };
  const htmlRaw = caseRow?.letter_draft_html || body.letter_html || body.letterHtml || "<p>Dispute letter</p>";
  return {
    pdf: undefined,
    html: `<html>${htmlRaw}</html>`,
    source: "html"
  };
}

/**
 * Shared PostGrid send for DIY + DFY + between-rounds.
 * Return address MUST be the consumer — never Fundhub.
 * PDF preferred; html fallback ok (inquiry path already uses HTML stubs).
 */
export async function mailBureauLetter({
  db,
  bureau,
  furnisherName,
  identity,
  from,
  to,
  pdf,
  pdfBase64,
  html,
  description,
  metadata,
  serviceLevel,
  env,
  fetchImpl
} = {}) {
  const returnAddr = (from && hasStreet(from) ? from : null) || clientReturnAddress(identity);
  if (!returnAddr) {
    return { ok: false, error: "return_address_required — consumer address only" };
  }

  let dest = to || null;
  if (!dest && bureau) dest = bureauMailAddress(bureau);
  if (!dest && furnisherName && db) {
    const row = await findFurnisherAddress(db, furnisherName, metadata?.orgId || null);
    if (row) {
      dest = {
        company_name: row.name,
        address_line1: row.address_line1,
        address_line2: row.address_line2,
        address_city: row.city,
        address_state: row.state,
        address_zip: row.zip,
        address_country: row.country || "US"
      };
    }
  }
  if (!dest) return { ok: false, error: "destination_address_missing" };

  const pdfPayload = pdf ?? pdfBase64;
  if (!pdfPayload && !html) {
    return { ok: false, error: "pdf_or_html_required" };
  }

  return sendLetter({
    to: dest,
    bureau,
    from: returnAddr,
    pdf: pdfPayload || undefined,
    html: pdfPayload ? undefined : html,
    description: description || "Bureau dispute letter",
    serviceLevel,
    metadata,
    env,
    fetchImpl
  });
}

/**
 * Mail a generated letter PDF to a bureau or furnisher.
 * Thin wrapper — prefer mailBureauLetter for new callers.
 */
export async function deliverDisputeLetter(opts = {}) {
  return mailBureauLetter({
    ...opts,
    pdf: opts.pdf ?? opts.pdfBase64
  });
}

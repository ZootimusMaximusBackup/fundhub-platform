// Persist + load funding-stack PDFs (inquiry_removal + personal_info only).
// Uses the existing documents registry — no parallel blob store.
// COMPLIANCE REVIEW REQUIRED — bureau / dispute letter adjacent.

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

/**
 * Store funding-stack letter PDFs in documents (one row per client+type+bureau).
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
    if (!isFundingLetterFile(file) || isDisputeLetterFile(file)) continue;
    const type = letterTypeOf(file);
    const bureau = letterBureau(file);
    const subtype = type ? FUNDING_LETTER_SUBTYPE[type] : null;
    const body = file.content || file.buffer || file.pdf || file.bytes;
    if (!type || !bureau || !subtype || !body) continue;

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

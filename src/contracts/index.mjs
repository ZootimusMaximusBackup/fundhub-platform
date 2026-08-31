// src/contracts/index.mjs — the contract generator.
//
// A staff member writes a contract once, as words with blanks in it, and sends
// it to any client without a developer being involved. The client opens a link,
// reads it, types their name, ticks a box and signs. The words are frozen at
// send and hash-checked at signature, so neither side can change them
// afterwards, and both sides can fetch a copy back.
//
// The immutable artifact lives in documents/document_versions (030); this module
// does not reimplement immutability, it anchors to it. See
// docs/CONTRACTS-SPEC.md for every decision behind the shape of this.

export { ContractError, badRequest, notFound, conflict, forbidden } from "./errors.mjs";

export {
  TEMPLATE_KINDS, normaliseKey, listTemplates, getTemplate, getTemplateByKey,
  createTemplate, updateTemplate
} from "./templates.mjs";

export {
  CONTRACT_MIME, CONTRACT_COLUMNS, bodyHash, getContract, listContracts,
  createDraft, saveDraft, preview, send, voidContract, emitContractEvent,
  mintLinks, agreementManifest
} from "./send.mjs";

export {
  loadForClient, verifyIntegrity, viewForSigning, sign, signedCopyHash, documentBytes
} from "./sign.mjs";

// Chasing one contract. The whole-org sweep stays behind
// src/workflows/contract-chaser.mjs; this is the single-row half both use.
export { remindContract } from "./notify.mjs";

export {
  FIELD_TYPES, SIGNING_TYPES, FIELD_SOURCES, normaliseFields, applyAutoFill,
  fieldsForSigner, openFieldsForSigner, missingForSigner, mergeSignerValues, assertSignable
} from "./fields.mjs";

export {
  SIGNER_COLUMNS, listSigners, getSigner, normaliseSigners, replaceSigners,
  turnOf, canSign, allSigned, resolveSigner, markSignerViewed, declineSigner,
  waitingSummary, publicSignerList
} from "./signers.mjs";

export {
  decodeUpload, uploadTemplate, saveFields, normaliseSignerRoles, loadTemplatePdf,
  ensureTemplateClient
} from "./upload.mjs";

export {
  inspect as inspectPdf, flatten as flattenPdf, textToPdf, boxToPoints,
  looksLikePdf, PdfError, MAX_UPLOAD_BYTES, PDF_MIME
} from "./pdf.mjs";

export {
  signContractUrl, verifyContractUrl, verifyContractRequest, secretFromEnv,
  DEFAULT_TTL_SECONDS, MAX_TTL_SECONDS, EMPLOYMENT_LINK_TTL_SECONDS
} from "./signed-link.mjs";

export {
  tagsIn, isoDate, clientContext, mergeContext, renderContract, missingTags,
  normaliseManualFields, missingRequired
} from "./render.mjs";

// The white-label partner license — the only supported way to open 042's
// partner payout gate. See src/contracts/partner-license.mjs for why the stamp
// has exactly one door.
export {
  PARTNER_LICENSE_TEMPLATE_KEY, PARTNER_LICENSE_SUBTYPE, PARTNER_ID_MERGE_KEY,
  PARTNER_SHARE_PCT, PARTNER_ENTRY_REFUND_DAYS,
  getPartnerLicenseTemplate, findSignedPartnerLicense, stampPartnerAgreement
} from "./partner-license.mjs";

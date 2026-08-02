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
  createDraft, saveDraft, preview, send, voidContract, emitContractEvent
} from "./send.mjs";

export {
  loadForClient, verifyIntegrity, viewForSigning, sign, signedCopyHash
} from "./sign.mjs";

export {
  signContractUrl, verifyContractUrl, verifyContractRequest, secretFromEnv,
  DEFAULT_TTL_SECONDS, MAX_TTL_SECONDS
} from "./signed-link.mjs";

export {
  tagsIn, isoDate, clientContext, mergeContext, renderContract, missingTags,
  normaliseManualFields, missingRequired
} from "./render.mjs";

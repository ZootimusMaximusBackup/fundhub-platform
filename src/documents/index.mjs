// src/documents/index.mjs — the documents registry + object storage.
//
// Generated artifacts (the five UnderwriteIQ deliverables, Metro 2 letter packs,
// funding agreements, partner licenses, soft-pull authorizations, invoice PDFs)
// are stored, versioned, and re-accessible here instead of being emailed once
// and lost. See README.md for the shape and PROPOSED-EVENTS.md for the three
// canonical events this module would emit if approved.

export {
  KINDS, ALL_KINDS, SUBTYPES, SUBTYPE_TITLES, DELIVERY_CHANNELS, DELIVERY_STATUSES,
  isKind, isKnownSubtype, assertKind, assertKnownSubtype, titleFor, buildDocumentKey
} from "./kinds.mjs";

export {
  createStore, memoryProvider, vercelBlobProvider, netlifyBlobsProvider, providerFromEnv, storeFromEnv,
  PROVIDERS, checksumOf, toBytes, buildStoragePath, extensionFor
} from "./store.mjs";

export {
  registerDocument, storeAndRegister, markDelivered, markSigned, updatePolicy,
  canTransitionDelivery, withTransaction
} from "./register.mjs";

export {
  listClientLibrary, getByClientAndKind, listByKind, getDocument, getHistory,
  getVersion, resolveStorageTarget, shapeDocument, shapeVersion
} from "./retrieve.mjs";

export {
  signDocumentUrl, verifyDocumentUrl, verifyDocumentRequest, secretFromEnv,
  DEFAULT_TTL_SECONDS, MAX_TTL_SECONDS
} from "./signed-url.mjs";

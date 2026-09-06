import { KINDS } from "../documents/kinds.mjs";
export const DOOR_KINDS = Object.freeze({
  funding: KINDS.CLIENT_UPLOAD,
  inquiry: KINDS.INQUIRY_DOC,
  bureau_response: KINDS.BUREAU_RESPONSE
});

/* THE `funding` DOOR IS THE IDENTITY DOOR.

   It is the only door that carries id_document and proof_of_address — the two
   images the document agent reads and the two the whole repair program keys
   off. It used to open on the funding-snapshot entitlement alone, so a $200
   REPAIR_TRIAL client (who is granted metro2-letter-pack, never
   funding-snapshot) saw only the bureau-response door and had nowhere to send
   their ID. hasIdentityLane opens it for both lanes.

   Funding clients keep it exactly as before, and no new door, screen or tab was
   added — this is the same door on the same card. */
export function lanesFromEntitlementCodes(codes = []) {
  const set = new Set((codes || []).map((c) => String(c || "").toLowerCase()));
  const funding = set.has("funding-snapshot");
  const inquiry = funding || set.has("credit-analysis-report");
  const repair = set.has("metro2-letter-pack");
  return {
    hasFundingLane: funding,
    hasInquiryLane: inquiry,
    hasRepairLane: repair,
    hasIdentityLane: funding || repair
  };
}
export function activeUploadDoors(lanes = {}) {
  // hasIdentityLane is the answer when the caller computed one; an older
  // hand-built lanes object without it falls back to the funding lane.
  const identity = lanes.hasIdentityLane === undefined
    ? !!lanes.hasFundingLane
    : !!lanes.hasIdentityLane;
  return {
    funding: identity,
    inquiry: !!lanes.hasInquiryLane,
    bureau_response: !!lanes.hasRepairLane
  };
}
export function kindForDoor(doorKey) { return DOOR_KINDS[doorKey] || null; }
export function isPortalUploadKind(kind) { return Object.values(DOOR_KINDS).includes(kind); }

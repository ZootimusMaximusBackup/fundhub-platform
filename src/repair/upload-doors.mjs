import { KINDS } from "../documents/kinds.mjs";
export const DOOR_KINDS = Object.freeze({
  funding: KINDS.CLIENT_UPLOAD,
  inquiry: KINDS.INQUIRY_DOC,
  bureau_response: KINDS.BUREAU_RESPONSE
});
export function lanesFromEntitlementCodes(codes = []) {
  const set = new Set((codes || []).map((c) => String(c || "").toLowerCase()));
  const funding = set.has("funding-snapshot");
  const inquiry = funding || set.has("credit-analysis-report");
  const repair = set.has("metro2-letter-pack");
  return { hasFundingLane: funding, hasInquiryLane: inquiry, hasRepairLane: repair };
}
export function activeUploadDoors(lanes = {}) {
  return {
    funding: !!lanes.hasFundingLane,
    inquiry: !!lanes.hasInquiryLane,
    bureau_response: !!lanes.hasRepairLane
  };
}
export function kindForDoor(doorKey) { return DOOR_KINDS[doorKey] || null; }
export function isPortalUploadKind(kind) { return Object.values(DOOR_KINDS).includes(kind); }

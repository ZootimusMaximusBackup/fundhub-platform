import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lanesFromEntitlementCodes, activeUploadDoors, kindForDoor, DOOR_KINDS } from "./upload-doors.mjs";
import { KINDS } from "../documents/kinds.mjs";

describe("C3 upload doors — lane gating", () => {
  it("funding-track client sees funding + inquiry, not bureau-response", () => {
    const doors = activeUploadDoors(lanesFromEntitlementCodes(["funding-snapshot"]));
    assert.equal(doors.funding, true);
    assert.equal(doors.inquiry, true);
    assert.equal(doors.bureau_response, false);
  });
  it("repair-track client sees bureau-response, not funding docs", () => {
    const doors = activeUploadDoors(lanesFromEntitlementCodes(["metro2-letter-pack"]));
    assert.equal(doors.funding, false);
    assert.equal(doors.inquiry, false);
    assert.equal(doors.bureau_response, true);
  });
  it("inquiry-only unlock opens inquiry door without funding snapshot", () => {
    const doors = activeUploadDoors(lanesFromEntitlementCodes(["credit-analysis-report"]));
    assert.equal(doors.funding, false);
    assert.equal(doors.inquiry, true);
    assert.equal(doors.bureau_response, false);
  });
  it("doors stamp the correct document kind", () => {
    assert.equal(kindForDoor("funding"), KINDS.CLIENT_UPLOAD);
    assert.equal(kindForDoor("inquiry"), KINDS.INQUIRY_DOC);
    assert.equal(kindForDoor("bureau_response"), KINDS.BUREAU_RESPONSE);
    assert.equal(DOOR_KINDS.bureau_response, "bureau_response");
  });
});

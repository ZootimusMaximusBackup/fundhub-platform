import { test } from "node:test";
import assert from "node:assert/strict";
import { clearHandlers, getHandlers } from "../events/registry.mjs";
import {
  register,
  onInquiryDocsNeeded,
  onDocsReceivedFlipInquiryGate
} from "./inquiry-docs.mjs";

test("register wires inquiry.docs.needed and docs.received", () => {
  clearHandlers();
  register();
  assert.ok(getHandlers("inquiry.docs.needed").includes(onInquiryDocsNeeded));
  assert.ok(getHandlers("docs.received").includes(onDocsReceivedFlipInquiryGate));
});

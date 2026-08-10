import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseResponseText } from "./parse-response.mjs";
import { confirmParse } from "./confirm.mjs";
import { handleInboundResponse } from "./handler.mjs";

describe("inbound parse", () => {
  it("detects deleted language near account last4", () => {
    const r = parseResponseText({
      text: "Regarding account ending 4521, the item has been deleted from your file.",
      items: [{ id: "a1", account_last4: "4521", creditor: "Midland" }]
    });
    assert.equal(r.outcomes[0].outcome, "deleted");
    assert.ok(r.confidence > 0.5);
  });

  it("holds low-confidence parses for human confirm", async () => {
    const parseResult = parseResponseText({
      text: "We received your letter.",
      items: [{ id: "a1", account_last4: "9999", creditor: "Unknown Co" }]
    });
    const r = await confirmParse(null, {
      orgId: "o",
      clientId: "c",
      caseId: "k",
      items: [{ id: "a1", status: "sent", round: "R1" }],
      parseResult,
      threshold: 0.85
    });
    assert.equal(r.hold, true);
    assert.equal(r.reason, "low_confidence");
  });

  it("handler returns held event on ambiguous OCR", async () => {
    const r = await handleInboundResponse(null, {
      orgId: "o",
      clientId: "c",
      caseId: "k",
      ocrText: "Thank you for contacting us.",
      items: [{ id: "1", account_last4: "1111", creditor: "Bank" }]
    });
    assert.equal(r.status, "held");
    assert.equal(r.event, "repair.parse.low_confidence");
  });
});

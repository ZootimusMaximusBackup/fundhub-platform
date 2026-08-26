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

  it("confirmParse reads trial rounds_cap and does not jump to R3", async () => {
    const calls = [];
    const db = {
      async query(sql, params = []) {
        calls.push({ sql, params });
        if (/FROM repair_programs/i.test(sql)) {
          return { rows: [{ rounds_cap: 2, program: "trial", status: "active" }] };
        }
        if (/UPDATE repair_programs/i.test(sql)) {
          return { rows: [{ id: "p1", program: "trial", rounds_cap: 2, status: "upsell_pending" }] };
        }
        return { rows: [] };
      }
    };
    const r = await confirmParse(db, {
      orgId: "11111111-1111-1111-1111-111111111111",
      clientId: "22222222-2222-2222-2222-222222222222",
      caseId: "33333333-3333-3333-3333-333333333333",
      items: [{ id: "a1", status: "sent", round: "R2", creditor: "Bank", account_last4: "1111" }],
      parseResult: { confidence: 1, outcomes: [{ itemId: "a1", outcome: "verified" }] },
      confirmedOutcomes: [{ itemId: "a1", outcome: "verified" }],
      confirmedBy: "staff-1"
    });
    assert.equal(r.ok, true);
    const item = r.items.find((it) => it.id === "a1");
    assert.equal(item.round, "R2");
    assert.equal(item.status, "closed");
    assert.equal(item.blocked_at_cap, true);
    assert.equal(r.upsell?.ok, true);
    assert.equal(r.upsell?.program?.status, "upsell_pending");
    assert.ok(calls.some((c) => /FROM repair_programs/i.test(c.sql)));
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

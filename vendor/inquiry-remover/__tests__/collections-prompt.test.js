"use strict";

const {
  COLLECTIONS_TASK,
  buildCollectionsCallConfig,
  COLLECTIONS_ANALYSIS_QUESTIONS
} = require("../src/agents/collections-prompt");

describe("collections-prompt", () => {
  test("task encodes AR success-fee playbook hard rules", () => {
    expect(COLLECTIONS_TASK).toMatch(/10%/);
    expect(COLLECTIONS_TASK).toMatch(/net 5/i);
    expect(COLLECTIONS_TASK).toMatch(/Commas/);
    expect(COLLECTIONS_TASK).toMatch(/Resend/);
    expect(COLLECTIONS_TASK).toMatch(/Bland/);
    expect(COLLECTIONS_TASK).toMatch(/Fundhub/i);
    expect(COLLECTIONS_TASK).toMatch(/Never say GoHighLevel, GHL, or Mailgun/);
    expect(COLLECTIONS_TASK).toMatch(/Never bluff/i);
    expect(COLLECTIONS_TASK).toMatch(/Never invent/i);
    expect(COLLECTIONS_TASK).toMatch(/Never discount/i);
    expect(COLLECTIONS_TASK).toMatch(/AUTHORITY MATRIX/);
    expect(COLLECTIONS_TASK).toMatch(/50\/50/);
    expect(COLLECTIONS_TASK).toMatch(/7-day extension/);
    expect(COLLECTIONS_TASK).toMatch(/full-balance anchor/i);
    expect(COLLECTIONS_TASK).toMatch(/dated mini-agreement/i);
    expect(COLLECTIONS_TASK).toMatch(/Marcus Hale/);
    expect(COLLECTIONS_TASK).toMatch(/FORMAT DEMO ONLY/);
    expect(COLLECTIONS_TASK).toContain("{{pay_link}}");
    expect(COLLECTIONS_TASK).toContain("{{fee_amount}}");
    expect(COLLECTIONS_TASK).toContain("{{escalation_day}}");
    expect(COLLECTIONS_TASK).toContain("{{approval_type}}");
    expect(COLLECTIONS_TASK).toContain("{{lender}}");
    expect(COLLECTIONS_TASK).toContain("{{approved_amount}}");
    expect(COLLECTIONS_TASK).toContain("{{firm_name}}");
    expect(COLLECTIONS_TASK).toMatch(/D0 — CARD/);
    expect(COLLECTIONS_TASK).toMatch(/D0 — LOAN/);
    expect(COLLECTIONS_TASK).toMatch(/D1 —/);
    expect(COLLECTIONS_TASK).toMatch(/D3 —/);
    expect(COLLECTIONS_TASK).toMatch(/D7 —/);
    expect(COLLECTIONS_TASK).toMatch(/verification soft pull/i);
    expect(COLLECTIONS_TASK).toMatch(/LEGAL/);
    expect(COLLECTIONS_TASK).toMatch(/Never threaten arrest/i);
    expect(COLLECTIONS_TASK).toMatch(/lawyer/i);
    expect(COLLECTIONS_TASK).toMatch(/STALL-KILLS/);
    expect(COLLECTIONS_TASK).toMatch(/HIGH PRESSURE/i);
  });

  test("buildCollectionsCallConfig wires fee, day, and lender fields", () => {
    const cfg = buildCollectionsCallConfig({
      phone_number: "+16616180865",
      first_name: "Chris",
      service_delivered: "funding strategy work",
      fee_amount: "$2,500",
      days_overdue: 7,
      pay_link: "https://pay.commas.test/demo",
      escalation_day: "D7",
      approval_type: "card",
      lender: "Lender A",
      approved_amount: "$25,000",
      firm_name: "",
      money_change_now: "stop stressing about cash",
      extension_used: false
    });
    expect(cfg.phoneNumber).toBe("+16616180865");
    expect(cfg.requestData.fee_amount).toBe("$2,500");
    expect(cfg.requestData.balance_owed).toBe("$2,500");
    expect(cfg.requestData.days_overdue_clause).toMatch(/7 days/);
    expect(cfg.requestData.escalation_day).toBe("D7");
    expect(cfg.requestData.approval_type).toBe("card");
    expect(cfg.requestData.lender).toBe("Lender A");
    expect(cfg.requestData.approved_amount).toBe("$25,000");
    expect(cfg.requestData.firm_name).toBe("");
    expect(cfg.requestData.extension_used).toBe("");
    expect(cfg.metadata.call_type).toBe("collections-ar");
    expect(cfg.webhookUrl).toBe("https://fundhub.ai/api/webhooks/bland");
  });

  test("buildCollectionsCallConfig falls back balance_owed to fee_amount", () => {
    const cfg = buildCollectionsCallConfig({
      phone_number: "+16616180865",
      first_name: "Chris",
      balance_owed: "$500",
      pay_link: "https://pay.commas.test/x"
    });
    expect(cfg.requestData.fee_amount).toBe("$500");
  });

  test("analysis questions cover matrix, legal stop, and human tone", () => {
    expect(
      COLLECTIONS_ANALYSIS_QUESTIONS.some((q) => /authority matrix/i.test(q))
    ).toBe(true);
    expect(
      COLLECTIONS_ANALYSIS_QUESTIONS.some((q) => /lawyer|legal/i.test(q))
    ).toBe(true);
    expect(
      COLLECTIONS_ANALYSIS_QUESTIONS.some((q) => /high-pressure|human/i.test(q))
    ).toBe(true);
  });
});

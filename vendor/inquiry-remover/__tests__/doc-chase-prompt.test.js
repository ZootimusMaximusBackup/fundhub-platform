"use strict";

const {
  DOC_CHASE_TASK,
  buildDocChaseCallConfig,
  DOC_CHASE_ANALYSIS_QUESTIONS
} = require("../src/agents/doc-chase-prompt");

const BASE = {
  phone_number: "+16616180865",
  first_name: "Chris",
  missing_item: "driver's license (front and back)",
  fundhub_sms_number: "+15555550100"
};

describe("doc-chase-prompt", () => {
  test("task stays assertive and educates address match", () => {
    expect(DOC_CHASE_TASK).toMatch(/stay on the (call|line)/i);
    expect(DOC_CHASE_TASK).toMatch(/match/i);
    expect(DOC_CHASE_TASK).toMatch(/blurry/i);
    expect(DOC_CHASE_TASK).toMatch(/text/i);
    expect(DOC_CHASE_TASK).toMatch(/optimize their credit|optimize your credit/i);
    expect(DOC_CHASE_TASK).toMatch(/three seconds/i);
    expect(DOC_CHASE_TASK).not.toContain("{{prequal_amount}}");
  });

  test("buildDocChaseCallConfig wires phone and missing item", () => {
    const cfg = buildDocChaseCallConfig(BASE);
    expect(cfg.phoneNumber).toBe("+16616180865");
    expect(cfg.task).toBe(DOC_CHASE_TASK);
    expect(cfg.requestData.missing_item).toContain("license");
    expect(cfg.requestData.fundhub_sms_number).toBe("+15555550100");
    expect(cfg.webhookUrl).toBe("https://fundhub.ai/api/webhooks/bland");
  });

  test("analysis questions cover live upload wait", () => {
    expect(DOC_CHASE_ANALYSIS_QUESTIONS.some((q) => /stay on the line/i.test(q))).toBe(true);
  });
});

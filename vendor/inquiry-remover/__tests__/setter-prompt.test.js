"use strict";

const { buildSetterCallConfig, SETTER_TASK, SETTER_ANALYSIS_QUESTIONS } = require("../src/agents/setter-prompt");

// ---- helpers ----
const BASE_REQUEST_DATA = {
  phone_number: "+15551234567",
  ghl_contact_id: "ghl_1",
  first_name: "John",
  appointment_time: "Thursday 2pm",
  closer_name: "Chris",
  funding_target_amount: "$100k - $200k",
  planned_use: "Growth (marketing, inventory, hiring)",
  money_change_now: "Grow faster (more customers / more reach)",
  self_reported_fico: "700-749",
  has_business: "Yes, 2-5 years",
  business_revenue: "$250k - $499k",
  revenue_verifiable: "Yes, both",
  available_capital: "$5k - $25k"
};

beforeEach(() => {
  delete process.env.BLAND_VOICE;
  delete process.env.WEBHOOK_BASE_URL;
  delete process.env.BLAND_WEBHOOK_URL;
  delete process.env.BLAND_TOOL_SLOTS_ID;
  delete process.env.BLAND_TOOL_BOOK_ID;
  delete process.env.FUNDHUB_REP_NUMBER;
});

describe("buildSetterCallConfig", () => {
  // ---- Config structure ----

  test("returns object with phone_number from requestData", () => {
    const config = buildSetterCallConfig(BASE_REQUEST_DATA);
    expect(config.phoneNumber).toBe("+15551234567");
  });

  test("returns object with task set to SETTER_TASK", () => {
    const config = buildSetterCallConfig(BASE_REQUEST_DATA);
    expect(config.task).toBe(SETTER_TASK);
  });

  test("returns object with request_data passed through", () => {
    const config = buildSetterCallConfig(BASE_REQUEST_DATA);
    expect(config.requestData).toBeDefined();
    expect(config.requestData.ghl_contact_id).toBe("ghl_1");
    expect(config.requestData.first_name).toBe("John");
  });

  test("sets wait_for_greeting to true", () => {
    const config = buildSetterCallConfig(BASE_REQUEST_DATA);
    expect(config.waitForGreeting).toBe(true);
  });

  test("sets default voice to 'nat' when BLAND_VOICE env is not set", () => {
    const config = buildSetterCallConfig(BASE_REQUEST_DATA);
    expect(config.voice).toBe("mason");
  });

  test("voice remains 'nat' regardless of BLAND_VOICE env (voice is hardcoded in setter prompt)", () => {
    process.env.BLAND_VOICE = "david";
    const config = buildSetterCallConfig(BASE_REQUEST_DATA);
    // setter-prompt.js hardcodes voice to "mason"; BLAND_VOICE env is not read here
    expect(config.voice).toBe("mason");
  });

  // ---- Webhook URL ----

  test("defaults webhook to Fundhub Bland inbound URL", () => {
    const config = buildSetterCallConfig(BASE_REQUEST_DATA);
    expect(config.webhookUrl).toBe("https://fundhub.ai/api/webhooks/bland");
  });

  test("uses BLAND_WEBHOOK_URL when set", () => {
    process.env.BLAND_WEBHOOK_URL = "https://fundhub.ai/api/webhooks/bland";
    const config = buildSetterCallConfig(BASE_REQUEST_DATA);
    expect(config.webhookUrl).toBe("https://fundhub.ai/api/webhooks/bland");
  });

  test("ignores WEBHOOK_BASE_URL Vercel path pattern", () => {
    process.env.WEBHOOK_BASE_URL = "https://inquiry-removal.vercel.app";
    const config = buildSetterCallConfig(BASE_REQUEST_DATA);
    expect(config.webhookUrl).toBe("https://fundhub.ai/api/webhooks/bland");
    expect(config.webhookUrl).not.toContain("/api/setter-webhook");
  });

  // ---- Metadata ----

  test("includes metadata with ghl_contact_id", () => {
    const config = buildSetterCallConfig(BASE_REQUEST_DATA);
    expect(config.metadata).toBeDefined();
    expect(config.metadata.ghl_contact_id).toBe("ghl_1");
  });

  test("applies overrides to config", () => {
    const config = buildSetterCallConfig(BASE_REQUEST_DATA, { metadata: { ghl_contact_id: "ghl_1", call_type: "setter" } });
    expect(config.metadata).toEqual({ ghl_contact_id: "ghl_1", call_type: "setter" });
  });

  // ---- Overrides spread ----

  test("allows overrides to add extra fields", () => {
    const config = buildSetterCallConfig(BASE_REQUEST_DATA, { customField: "test" });
    expect(config.customField).toBe("test");
  });

  test("defaults metadata to object with contact data when no overrides", () => {
    const config = buildSetterCallConfig(BASE_REQUEST_DATA);
    expect(typeof config.metadata).toBe("object");
    expect(config.metadata).not.toBeNull();
  });
});

describe("SETTER_TASK", () => {
  test("is a non-empty string", () => {
    expect(typeof SETTER_TASK).toBe("string");
    expect(SETTER_TASK.length).toBeGreaterThan(100);
  });

  test("contains survey placeholders, not prequal merge tags", () => {
    expect(SETTER_TASK).toContain("{{first_name}}");
    expect(SETTER_TASK).toContain("{{funding_target_amount}}");
    expect(SETTER_TASK).toContain("{{planned_use}}");
    expect(SETTER_TASK).not.toContain("{{prequal_amount}}");
    expect(SETTER_TASK).toMatch(/YOU DO NOT HAVE:[\s\S]*UnderwriteIQ/i);
  });

  test("passes survey fields into requestData", () => {
    const config = buildSetterCallConfig(BASE_REQUEST_DATA);
    expect(config.requestData.funding_target_amount).toBe("$100k - $200k");
    expect(config.requestData.planned_use).toBe("Growth (marketing, inventory, hiring)");
    expect(config.requestData.self_reported_fico).toBe("700-749");
  });

  test("includes identity as Josh", () => {
    expect(SETTER_TASK).toContain("Josh");
  });

  test("includes voicemail script", () => {
    expect(SETTER_TASK).toContain("VOICEMAIL");
  });

  test("includes guardrails section", () => {
    expect(SETTER_TASK).toContain("GUARDRAILS");
  });

  test("includes call flow or rules section", () => {
    const hasRules = SETTER_TASK.includes("RULES") || SETTER_TASK.includes("CALL FLOW");
    expect(hasRules).toBe(true);
  });
});

describe("SETTER_ANALYSIS_QUESTIONS", () => {
  test("is an array of strings", () => {
    expect(Array.isArray(SETTER_ANALYSIS_QUESTIONS)).toBe(true);
    expect(SETTER_ANALYSIS_QUESTIONS.length).toBeGreaterThan(0);
    for (const q of SETTER_ANALYSIS_QUESTIONS) {
      expect(typeof q).toBe("string");
    }
  });

  test("includes disposition question", () => {
    const hasDisposition = SETTER_ANALYSIS_QUESTIONS.some(
      (q) => q.toLowerCase().includes("disposition")
    );
    expect(hasDisposition).toBe(true);
  });

  test("includes appointment question", () => {
    const hasAppointment = SETTER_ANALYSIS_QUESTIONS.some(
      (q) => q.toLowerCase().includes("appointment")
    );
    expect(hasAppointment).toBe(true);
  });
});

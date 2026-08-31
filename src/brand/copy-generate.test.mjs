import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { defaultBody, legalBlocks } from "./templates.mjs";
import { generateSectionCopy } from "./copy-generate.mjs";

const PID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PAGE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const GUARANTEE_RULE = {
  rule_set: "claims",
  rule_key: "guaranteed-approval",
  offer_types: [],
  platforms: [],
  match_type: "regex",
  pattern: "guaranteed\\s+approval",
  severity: "block",
  message: "Guaranteed approval is prohibited.",
  citation: "test"
};

function fakeDb({ enabled = true, used = 0, inserts = [] } = {}) {
  return {
    inserts,
    query: async (sql, params) => {
      if (/FROM partner_module_settings/i.test(sql)) {
        return { rows: [{ marketing_suite_enabled: enabled, ai_token_cap_monthly: 250000, org_id: ORG }] };
      }
      if (/FROM partner_ai_usage/i.test(sql)) return { rows: [{ used }] };
      if (/FROM compliance_rules/i.test(sql)) return { rows: [GUARANTEE_RULE] };
      if (/INSERT INTO partner_ai_usage/i.test(sql)) {
        inserts.push({ kind: "usage", params });
        return { rows: [{ id: "u1", input_tokens: params[4], output_tokens: params[5] }] };
      }
      if (/INSERT INTO partner_page_section_versions/i.test(sql)) {
        inserts.push({ kind: "history", params });
        return { rows: [] };
      }
      if (/UPDATE partner_pages/i.test(sql)) {
        inserts.push({ kind: "page", params });
        return { rows: [] };
      }
      throw new Error("unexpected sql: " + sql);
    }
  };
}

const pageOf = (body) => ({
  id: PAGE, org_id: ORG, partner_id: PID, title: "Apply", funnel_key: "apply",
  body_json: body
});

function fetchText(text) {
  return async () => ({
    ok: true,
    json: async () => ({
      content: [{ type: "text", text }],
      usage: { input_tokens: 11, output_tokens: 7 }
    })
  });
}

describe("generateSectionCopy", () => {
  test("refuses a locked legal block", async () => {
    const db = fakeDb();
    await assert.rejects(
      () => generateSectionCopy({
        db, orgId: ORG, partnerId: PID,
        page: pageOf(defaultBody("apply", { entity_name: "Acme" })),
        brand: { entity_name: "Acme" },
        sectionId: "legal-lender",
        env: { ANTHROPIC_API_KEY: "k" }
      }),
      (err) => err.code === "locked_section"
    );
  });

  test("refuses when the owner switch is off", async () => {
    const db = fakeDb({ enabled: false });
    await assert.rejects(
      () => generateSectionCopy({
        db, orgId: ORG, partnerId: PID,
        page: pageOf(defaultBody("apply", { entity_name: "Acme" })),
        brand: { entity_name: "Acme" },
        env: { ANTHROPIC_API_KEY: "k" }
      }),
      (err) => err.code === "suite_off"
    );
  });

  test("writes unlocked copy, records tokens, and keeps legal blocks", async () => {
    const db = fakeDb();
    const body = defaultBody("apply", { entity_name: "Acme" });
    const out = await generateSectionCopy({
      db, orgId: ORG, partnerId: PID,
      page: pageOf(body),
      brand: { entity_name: "Acme" },
      sectionId: "hero",
      env: { ANTHROPIC_API_KEY: "k" },
      fetchImpl: fetchText('{"headline":"A funding review","sub":"Lenders decide."}')
    });
    assert.equal(out.results[0].state, "needs_approval");
    assert.equal(out.body.sections.find((s) => s.id === "hero").headline, "A funding review");
    /* Counted from legalBlocks() rather than typed. A locked count typed into a
       test turns "a required disclosure was added" into a failure that reads
       like a regression — and the assertion that matters here is that the AI
       write left every locked block alone, not how many there are. */
    assert.equal(out.body.sections.filter((s) => s.locked).length, legalBlocks("Acme").length);
    assert.ok(db.inserts.some((x) => x.kind === "usage"));
    assert.ok(db.inserts.some((x) => x.kind === "history"));
  });

  test("blocked copy is not applied but usage is still recorded", async () => {
    const db = fakeDb();
    const body = defaultBody("apply", { entity_name: "Acme" });
    const before = body.sections.find((s) => s.id === "hero").headline;
    const out = await generateSectionCopy({
      db, orgId: ORG, partnerId: PID,
      page: pageOf(body),
      brand: { entity_name: "Acme" },
      sectionId: "hero",
      env: { ANTHROPIC_API_KEY: "k" },
      fetchImpl: fetchText('{"headline":"Guaranteed approval for everyone"}')
    });
    assert.equal(out.results[0].state, "blocked");
    assert.equal(out.body.sections.find((s) => s.id === "hero").headline, before);
    assert.ok(db.inserts.some((x) => x.kind === "usage"));
    assert.equal(db.inserts.filter((x) => x.kind === "history").length, 0);
  });
});

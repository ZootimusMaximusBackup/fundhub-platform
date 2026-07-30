// Adversarial tests for the guardrail engine.
//
// Written to BREAK the screen, not to confirm it works. Per the spec, every rule
// gets two cases:
//
//   a BLOCKED variant  — copy that must not reach a platform
//   a NEAR-MISS variant — copy that is deliberately close to the banned phrasing
//                         and must still PASS
//
// The near-misses are the point. A rule that blocks "guaranteed 100 point
// increase" is easy; a rule that also blocks "our clients have seen score
// increases" is a rule that makes the product unusable and will be switched off
// by whoever is on call. Both failure directions are bugs, so both are tested.
//
// These run without a database: the rule rows are loaded through a fake db, using
// the exact patterns seeded in 047_compliance_rules.sql. The migration and this
// fixture are kept in step by rulesInSync(), which fails if a rule_key is seeded
// but not exercised here.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { screen, clearRuleCache, OFFER_TYPES } from "./screen.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.join(HERE, "../../db/migrations/047_compliance_rules.sql");

const ORG = "00000000-0000-4000-8000-000000000001";
const PARTNER = "00000000-0000-4000-8000-000000000002";

/* The rules, parsed straight out of the migration's VALUES block. Reading the
   real SQL rather than restating the patterns here means a typo in the migration
   fails these tests instead of being mirrored by a copy that was edited in step
   with it. */
function seededRules() {
  const sql = fs.readFileSync(MIGRATION, "utf8");
  const block = sql.slice(sql.indexOf("CROSS JOIN (VALUES"), sql.indexOf("AS v(rule_set"));
  const rows = [];
  // Each row is ('set','key','[..]','[..]','match','pattern','sev','msg','cite')
  const re = /\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*\)/g;
  let m;
  while ((m = re.exec(block))) {
    const [, rule_set, rule_key, offer_types, platforms, match_type, pattern, severity, message, citation] = m;
    rows.push({
      rule_set, rule_key,
      offer_types: JSON.parse(offer_types),
      platforms: JSON.parse(platforms),
      match_type,
      pattern: pattern.replace(/''/g, "'"),
      severity,
      message: message.replace(/''/g, "'"),
      citation
    });
  }
  return rows;
}

const RULES = seededRules();

/* A db stand-in. categoryMap defaults to POPULATED so the Meta path is testable;
   the unset case gets its own test, because "unset config blocks everything" is
   itself a rule worth proving. */
function fakeDb({ rules = RULES, categoryMap = { funding: "CREDIT", credit_cards: "CREDIT", credit_repair: "CREDIT" } } = {}) {
  return {
    query: async (sql, params) => {
      if (sql.includes("FROM compliance_rules")) return { rows: rules };
      if (sql.includes("ad_platform_category_map")) {
        const v = categoryMap[params[1]];
        return { rows: v ? [{ special_ad_category: v }] : [] };
      }
      if (sql.includes("INSERT INTO compliance_screenings")) return { rows: [] };
      throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
    }
  };
}

// approveBeforeLaunch:false isolates the COPY rules from the approval gate — with
// it on, everything returns needs_approval and a broken pattern would be invisible.
const base = {
  orgId: ORG, partnerId: PARTNER, platform: "meta",
  approveBeforeLaunch: false, targeting: undefined
};
const run = (text, over = {}) =>
  screen(fakeDb(over.db || {}), { ...base, text, ...over, db: undefined });

const codes = (res) => res.reasons.map((x) => x.code);

beforeEach(() => clearRuleCache());

// ---------------------------------------------------------------------------
// CROA — applies to credit_repair
// ---------------------------------------------------------------------------

describe("CROA rules", () => {
  // hasDisclosureAsset satisfies the SEPARATE croa-consumer-rights rule, which is
  // tested on its own below. Without it every credit_repair near-miss trips the
  // missing-disclosure block and the CROA pattern under test is never reached —
  // the near-miss would "fail" for a reason that has nothing to do with it.
  const cr = { offerType: "credit_repair", hasDisclosureAsset: true };

  // credit_repair always ends in needs_approval when it is otherwise clean, so
  // "passes" means "was not blocked".
  const notBlocked = async (text) => {
    const res = await run(text, cr);
    assert.notStrictEqual(res.state, "blocked",
      `expected near-miss to survive screening, got blocked for: ${JSON.stringify(codes(res))}`);
  };
  const blockedBy = async (text, key) => {
    const res = await run(text, cr);
    assert.strictEqual(res.state, "blocked", `expected a block for: ${text}`);
    assert.ok(codes(res).includes(key), `expected ${key}, got ${JSON.stringify(codes(res))}`);
  };

  test("guaranteed score increase — blocked", () =>
    blockedBy("We guarantee a 100 point score increase in 30 days.", "guaranteed-score-increase"));

  test("guaranteed score increase — near miss passes", () =>
    // No guarantee, no number attached to a promise. This is the compliant way to
    // say the same thing, and blocking it would make the product unusable.
    notBlocked("Clients often see their scores improve as inaccurate items are corrected. Results vary."));

  test("promise to remove accurate info — blocked", () =>
    blockedBy("We remove negative items from your report, even accurate ones.",
      "promise-to-remove-accurate-info"));

  test("promise to remove accurate info — near miss passes", () =>
    notBlocked("We dispute inaccurate and unverifiable items on your report."));

  test("remove late payments — blocked", () =>
    blockedBy("We delete late payments and collections permanently.",
      "remove-late-payments-collections"));

  test("remove late payments — near miss passes", () =>
    notBlocked("If a late payment is reported in error, we help you dispute it."));

  test("advance fee — blocked", () =>
    blockedBy("Just $99 upfront to get started on your credit repair.", "advance-fee"));

  test("advance fee — near miss passes", () =>
    // Billing after performance is the compliant model, and saying so must not trip
    // the same rule that catches "pay upfront".
    notBlocked("You are billed only after the first round of disputes is complete."));

  test("CPN / file segregation — blocked", () =>
    blockedBy("Get a CPN and start fresh with a clean file.", "file-segregation-cpn"));

  test("CPN / file segregation — near miss passes", () =>
    // "cpn" as a substring of an ordinary word must not fire. This is exactly what
    // the \y-vs-\b boundary bug would have broken in the other direction.
    notBlocked("Our CPNs policy: we never use them. Ask about incpnsistent reporting."));

  test("guaranteed timeline — blocked", () =>
    blockedBy("Guaranteed results in 45 days or your money back.", "guaranteed-timeline"));

  test("guaranteed timeline — near miss passes", () =>
    notBlocked("Most disputes receive a response within 30 to 45 days."));
});

// ---------------------------------------------------------------------------
// Claims — all offer types
// ---------------------------------------------------------------------------

describe("claims rules", () => {
  const fund = { offerType: "funding" };

  test("guaranteed approval — blocked", async () => {
    const res = await run("Guaranteed approval for every business owner.", fund);
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("guaranteed-approval"));
  });

  test("guaranteed approval — near miss passes", async () => {
    const res = await run("Approval depends on your profile. See if you prequalify.", fund);
    assert.strictEqual(res.state, "passed");
  });

  test("guaranteed funding amount — blocked", async () => {
    const res = await run("Get $50,000 in funding, guaranteed.", fund);
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("guaranteed-funding-amount"));
  });

  test("guaranteed funding amount — near miss passes", async () => {
    // "up to", with the qualifier, is the compliant construction.
    const res = await run("Qualified applicants may receive up to $50,000 depending on underwriting.", fund);
    assert.strictEqual(res.state, "passed");
  });

  test("fabricated testimonial — blocked", async () => {
    const res = await run("These results are typical for our clients.", fund);
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("fabricated-testimonial"));
  });

  test("fabricated testimonial — near miss passes", async () => {
    const res = await run("Results are not typical and vary by applicant.", fund);
    assert.strictEqual(res.state, "passed");
  });

  test("income/wealth targeting cue — blocked", async () => {
    const res = await run("Are you broke and tired of being denied?", fund);
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("income-wealth-targeting-cue"));
  });

  test("income/wealth targeting cue — near miss passes", async () => {
    const res = await run("Business owners: see what funding options fit your profile.", fund);
    assert.strictEqual(res.state, "passed");
  });

  test("claims rules apply to credit_cards too, not just funding", async () => {
    const res = await run("Guaranteed approval, no credit check.", { offerType: "credit_cards" });
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("guaranteed-approval"));
  });
});

// ---------------------------------------------------------------------------
// Disclosure
// ---------------------------------------------------------------------------

describe("disclosure rules", () => {
  test("credit repair without the consumer-rights disclosure — blocked", async () => {
    const res = await run("We help you dispute inaccurate items.", { offerType: "credit_repair" });
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("croa-consumer-rights"));
  });

  test("disclosure satisfied by the copy itself", async () => {
    const res = await run(
      "We dispute inaccurate items. Consumer Credit File Rights Under State and Federal Law apply.",
      { offerType: "credit_repair" });
    assert.notStrictEqual(res.state, "blocked");
  });

  test("disclosure satisfied by a linked disclosure asset", async () => {
    const res = await run("We dispute inaccurate items.",
      { offerType: "credit_repair", hasDisclosureAsset: true });
    assert.notStrictEqual(res.state, "blocked");
  });

  test("funding offers do not require the CROA disclosure", async () => {
    const res = await run("Business funding for qualified applicants.", { offerType: "funding" });
    assert.strictEqual(res.state, "passed");
  });

  test("a synthetic performer that is not flagged ai_generated is blocked", async () => {
    const res = await run("Business funding options.",
      { offerType: "funding", syntheticPerformer: true, aiGenerated: false });
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("synthetic_without_ai_flag"));
  });

  test("a synthetic performer correctly flagged passes", async () => {
    const res = await run("Business funding options.",
      { offerType: "funding", syntheticPerformer: true, aiGenerated: true });
    assert.strictEqual(res.state, "passed");
  });
});

// ---------------------------------------------------------------------------
// Platform rules — the structural blocks
// ---------------------------------------------------------------------------

describe("platform rules", () => {
  test("TikTok + credit_repair is blocked with clean copy and every gate satisfied", async () => {
    // The whole point: nothing about the creative can rescue this combination.
    const res = await run(
      "Consumer Credit File Rights Under State and Federal Law. We dispute inaccurate items.",
      { offerType: "credit_repair", platform: "tiktok", hasDisclosureAsset: true });
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("tiktok_credit_repair_prohibited"));
  });

  test("TikTok + credit_repair stays blocked even if the config row is deactivated", async () => {
    // The structural check runs before the rule rows are consulted, so removing
    // the row changes the message source but not the outcome.
    const res = await run("Clean copy.", {
      offerType: "credit_repair", platform: "tiktok", hasDisclosureAsset: true,
      db: { rules: RULES.filter((x) => x.rule_key !== "tiktok-credit-repair-prohibited") }
    });
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("tiktok_credit_repair_prohibited"));
  });

  test("TikTok + funding is allowed — the block is offer-specific, not a TikTok ban", async () => {
    const res = await run("Business funding for qualified applicants.",
      { offerType: "funding", platform: "tiktok" });
    assert.strictEqual(res.state, "passed");
  });

  test("Meta with no configured special_ad_category is blocked", async () => {
    const res = await run("Business funding for qualified applicants.",
      { offerType: "funding", platform: "meta", db: { categoryMap: {} } });
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("special_ad_category_unset"));
  });
});

// ---------------------------------------------------------------------------
// Approval gates
// ---------------------------------------------------------------------------

describe("approval gates", () => {
  test("credit_repair needs approval even with approve_before_launch OFF", async () => {
    const res = await run(
      "Consumer Credit File Rights Under State and Federal Law. We dispute inaccurate items.",
      { offerType: "credit_repair", approveBeforeLaunch: false, hasDisclosureAsset: true });
    assert.strictEqual(res.state, "needs_approval");
    assert.ok(codes(res).includes("human_approval_required_credit_repair"));
  });

  test("funding needs approval while the setting is ON", async () => {
    const res = await run("Business funding for qualified applicants.",
      { offerType: "funding", approveBeforeLaunch: true });
    assert.strictEqual(res.state, "needs_approval");
    assert.ok(codes(res).includes("human_approval_required_setting"));
  });

  test("funding passes with the setting OFF", async () => {
    const res = await run("Business funding for qualified applicants.",
      { offerType: "funding", approveBeforeLaunch: false });
    assert.strictEqual(res.state, "passed");
  });

  test("needs_approval is never a pass — blocked copy stays blocked", async () => {
    const res = await run("Guaranteed approval!", { offerType: "funding", approveBeforeLaunch: true });
    assert.strictEqual(res.state, "blocked");
  });
});

// ---------------------------------------------------------------------------
// Fail-closed
// ---------------------------------------------------------------------------

describe("fails closed", () => {
  test("a database error blocks rather than passes", async () => {
    const broken = { query: async () => { throw new Error("connection refused"); } };
    const res = await screen(broken, { ...base, offerType: "funding", text: "anything" });
    assert.strictEqual(res.state, "blocked");
    assert.strictEqual(res.reasons[0].code, "screen_error");
  });

  test("an uncompilable regex in a rule row blocks rather than being skipped", async () => {
    const res = await run("anything", {
      offerType: "funding",
      db: { rules: [{ rule_set: "claims", rule_key: "bad", offer_types: [], platforms: [],
                      match_type: "regex", pattern: "([unclosed", severity: "block",
                      message: "x", citation: null }] }
    });
    assert.strictEqual(res.state, "blocked");
    assert.strictEqual(res.reasons[0].code, "screen_error");
  });

  test("a missing offer_type blocks", async () => {
    const res = await run("anything", { offerType: undefined });
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("offer_type_missing"));
  });

  test("an unknown offer_type blocks rather than defaulting", async () => {
    const res = await run("anything", { offerType: "mortgage" });
    assert.strictEqual(res.state, "blocked");
  });

  test("an unknown platform blocks", async () => {
    const res = await run("anything", { offerType: "funding", platform: "snapchat" });
    assert.strictEqual(res.state, "blocked");
  });

  test("a missing partnerId blocks — an unscoped screen is not a screen", async () => {
    const res = await screen(fakeDb(), { ...base, partnerId: undefined, offerType: "funding", text: "x" });
    assert.strictEqual(res.state, "blocked");
  });

  test("there is no override argument that produces a pass on banned copy", async () => {
    // Named explicitly because the spec forbids building one: if someone adds a
    // `force`/`skipCompliance`/`override` option later, this test is where it
    // shows up as a failure.
    for (const key of ["force", "override", "skipCompliance", "bypass", "admin"]) {
      const res = await run("Guaranteed approval!", { offerType: "funding", [key]: true });
      assert.strictEqual(res.state, "blocked", `option "${key}" must not bypass the engine`);
    }
  });
});

// ---------------------------------------------------------------------------
// The fixture cannot drift from the migration
// ---------------------------------------------------------------------------

describe("rule coverage", () => {
  test("every seeded rule was parsed out of the migration", () => {
    // If the regex above stops matching the VALUES block, every rule test would
    // silently pass against an empty rule set. This is the tripwire.
    assert.ok(RULES.length >= 12, `expected the seeded rules, parsed ${RULES.length}`);
    for (const set of ["croa", "claims", "disclosure", "platform"]) {
      assert.ok(RULES.some((r) => r.rule_set === set), `no ${set} rules parsed`);
    }
  });

  test("every seeded rule_key has a blocked case in this file", () => {
    const body = fs.readFileSync(path.join(HERE, "screen.test.mjs"), "utf8");
    const missing = RULES
      .filter((r) => r.rule_key !== "tiktok-credit-repair-prohibited")
      .map((r) => r.rule_key)
      .filter((k) => !body.includes(`"${k}"`));
    assert.deepStrictEqual(missing, [],
      `these rules are seeded but never asserted on: ${missing.join(", ")}`);
  });

  test("every offer type is exercised", () => {
    assert.deepStrictEqual([...OFFER_TYPES].sort(), ["credit_cards", "credit_repair", "funding"]);
  });
});

"use strict";

/**
 * Smash tests for vendor generate-deliverables.js.
 * Never hits live Anthropic — fetch is always stubbed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const CLAUDE_CLIENT_PATH = path.resolve(
  here,
  "../../vendor/underwriteiq-full/api/lite/crs/claude-client.js"
);
const GD_PATH = path.resolve(
  here,
  "../../vendor/underwriteiq-full/api/lite/crs/generate-deliverables.js"
);
const METRO2_PATH = path.resolve(
  here,
  "../../vendor/underwriteiq-full/api/lite/crs/metro2-violation-checker.js"
);
const PRESEND_PATH = path.resolve(
  here,
  "../../vendor/underwriteiq-full/api/lite/crs/presend-validator.js"
);

const MARKDOWN_DOC = [
  "## 01 / PICTURE — Where this file stands",
  "",
  "This file is repair-first. Median score is 590.",
  "",
  "## 08 / BOTTOM LINE — Current vs projected pre-approval",
  "",
  "Do the work. Then re-pull."
].join("\n");

const FENCED_JSON = '```json\n{"heading":"Credit Analysis","paragraph":"dump"}\n```';

function makeCRSResult(overrides = {}) {
  return {
    outcome: "FULL_FUNDING",
    bureaus: {
      experian: { clean: false },
      equifax: { clean: true },
      transunion: { clean: true }
    },
    normalized: {
      tradelines: [
        {
          creditorName: "Capital One",
          accountIdentifier: "ACCT-1234",
          source: "experian",
          accountType: "revolving",
          loanType: "CreditCard",
          ownership: "individual",
          isAU: false,
          status: "chargeoff",
          openedDate: "2020-01-01",
          closedDate: "2022-06-01",
          reportedDate: "2026-01-01",
          lastActivityDate: "2022-06-01",
          creditLimit: 5000,
          highBalance: 5000,
          currentBalance: 3200,
          effectiveLimit: 5000,
          pastDue: 3200,
          monthlyPayment: null,
          chargeOffAmount: 3200,
          termsMonths: null,
          monthsReviewed: 48,
          latePayments: { _30: 2, _60: 1, _90: 1 },
          currentRatingCode: "97",
          currentRatingType: "ChargeOff",
          ratingSeverity: 5,
          isDerogatory: true,
          paymentPattern: null,
          adverseRatings: {
            highest: { date: "2021-06-01", type: "ChargeOff" },
            mostRecent: { date: "2022-01-01", type: "ChargeOff" },
            prior: []
          },
          comments: []
        }
      ],
      inquiries: [{ source: "experian", creditorName: "GECS", date: "2024-04-01" }],
      identity: {}
    },
    consumerSignals: {
      scores: { median: 590 },
      utilization: { overall: 64 },
      bureauNegatives: {},
      auImpact: null
    },
    businessSignals: { available: false },
    preapprovals: { totalPersonal: 0, totalBusiness: 0, totalCombined: 0 },
    projectedPreapproval: null,
    suggestions: { fullSuggestions: [] },
    ...overrides
  };
}

function makePersonal() {
  return {
    name: "Barbara Doty",
    address: "123 Main St, Denton TX 76201",
    firstName: "Barbara",
    lastName: "Doty"
  };
}

function classifyCall(opts) {
  try {
    const payload = JSON.parse(opts.user || "{}");
    if (payload.furnisher) return "dispute";
    if (Object.prototype.hasOwnProperty.call(payload, "personalInfo") && !payload.outcome) {
      return "personal_info";
    }
    if (Array.isArray(payload.inquiries) && !payload.outcome) return "inquiry";
    if (payload.cta || payload.lenderMatches || payload.outcome) return "analysis_doc";
    return "unknown";
  } catch {
    return "unknown";
  }
}

function looksLikeJsonDump(value) {
  if (typeof value !== "string") return false;
  if (/```json/i.test(value)) return true;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function installFetchGuard() {
  const orig = globalThis.fetch;
  let calls = 0;
  const urls = [];
  globalThis.fetch = async (url) => {
    calls += 1;
    urls.push(String(url));
    throw new Error("ANTHROPIC fetch is forbidden in generate-deliverables tests");
  };
  return {
    calls: () => calls,
    urls: () => urls,
    restore() {
      globalThis.fetch = orig;
    }
  };
}

async function withStub(stub, testFn, extra = {}) {
  const guard = installFetchGuard();
  const origCC = require.cache[CLAUDE_CLIENT_PATH];
  const origGD = require.cache[GD_PATH];
  const origMetro = require.cache[METRO2_PATH];
  const origPresend = require.cache[PRESEND_PATH];

  require.cache[CLAUDE_CLIENT_PATH] = {
    id: CLAUDE_CLIENT_PATH,
    filename: CLAUDE_CLIENT_PATH,
    loaded: true,
    exports: { callClaude: stub }
  };
  if (extra.detectViolations) {
    require.cache[METRO2_PATH] = {
      id: METRO2_PATH,
      filename: METRO2_PATH,
      loaded: true,
      exports: { detectViolations: extra.detectViolations }
    };
  }
  if (extra.validatePreSend) {
    require.cache[PRESEND_PATH] = {
      id: PRESEND_PATH,
      filename: PRESEND_PATH,
      loaded: true,
      exports: { validatePreSend: extra.validatePreSend }
    };
  }
  delete require.cache[GD_PATH];
  const freshModule = require(GD_PATH);

  try {
    await testFn(freshModule, guard);
    assert.equal(guard.calls(), 0, "unit tests must never call fetch (live Anthropic)");
  } finally {
    guard.restore();
    if (origCC) require.cache[CLAUDE_CLIENT_PATH] = origCC;
    else delete require.cache[CLAUDE_CLIENT_PATH];
    if (origGD) require.cache[GD_PATH] = origGD;
    else delete require.cache[GD_PATH];
    if (extra.detectViolations) {
      if (origMetro) require.cache[METRO2_PATH] = origMetro;
      else delete require.cache[METRO2_PATH];
    }
    if (extra.validatePreSend) {
      if (origPresend) require.cache[PRESEND_PATH] = origPresend;
      else delete require.cache[PRESEND_PATH];
    }
  }
}

function analysisAndLetterStub(systems) {
  return async (opts) => {
    if (systems) systems.push(opts.system || "");
    const kind = classifyCall(opts);
    if (kind === "personal_info" || kind === "inquiry") {
      return "I am writing to ensure my personal information is accurate.";
    }
    return MARKDOWN_DOC;
  };
}

test("pack funding does not ask Claude for dispute, personal-info, or inquiry letters", async () => {
  const kinds = [];
  const stub = async (opts) => {
    kinds.push(classifyCall(opts));
    return MARKDOWN_DOC;
  };
  await withStub(stub, async ({ generateDeliverables }) => {
    const result = await generateDeliverables(makeCRSResult(), makePersonal(), {
      pack: "funding"
    });
    assert.equal(result.letters.length, 0, "funding pack must skip all Claude letters");
    assert.equal(
      kinds.filter((k) => k === "dispute" || k === "personal_info" || k === "inquiry").length,
      0,
      `funding pack still asked Claude for letters: ${kinds.join(", ")}`
    );
    assert.ok(kinds.length >= 1, "funding pack still generates the four analysis docs");
    assert.ok(
      kinds.every((k) => k === "analysis_doc"),
      `unexpected Claude call kinds: ${kinds.join(", ")}`
    );
    assert.equal(result.documents.creditAnalysis, MARKDOWN_DOC);
  });
});

test("missing ANTHROPIC key skips docs, does not throw, does not invent JSON", async () => {
  const guard = installFetchGuard();
  const prevKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete require.cache[GD_PATH];
  delete require.cache[CLAUDE_CLIENT_PATH];
  try {
    const { generateDeliverables } = require(GD_PATH);
    let threw = false;
    let result;
    try {
      result = await generateDeliverables(makeCRSResult(), makePersonal(), {
        pack: "funding"
      });
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "missing key must skip, not throw");
    assert.equal(guard.calls(), 0, "missing key must not hit fetch");
    assert.equal(result.letters.length, 0);
    for (const [name, value] of Object.entries(result.documents)) {
      assert.equal(value, null, `${name} must be skipped when the key is missing`);
      assert.equal(looksLikeJsonDump(value), false, `${name} must not be a fake JSON doc`);
    }
    assert.equal(result.meta.documentsGenerated, 0);
  } finally {
    guard.restore();
    if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey;
    else delete process.env.ANTHROPIC_API_KEY;
    delete require.cache[GD_PATH];
    delete require.cache[CLAUDE_CLIENT_PATH];
  }
});

test("fenced JSON from Claude is not stored as the PDF body", async () => {
  const stub = async () => FENCED_JSON;
  await withStub(stub, async ({ generateDeliverables }) => {
    const result = await generateDeliverables(makeCRSResult(), makePersonal(), {
      pack: "funding"
    });
    for (const [name, value] of Object.entries(result.documents)) {
      assert.notEqual(value, FENCED_JSON, `${name} stored the fenced JSON blob as the body`);
      assert.equal(looksLikeJsonDump(value), false, `${name} stored JSON as markdown`);
      assert.equal(value, null, `${name} must skip a fenced JSON blob`);
    }
  });
});

test("one fenced JSON doc is skipped and the rest of the pack still returns", async () => {
  const stub = async (opts) => {
    if (/Financial Profile Assessment/i.test(opts.system || "")) {
      return FENCED_JSON;
    }
    return MARKDOWN_DOC;
  };
  await withStub(stub, async ({ generateDeliverables }) => {
    const result = await generateDeliverables(makeCRSResult(), makePersonal(), {
      pack: "funding"
    });
    assert.equal(result.documents.creditAnalysis, null);
    assert.equal(result.documents.roadmap, MARKDOWN_DOC);
    assert.equal(result.documents.fundingSnapshot, MARKDOWN_DOC);
    assert.equal(result.documents.lenderMatchList, MARKDOWN_DOC);
    assert.equal(result.meta.documentsGenerated, 3);
  });
});

test("timeout on one doc skips that doc and does not crash the pack", async () => {
  const stub = async (opts) => {
    if (/Business Readiness Roadmap/i.test(opts.system || "")) {
      const err = new Error("Claude API timeout after 90000ms");
      err.name = "AbortError";
      throw err;
    }
    return MARKDOWN_DOC;
  };
  await withStub(stub, async ({ generateDeliverables }) => {
    let threw = false;
    let result;
    try {
      result = await generateDeliverables(makeCRSResult(), makePersonal(), {
        pack: "funding"
      });
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "timeout must not crash the pack");
    assert.equal(result.documents.roadmap, null);
    assert.equal(result.documents.creditAnalysis, MARKDOWN_DOC);
    assert.equal(result.letters.length, 0);
  });
});

test("empty Claude content skips that doc and does not crash the pack", async () => {
  const stub = async (opts) => {
    if (/Capital Readiness Snapshot/i.test(opts.system || "")) return "";
    if (/Capital Partner Shortlist/i.test(opts.system || "")) return "   \n";
    return MARKDOWN_DOC;
  };
  await withStub(stub, async ({ generateDeliverables }) => {
    let threw = false;
    let result;
    try {
      result = await generateDeliverables(makeCRSResult(), makePersonal(), {
        pack: "funding"
      });
    } catch {
      threw = true;
    }
    assert.equal(threw, false);
    assert.equal(result.documents.fundingSnapshot, null);
    assert.equal(result.documents.lenderMatchList, null);
    assert.equal(result.documents.creditAnalysis, MARKDOWN_DOC);
    assert.equal(result.documents.roadmap, MARKDOWN_DOC);
  });
});

test("callClaude throw during dispute letters skips the letter and does not crash", async () => {
  const stub = async (opts) => {
    const kind = classifyCall(opts);
    if (kind === "dispute") throw new Error("Claude API timeout after 90000ms");
    if (kind === "personal_info" || kind === "inquiry") return "I am writing to ensure my personal information is accurate.";
    return MARKDOWN_DOC;
  };
  await withStub(stub, async ({ generateDisputeLetters }) => {
    let threw = false;
    let letters;
    try {
      letters = await generateDisputeLetters(makeCRSResult(), makePersonal());
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "dispute timeout must skip, not crash");
    assert.equal(letters.filter((l) => l.type === "dispute").length, 0);
  });
});

test("missing scores skips lender-match and does not crash the pack", async () => {
  const systems = [];
  const crs = makeCRSResult({
    consumerSignals: {
      utilization: { overall: 64 },
      bureauNegatives: {},
      auImpact: null
    }
  });
  await withStub(analysisAndLetterStub(systems), async ({ generateDeliverables }) => {
    let threw = false;
    let result;
    try {
      result = await generateDeliverables(crs, makePersonal());
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "missing scores must skip lender-match, not crash");
    assert.equal(result.documents.lenderMatchList, null);
    assert.equal(result.documents.creditAnalysis, MARKDOWN_DOC);
    assert.equal(result.documents.roadmap, MARKDOWN_DOC);
    assert.equal(result.documents.fundingSnapshot, MARKDOWN_DOC);
    assert.equal(
      systems.filter((s) => /Capital Partner Shortlist/i.test(s)).length,
      0,
      "must not call Claude for lender-match when scores are missing"
    );
    assert.equal(result.lenderMatches.totalMatched, 0);
    assert.ok(result.letters.some((l) => l.type === "personal_info"));
  });
});

test("null scores skips lender-match and does not crash a funding pack", async () => {
  const systems = [];
  const crs = makeCRSResult({
    consumerSignals: {
      scores: null,
      utilization: { overall: 64 },
      bureauNegatives: {},
      auImpact: null
    }
  });
  await withStub(analysisAndLetterStub(systems), async ({ generateDeliverables }) => {
    let threw = false;
    let result;
    try {
      result = await generateDeliverables(crs, makePersonal(), { pack: "funding" });
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "null scores must skip lender-match, not crash");
    assert.equal(result.documents.lenderMatchList, null);
    assert.equal(result.documents.creditAnalysis, MARKDOWN_DOC);
    assert.equal(result.letters.length, 0);
    assert.equal(systems.filter((s) => /Capital Partner Shortlist/i.test(s)).length, 0);
  });
});

test("detectViolations throw skips that letter and the pack continues", async () => {
  await withStub(
    analysisAndLetterStub(),
    async ({ generateDeliverables }) => {
      let threw = false;
      let result;
      try {
        result = await generateDeliverables(makeCRSResult(), makePersonal());
      } catch {
        threw = true;
      }
      assert.equal(threw, false, "violation-check throw must skip the letter, not crash");
      assert.equal(result.letters.filter((l) => l.type === "dispute").length, 0);
      assert.ok(result.letters.some((l) => l.type === "personal_info"));
      assert.equal(result.documents.creditAnalysis, MARKDOWN_DOC);
      assert.equal(result.documents.lenderMatchList, MARKDOWN_DOC);
    },
    {
      detectViolations: () => {
        throw new Error("metro2 checker boom");
      }
    }
  );
});

test("validatePreSend throw skips that letter and the pack continues", async () => {
  await withStub(
    analysisAndLetterStub(),
    async ({ generateDeliverables }) => {
      let threw = false;
      let result;
      try {
        result = await generateDeliverables(makeCRSResult(), makePersonal());
      } catch {
        threw = true;
      }
      assert.equal(threw, false, "validatePreSend throw must skip the letter, not crash");
      assert.equal(result.letters.filter((l) => l.type === "dispute").length, 0);
      assert.ok(result.letters.some((l) => l.type === "personal_info"));
      assert.equal(result.documents.creditAnalysis, MARKDOWN_DOC);
      assert.equal(result.documents.roadmap, MARKDOWN_DOC);
    },
    {
      detectViolations: () => ({
        violations: [
          {
            code: "STALE_REPORTING",
            field: "Field 24 (Date Reported / Account Status Date)",
            severity: "high"
          }
        ]
      }),
      validatePreSend: () => {
        throw new Error("presend gate boom");
      }
    }
  );
});

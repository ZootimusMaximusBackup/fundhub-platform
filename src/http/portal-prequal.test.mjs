import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  formatPrequalUsd,
  portalCreditScores,
  portalHasScore,
  prequalFromCustomFields
} from "./portal-prequal.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("prequalFromCustomFields prefers analyzer_prequal_amount", () => {
  assert.equal(prequalFromCustomFields({
    analyzer_prequal_amount: 62000,
    total_funding_estimate: 50000
  }), 62000);
});

test("prequalFromCustomFields falls back to total_funding_estimate", () => {
  assert.equal(prequalFromCustomFields({ total_funding_estimate: 48000 }), 48000);
});

test("prequalFromCustomFields ignores empty or zero", () => {
  assert.equal(prequalFromCustomFields({}), null);
  assert.equal(prequalFromCustomFields({ analyzer_prequal_amount: 0 }), null);
});

test("formatPrequalUsd formats whole dollars", () => {
  assert.equal(formatPrequalUsd(50000), "$50,000");
});

test("portal-summary route is registered", () => {
  const api = readFileSync(path.join(ROOT, "netlify/functions/api.mjs"), "utf8");
  assert.match(api, /read\/portal-summary/);
  assert.match(api, /readPortalSummary/);
});

test("portal-summary handler admits client principals", () => {
  const src = readFileSync(path.join(ROOT, "api/read/portal-summary.mjs"), "utf8");
  assert.match(src, /requirePrincipal\(req, res, \["staff", "client"\]/);
  assert.match(src, /principal\.kind === "client"/);
});

test("client portal loads pre-qual from portal-summary", () => {
  const html = readFileSync(path.join(ROOT, "public/app/client-portal.html"), "utf8");
  assert.match(html, /portalSummary/);
  assert.match(html, /sb-prequal-amt/);
  assert.match(html, /doc-agent-note/);
  assert.match(html, /doc_agent_message/);
  assert.match(html, /sb-scores-card/);
  assert.match(html, /sb-score-ex-biz/);
  assert.match(html, /paintPortalScores/);
});

test("portalCreditScores reads 3-bureau FICO and Experian business 1-100", () => {
  const scores = portalCreditScores({
    crsResults: [{
      created_at: "2026-08-24T00:00:00Z",
      result: { scores: { ex: 720, eq: 710, tu: 705 } }
    }],
    businesses: [{ name: "Acme LLC", entity_data: { scores: { intelliscore: 72 } } }]
  });
  assert.deepEqual(scores, {
    experian: 720,
    equifax: 710,
    transunion: 705,
    experian_business: 72
  });
  assert.equal(portalHasScore(scores), true);
});

test("portalCreditScores leaves missing numbers null", () => {
  const scores = portalCreditScores({});
  assert.deepEqual(scores, {
    experian: null,
    equifax: null,
    transunion: null,
    experian_business: null
  });
  assert.equal(portalHasScore(scores), false);
});

test("portalCreditScores does not treat a FICO as a business score", () => {
  const scores = portalCreditScores({
    businesses: [{ entity_data: { scores: { intelliscore: 720 } } }]
  });
  assert.equal(scores.experian_business, null);
});

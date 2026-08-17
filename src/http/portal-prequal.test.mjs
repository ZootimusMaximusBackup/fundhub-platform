import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { prequalFromCustomFields, formatPrequalUsd } from "./portal-prequal.mjs";

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
});

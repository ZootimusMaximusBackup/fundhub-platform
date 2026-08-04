import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const consentSrc = readFileSync(join(HERE, "../../api/staff/monitoring-consent.mjs"), "utf8");
const teleSrc = readFileSync(join(HERE, "../../api/staff/telemetry.mjs"), "utf8");
const apiSrc = readFileSync(join(HERE, "../../netlify/functions/api.mjs"), "utf8");

test("monitoring-consent owner-only requireRole", () => {
  assert.match(consentSrc, /OWNER_ONLY/);
  assert.match(consentSrc, /requireRole\s*\(\s*res\s*,\s*staff\s*,\s*OWNER_ONLY\s*\)/);
});
test("telemetry FINANCE gate", () => {
  assert.match(teleSrc, /ROLE_SETS\.FINANCE/);
});
test("ROUTES registered", () => {
  assert.match(apiSrc, /"staff\/telemetry"/);
  assert.match(apiSrc, /"staff\/monitoring-consent"/);
});

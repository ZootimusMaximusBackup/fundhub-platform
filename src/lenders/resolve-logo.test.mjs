import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LENDER_LOGO_PLACEHOLDER, logoPathOrPlaceholder } from "./resolve-logo.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("logoPathOrPlaceholder keeps a real mark", () => {
  assert.equal(
    logoPathOrPlaceholder("/assets/lenders/chase.png"),
    "/assets/lenders/chase.png"
  );
});

test("logoPathOrPlaceholder uses the dark gold tile when no mark exists", () => {
  assert.equal(logoPathOrPlaceholder(null), LENDER_LOGO_PLACEHOLDER);
  assert.equal(logoPathOrPlaceholder(""), LENDER_LOGO_PLACEHOLDER);
  assert.equal(logoPathOrPlaceholder("   "), LENDER_LOGO_PLACEHOLDER);
});

test("placeholder mark is on disk", () => {
  const rel = LENDER_LOGO_PLACEHOLDER.replace(/^\//, "");
  assert.equal(fs.existsSync(path.join(ROOT, "public", rel)), true);
});

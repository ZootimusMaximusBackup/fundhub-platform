import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLogoPath } from "./resolve-logo.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("resolveLogoPath prefers sidecar when that file exists", () => {
  const exists = (p) => p === "/assets/lenders/chase.png";
  assert.equal(
    resolveLogoPath({
      name: "Chase",
      externalRowId: "LEGACY-1",
      sidecar: { "LEGACY-1": "/assets/lenders/chase.png" },
      exists
    }),
    "/assets/lenders/chase.png"
  );
});

test("resolveLogoPath falls back to slug file, then slug-0", () => {
  const exists = (p) => p === "/assets/lenders/elan-financial-0.png";
  assert.equal(
    resolveLogoPath({ name: "Elan Financial (0%", exists }),
    "/assets/lenders/elan-financial-0.png"
  );
});

test("resolveLogoPath returns null when no local mark exists", () => {
  assert.equal(resolveLogoPath({ name: "Unknown Credit Union XYZ", exists: () => false }), null);
});

test("resolveLogoPath aliases scrape wording to the same existing mark", () => {
  const exists = (p) =>
    p === "/assets/lenders/elan-financial.png" ||
    p === "/assets/lenders/ibc.png" ||
    p === "/assets/lenders/origin-bank.png" ||
    p === "/assets/lenders/fnbo.png" ||
    p === "/assets/lenders/southstate-bank.png";
  assert.equal(
    resolveLogoPath({ name: "Elan Financial Issuers", exists }),
    "/assets/lenders/elan-financial.png"
  );
  assert.equal(resolveLogoPath({ name: "IBC Bank", exists }), "/assets/lenders/ibc.png");
  assert.equal(
    resolveLogoPath({ name: "Origin Bank (0%", exists }),
    "/assets/lenders/origin-bank.png"
  );
  assert.equal(
    resolveLogoPath({ name: "First National Bank of Omaha (FNBO)", exists }),
    "/assets/lenders/fnbo.png"
  );
  assert.equal(
    resolveLogoPath({ name: "CenterState Bank (Now SouthState)", exists }),
    "/assets/lenders/southstate-bank.png"
  );
});

test("resolveLogoPath does not borrow another bank's mark", () => {
  const exists = (p) => p === "/assets/lenders/us-bank.png" || p === "/assets/lenders/first-bank.png";
  assert.equal(resolveLogoPath({ name: "Synovus Bank", exists }), null);
  assert.equal(resolveLogoPath({ name: "Local First Bank", exists }), null);
});

test("Chase mark from the existing lender pack is on disk", () => {
  const rel = "/assets/lenders/chase.png";
  assert.equal(
    resolveLogoPath({
      name: "Chase",
      exists: (p) => fs.existsSync(path.join(ROOT, "public", p.replace(/^\//, "")))
    }),
    rel
  );
});

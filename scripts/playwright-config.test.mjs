import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("CI Playwright must not run live fundhub.ai specs", () => {
  const cfg = readFileSync(join(root, "playwright.config.mjs"), "utf8");
  assert.match(cfg, /testIgnore/);
  assert.match(cfg, /live-\*\.spec\.mjs/);
  const live = readFileSync(join(root, "playwright.live.config.mjs"), "utf8");
  assert.match(live, /live-\*\.spec\.mjs/);
});

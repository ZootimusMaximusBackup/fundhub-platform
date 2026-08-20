// Separate from the required 31-id gate. This suite creates only marked E2E
// fixtures, reads them through the live UI, and removes them in afterAll.

import { defineConfig } from "@playwright/test";
import liveConfig from "./playwright.live.config.mjs";

export default defineConfig({
  ...liveConfig,
  testMatch: ["**/launch-proof-live.spec.mjs"],
  reporter: [
    ["list"],
    ["json", {
      outputFile: "docs/workflows/launch-proof-2026-08-20-evidence/live-browser-last-run.json"
    }]
  ]
});

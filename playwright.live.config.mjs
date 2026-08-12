// Live Playwright config — deployed sites only. No static harness webServer.
// Run: npm run test:e2e:live

import fs from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function loadDotEnv() {
  const p = path.join(HERE, ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadDotEnv();

function preinstalledChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const roots = [];
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) roots.push(process.env.PLAYWRIGHT_BROWSERS_PATH);
  const homeCache = path.join(
    process.env.HOME || process.env.USERPROFILE || "",
    "Library", "Caches", "ms-playwright"
  );
  if (homeCache) roots.push(homeCache);
  const plat = process.platform;
  const candidates = plat === "darwin"
    ? [
        path.join("chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
        path.join("chrome-mac", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing")
      ]
    : [path.join("chrome-linux", "chrome")];
  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    try {
      const dirs = fs.readdirSync(root)
        .filter((d) => /^chromium-\d+$/.test(d))
        .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
      for (const d of dirs) {
        for (const rel of candidates) {
          const exe = path.join(root, d, rel);
          if (fs.existsSync(exe)) return exe;
        }
      }
    } catch { /* next */ }
  }
  return undefined;
}

const CHROMIUM = preinstalledChromium();
const BASE_URL = process.env.BASE_URL || "https://fundhub.ai";

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["**/live-*.spec.mjs"],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "docs/workflows/e2e-verify-run4-evidence/live-playwright-100/last-run.json" }]],
  use: {
    baseURL: BASE_URL,
    ...devices["Desktop Chrome"],
    ...(CHROMIUM ? { launchOptions: { executablePath: CHROMIUM } } : {}),
    trace: "off",
    screenshot: "only-on-failure"
  },
  projects: [{ name: "chromium-live" }]
  // No webServer — live site only.
});

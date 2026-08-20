// Live browser proof over short-lived, marked E2E fixtures only.
// Run after the required live gate is 31/31:
//   LAUNCH_PROOF_FIXTURES=1 npx playwright test \
//     -c playwright.launch-proof.config.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";

import { BASE, liveStaffLogin } from "./live-auth.mjs";
import {
  CLIENT_EMAIL,
  CLIENT_NAME,
  RULE_NAME,
  cleanupLaunchProofFixtures,
  setupLaunchProofFixtures
} from "../scripts/launch-proof-fixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = path.join(
  ROOT,
  "docs/workflows/launch-proof-2026-08-20-evidence/screenshots"
);

function clientPassword() {
  return process.env.LAUNCH_PROOF_CLIENT_PASSWORD
    || process.env.STAFF_E2E_PASSWORD
    || process.env.STAFF_INITIAL_PASSWORD
    || "";
}

async function mark(page, locator, label) {
  await locator.evaluate((element, text) => {
    element.style.outline = "4px solid #e11d48";
    element.style.outlineOffset = "4px";
    element.setAttribute("data-launch-proof", text);
    const badge = document.createElement("div");
    badge.textContent = `LAUNCH PROOF · ${text}`;
    badge.style.cssText = [
      "position:fixed",
      "top:8px",
      "right:8px",
      "z-index:2147483647",
      "padding:8px 12px",
      "border:3px solid #e11d48",
      "background:#fff",
      "color:#881337",
      "font:700 14px/1.2 monospace"
    ].join(";");
    document.body.appendChild(badge);
  }, label);
}

test.describe.configure({ mode: "serial" });

test.describe("safe launch-proof fixtures on the deployed site", () => {
  let fixturesReady = false;

  test.beforeAll(async () => {
    fs.mkdirSync(SHOTS, { recursive: true });
    await setupLaunchProofFixtures({ password: clientPassword() });
    fixturesReady = true;
  });

  test.afterAll(async () => {
    if (fixturesReady) await cleanupLaunchProofFixtures();
  });

  test("Pipeline shows only the marked E2E card and opens its drawer without moving it",
    async ({ page }) => {
      await liveStaffLogin(page, "owner@fundhub.ai");
      await page.goto(`${BASE}/app/pipeline.html`, { waitUntil: "domcontentloaded" });

      const card = page.locator(".col-body > .card").filter({
        hasText: "E2E LAUNCH PROOF TEST FIXTURE"
      });
      await expect(card).toHaveCount(1);
      await card.locator(".c-name").click();

      const drawer = page.locator("#fhDrawer.open");
      await expect(drawer).toBeVisible();
      await expect(page.locator("#fhDrawerName")).toHaveText("E2E LAUNCH PROOF TEST FIXTURE");
      await expect(page.locator("#fhDrawerBody")).toContainText(CLIENT_EMAIL);
      await expect(page.locator("#fhDrawerBody")).toContainText("MANUAL_REVIEW");

      await mark(page, drawer, "PIPELINE CARD + DRAWER · READ ONLY");
      await page.screenshot({
        path: path.join(SHOTS, "pipeline-card-drawer-MARKED.png"),
        fullPage: true
      });
    });

  test("Commission screen reads the inactive tier fixture and offers no tier edit",
    async ({ page }) => {
      await liveStaffLogin(page, "owner@fundhub.ai");
      await page.goto(`${BASE}/app/products-commissions.html`, {
        waitUntil: "domcontentloaded"
      });
      await page.locator('.tab[data-tab="rules"]').click();

      const rule = page.locator(".rule").filter({ hasText: RULE_NAME });
      await expect(rule).toHaveCount(1);
      await rule.locator(".rule-hd").click();
      await expect(rule.locator(".tierrow")).toContainText("1.25%");
      await expect(rule).toContainText(
        "Tier changes stay read-only until tier version writes are supported."
      );
      await expect(rule.getByRole("button", { name: "Change rate" })).toHaveCount(0);

      await mark(page, rule, "INACTIVE TIER FIXTURE · NO EDIT");
      await page.screenshot({
        path: path.join(SHOTS, "commission-tier-read-only-MARKED.png"),
        fullPage: true
      });
    });

  test("a real client account signs in and reads only its own Portal file",
    async ({ page }) => {
      await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
      await page.locator("#email").fill(CLIENT_EMAIL);
      await page.locator("#pw").fill(clientPassword());
      await page.locator("#go").click();
      await expect(page).not.toHaveURL(/login\.html/, { timeout: 30_000 });

      await page.goto(`${BASE}/app/client-portal.html`, {
        waitUntil: "domcontentloaded"
      });
      await expect(page.locator("#who-name")).toHaveText(CLIENT_NAME, {
        timeout: 30_000
      });
      await expect(page.locator("#greeting")).toContainText("Welcome back, E2E");
      await expect(page.locator("#greeting-sub-pre")).not.toContainText(
        "We could not load your file"
      );

      const portal = page.locator(".page");
      await mark(page, portal, "CLIENT SESSION · OWN FILE");
      await page.screenshot({
        path: path.join(SHOTS, "client-portal-session-MARKED.png"),
        fullPage: true
      });
    });
});

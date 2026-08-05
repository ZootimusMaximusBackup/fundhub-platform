// Playwright: sidebar item set per role after sales-dashboard screens shipped.
// Asserts the three new screens land on the right roles, every visible row
// points at a real page, and no role sees a row it should not.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openScreen, OWNER, CLOSER } from "./harness.mjs";

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "app");
const SCREENS = new Set(fs.readdirSync(APP).filter((f) => f.endsWith(".html")));

const SALES_MANAGER = {
  ok: true,
  staff: {
    id: "staff-sm", name: "Sarah Whitfield", email: "sarah@fundhub.ai",
    role: "sales_manager", org_id: "org-1", status: "active"
  }
};

const FUNDING_ADVISOR = {
  ok: true,
  staff: {
    id: "staff-fa", name: "Alex Funding", email: "alex@fundhub.ai",
    role: "funding_advisor", org_id: "org-1", status: "active"
  }
};

const SETTER = {
  ok: true,
  staff: {
    id: "staff-set", name: "Sam Setter", email: "sam@fundhub.ai",
    role: "setter", org_id: "org-1", status: "active"
  }
};

const CLOSER_DESK = ["closer-call.html", "my-numbers.html"];
const SALES_FLOOR = ["sales-floor.html"];
const OWNER_ADMIN_ONLY = ["subscriptions.html", "journeys.html"];

async function visibleNavHrefs(page) {
  await page.waitForSelector("#fh-shell-chip, .navitem", { timeout: 10000 }).catch(() => {});
  // Gate runs twice (hint + session); wait until at least one row is gated or
  // the chip shows a tab count — either means gateLinks finished.
  await page.waitForFunction(() => {
    const chip = document.getElementById("fh-shell-chip");
    const gated = document.querySelector("[data-fh-gated]");
    return Boolean(chip || gated);
  }, null, { timeout: 10000 });
  await page.waitForTimeout(200);

  return page.evaluate(() => {
    const out = [];
    for (const a of document.querySelectorAll("a.navitem")) {
      const style = window.getComputedStyle(a);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (a.hasAttribute("data-fh-gated")) continue;
      const href = (a.getAttribute("data-fh-href") || a.getAttribute("href") || "")
        .replace(/^\.\//, "")
        .split("?")[0]
        .split("#")[0];
      if (href.endsWith(".html")) out.push(href);
    }
    return out;
  });
}

function expectIncludes(hrefs, required) {
  for (const h of required) {
    expect(hrefs, `missing ${h}`).toContain(h);
  }
}

function expectExcludes(hrefs, forbidden) {
  for (const h of forbidden) {
    expect(hrefs, `should not show ${h}`).not.toContain(h);
  }
}

test.describe("sidebar role visibility", () => {
  test("closer sees closer desk, not sales floor or owner-only rows", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", CLOSER);
    const hrefs = await visibleNavHrefs(page);
    expectIncludes(hrefs, CLOSER_DESK);
    expectIncludes(hrefs, ["pipeline.html", "closer-dashboard.html"]);
    expectExcludes(hrefs, [...SALES_FLOOR, ...OWNER_ADMIN_ONLY]);
    for (const h of hrefs) expect(SCREENS.has(h), `broken nav link ${h}`).toBe(true);
  });

  test("sales_manager sees sales floor, not closer desk", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", SALES_MANAGER);
    const hrefs = await visibleNavHrefs(page);
    expectIncludes(hrefs, SALES_FLOOR);
    expectIncludes(hrefs, ["pipeline.html"]);
    expectExcludes(hrefs, [...CLOSER_DESK, ...OWNER_ADMIN_ONLY]);
    for (const h of hrefs) expect(SCREENS.has(h), `broken nav link ${h}`).toBe(true);
  });

  test("owner sees closer desk, sales floor, and owner-only rows", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER);
    const hrefs = await visibleNavHrefs(page);
    expectIncludes(hrefs, [...CLOSER_DESK, ...SALES_FLOOR, ...OWNER_ADMIN_ONLY]);
    for (const h of hrefs) expect(SCREENS.has(h), `broken nav link ${h}`).toBe(true);
  });

  test("funding_advisor does not see closer desk or sales floor", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", FUNDING_ADVISOR);
    const hrefs = await visibleNavHrefs(page);
    expectIncludes(hrefs, ["pipeline.html", "command-center.html"]);
    expectExcludes(hrefs, [...CLOSER_DESK, ...SALES_FLOOR, ...OWNER_ADMIN_ONLY]);
    for (const h of hrefs) expect(SCREENS.has(h), `broken nav link ${h}`).toBe(true);
  });

  test("setter does not see closer desk or sales floor", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", SETTER);
    const hrefs = await visibleNavHrefs(page);
    expectIncludes(hrefs, ["pipeline.html"]);
    expectExcludes(hrefs, [...CLOSER_DESK, ...SALES_FLOOR, ...OWNER_ADMIN_ONLY]);
    for (const h of hrefs) expect(SCREENS.has(h), `broken nav link ${h}`).toBe(true);
  });

  test("sales screens themselves render a styled sidebar rail", async ({ page }) => {
    await openScreen(page, "/app/my-numbers.html", CLOSER);
    const side = page.locator("aside.side");
    await expect(side).toBeVisible();
    const width = await side.evaluate((el) => el.getBoundingClientRect().width);
    expect(width, "sidebar should be the dark CRM rail (~228px), not collapsed").toBeGreaterThan(180);
    await expect(side.locator('a.navitem[href*="my-numbers.html"], a.navitem[data-fh-href*="my-numbers.html"]').first()).toBeVisible();
  });
});

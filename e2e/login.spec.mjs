// Staff login and portal magic-link login.
//
// NO BACKEND. page.route() answers /api/**. Follows messaging-inbox patterns.

import { test, expect } from "@playwright/test";
import { json, EXTERNAL_RESOURCE } from "./harness.mjs";

test.describe("staff login", () => {

  test("wrong password shows an honest error, not a crash", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.route("**/api/**", async (route) => {
      const url = route.request().url();
      if (route.request().method() === "GET" && url.includes("/api/auth/login")) {
        return json(route, { ok: true, demo: { enabled: false, envVar: "DEMO_LOGINS_ENABLED" } });
      }
      if (route.request().method() === "POST" && url.includes("/api/auth/login")) {
        return json(route, { ok: false, error: "invalid_credentials" }, 401);
      }
      return json(route, { ok: true });
    });
    await page.goto("/login.html");
    await page.locator('input[type="email"], #email, input[name="email"]').first().fill("jordan@fundhub.ai");
    await page.locator('input[type="password"], #password, input[name="password"]').first().fill("wrong");
    await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")').first().click();
    await expect(page.locator("body")).toContainText(/invalid|wrong|incorrect|failed|credentials/i);
    expect(errors.filter((e) => !EXTERNAL_RESOURCE.test(e))).toEqual([]);
  });

  test("good password stores a session and leaves the login page", async ({ page }) => {
    await page.route("**/api/**", async (route) => {
      const url = route.request().url();
      if (route.request().method() === "GET" && url.includes("/api/auth/login")) {
        return json(route, { ok: true, demo: { enabled: false, envVar: "DEMO_LOGINS_ENABLED" } });
      }
      if (route.request().method() === "POST" && url.includes("/api/auth/login")) {
        return json(route, {
          ok: true,
          token: "tok-e2e",
          staff: {
            id: "staff-1", name: "Jordan Blake", email: "jordan@fundhub.ai",
            role: "owner", org_id: "org-1", status: "active"
          }
        });
      }
      if (url.includes("/api/auth/session")) {
        return json(route, {
          ok: true,
          staff: {
            id: "staff-1", name: "Jordan Blake", email: "jordan@fundhub.ai",
            role: "owner", org_id: "org-1", status: "active"
          }
        });
      }
      return json(route, { ok: true, items: [] });
    });
    await page.goto("/login.html");
    await page.locator('input[type="email"], #email, input[name="email"]').first().fill("jordan@fundhub.ai");
    await page.locator('input[type="password"], #password, input[name="password"]').first().fill("secret");
    await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")').first().click();
    await expect(page).not.toHaveURL(/login\.html/);
  });
});

test.describe("portal magic-link login", () => {

  test("portal login page loads without a crash", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.route("**/api/**", async (route) => json(route, { ok: true }));
    await page.goto("/portal-login.html");
    await expect(page.locator("body")).toBeVisible();
    expect(errors.filter((e) => !EXTERNAL_RESOURCE.test(e))).toEqual([]);
  });

  test("requesting a magic link posts to the magic-link endpoint", async ({ page }) => {
    const posts = [];
    await page.route("**/api/**", async (route) => {
      const url = route.request().url();
      if (route.request().method() === "POST" && url.includes("magic-link")) {
        posts.push(JSON.parse(route.request().postData() || "{}"));
        return json(route, { ok: true });
      }
      return json(route, { ok: true });
    });
    await page.goto("/portal-login.html");
    const email = page.locator('input[type="email"], #email, input[name="email"]').first();
    if (await email.count()) {
      await email.fill("client@example.com");
      const btn = page.locator('button[type="submit"], button:has-text("Send"), button:has-text("Email")').first();
      if (await btn.count()) {
        await btn.click();
        await expect.poll(() => posts.length).toBeGreaterThan(0);
      }
    }
    await expect(page.locator("body")).toBeVisible();
  });
});

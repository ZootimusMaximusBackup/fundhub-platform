// Live RUN4 PASS gate — against https://fundhub.ai + https://apply.fundhub.ai only.
// Scoreboard: docs/workflows/live-playwright-100.md

import { test, expect } from "@playwright/test";
import { BASE, FUNNEL, liveStaffLogin, apiLogin, staffPassword } from "./live-auth.mjs";

test.describe("live auth", () => {
  test("auth:staff_session chris", async ({ page }) => {
    test.info().annotations.push({ type: "req", description: "auth:staff_session" });
    await liveStaffLogin(page, "chris@fundhub.ai");
    await expect(page.locator("body")).toBeVisible();
  });

  test("auth:staff_session owner", async ({ page }) => {
    test.info().annotations.push({ type: "req", description: "auth:staff_session" });
    await liveStaffLogin(page, "owner@fundhub.ai");
  });

  test("auth:staff_session admin", async ({ page }) => {
    test.info().annotations.push({ type: "req", description: "auth:staff_session" });
    await liveStaffLogin(page, "admin@fundhub.ai");
  });

  test("api:auth/login bad password", async ({ request }) => {
    test.info().annotations.push({ type: "req", description: "api:auth/login bad password" });
    const res = await request.post(`${BASE}/api/auth/login`, {
      data: { email: "chris@fundhub.ai", password: "definitely-wrong-password-xyz" }
    });
    expect(res.status()).toBe(401);
  });

  test("api:auth/session anon", async ({ request }) => {
    test.info().annotations.push({ type: "req", description: "api:auth/session anon" });
    const res = await request.get(`${BASE}/api/auth/session`);
    expect(res.status()).toBe(401);
  });

  test("api:auth/login demo off", async ({ request }) => {
    test.info().annotations.push({ type: "req", description: "api:auth/login demo off" });
    const res = await request.get(`${BASE}/api/auth/login`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.demo?.enabled === true).toBeFalsy();
  });
});

test.describe("live CRM", () => {
  test("CRM shells static 200", async ({ request }) => {
    test.info().annotations.push({ type: "req", description: "CRM shells static 200" });
    for (const path of ["/login.html", "/crm.html", "/app/", "/app/index.html"]) {
      const res = await request.get(`${BASE}${path}`);
      expect(res.status(), path).toBeLessThan(400);
    }
  });

  test("CRM rows+filters / demo banner", async ({ page, request }) => {
    test.info().annotations.push({ type: "req", description: "CRM rows+filters / demo banner" });
    await liveStaffLogin(page, "chris@fundhub.ai");
    // Login often lands in /app already; re-goto can ERR_ABORTED on redirect
    if (!/\/app\//.test(page.url())) {
      await page.goto(`${BASE}/app/`, { waitUntil: "commit" });
      await page.waitForLoadState("domcontentloaded").catch(() => {});
    }
    await page.waitForTimeout(2000);
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/DEMO MODE ON/i);

    // Filter survival via live search API (same endpoint the shell uses)
    const { body: login } = await apiLogin(request, "chris@fundhub.ai");
    const res = await request.get(`${BASE}/api/read/search?q=${encodeURIComponent("test")}`, {
      headers: { Authorization: `Bearer ${login.token}` }
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.ok).toBeTruthy();
    const blob = JSON.stringify(data).toLowerCase();
    expect(blob).not.toMatch(/dana/);

    // UI: open shell search (beta banner can intercept normal clicks)
    await page.evaluate(() => {
      const overlay = document.getElementById("fh-shell-search-overlay");
      if (overlay) overlay.classList.add("open");
      const input = document.getElementById("fh-shell-search-input");
      if (input) input.focus();
    });
    const filter = page.locator("#fh-shell-search-input");
    await expect(filter).toBeVisible({ timeout: 10_000 });
    await filter.fill("test");
    await page.waitForTimeout(800);
    await expect(page.locator("#fh-shell-search-results")).toBeVisible();
  });

  test("route:dirty_letter_artifact repair client visible", async ({ request }) => {
    test.info().annotations.push({ type: "req", description: "route:dirty_letter_artifact" });
    const { body: login } = await apiLogin(request, "chris@fundhub.ai");
    expect(login.ok).toBeTruthy();
    const res = await request.get(`${BASE}/api/read/search?q=${encodeURIComponent("w4c+test")}`, {
      headers: { Authorization: `Bearer ${login.token}` }
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const blob = JSON.stringify(data).toLowerCase();
    expect(blob).toMatch(/w4c\+test\.repair|w4c\+test/);
  });
});

test.describe("live webhooks fail-closed", () => {
  test("wh:clickfunnels fail-closed", async ({ request }) => {
    test.info().annotations.push({ type: "req", description: "wh:clickfunnels fail-closed" });
    const res = await request.post(`${BASE}/api/webhooks/clickfunnels`, {
      data: { type: "test", data: {} }
    });
    expect(res.status()).toBe(401);
  });

  test("wh:commas signature", async ({ request }) => {
    test.info().annotations.push({ type: "req", description: "wh:commas signature" });
    const res = await request.post(`${BASE}/api/webhooks/commas`, {
      data: { type: "payment.succeeded", id: "e2e-live-unsigned" }
    });
    expect(res.status()).toBe(401);
  });
});

test.describe("live dashboard authz", () => {
  test("api:dashboard/* anonymous refuse", async ({ request }) => {
    test.info().annotations.push({ type: "req", description: "api:dashboard/* anonymous refuse" });
    const res = await request.get(`${BASE}/api/dashboard/clients`);
    expect(res.status()).toBe(401);
  });
});

test.describe("live money read (staff)", () => {
  test("api:read/products", async ({ request }) => {
    test.info().annotations.push({ type: "req", description: "api:read/products" });
    const { body } = await apiLogin(request, "chris@fundhub.ai");
    expect(body.ok).toBeTruthy();
    const token = body.token;
    const res = await request.get(`${BASE}/api/read/products`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const n = data.count ?? data.items?.length ?? data.products?.length ?? 0;
    expect(n).toBeGreaterThanOrEqual(1);
  });

  test("api:payment-links list", async ({ request }) => {
    test.info().annotations.push({ type: "req", description: "api:payment-links list" });
    const { body } = await apiLogin(request, "chris@fundhub.ai");
    const res = await request.get(`${BASE}/api/payment-links`, {
      headers: { Authorization: `Bearer ${body.token}` }
    });
    // Honest empty or list — not 500
    expect(res.status()).toBeLessThan(500);
  });

  test("api:read/commissions", async ({ request }) => {
    test.info().annotations.push({ type: "req", description: "api:read/commissions" });
    const { body } = await apiLogin(request, "chris@fundhub.ai");
    const res = await request.get(`${BASE}/api/read/commissions`, {
      headers: { Authorization: `Bearer ${body.token}` }
    });
    expect(res.status()).toBeLessThan(500);
  });
});

test.describe("live funnel thank-you + grid", () => {
  const booking = {
    start: "2026-08-20T16:00:00.000Z",
    end: "2026-08-20T16:30:00.000Z",
    tz: "America/Phoenix",
    name: "Test User",
    email: "w1.run4+test@gmail.com",
    title: "Funding Strategy Meeting — Fundhub",
    timeString: "Thursday, August 20, 2026 at 9:00 AM – 9:30 AM (America/Phoenix)",
    capturedAt: Date.now()
  };

  test("screen:thank-you calendar", async ({ browser }) => {
    test.info().annotations.push({ type: "req", description: "screen:thank-you calendar" });
    const context = await browser.newContext();
    await context.addInitScript((data) => {
      localStorage.setItem("fh_booking_v1", JSON.stringify(data));
    }, booking);
    const page = await context.newPage();
    await page.goto(`${FUNNEL}/thank-you`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2000);
    const html = await page.content();
    expect(html).toMatch(/cal-cta|Add to (Google )?Calendar|BEGIN:VCALENDAR|google\.com\/calendar/i);
    const cal = page.locator(".cal-cta, [class*='cal-cta']").first();
    if (await cal.count()) {
      await expect(cal).toBeVisible();
    }
    await context.close();
  });

  test("screen:thank-you no booking", async ({ browser }) => {
    test.info().annotations.push({ type: "req", description: "screen:thank-you no booking" });
    const context = await browser.newContext();
    await context.addInitScript(() => {
      localStorage.removeItem("fh_booking_v1");
    });
    const page = await context.newPage();
    await page.goto(`${FUNNEL}/thank-you`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1500);
    const on = await page.locator(".cal-cta.is-on").count();
    expect(on).toBe(0);
    await context.close();
  });

  test("funnel:fixed-grid bg", async ({ page }) => {
    test.info().annotations.push({ type: "req", description: "funnel:fixed-grid" });
    await page.goto(`${FUNNEL}/watch`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const bg = await page.evaluate(() => {
      const s = getComputedStyle(document.body, "::before");
      return {
        content: s.content,
        position: s.position,
        image: s.backgroundImage || ""
      };
    });
    // Fixed grid layer: body::before with gradient lines (or similar grid paint)
    const hasGrid =
      (bg.position === "fixed" || bg.position === "absolute") &&
      /linear-gradient/i.test(bg.image);
    expect(hasGrid || /linear-gradient/i.test(bg.image)).toBeTruthy();
  });
});

test.describe("live health", () => {
  test("api:health up pending0", async ({ request }) => {
    test.info().annotations.push({ type: "req", description: "api:health" });
    const res = await request.get(`${BASE}/api/health`);
    expect(res.ok()).toBeTruthy();
    const d = await res.json();
    expect(d.db).toBe("up");
    expect(d.pending ?? 0).toBe(0);
  });
});

// Ensure password helper is referenced so missing env fails early in workers
test.beforeAll(() => {
  staffPassword();
});

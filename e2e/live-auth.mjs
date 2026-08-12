// Live auth helpers — credentials from env / gitignored .env only.

import { expect } from "@playwright/test";

export const BASE = process.env.BASE_URL || "https://fundhub.ai";
export const FUNNEL = process.env.FUNNEL_URL || "https://apply.fundhub.ai";

export function staffPassword() {
  const p = process.env.STAFF_E2E_PASSWORD || process.env.STAFF_INITIAL_PASSWORD || "";
  if (!p) {
    throw new Error("STAFF_E2E_PASSWORD (or STAFF_INITIAL_PASSWORD) missing — set in gitignored .env");
  }
  return p;
}

/** @param {import('@playwright/test').Page} page */
export async function liveStaffLogin(page, email = "chris@fundhub.ai") {
  await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"], #email, input[name="email"]').first().fill(email);
  await page.locator('input[type="password"], #password, input[name="password"]').first().fill(staffPassword());
  await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
  await expect(page).not.toHaveURL(/login\.html/, { timeout: 30_000 });
}

/** @param {import('@playwright/test').APIRequestContext} request */
export async function apiLogin(request, email) {
  const res = await request.post(`${BASE}/api/auth/login`, {
    data: { email, password: staffPassword() }
  });
  const body = await res.json();
  return { status: res.status(), body };
}

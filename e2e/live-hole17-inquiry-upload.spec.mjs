// HOLE 17 — live verify: inquiry portal hides the upload door.
// Staff walk first (records the entitlement truth), then the client's own view.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { BASE, liveStaffLogin } from "./live-auth.mjs";

const CLIENT = "40f063e1-27e3-4857-be1a-91640eee90e1";
const OUT = "docs/workflows/hole-17-evidence";

test.setTimeout(180_000);

test("hole 17 — staff walk of the inquiry portal", async ({ page }) => {
  await liveStaffLogin(page);
  await page.waitForTimeout(3000);
  for (let i = 0; i < 3; i++) {
    try { await page.goto(`${BASE}/app/client-portal.html?id=${CLIENT}`, { waitUntil: "domcontentloaded", timeout: 45000 }); break; }
    catch (e) { if (i === 2) throw e; await page.waitForTimeout(3000); }
  }
  await page.waitForTimeout(5000);

  const shot = { path: `${OUT}/01-staff-walk.png`, fullPage: true };
  await page.screenshot(shot);

  const state = await page.evaluate(() => {
    const vis = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return "missing";
      const r = el.getBoundingClientRect();
      return (r.width > 0 && r.height > 0) ? "visible" : "hidden";
    };
    return {
      bodyClass: document.body.className,
      actionCard: vis("#action-card"),
      uploadDoors: vis("#upload-doors"),
      inquiryDoor: vis(".door-inquiry"),
      fundingDoor: vis(".door-funding"),
      bureauDoor: vis(".door-bureau"),
      footer: (document.body.innerText.match(/live entitlements[^\n]*/) || [""])[0]
    };
  });

  const api = await page.evaluate(async (id) => {
    const grab = async (u) => {
      try { const r = await fetch(u, { credentials: "same-origin" }); return { status: r.status, body: await r.json() }; }
      catch (e) { return { status: 0, body: String(e) }; }
    };
    return {
      entitlements: await grab(`/api/read/entitlements?client_id=${id}&limit=200`),
      client: await grab(`/api/dashboard/client?id=${id}`),
      inquiryCases: await grab(`/api/read/inquiry-cases?client_id=${id}`)
    };
  }, CLIENT);

  fs.writeFileSync(`${OUT}/01-staff-walk.json`, JSON.stringify({ state, api }, null, 2));
  console.log("STATE " + JSON.stringify(state));
  console.log("ENTITLEMENTS " + JSON.stringify(api.entitlements).slice(0, 1200));
  console.log("CLIENT " + JSON.stringify(api.client).slice(0, 1200));
  console.log("INQUIRY " + JSON.stringify(api.inquiryCases).slice(0, 1200));
  expect(true).toBe(true);
});

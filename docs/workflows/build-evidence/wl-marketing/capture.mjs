// One-shot four-state screenshots for the white-label marketing suite screens.
// Serves nothing itself — expects public/ on http://127.0.0.1:8765

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.EVIDENCE_BASE || "http://127.0.0.1:8765";
const PID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const SCREENS = [
  { id: "brand-studio", path: `/app/brand-studio.html?partner_id=${PID}` },
  { id: "social-studio", path: "/app/social-studio.html" },
  { id: "creative-factory", path: "/app/creative-factory.html" }
];

function json(route, status, body) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

async function applyState(page, state) {
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (state === "error") {
      return json(route, 500, { ok: false, error: "server", message: "Could not load this just now." });
    }
    if (url.includes("/api/auth/session")) {
      return json(route, 200, {
        ok: true,
        staff: { id: "s1", name: "Partner", email: "p@example.test", role: "partner" }
      });
    }
    if (state === "empty") {
      if (url.includes("/api/read/partners")) return json(route, 200, { ok: true, items: [] });
      if (url.includes("/api/partner-pages")) return json(route, 200, { ok: true, items: [] });
      if (url.includes("/api/partner-marketing/usage")) {
        return json(route, 200, { ok: true, enabled: false, used: 0, remaining: 250000, cap: 250000 });
      }
      if (url.includes("/api/social/posts")) return json(route, 200, { ok: true, items: [] });
      if (url.includes("/api/creative/")) return json(route, 200, { ok: true, items: [] });
      return json(route, 200, { ok: true, items: [] });
    }
    if (state === "full") {
      if (url.includes("/api/read/partners")) {
        return json(route, 200, { ok: true, items: [{ id: PID, name: "Acme Capital", slug: "acme" }] });
      }
      if (url.includes("/api/partner-marketing/usage") || url.includes("/api/partner-marketing/enable")) {
        return json(route, 200, { ok: true, enabled: true, used: 1200, remaining: 248800, cap: 250000, partner_id: PID });
      }
      if (url.includes("/api/partner-pages")) {
        return json(route, 200, {
          ok: true,
          items: [{
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            title: "Application funnel",
            funnel_key: "apply",
            slug: "apply",
            status: "draft",
            live_path: `/sites/${PID}/apply`,
            body_json: { sections: [{ id: "hero", type: "hero", locked: false, headline: "A funding review" }] }
          }]
        });
      }
      if (url.includes("/api/social/posts")) {
        return json(route, 200, {
          ok: true,
          items: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", caption: "A short review. Lenders decide.", status: "draft", offer_type: "funding" }]
        });
      }
      if (url.includes("/api/creative/")) {
        return json(route, 200, { ok: true, items: [] });
      }
      if (method === "POST") return json(route, 200, { ok: true, items: [] });
      return json(route, 200, { ok: true, items: [] });
    }
    // loading: hang a bit then empty
    await new Promise((r) => setTimeout(r, 2500));
    return json(route, 200, { ok: true, items: [] });
  });
}

async function shot(page, name, width) {
  const dir = path.join(HERE, String(width));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

const browser = await chromium.launch({ headless: true });
const clicks = [];
try {
  for (const state of ["loading", "empty", "error", "full"]) {
    for (const screen of SCREENS) {
      const context = await browser.newContext();
      await context.addInitScript(() => {
        localStorage.setItem("fh_token", "evidence");
        localStorage.setItem("fh_role", "partner");
        localStorage.setItem("fh_demo", "0");
      });
      const page = await context.newPage();
      await applyState(page, state);
      await page.goto(BASE + screen.path, { waitUntil: "domcontentloaded", timeout: 15000 });
      if (state === "loading") await page.waitForTimeout(400);
      else await page.waitForTimeout(1200);
      await shot(page, `${screen.id}-${state}`, 1440);
      await shot(page, `${screen.id}-${state}`, 390);
      if (state === "full") {
        for (const sel of ["#ssGenBtn", "#genBtn", "#genCopyBtn", "#suiteOnBtn", "#oauthFb"]) {
          const loc = page.locator(sel);
          if (await loc.count()) {
            const disabled = await loc.first().isDisabled().catch(() => null);
            await loc.first().click({ force: true }).catch(() => {});
            clicks.push({ screen: screen.id, sel, disabled });
          }
        }
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}
fs.writeFileSync(path.join(HERE, "clicks.json"), JSON.stringify({ at: new Date().toISOString(), clicks }, null, 2));
console.log("wrote evidence under", HERE);

/**
 * K4 follow: walk Present slides to S-23 Send contract. No pay. No soft-pull $32.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-keep-going-2026-08-18-evidence/k4");
const BASE = "https://fundhub.ai";
const TEST = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const LIVE = "9af65808-a619-4e65-ae91-239766a006b7";

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadDotEnv();
const PASSWORD = process.env.STAFF_E2E_PASSWORD || "";

const loginRes = await fetch(BASE + "/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "chris@fundhub.ai", password: PASSWORD })
});
const token = (await loginRes.json().catch(() => ({}))).token;
if (!token) throw new Error("login failed");

const http = [];
const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--disable-blink-features=AutomationControlled"]
});
const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });
await context.addCookies([{
  name: "fundhub_session", value: token, domain: "fundhub.ai", path: "/", httpOnly: true, secure: true
}]);
const page = await context.newPage();
await page.addInitScript((t) => { try { localStorage.setItem("fh_token", t); } catch {} }, token);
page.on("response", async (res) => {
  if (!/\/api\/contracts/.test(res.url())) return;
  const body = await res.json().catch(() => ({}));
  http.push({
    status: res.status(),
    ok: body.ok ?? null,
    error: typeof body.error === "string" ? body.error : (body.error && body.error.message) || null,
    has_contract: Boolean(body.contract && body.contract.id),
    link_n: Array.isArray(body.links) ? body.links.length : 0
  });
});

try {
  await page.goto(`${BASE}/app/present.html?contact=${TEST}`, { waitUntil: "domcontentloaded", timeout: 45000 });
} catch (err) {
  if (!/ERR_ABORTED/.test(String(err))) throw err;
}
await page.waitForTimeout(2500);
if (page.url().includes(LIVE)) throw new Error("refusing live file");

if (await page.locator('button:has-text("07")').count()) {
  await page.locator('button:has-text("07")').first().click();
  await page.waitForTimeout(800);
}

const steps = [];
for (let i = 0; i < 20; i++) {
  const snap = await page.evaluate(() => {
    const t = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    const btns = [...document.querySelectorAll("button")].map((b) => (b.textContent || "").replace(/\s+/g, " ").trim());
    return {
      hasSend: btns.some((x) => /^Send contract$/i.test(x)),
      hasPay: btns.some((x) => /pay link/i.test(x)),
      hasWording: btns.some((x) => /Send this wording/i.test(x)),
      buttons: btns.filter(Boolean).slice(0, 30),
      textSlice: t.slice(0, 240)
    };
  });
  steps.push({ i, ...snap });
  if (snap.hasSend) break;
  const next = page.locator('button:has-text("Next screen")');
  if (!(await next.count())) break;
  await next.first().click();
  await page.waitForTimeout(400);
}

await page.screenshot({ path: path.join(OUT, "03-s23.png"), fullPage: true });

let sent = false;
if (steps.length && steps[steps.length - 1].hasSend) {
  await page.locator('button:has-text("Send contract")').first().click();
  await page.waitForTimeout(1500);
  if (await page.locator('button:has-text("Send this wording")').count()) {
    await page.locator('button:has-text("Send this wording")').first().click();
    sent = true;
    await page.waitForTimeout(4000);
  }
}
await page.screenshot({ path: path.join(OUT, "04-after-contract.png"), fullPage: true });
const toast = await page.locator(".toast").innerText().catch(() => "");
const afterText = (await page.evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").trim())).slice(0, 500);

const out = {
  at: new Date().toISOString(),
  href: page.url(),
  opened_live: false,
  clicked_pay: false,
  clicked_softpull: false,
  steps_n: steps.length,
  last: steps[steps.length - 1] || null,
  sent,
  toast,
  afterText,
  http
};
fs.writeFileSync(path.join(OUT, "follow.json"), JSON.stringify(out, null, 2));
await browser.close();
console.log(JSON.stringify({
  steps_n: steps.length,
  last: steps[steps.length - 1],
  sent,
  toast,
  http
}, null, 2));

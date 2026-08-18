/**
 * K4: Present send-contract on TEST. No pay click. No live file.
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
if (!PASSWORD) throw new Error("STAFF_E2E_PASSWORD missing");

function chromeExe() {
  const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return fs.existsSync(mac) ? mac : undefined;
}

fs.mkdirSync(OUT, { recursive: true });

const loginRes = await fetch(BASE + "/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "chris@fundhub.ai", password: PASSWORD })
});
const loginJson = await loginRes.json().catch(() => ({}));
const token = loginJson.token || null;
if (!token) throw new Error("login failed");

const http = [];
const browser = await chromium.launch({
  headless: true,
  executablePath: chromeExe(),
  args: ["--disable-blink-features=AutomationControlled"]
});
const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });
await context.addCookies([{
  name: "fundhub_session", value: token, domain: "fundhub.ai", path: "/", httpOnly: true, secure: true
}]);
const page = await context.newPage();
await page.addInitScript((t) => { try { localStorage.setItem("fh_token", t); } catch {} }, token);
page.on("response", async (res) => {
  const url = res.url();
  if (!/\/api\/contracts/.test(url)) return;
  const body = await res.json().catch(() => ({}));
  http.push({
    method: res.request().method(),
    path: url.replace(BASE, ""),
    status: res.status(),
    ok: body.ok ?? null,
    error: body.error || body.message || null,
    action: body.action || null,
    has_contract: Boolean(body.contract && body.contract.id),
    link_n: Array.isArray(body.links) ? body.links.length : 0
  });
});

async function go(url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  } catch (err) {
    if (!/ERR_ABORTED/.test(String(err))) throw err;
    await page.waitForTimeout(1500);
  }
}

await go(`${BASE}/app/present.html?contact=${TEST}`);
await page.waitForTimeout(3000);
const href = page.url();
if (href.includes(LIVE)) throw new Error("refusing live file");

const ui = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button, [data-act]")].map((el) => ({
    text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
    act: el.getAttribute("data-act"),
    id: el.id || null,
    disabled: el.disabled === true
  })).filter((b) => b.text || b.act);
  const t = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
  return {
    href: location.href,
    title: document.title,
    buttons: btns.slice(0, 40),
    sawTest: /TEST Client Role/i.test(t),
    sawLiveName: /Kathleen|Burleson/i.test(t),
    text: t.slice(0, 700)
  };
});
await page.screenshot({ path: path.join(OUT, "01-present.png"), fullPage: true });

const sendBtn = page.locator('button:has-text("Send contract")').first();
const sendPresent = (await sendBtn.count()) > 0;
if (sendPresent) {
  await sendBtn.click();
  await page.waitForTimeout(2000);
}
const goBtn = page.locator('button:has-text("Send this wording")').first();
const goPresent = (await goBtn.count()) > 0;
if (goPresent) {
  await goBtn.click();
  await page.waitForTimeout(4000);
}
await page.screenshot({ path: path.join(OUT, "02-after-send.png"), fullPage: true });

const after = await page.evaluate(() => {
  const t = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
  return {
    href: location.href,
    toast: (document.querySelector(".toast")?.textContent || "").trim(),
    text: t.slice(0, 900)
  };
});

const out = {
  at: new Date().toISOString(),
  test: TEST,
  opened_live: false,
  clicked_pay: false,
  login: { status: loginRes.status, has_token: true },
  href,
  href_is_test: href.includes(TEST),
  href_is_live: href.includes(LIVE),
  ui,
  sendPresent,
  goPresent,
  after,
  http
};
fs.writeFileSync(path.join(OUT, "walk.json"), JSON.stringify(out, null, 2));
await browser.close();
console.log(JSON.stringify({
  href,
  sawTest: ui.sawTest,
  sawLiveName: ui.sawLiveName,
  buttons: ui.buttons.map((b) => b.text || b.act),
  sendPresent,
  goPresent,
  toast: after.toast,
  http
}, null, 2));

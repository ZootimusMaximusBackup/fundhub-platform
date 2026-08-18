/**
 * K5: Company Brain ask, Affiliate money, education play, Repair Send.
 * TEST only for Repair. Never open the live file. No card charge.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-keep-going-2026-08-18-evidence/k5");
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
  const u = res.url();
  if (!/\/api\/(read\/company-brain|company-brain\/|read\/affiliates|inquiry)/.test(u)) return;
  const body = await res.json().catch(() => ({}));
  http.push({
    method: res.request().method(),
    path: u.replace(BASE, "").slice(0, 180),
    status: res.status(),
    ok: body.ok ?? null,
    error: typeof body.error === "string" ? body.error : (body.error && body.error.message) || body.message || null
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

function shot(name) {
  return page.screenshot({ path: path.join(OUT, name), fullPage: true });
}

function text() {
  return page.evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").trim());
}

const out = {
  at: new Date().toISOString(),
  opened_live: false,
  charged: false,
  login: { status: loginRes.status, has_token: true }
};

await go(BASE + "/app/company-brain.html");
await page.waitForTimeout(2500);
out.brain = {
  href: page.url(),
  bounced: /pipeline\.html|login\.html/i.test(page.url()),
  ask_present: (await page.locator("#q").count()) > 0,
  text: (await text()).slice(0, 700)
};
await shot("01-brain.png");
if (out.brain.ask_present) {
  await page.locator("#q").fill("What documents are on file? e2e ignore.");
  await page.locator("#askBtn").click();
  await page.waitForTimeout(8000);
  out.brain.after = {
    href: page.url(),
    text: (await text()).slice(0, 900)
  };
  await shot("02-brain-ask.png");
}

const uploadName = path.join(OUT, "e2e-brain.txt");
fs.writeFileSync(uploadName, "fundhub e2e brain upload — ignore.\n");
if ((await page.locator("#fileInput").count()) > 0) {
  await page.locator("#fileInput").setInputFiles(uploadName);
  await page.waitForTimeout(6000);
  out.brain.upload_after = { href: page.url(), text: (await text()).slice(0, 400) };
  await shot("03-brain-upload.png");
}

await go(BASE + "/app/affiliate.html");
await page.waitForTimeout(2500);
out.affiliate = {
  href: page.url(),
  bounced: /pipeline\.html|login\.html/i.test(page.url()),
  paid: await page.locator("#kPaid").innerText().catch(() => null),
  text: (await text()).slice(0, 800)
};
await shot("04-affiliate.png");

await go(BASE + "/education/");
await page.waitForTimeout(2000);
out.education = {
  href: page.url(),
  status_ok: true,
  has_player: (await page.locator("video, .player, [data-lesson]").count()) > 0,
  enroll_link: (await page.locator('a[href*="enroll"]').count()) > 0,
  text: (await text()).slice(0, 500)
};
await shot("05-education.png");
await go(BASE + "/education/enroll/");
await page.waitForTimeout(1500);
out.enroll = {
  href: page.url(),
  has_pay: /tuition|\$5,000|pay/i.test(await text()),
  text: (await text()).slice(0, 400)
};
await shot("06-enroll.png");

await go(BASE + "/app/inquiry-remover.html");
await page.waitForTimeout(2500);
if (page.url().includes(LIVE)) throw new Error("refusing live file");
out.repair = {
  href: page.url(),
  bounced: /pipeline\.html|login\.html/i.test(page.url())
};
const row = page.locator("tr[data-row]").first();
out.repair.has_row = (await row.count()) > 0;
if (out.repair.has_row) {
  await row.click();
  await page.waitForTimeout(800);
}
const send = page.locator('[data-act="send"]').first();
out.repair.send_present = (await send.count()) > 0;
if (out.repair.send_present) {
  await page.evaluate(() => {
    const b = document.querySelector('[data-act="send"]');
    if (b) b.click();
  });
  await page.waitForTimeout(2500);
}
out.repair.after = await page.evaluate(() => {
  const sendBtn = document.querySelector('[data-act="send"]');
  const t = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
  return {
    send_text: sendBtn ? sendBtn.textContent.trim() : null,
    view_undefined: /VIEW IS NOT DEFINED/i.test(t) || /VIEW IS NOT DEFINED/i.test(sendBtn ? sendBtn.textContent : ""),
    opened_live: /9af65808/i.test(location.href)
  };
});
await shot("07-repair-send.png");

out.http = http;
fs.writeFileSync(path.join(OUT, "walk.json"), JSON.stringify(out, null, 2));
await browser.close();
console.log(JSON.stringify({
  brain: { href: out.brain && out.brain.href, bounced: out.brain && out.brain.bounced, ask: out.brain && out.brain.ask_present },
  affiliate: { href: out.affiliate && out.affiliate.href, bounced: out.affiliate && out.affiliate.bounced, paid: out.affiliate && out.affiliate.paid },
  education: { href: out.education && out.education.href, has_player: out.education && out.education.has_player },
  repair: out.repair,
  http
}, null, 2));

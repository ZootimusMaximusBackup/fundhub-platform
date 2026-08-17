#!/usr/bin/env node
// Ticket 2 prove: owner login → Staff & Teams footer is a roster note, not [object Promise].
// Password from gitignored .env. Never printed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const OUT = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || "http://localhost:8888";
const EMAIL = "owner@fundhub.ai";

function loadPassword() {
  if (process.env.STAFF_E2E_PASSWORD) return process.env.STAFF_E2E_PASSWORD;
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return "";
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?STAFF_E2E_PASSWORD\s*=\s*(.*)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  return "";
}

const password = loadPassword();
if (!password) {
  console.error("STAFF_E2E_PASSWORD missing");
  process.exit(2);
}

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 860 } });

async function login() {
  await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"], #email, input[name="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"], #password, input[name="password"]').first().fill(password);
  await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
  await page.waitForURL((u) => !/login\.html/.test(u.toString()), { timeout: 30_000 });
}

let loginOk = false;
for (let i = 0; i < 5 && !loginOk; i++) {
  try {
    await login();
    loginOk = true;
  } catch {
    await page.waitForTimeout(8000);
  }
}
if (!loginOk) {
  console.error("FAIL login");
  await browser.close();
  process.exit(1);
}

let sawStaff = false;
let footer = { text: "", visible: false };

for (let i = 0; i < 8; i++) {
  const staffWait = page.waitForResponse(
    (r) => r.url().includes("/api/read/staff") && r.request().method() === "GET",
    { timeout: 20_000 }
  ).then((r) => r.status()).catch(() => 0);

  await page.goto(`${BASE}/app/staff-teams.html`, { waitUntil: "domcontentloaded" });
  const staffStatus = await staffWait;
  sawStaff = staffStatus === 200;

  await page.waitForFunction(() => {
    const el = document.getElementById("fh-data-banner");
    const t = el ? String(el.textContent || "").trim() : "";
    return t.length > 0 && t !== "loading roster…";
  }, { timeout: 10_000 }).catch(() => {});

  await page.waitForFunction(() => {
    const body = (document.body && document.body.innerText) || "";
    return /Chris Stanbridge/i.test(body);
  }, { timeout: 8_000 }).catch(() => {});

  footer = await page.evaluate(() => {
    const el = document.getElementById("fh-data-banner");
    return {
      text: el ? String(el.textContent || "").trim() : "",
      visible: !!(el && (el.offsetParent !== null || getComputedStyle(el).position === "fixed"))
    };
  });

  if (sawStaff && /live roster/i.test(footer.text) && !footer.text.includes("[object Promise]")) break;
  await page.waitForTimeout(8000);
}

const shot = path.join(OUT, "staff-teams-shot.png");
await page.screenshot({ path: shot, fullPage: false });

const payload = {
  email: EMAIL,
  base: BASE,
  url: page.url(),
  ranAt: new Date().toISOString(),
  sawStaff200: sawStaff,
  footerText: footer.text,
  footerVisible: footer.visible,
  isObjectPromise: footer.text.includes("[object Promise]"),
  looksLikeRosterNote: /live roster/i.test(footer.text),
  shot: "docs/workflows/e2e-verify-run5-evidence/role-owner/fixed/staff-teams-shot.png"
};

fs.writeFileSync(path.join(OUT, "staff-teams-footer.json"), JSON.stringify(payload, null, 2) + "\n");

await browser.close();

if (!sawStaff || payload.isObjectPromise || !payload.looksLikeRosterNote) {
  console.error("FAIL footer", payload.footerText);
  process.exit(1);
}
console.log("PASS footer ok");

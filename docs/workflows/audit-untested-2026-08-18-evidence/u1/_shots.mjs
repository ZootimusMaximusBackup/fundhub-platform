// U1 shots. Does not request a magic link. Does not mint a portal session.
// Staff-open is extra only — not a magic-link PASS.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u1");
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadDotEnv();

const PASSWORD = process.env.STAFF_E2E_PASSWORD || "";
if (!PASSWORD) throw new Error("STAFF_E2E_PASSWORD missing");
fs.mkdirSync(OUT, { recursive: true });

function chromeExe() {
  const home = process.env.HOME || "";
  const root = path.join(home, "Library/Caches/ms-playwright");
  if (!fs.existsSync(root)) return undefined;
  const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    const exe = path.join(root, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}

const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.on("dialog", (d) => d.dismiss());

await page.goto(BASE + "/portal-login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(OUT, "01-portal-login-form.png"), fullPage: false });
const loginFacts = await page.evaluate(() => ({
  title: document.title,
  hasEmail: Boolean(document.querySelector('input[type="email"], input[name="email"], #email')),
  hasPassword: Boolean(document.querySelector('input[type="password"]')),
  bodyPreview: (document.body?.innerText || "").slice(0, 400)
}));
fs.writeFileSync(path.join(OUT, "portal-login-form.json"), JSON.stringify({
  url: BASE + "/portal-login.html",
  requestedLink: false,
  mintedSession: false,
  sentToInbox: false,
  ...loginFacts
}, null, 2));

const gmail = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
await gmail.goto("https://mail.google.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
await gmail.waitForTimeout(1500);
const gmailUrl = gmail.url();
const gmailSession = {
  session_exists: /mail\.google\.com\/mail/i.test(gmailUrl) && !/accounts\.google\.com/i.test(gmailUrl),
  landed_on: /accounts\.google\.com/i.test(gmailUrl) ? "google-signin" : (/mail\.google\.com/i.test(gmailUrl) ? "gmail" : "other"),
  typed_inbox: false,
  opened_any_mail_link: false,
  requested_magic_link: false,
  note: "Did not type FUNDHUB_TEST_INBOX. Did not request a magic link."
};
await gmail.screenshot({ path: path.join(OUT, "02-gmail-session.png"), fullPage: false });
fs.writeFileSync(path.join(OUT, "gmail-session.json"), JSON.stringify(gmailSession, null, 2));
await gmail.close();

await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator('input[type="email"], #email, input[name="email"]').first().fill("chris@fundhub.ai");
await page.locator('input[type="password"], #password, input[name="password"]').first().fill(PASSWORD);
await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
await page.waitForFunction(() => !/login\.html|portal-login\.html/i.test(location.pathname), null, { timeout: 30000 });

const portalUrl = `${BASE}/app/client-portal.html?id=${TEST}`;
await page.goto(portalUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2500);
if (page.url().includes(LIVE)) throw new Error("refusing live credit file URL");

await page.screenshot({ path: path.join(OUT, "03-staff-file-paint.png"), fullPage: false });
await page.evaluate(() => window.scrollTo(0, 400));
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, "04-staff-hero-video.png"), fullPage: false });
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, "05-staff-entitlements.png"), fullPage: false });
await page.evaluate(() => {
  const el = document.querySelector("[data-dispute], #dispute, .dispute, #signCard, #disputeCard");
  if (el) el.scrollIntoView({ block: "center" });
});
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, "06-staff-dispute-card.png"), fullPage: false });

const staff = await page.evaluate((live) => {
  const text = document.body?.innerText || "";
  if (text.includes(live)) return { refused: true };
  const tiles = [...document.querySelectorAll("[data-key], .tile, .offer-tile, [data-entitlement]")].slice(0, 12).map((el) => ({
    key: el.getAttribute("data-key") || el.getAttribute("data-entitlement") || "",
    locked: /locked/i.test(el.textContent || ""),
    text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80)
  }));
  return {
    label: "staff-opened, not magic-link",
    path: location.pathname + location.search,
    urlHasForbidden: location.href.includes(live),
    greeting: (document.querySelector("#greeting, .greeting, h1")?.textContent || "").trim(),
    bodyHasCouldNotLoad: /could not load your file/i.test(text),
    bodyHasVideoUnavailable: /welcome video is not available/i.test(text),
    bodyHasAlreadySigned: /you already signed/i.test(text),
    hasVideoEl: Boolean(document.querySelector("video")),
    footerPreview: (document.querySelector("footer, #status, #liveStatus, .status")?.textContent || text.match(/live entitlements[^\n]*/i)?.[0] || "").slice(0, 200),
    unlockedOf6: (text.match(/(\d+)\s*unlocked\s*·\s*(\d+)\s*locked/i) || []).slice(1).join("/") || null,
    tiles
  };
}, LIVE);

fs.writeFileSync(path.join(OUT, "staff-opened-portal.json"), JSON.stringify(staff, null, 2));
await browser.close();
console.log(JSON.stringify({ gmailSession, staff: { ...staff, tiles: staff.tiles?.length } }));

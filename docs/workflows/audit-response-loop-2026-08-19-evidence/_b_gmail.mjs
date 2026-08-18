// Open Gmail in Chrome using a copied session. Mask the inbox address in shots.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-response-loop-2026-08-19-evidence");
const SHOTS = path.join(OUT, "shots");
const DUMPS = path.join(OUT, "dumps");
const SUFFIX = "e2e-loop-1787083542508";
const SEARCH = `https://mail.google.com/mail/u/0/#search/${SUFFIX}`;

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

const INBOX = String(process.env.FUNDHUB_TEST_INBOX || "").trim().toLowerCase();

function chromeExe() {
  return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
}

async function mask(page) {
  if (!INBOX) return;
  const local = INBOX.split("@")[0];
  await page.addStyleTag({
    content: `
      /* hide account chip / obvious address display as much as CSS can */
    `
  });
  await page.evaluate((needles) => {
    const walk = (node) => {
      if (!node) return;
      if (node.nodeType === 3) {
        let t = node.textContent;
        for (const n of needles) {
          if (n && t.toLowerCase().includes(n)) {
            t = t.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "[REDACTED]");
          }
        }
        node.textContent = t;
      } else if (node.nodeType === 1 && node.childNodes) {
        for (const c of [...node.childNodes]) walk(c);
      }
    };
    walk(document.body);
  }, [INBOX, local, local + "+"]);
}

async function main() {
  const browser = await chromium.launchPersistentContext("/tmp/p3-chrome-profile", {
    headless: true,
    executablePath: chromeExe(),
    viewport: { width: 1440, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"]
  });
  const page = browser.pages()[0] || await browser.newPage();
  const result = { url: null, title: null, logged_in: null, found_suffix: false, has_sign_link: false };

  await page.goto(SEARCH, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(5000);
  result.url = page.url();
  result.title = await page.title();
  result.logged_in = /mail\.google\.com\/mail\//.test(result.url) && !/accounts\.google|ServiceLogin|workspace\.google/i.test(result.url);
  await mask(page);
  await page.screenshot({ path: path.join(SHOTS, "01-gmail-search.png"), fullPage: false });

  const bodyText = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 4000) : "");
  result.body_has_suffix = bodyText.includes(SUFFIX);
  result.body_has_please_sign = /Please sign/i.test(bodyText);
  result.body_has_funding = /Funding Agreement/i.test(bodyText);
  result.looks_like_login = /sign in|workspace\.google|Create an account/i.test(bodyText + result.title);

  if (result.logged_in) {
    const row = page.locator("tr.zA, div[role='main'] span").filter({ hasText: /Please sign|Funding Agreement|e2e-loop/i }).first();
    if (await row.count()) {
      result.found_suffix = true;
      await row.click();
      await page.waitForTimeout(3000);
      await mask(page);
      await page.screenshot({ path: path.join(SHOTS, "02-gmail-opened-mail.png"), fullPage: false });
      const mailText = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 6000) : "");
      result.opened_has_suffix = mailText.includes(SUFFIX);
      result.opened_has_please_sign = /Please sign/i.test(mailText);
      result.has_sign_link = /fundhub\.ai/i.test(mailText) && /sign/i.test(mailText);
      const hrefs = await page.evaluate(() =>
        [...document.querySelectorAll("a[href]")].map((a) => a.href).filter((h) => /fundhub\.ai/i.test(h))
      );
      result.fundhub_link_count = hrefs.length;
      result.fundhub_link_hosts = [...new Set(hrefs.map((h) => {
        try { return new URL(h).host; } catch { return "bad"; }
      }))];
    }
  }

  fs.writeFileSync(path.join(DUMPS, "09-gmail.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  await browser.close();
}

main().catch((err) => {
  fs.writeFileSync(path.join(DUMPS, "09-gmail.json"), JSON.stringify({ ok: false, error: err.message }, null, 2));
  console.error(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
});

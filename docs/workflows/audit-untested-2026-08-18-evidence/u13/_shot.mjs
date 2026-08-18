// Live Messaging shot for TEST client only. Does not press Send.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const TEST = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const LIVE = "9af65808-a619-4e65-ae91-239766a006b7";

function loadEnv() {
  const raw = readFileSync(resolve(ROOT, ".env"), "utf8");
  for (const line of raw.split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!m) continue;
    if (process.env[m[1]] != null && process.env[m[1]] !== "") continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}

loadEnv();
mkdirSync(resolve(HERE, "shots"), { recursive: true });

const password = process.env.STAFF_E2E_PASSWORD;
if (!password) throw new Error("STAFF_E2E_PASSWORD missing");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const notes = { opened_live_file: false, send_clicked: false };

try {
  await page.goto("https://fundhub.ai/login.html", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.locator('input[type="email"], #email, input[name="email"]').first().fill("chris@fundhub.ai");
  await page.locator('input[type="password"], #password, input[name="password"]').first().fill(password);
  await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
  await page.waitForURL((u) => !/login\.html/i.test(u.href), { timeout: 30000 });
  notes.login_url = page.url().replace(/[?#].*$/, "");

  const target = `https://fundhub.ai/app/messaging.html?client_id=${TEST}`;
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2500);
  notes.page_url_has_test_id = page.url().includes(TEST);
  notes.page_url_has_live_id = page.url().includes(LIVE);
  if (notes.page_url_has_live_id) notes.opened_live_file = true;

  const facts = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll("input, textarea, select")).map((el) => ({
      id: el.id || null,
      name: el.name || null,
      type: (el.type || el.tagName || "").toLowerCase(),
      placeholder: el.placeholder || null
    }));
    const text = (document.body && document.body.innerText) || "";
    return {
      title: document.title || "",
      has_to_input: inputs.some((i) => /to/i.test(String(i.id || i.name || i.placeholder || ""))),
      input_ids: inputs.map((i) => i.id || i.name || i.type),
      compose_note: (document.getElementById("composeNote") || {}).textContent || null,
      channel_label: (document.getElementById("composeChannel") || {}).textContent || null,
      send_disabled: (document.getElementById("sendBtn") || {}).disabled ?? null,
      body_mentions_no_phone: /do not have a phone|no phone/i.test(text),
      visible_phone_row: /Phone/i.test(text)
    };
  });
  notes.screen = facts;

  await page.screenshot({
    path: resolve(HERE, "shots/01-messaging-test-client.png"),
    fullPage: false
  });
  notes.shot = "shots/01-messaging-test-client.png";
} catch (err) {
  notes.error = String(err && err.message || err);
  try {
    await page.screenshot({ path: resolve(HERE, "shots/00-error.png"), fullPage: false });
  } catch { /* ignore */ }
}

writeFileSync(resolve(HERE, "08-screen.json"), JSON.stringify(notes, null, 2) + "\n");
await browser.close();
console.log("u13 shot done");

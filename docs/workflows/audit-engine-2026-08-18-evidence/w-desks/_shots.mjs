// W-DESKS UI shots. Do not press Send. Do not mail.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-engine-2026-08-18-evidence/w-desks");
const BASE = "https://fundhub.ai";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";
const CLIENT = "41a3199f-1835-4ac8-91c0-d4f37bd92037";

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

function abortIfForbidden(url) {
  if (String(url).includes(FORBIDDEN)) throw new Error("refused: forbidden client id in URL");
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on("framenavigated", (f) => abortIfForbidden(f.url()));

  await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator("#email").fill("chris@fundhub.ai");
  await page.locator("#pw").fill(PASSWORD);
  await page.locator("#go").click();
  await page.waitForFunction(() => !/login\.html|portal-login\.html/i.test(location.pathname), null, { timeout: 30000 });
  await page.waitForTimeout(800);

  await page.goto(BASE + "/app/inquiry-remover.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  abortIfForbidden(page.url());
  await page.waitForTimeout(2200);

  const inqFacts = await page.evaluate(() => {
    const body = (document.body && document.body.innerText) || "";
    const rows = [...document.querySelectorAll("#caseQueueBody tr.case-main")].map((tr) =>
      (tr.innerText || "").replace(/\s+/g, " ").trim()
    );
    return {
      url: location.href,
      title: document.title,
      hasInquiriesTab: !!document.getElementById("tab-inquiries"),
      inquiriesSelected: document.getElementById("tab-inquiries")?.getAttribute("aria-selected") === "true",
      rowCount: rows.length,
      rows,
      hasSimulated: rows.some((t) => /simulated/i.test(t)),
      snippet: body.replace(/\s+/g, " ").slice(0, 500)
    };
  });
  await page.screenshot({ path: path.join(OUT, "03-inquiries-queue.png"), fullPage: true });

  let caseOpen = { clicked: false };
  if (inqFacts.hasSimulated) {
    const row = page.locator("#caseQueueBody tr.case-main").filter({ hasText: /Simulated/i }).first();
    await row.click();
    await page.waitForTimeout(600);
    caseOpen = await page.evaluate(() => {
      const detail = document.querySelector("#caseQueueBody .case-expand");
      const send = detail && detail.querySelector('[data-act="send"]');
      return {
        clicked: true,
        hasDetail: !!detail,
        hasSend: !!send,
        sendDisabled: !!(send && send.disabled),
        hasFraudUpload: !!(detail && detail.querySelector('[data-act="upload-fraud"]')),
        text: ((detail && detail.innerText) || "").replace(/\s+/g, " ").slice(0, 400)
      };
    });
    await page.screenshot({ path: path.join(OUT, "03-inquiry-case-open.png"), fullPage: true });
  }

  await page.locator("#tab-repair").click();
  await page.waitForTimeout(1800);
  const repairFacts = await page.evaluate(() => {
    const body = (document.body && document.body.innerText) || "";
    const empty = document.querySelector(".repair-empty");
    return {
      repairSelected: document.getElementById("tab-repair")?.getAttribute("aria-selected") === "true",
      emptyCopy: empty ? empty.innerText.replace(/\s+/g, " ").trim() : null,
      hasEmptyPhrase: /No repair files yet/i.test(body),
      mentionsThisClient: /41a3199f-1835-4ac8-91c0-d4f37bd92037|Simulated Client/i.test(body),
      snippet: body.replace(/\s+/g, " ").slice(0, 500)
    };
  });
  await page.screenshot({ path: path.join(OUT, "04-repair-empty.png"), fullPage: true });

  fs.writeFileSync(path.join(OUT, "shots.json"), JSON.stringify({
    client_id: CLIENT,
    sent: false,
    inquiries: inqFacts,
    case_open: caseOpen,
    repair: repairFacts
  }, null, 2));

  await browser.close();
  console.log(JSON.stringify({
    inquiries_rows: inqFacts.rowCount,
    has_simulated: inqFacts.hasSimulated,
    case_opened: caseOpen.clicked,
    repair_empty: repairFacts.hasEmptyPhrase
  }));
}

main().catch((err) => {
  fs.writeFileSync(path.join(OUT, "shots-error.json"), JSON.stringify({ message: err.message }, null, 2));
  console.error(err.message);
  process.exit(1);
});

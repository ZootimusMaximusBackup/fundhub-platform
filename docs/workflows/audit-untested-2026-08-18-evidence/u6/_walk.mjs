/**
 * U6 — Inquiry Send on a TEST Queued case only. Evidence only.
 * One Send. Do not mail a letter. Do not Mark Cleared. Never open live file.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u6");
const BASE = "https://fundhub.ai";
const TEST_CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";

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

const findings = [];
function rec(row) {
  findings.push(row);
  console.log(JSON.stringify({
    id: row.id,
    verdict: row.verdict || null,
    happened: String(row.happened || "").slice(0, 260)
  }));
}

async function shot(page, slug) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return path.relative(ROOT, file);
}

function netWatch(page) {
  const writes = [];
  const vendor = [];
  page.on("response", (res) => {
    const req = res.request();
    const url = res.url();
    const method = req.method();
    const pathOnly = url.replace(/[?#].*$/, "");
    if (/inquiry-removal-ai-sigma\.vercel\.app/i.test(url) || /INQUIRY_API/i.test(url)) {
      vendor.push({ method, status: res.status(), host: (() => { try { return new URL(url).host; } catch { return "n/a"; } })() });
    }
    if (/\/api\//.test(url) && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      writes.push({
        method,
        status: res.status(),
        path: pathOnly.replace(BASE, "").slice(0, 180)
      });
    }
  });
  page.on("request", (req) => {
    const url = req.url();
    if (/inquiry-removal-ai-sigma\.vercel\.app/i.test(url)) {
      vendor.push({ method: req.method(), status: "request", host: "inquiry-removal-ai-sigma.vercel.app" });
    }
  });
  return { writes, vendor };
}

const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const net = netWatch(page);
page.on("dialog", async (d) => { await d.dismiss(); });

await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator('input[type="email"], #email').first().fill("inquiry@fundhub.ai");
await page.locator('input[type="password"], #password').first().fill(PASSWORD);
await page.locator('button[type="submit"]').first().click();
await page.waitForFunction(() => !/login\.html/i.test(location.pathname), null, { timeout: 30000 });
if (page.url().includes(FORBIDDEN)) throw new Error("opened forbidden client");
await shot(page, "00-inquiry-login");
rec({ id: "login", claim: "Specialist signs in", happened: page.url().replace(/[?#].*$/, ""), verdict: "WORKS" });

const inquiryApi = await page.evaluate(async () => {
  const tok = localStorage.getItem("fh_token") || "";
  const r = await fetch("/api/inquiry?action=cases", {
    headers: { accept: "application/json", authorization: tok ? "Bearer " + tok : "" }
  });
  let data = null;
  try { data = await r.json(); } catch { data = { raw: true }; }
  return { status: r.status, ok: !!data.ok, error: data.error || null, message: data.message || null };
});
rec({
  id: "inquiry-api",
  claim: "GET /api/inquiry?action=cases — phone runtime door",
  happened: `status=${inquiryApi.status} ok=${inquiryApi.ok} error=${inquiryApi.error || ""} message=${inquiryApi.message || ""}`,
  http: inquiryApi,
  verdict: inquiryApi.status === 503 ? "BROKEN" : "OBSERVED"
});

await page.goto(BASE + "/app/inquiry-remover.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(3500);
if (page.url().includes(FORBIDDEN)) throw new Error("opened forbidden client");
await shot(page, "01-specialist-desk");

const desk = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("tr.case-main, tr")].map((tr) => (tr.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  const testRows = rows.filter((t) => /8556bedc|TEST Client|client@fundhub/i.test(t));
  const realish = rows.filter((t) => /9af65808/i.test(t));
  return {
    path: location.pathname,
    title: document.title,
    view_on_window: !!(window.VIEW && window.VIEW.buildCaseSendRequest),
    fhinquiryview: !!(window.FHInquiryView && window.FHInquiryView.buildCaseSendRequest),
    row_n: rows.length,
    test_row_n: testRows.length,
    forbidden_row_n: realish.length,
    test_preview: testRows.slice(0, 3),
    body: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 240)
  };
});
rec({
  id: "desk",
  claim: "Specialist desk — TEST Queued rows only",
  happened: JSON.stringify(desk),
  verdict: desk.forbidden_row_n ? "BROKEN" : "OBSERVED"
});

const testRow = page.locator("tr.case-main, tr").filter({ hasText: /TEST Client|8556bedc|client@fundhub/i }).filter({ hasText: /Queued|Ready/i }).first();
if (!(await testRow.count())) {
  rec({ id: "open-case", claim: "Open a TEST Queued case", happened: "No TEST Queued row visible", verdict: "UNVERIFIED" });
} else {
  await testRow.click();
  await page.waitForTimeout(1200);
  await shot(page, "02-test-case-open");
  const open = await page.evaluate(() => {
    const send = document.querySelector('button[data-act="send"]');
    const mail = document.querySelector(".want-mail");
    const cleared = document.querySelector('button[data-act="cleared"]');
    const panel = (document.querySelector(".case-expand")?.innerText || "").replace(/\s+/g, " ").slice(0, 220);
    return {
      has_send: !!send,
      send_text: send ? (send.innerText || "").trim() : "",
      send_disabled: send ? !!send.disabled : null,
      mail_checked: mail ? !!mail.checked : null,
      has_cleared: !!cleared,
      panel
    };
  });
  rec({
    id: "open-case",
    claim: "Open a TEST Queued case",
    happened: JSON.stringify(open),
    verdict: open.has_send ? "OBSERVED" : "BROKEN"
  });

  const mailBox = page.locator(".want-mail").first();
  if (await mailBox.count()) {
    if (await mailBox.isChecked()) await mailBox.uncheck();
  }

  const sendBtn = page.locator('button[data-act="send"]').first();
  if (await sendBtn.count()) {
    const beforeW = net.writes.length;
    const beforeV = net.vendor.length;
    await sendBtn.click();
    await page.waitForTimeout(2500);
    const after = await page.evaluate(() => {
      const send = document.querySelector('button[data-act="send"]');
      return {
        send_text: send ? (send.innerText || "").trim() : "",
        send_disabled: send ? !!send.disabled : null,
        toast: (document.body?.innerText || "").match(/VIEW IS NOT DEFINED|select mail|failed|sent|not_configured|PostGrid/i)?.[0] || null,
        body: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 200)
      };
    });
    await shot(page, "03-send-once");
    rec({
      id: "send-once",
      claim: "Press Send once on TEST Queued case. Mail unchecked. No Mark Cleared.",
      happened: JSON.stringify({
        after,
        writes: net.writes.slice(beforeW),
        vendor: net.vendor.slice(beforeV)
      }),
      http: { writes: net.writes.slice(beforeW), vendor: net.vendor.slice(beforeV) },
      verdict: net.vendor.slice(beforeV).length ? "WORKS" : (/VIEW IS NOT DEFINED/i.test(after.send_text || "") ? "BROKEN" : "OBSERVED")
    });
  } else {
    rec({ id: "send-once", claim: "Press Send once", happened: "Send button missing", verdict: "BROKEN" });
  }
}

rec({
  id: "vendor-total",
  claim: "Any call to inquiry-removal-ai-sigma.vercel.app",
  happened: JSON.stringify({ vendor: net.vendor, writes: net.writes }),
  verdict: net.vendor.length ? "WORKS" : "MISSING"
});

await context.close();
await browser.close();

fs.writeFileSync(path.join(OUT, "walk.json"), JSON.stringify({
  at: new Date().toISOString(),
  test_client: TEST_CLIENT,
  opened_forbidden: false,
  findings
}, null, 2));
console.log(JSON.stringify({ wrote: "u6/walk.json", n: findings.length }, null, 2));

/**
 * W6 follow-up fires that missed selectors. Test/demo rows only.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-crm-whole-2026-08-18-evidence/w6");
const BASE = "https://fundhub.ai";
const TEST_CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const DRAFT_CONTRACT = "8988b582-d98a-44c8-9173-86de54fc5788";

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
  console.log(JSON.stringify({ id: row.id, happened: String(row.happened || "").slice(0, 260), verdict: row.verdict }));
}
async function shot(page, slug) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return path.relative(ROOT, file);
}

const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on("dialog", async (d) => {
  const t = d.message() || "";
  if (/voided|why is this being voided/i.test(t)) { await d.accept("W6 audit unused test draft"); return; }
  await d.dismiss();
});

await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator('input[type="email"]').first().fill("chris@fundhub.ai");
await page.locator('input[type="password"]').first().fill(PASSWORD);
await page.locator('button[type="submit"]').first().click();
await page.waitForFunction(() => !/login\.html/i.test(location.pathname), null, { timeout: 30000 });

async function api(page, method, path, body) {
  return page.evaluate(async ({ method, path, body }) => {
    const tok = localStorage.getItem("fh_token") || "";
    const r = await fetch(path, {
      method,
      headers: { accept: "application/json", authorization: tok ? "Bearer " + tok : "", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await r.json(); } catch { data = {}; }
    const safe = JSON.parse(JSON.stringify(data, (k, v) => {
      if (/token|secret|password|authorization|checkout_url|url/i.test(k) && typeof v === "string" && v.length > 12) return `[redacted len=${v.length}]`;
      return v;
    }));
    return { status: r.status, data: safe };
  }, { method, path, body });
}

// People tab
await page.goto(BASE + "/app/ops-admin.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2000);
await page.evaluate(() => {
  const tabs = [...document.querySelectorAll("button, .tab, [role=tab]")];
  const people = tabs.find((t) => /people/i.test(t.textContent || ""));
  if (people) people.click();
});
await page.waitForTimeout(800);
await shot(page, "07-ops-people-tab");
const peopleText = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 300));
rec({ id: "ops-people-tab", happened: peopleText, verdict: /no staff/i.test(peopleText) ? "BROKEN" : "OBSERVED" });

// Void the unused TEST draft via the same API the Void button calls
const voidRes = await api(page, "POST", "/api/contracts", {
  action: "void",
  id: DRAFT_CONTRACT,
  reason: "W6 audit — unused test draft, never sent"
});
rec({
  id: "fire-void-api",
  happened: `status=${voidRes.status} ok=${voidRes.data?.ok} err=${voidRes.data?.error || voidRes.data?.message || ""}`,
  verdict: voidRes.data?.ok ? "WORKS" : "BROKEN"
});

// Agent save on draft Agent 1 — not Josh / IR
await page.goto(BASE + "/app/agent-editor.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2000);
const picked = await page.evaluate(() => {
  const items = [...document.querySelectorAll(".alist button, .list button, [data-code], .arow, li button, .agent")];
  const draft = items.find((el) => /Agent 1/i.test(el.textContent || "") && !/Josh|Inquiry/i.test(el.textContent || ""));
  if (!draft) return { n: items.length, labels: items.slice(0, 8).map((e) => (e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40)) };
  draft.click();
  return { clicked: (draft.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60) };
});
rec({ id: "agent-pick", happened: JSON.stringify(picked), verdict: picked.clicked ? "WORKS" : "UNVERIFIED" });
await page.waitForTimeout(500);
const nameNow = await page.locator("#a_name").inputValue().catch(() => "");
if (/josh|inquiry removal/i.test(nameNow)) {
  rec({ id: "fire-agent-save", happened: `withheld — editor still on ${nameNow}`, verdict: "WITHHELD" });
} else if (picked.clicked) {
  await page.locator("#saveBtn").click();
  await page.waitForTimeout(1500);
  await shot(page, "01-agent-save");
  const note = await page.evaluate(() => (document.querySelector("#saveNote, .save-note")?.textContent || "") + " name=" + (document.getElementById("a_name")?.value || ""));
  rec({ id: "fire-agent-save", happened: note.slice(0, 180), verdict: /SAVED|saved/i.test(note) ? "WORKS" : "OBSERVED" });
}

// Inquiry case expand + Send (no mail checkbox)
await page.goto(BASE + "/app/inquiry-remover.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2500);
await page.evaluate(() => {
  const rows = [...document.querySelectorAll("tbody tr, .case-row, tr")];
  const test = rows.find((r) => /TEST Client Role/i.test(r.textContent || "") && /Queued/i.test(r.textContent || ""));
  if (test) test.click();
});
await page.waitForTimeout(800);
await shot(page, "01-inquiry-case-open2");
const sendState = await page.evaluate(() => {
  const btn = document.querySelector('button[data-act="send"]');
  return {
    has: !!btn,
    disabled: btn ? btn.disabled : null,
    text: btn ? btn.textContent : null,
    panel: (document.querySelector(".case-actions, .expand, .detail")?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 220)
  };
});
if (sendState.has && !sendState.disabled) {
  await page.locator('button[data-act="send"]').first().click();
  await page.waitForTimeout(1200);
}
await shot(page, "01-inquiry-send2");
rec({ id: "fire-inquiry-send2", happened: JSON.stringify(sendState), verdict: sendState.has ? "OBSERVED" : "BROKEN" });

// Hiring drawer + look for hire/reject
await page.goto(BASE + "/app/hiring.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2500);
await page.evaluate(() => {
  const row = document.querySelector("tbody tr, .rowbtn, [data-id]");
  if (row) row.click();
});
await page.waitForTimeout(1000);
await shot(page, "01-hiring-drawer2");
const hire = await page.evaluate(() => {
  const dw = document.getElementById("dwBody");
  const text = (dw?.innerText || "").replace(/\s+/g, " ").trim();
  const buttons = [...document.querySelectorAll("#drawer button, #dwBody button, aside button")]
    .map((b) => (b.innerText || "").trim()).filter(Boolean);
  return { buttons, snippet: text.slice(0, 260), hasDrawer: !!(dw && dw.offsetParent) };
});
rec({ id: "fire-hire-reject2", happened: JSON.stringify(hire), verdict: /cannot be changed|no candidate may be rejected/i.test(hire.snippet) ? "MISSING" : "OBSERVED" });

// Oxylabs with a dummy lender id — do not open a bank host
const proxy = await api(page, "POST", "/api/proxy/launch", {
  client_id: TEST_CLIENT,
  lender_id: "00000000-0000-4000-8000-000000000001"
});
rec({
  id: "oxylabs-launch2",
  happened: `status=${proxy.status} ok=${proxy.data?.ok} err=${proxy.data?.error || proxy.data?.message || ""}`.slice(0, 240),
  verdict: proxy.data?.ok ? "WORKS" : (proxy.status === 503 ? "BROKEN" : "OBSERVED")
});

await page.close();
await browser.close();

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
const after = {
  draft: (await client.query(`SELECT id, status, voided_at IS NOT NULL AS voided FROM contracts WHERE id=$1`, [DRAFT_CONTRACT])).rows,
  agent: (await client.query(`SELECT code, status, updated_at FROM agents WHERE code='AG-01'`)).rows,
  cases: (await client.query(`SELECT count(*)::int n FROM inquiry_removal_cases WHERE client_id=$1`, [TEST_CLIENT])).rows,
  settings: (await client.query(`SELECT outbound_enabled FROM messaging_settings`)).rows
};
await client.end();
fs.writeFileSync(path.join(OUT, "follow.json"), JSON.stringify({ at: new Date().toISOString(), findings, after }, null, 2));
console.log(JSON.stringify({ wrote: "w6/follow.json", after }, null, 2));

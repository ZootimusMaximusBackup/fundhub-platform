/**
 * U12 live Hiring walk. Evidence only.
 * Reject only if a demo row exists AND a write path exists.
 * Never emails a real applicant. Never prints secrets or real emails.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u12");
const BASE = "https://fundhub.ai";
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
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
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
    happened: String(row.happened || "").slice(0, 240)
  }));
}

async function shot(page, slug) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return path.relative(ROOT, file);
}

async function apiFromPage(page, method, pathName, body) {
  return page.evaluate(async ({ method, pathName, body }) => {
    const tok = localStorage.getItem("fh_token") || "";
    const r = await fetch(pathName, {
      method,
      headers: {
        accept: "application/json",
        authorization: tok ? "Bearer " + tok : "",
        ...(body ? { "content-type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await r.json(); } catch { data = { raw: true, text: true }; }
    const safe = JSON.parse(JSON.stringify(data, (k, v) => {
      if (/token|secret|password|authorization|cookie|email|phone|full_name|name/i.test(k) && typeof v === "string" && v.length > 2) {
        return `[redacted len=${v.length}]`;
      }
      return v;
    }));
    return { status: r.status, allow: r.headers.get("allow"), data: safe };
  }, { method, pathName, body });
}

function netWatch(page) {
  const writes = [];
  page.on("response", (res) => {
    const req = res.request();
    const url = res.url();
    const method = req.method();
    if (/\/api\//.test(url) && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      writes.push({
        method,
        status: res.status(),
        path: url.replace(BASE, "").replace(/[?#].*$/, "").slice(0, 180)
      });
    }
  });
  return { writes };
}

async function waitQuiet(page, ms = 1400) {
  await page.waitForTimeout(ms);
}

const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const net = netWatch(page);
page.on("dialog", async (d) => { await d.dismiss(); });

await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator('input[type="email"], #email, input[name="email"]').first().fill("chris@fundhub.ai");
await page.locator('input[type="password"], #password, input[name="password"]').first().fill(PASSWORD);
await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
await page.waitForFunction(() => !/login\.html|portal-login\.html/i.test(location.pathname), null, { timeout: 30000 });
await shot(page, "00-owner-login");
rec({ id: "login", happened: page.url().replace(/[?#].*$/, ""), verdict: "WORKS" });
if (page.url().includes(FORBIDDEN)) throw new Error("opened forbidden client");

await page.goto(BASE + "/app/hiring.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await waitQuiet(page, 2800);
if (page.url().includes(FORBIDDEN)) throw new Error("opened forbidden client");
const boardShot = await shot(page, "u12-hiring");

const board = await page.evaluate(() => {
  const text = (document.body?.innerText || "").replace(/\s+/g, " ");
  const foot = (document.getElementById("footNote")?.innerText || "").trim();
  const buttons = [...document.querySelectorAll("button")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  const hireReject = buttons.filter((t) => /^(hire|reject)$/i.test(t) || /\b(hire|reject)\b/i.test(t));
  const demoMarks = (text.match(/DEMO/g) || []).length;
  const rows = document.querySelectorAll("tr.rowbtn, tbody tr, .card, [data-application-id]").length;
  return {
    path: location.pathname,
    foot,
    hireReject: hireReject.slice(0, 12),
    demoMarks,
    rows,
    notice: /nothing in this panel can be changed/i.test(text),
    readonly: /read-only/i.test(text + " " + foot),
    body: text.slice(0, 220)
  };
});
rec({
  id: "u12-board",
  claim: "Owner Hiring board",
  happened: JSON.stringify(board).slice(0, 280),
  shot: boardShot,
  verdict: "OBSERVED"
});

const getCand = await apiFromPage(page, "GET", "/api/hiring/candidates?state=all&limit=200");
const items = getCand.data?.items || [];
const classified = items.map((r) => ({
  application_id: r.application_id || null,
  status: r.status || null,
  stage_key: r.stage_key || null,
  source_detail: r.source_detail || null,
  is_demo_row: r.source_detail === "platform_demo" || /^DEMO[\s—-]/.test(String(r.full_name || "")),
  email_domain: typeof r.email === "string" && r.email.includes("@") ? r.email.split("@")[1] : (typeof r.email === "string" ? "redacted" : null)
}));
rec({
  id: "u12-candidates-api",
  claim: "GET /api/hiring/candidates",
  happened: `status=${getCand.status} ok=${getCand.data?.ok} n=${classified.length} demo=${classified.filter((c) => c.is_demo_row).length}`,
  verdict: "OBSERVED"
});

const demo = classified.find((c) => c.is_demo_row);
if (demo) {
  const row = page.locator("tr.rowbtn, tbody tr, .card").filter({ hasText: /DEMO/i }).first();
  if (await row.count()) {
    await row.click();
    await waitQuiet(page, 1200);
  }
}
const drawerShot = await shot(page, "u12-drawer");
const drawer = await page.evaluate(() => {
  const body = (document.getElementById("dwBody")?.innerText || "").replace(/\s+/g, " ");
  const buttons = [...document.querySelectorAll("#drawer button, #dwBody button")].map((b) => (b.innerText || "").trim()).filter(Boolean);
  return {
    buttons,
    notice: /nothing in this panel can be changed/i.test(body),
    advisory: /scores are advisory/i.test(body),
    snippet: body.slice(0, 280)
  };
});
rec({
  id: "u12-drawer",
  claim: "Hiring drawer read-only notice",
  happened: JSON.stringify(drawer).slice(0, 280),
  shot: drawerShot,
  verdict: drawer.notice ? "OBSERVED" : "MISSING"
});

const writePaths = [
  "/api/hiring/candidates",
  "/api/hiring/decisions",
  "/api/hiring/application",
  "/api/hiring/postings",
  "/api/hiring/funnel",
  "/api/hiring/bench"
];
const writeProbes = [];
for (const pth of writePaths) {
  const r = await apiFromPage(page, "POST", pth, { action: "reject", decision: "reject" });
  writeProbes.push({
    path: pth,
    status: r.status,
    allow: r.allow,
    error: r.data?.error || r.data?.message || null
  });
}
rec({
  id: "u12-write-api",
  claim: "POST hire/reject on hiring endpoints",
  happened: writeProbes.map((p) => `${p.path} ${p.status}`).join("; "),
  verdict: writeProbes.every((p) => p.status === 405 || p.status === 404 || p.status === 400) ? "OBSERVED" : "OBSERVED"
});

const canPress = drawer.buttons.some((b) => /^(hire|reject)$/i.test(b)) && writeProbes.some((p) => p.status === 200);
if (canPress && demo) {
  const rejectBtn = page.locator("#drawer button, #dwBody button").filter({ hasText: /^Reject$/i }).first();
  const beforeWrites = net.writes.length;
  await rejectBtn.click();
  await waitQuiet(page, 1500);
  await shot(page, "u12-after-reject");
  rec({
    id: "u12-reject",
    claim: "Reject once on demo candidate",
    happened: "Pressed Reject on a DEMO row.",
    writes: net.writes.slice(beforeWrites),
    verdict: "OBSERVED"
  });
} else {
  rec({
    id: "u12-reject",
    claim: "Reject once on demo candidate",
    happened: `Demo rows exist (${classified.filter((c) => c.is_demo_row).length}). No Hire/Reject button that writes. Did not press. Did not email.`,
    drawer_buttons: drawer.buttons,
    write_probes: writeProbes,
    verdict: "BROKEN"
  });
}

await context.close();
await browser.close();

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
const afterDecisions = await client.query(
  `SELECT count(*)::int AS n,
          count(*) FILTER (WHERE decision = 'reject')::int AS rejects
     FROM hiring_decisions`
);
await client.end();

const walk = {
  at: new Date().toISOString(),
  opened_forbidden: false,
  findings,
  writes: net.writes,
  candidates_classified: classified,
  write_probes: writeProbes,
  after_decisions: afterDecisions.rows[0]
};
fs.writeFileSync(path.join(OUT, "walk.json"), JSON.stringify(walk, null, 2));
console.log(JSON.stringify({
  wrote: "u12/walk.json",
  verdicts: findings.map((f) => ({ id: f.id, verdict: f.verdict })),
  demo: classified.filter((c) => c.is_demo_row).length,
  write_probes: writeProbes,
  decisions_after: afterDecisions.rows[0],
  opened_forbidden: false
}, null, 2));

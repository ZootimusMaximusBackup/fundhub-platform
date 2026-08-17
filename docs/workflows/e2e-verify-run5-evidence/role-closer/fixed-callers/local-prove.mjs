// Fixer prove (local, static server + mocked API) for ticket 1 follow-up:
// the three page-level /api/demo/mode callers must not fire for non-owner/admin
// and must still fire for owner. Live prove happens after deploy with the same
// reverify tools (docs/workflows/e2e-verify-run5-evidence/role-closer/reverify/).
//
// Usage: node docs/workflows/e2e-verify-run5-evidence/role-closer/fixed-callers/local-prove.mjs
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "docs/workflows/e2e-verify-run5-evidence/role-closer/fixed-callers");
fs.mkdirSync(OUT, { recursive: true });
const PORT = 48123;

const server = spawn("node", ["e2e/static-server.mjs"], { env: { ...process.env, E2E_PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"] });
await new Promise((res, rej) => {
  server.stdout.on("data", (d) => { if (String(d).includes("listening")) res(); });
  server.stderr.on("data", (d) => process.stderr.write(d));
  setTimeout(() => rej(new Error("static server did not start")), 15000);
});
const BASE = `http://127.0.0.1:${PORT}`;

// the seven screens the live re-verify caught + one control screen
const SCREENS = [
  "/app/closer-dashboard.html", "/app/closer-call.html", "/app/finance-os.html",
  "/app/client-control-panel.html", "/app/documents.html", "/app/ops-admin.html", "/app/sample-data.html",
  "/app/pipeline.html"
];
const ROLES = [
  { role: "closer", staff: { id: "s1", role: "closer", org_id: "org-1", status: "active", email: "closer@fundhub.ai" } },
  { role: "sales_manager", staff: { id: "s2", role: "sales_manager", org_id: "org-1", status: "active", email: "sales@fundhub.ai" } },
  { role: "owner", staff: { id: "s3", role: "owner", org_id: "org-1", status: "active", email: "owner@fundhub.ai" } },
];

const browser = await chromium.launch();
const result = { ranAt: new Date().toISOString(), base: BASE, roles: [] };
for (const R of ROLES) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  const page = await ctx.newPage();
  await page.addInitScript((s) => { localStorage.setItem("fh_token", "e2e-token"); localStorage.setItem("fh_role", s.role); }, R);
  const demoCalls = [];
  page.on("request", (req) => { if (req.url().includes("/api/demo/mode")) demoCalls.push({ screen: page.url().replace(BASE, ""), method: req.method() }); });
  await page.route("**/api/**", async (route) => {
    const u = route.request().url();
    if (u.includes("/api/auth/session")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, staff: R.staff }) });
    if (u.includes("/api/demo/mode")) {
      const forbidden = R.role !== "owner" && R.role !== "admin";
      return route.fulfill({ status: forbidden ? 403 : 200, contentType: "application/json", body: JSON.stringify(forbidden ? { ok: false, error: "forbidden" } : { ok: true, demo_mode_enabled: false, counts: {} }) });
    }
    if (u.includes("/api/health")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, db: "up" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, items: [], rows: [], stages: [], data: [] }) });
  });
  const per = [];
  for (const s of SCREENS) {
    const before = demoCalls.length;
    await page.goto(BASE + s, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(900);
    const rec = { screen: s, finalUrl: page.url().replace(BASE, ""), demoModeRequests: demoCalls.length - before };
    if (s === "/app/sample-data.html") rec.msg = await page.locator("#msg, #demoMsg, .msg").first().textContent({ timeout: 800 }).catch(() => null);
    if (s === "/app/ops-admin.html") rec.demoPanelDisplay = await page.evaluate(() => { const p = document.getElementById("fh-demo-mode-panel"); return p ? getComputedStyle(p).display : "no-panel"; }).catch(() => null);
    per.push(rec);
    if (s === "/app/ops-admin.html" || s === "/app/sample-data.html" || s === "/app/closer-dashboard.html") await page.screenshot({ path: path.join(OUT, `${R.role}-${s.split("/").pop()}.png`) }).catch(() => {});
  }
  result.roles.push({ role: R.role, totalDemoModeRequests: demoCalls.length, screens: per });
  await ctx.close();
}
await browser.close();
server.kill();
fs.writeFileSync(path.join(OUT, "local-prove.json"), JSON.stringify(result, null, 2));
for (const r of result.roles) console.log(r.role, "→ /api/demo/mode requests:", r.totalDemoModeRequests, r.screens.map((s) => `${s.screen}:${s.demoModeRequests}`).join(" "));

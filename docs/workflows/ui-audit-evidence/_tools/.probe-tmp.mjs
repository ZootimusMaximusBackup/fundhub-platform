// Read-only probe: reuse cached session, evaluate a JS expression on the screen, optionally screenshot.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
const [screen, email, slug, expr, shotName, vwArg] = process.argv.slice(2);
const BASE = "https://fundhub.ai";
const ROOT = process.cwd();
const STATE_FILE = path.join(process.env.UI_AUDIT_STATE_DIR, email.replace(/[^a-z0-9@.-]/gi, "_") + "@" + BASE.replace(/[^a-z0-9.]/gi, "_") + ".json");
const st = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
const browser = await chromium.launch();
const vw = vwArg ? Number(vwArg) : 1440;
const ctx = await browser.newContext({ viewport: { width: vw, height: Number(process.env.PROBE_VH || (vw < 700 ? 844 : 900)) }, storageState: st });
await ctx.route("**/api/**", async (route) => {
  const m = route.request().method();
  if (m === "GET" || m === "HEAD") return route.continue();
  return route.fulfill({ status: 599, contentType: "application/json", body: JSON.stringify({ ok: false, error: "audit_intercepted" }) });
});
const page = await ctx.newPage();
page.on("dialog", async (d) => { console.log("DIALOG:", d.type(), d.message()); await d.dismiss().catch(() => {}); });
await page.goto(`${BASE}/app/${screen}`, { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(2500);
const res = await page.evaluate(expr).catch((e) => "EVAL ERROR: " + e.message);
console.log(typeof res === "string" ? res : JSON.stringify(res, null, 1));
if (shotName) {
  const OUT = path.join(ROOT, "docs/workflows/ui-audit-evidence", slug, "extra");
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, shotName) });
  console.log("shot:", path.relative(ROOT, path.join(OUT, shotName)));
}
await browser.close();

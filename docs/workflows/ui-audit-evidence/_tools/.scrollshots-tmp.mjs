// Read-only supplement to ui-audit.mjs: reuse the cached session, open the screen,
// and screenshot the internally-scrolling main region page by page so below-fold
// content (which the harness's docH=900 shots miss) is visible. Same write guard.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [screen, email, slug] = process.argv.slice(2);
const BASE = "https://fundhub.ai";
const ROOT = process.cwd();
const STATE_DIR = process.env.UI_AUDIT_STATE_DIR;
const STATE_FILE = path.join(STATE_DIR, email.replace(/[^a-z0-9@.-]/gi, "_") + "@" + BASE.replace(/[^a-z0-9.]/gi, "_") + ".json");
const OUT = path.join(ROOT, "docs/workflows/ui-audit-evidence", slug, "extra");
fs.mkdirSync(OUT, { recursive: true });
const st = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: st });
await ctx.route("**/api/**", async (route) => {
  const m = route.request().method();
  if (m === "GET" || m === "HEAD") return route.continue();
  return route.fulfill({ status: 599, contentType: "application/json", body: JSON.stringify({ ok: false, error: "audit_intercepted" }) });
});
const page = await ctx.newPage();
await page.goto(`${BASE}/app/${screen}`, { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(2500);
// find biggest scrollable element
const info = await page.evaluate(() => {
  let best = null;
  const all = [document.scrollingElement, ...document.querySelectorAll("*")];
  for (const el of all) {
    if (!el) continue;
    const cs = getComputedStyle(el);
    const ov = cs.overflowY;
    const scrollable = el === document.scrollingElement || ov === "auto" || ov === "scroll";
    if (!scrollable) continue;
    const extra = el.scrollHeight - el.clientHeight;
    if (extra > 40 && (!best || extra > best.extra)) best = { extra, sel: el === document.scrollingElement ? "html" : (el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : "")), sh: el.scrollHeight, ch: el.clientHeight };
  }
  return best;
});
console.log("scroll container:", JSON.stringify(info));
const files = [];
if (info) {
  const steps = Math.min(8, Math.ceil(info.sh / info.ch));
  for (let i = 1; i < steps; i++) {
    await page.evaluate(([sel, y]) => { const el = sel === "html" ? document.scrollingElement : document.querySelector(sel); el.scrollTop = y; }, [info.sel, i * (info.ch - 40)]);
    await page.waitForTimeout(400);
    const f = path.join(OUT, `1440-scroll-${i}.png`);
    await page.screenshot({ path: f });
    files.push(path.relative(ROOT, f));
  }
}
// also dump the visible text of main for reading
const txt = await page.evaluate(() => (document.querySelector("main") || document.body).innerText);
fs.writeFileSync(path.join(OUT, "main-text.txt"), txt);
console.log(files.join("\n"));
console.log("text bytes:", txt.length);
await browser.close();

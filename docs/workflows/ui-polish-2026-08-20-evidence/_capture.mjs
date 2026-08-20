/* Local, read-only browser proof for the post-simplify UI polish. */
import { chromium } from "playwright";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const PUBLIC = path.join(ROOT, "public");
const AFTER = path.join(HERE, "after");
const CHROME = process.env.PLAYWRIGHT_CHROMIUM || "/usr/local/bin/google-chrome";

const SCREENS = {
  "closer-dashboard.html": "closer",
  "closer-call.html": "closer",
  "my-numbers.html": "closer",
  "sales-floor.html": "sales_manager",
  "pipeline.html": "setter",
  "client-control-panel.html": "funding_advisor",
  "documents.html": "funding_advisor",
  "contracts.html": "owner",
  "client-portal.html": "client",
  "messaging.html": "funding_advisor",
  "calendar.html": "closer",
  "template-editor.html": "setter",
  "inquiry-remover.html": "inquiry_specialist",
  "staff-teams.html": "sales_manager",
  "products-commissions.html": "sales_manager",
  "agent-editor.html": "admin",
  "lenders.html": "funding_advisor",
  "content-admin.html": "admin"
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2"
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/app/pipeline.html";
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: CHROME });
const report = { at: new Date().toISOString(), screens: {}, failures: [] };
fs.mkdirSync(AFTER, { recursive: true });

function apiBody() {
  return {
    ok: true, db: "up", migrations: 1,
    items: [], rows: [], results: [], list: [], data: [],
    staff: [], clients: [], tasks: [], stages: [], templates: [],
    contracts: [], documents: [], messages: [], events: [], leads: [],
    counts: {}, kpis: {}, metrics: {}, totals: {}
  };
}

for (const [screen, role] of Object.entries(SCREENS)) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((sessionRole) => {
    localStorage.setItem("fh_role", sessionRole);
    localStorage.setItem("fh_token", "ui-polish-proof");
  }, role);
  await ctx.route("**/api/**", (route) => {
    if (route.request().url().includes("/api/auth/session")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          staff: {
            id: "proof", name: "DEMO " + role,
            email: role + "@demo.fundhub.local", role, org_id: "org-proof"
          }
        })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(apiBody())
    });
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 240)));
  await page.goto(`${base}/app/${screen}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);

  const slug = screen.replace(".html", "");
  const screenDir = path.join(AFTER, slug);
  fs.mkdirSync(screenDir, { recursive: true });
  const checks = {};

  for (const viewport of [
    { name: "1440", width: 1440, height: 900 },
    { name: "390", width: 390, height: 844 }
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(250);
    await page.screenshot({
      path: path.join(screenDir, `${viewport.name}-fold.png`),
      fullPage: false
    });
    checks[viewport.name] = await page.evaluate(({ width, height }) => {
      const rectOf = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          left: Math.round(r.left), top: Math.round(r.top),
          right: Math.round(r.right), bottom: Math.round(r.bottom),
          width: Math.round(r.width), height: Math.round(r.height)
        };
      };
      const rect = (selector) => rectOf(document.querySelector(selector));
      const chip = document.getElementById("fh-shell-chip");
      const title = document.querySelector(
        ".topbar h1, header h1, header .eyebrow, header .brand, .page-hd h1"
      );
      const sign = document.getElementById("cpSignSubmit");
      const editor = document.getElementById("editor");
      return {
        viewport: { width, height },
        pageScrollWidth: document.documentElement.scrollWidth,
        noPageOverflow: document.documentElement.scrollWidth <= width,
        chip: chip ? {
          position: getComputedStyle(chip).position,
          inHeader: chip.getAttribute("data-fh-in-header") === "1",
          parent: chip.parentElement?.className || chip.parentElement?.tagName || ""
        } : null,
        title: rectOf(title),
        menuButton: rect("#fh-mobile-menu"),
        header: rect(".topbar, body > header, .app > header, .app-shell > header"),
        account: rect("#fh-shell-chip"),
        signButton: sign ? {
          ...rect("#cpSignSubmit"),
          visibleInFold: sign.getBoundingClientRect().bottom <= height
        } : null,
        editor: editor ? {
          visibility: getComputedStyle(editor).visibility,
          pointerEvents: getComputedStyle(editor).pointerEvents
        } : null,
        bodyText: document.body.innerText.slice(0, 5000)
      };
    }, { width: viewport.width, height: viewport.height });
  }

  if (!checks["1440"].noPageOverflow) report.failures.push(`${screen}: desktop page overflow`);
  if (!checks["390"].noPageOverflow) report.failures.push(`${screen}: phone page overflow`);
  if (role !== "client" && checks["390"].chip?.position === "fixed") {
    report.failures.push(`${screen}: account chip is still fixed on phone`);
  }
  const title = checks["390"].title;
  const menu = checks["390"].menuButton;
  if (title && menu &&
      title.left < menu.right && title.right > menu.left &&
      title.top < menu.bottom && title.bottom > menu.top) {
    report.failures.push(`${screen}: phone title overlaps menu button`);
  }
  if (/\/api\/read\/my-numbers/i.test(checks["1440"].bodyText)) {
    report.failures.push(`${screen}: raw API path is visible`);
  }
  report.screens[screen] = { role, errors, checks };
  await ctx.close();
}

await browser.close();
server.close();
fs.writeFileSync(path.join(HERE, "measurements.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  screens: Object.keys(report.screens).length,
  failures: report.failures
}, null, 2));
process.exitCode = report.failures.length ? 1 : 0;

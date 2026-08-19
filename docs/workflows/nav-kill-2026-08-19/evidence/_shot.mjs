/* Menu shots for the 2026-08-19 nav kill. Local public/ only. Session is faked
   so this does not need a live login and cannot write anything. */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
const PUBLIC = path.join(ROOT, "public");
const PHASE = process.argv[2] === "after" ? "after" : "before";
const OUT = path.join(HERE, PHASE);
fs.mkdirSync(OUT, { recursive: true });

const HOMES = {
  owner: "pipeline.html",
  admin: "pipeline.html",
  funding_advisor: "client-control-panel.html",
  closer: "closer-dashboard.html",
  inquiry_specialist: "inquiry-remover.html",
  setter: "pipeline.html",
  sales_manager: "sales-floor.html",
  partner: "partner-galaxy.html",
  affiliate: "affiliate.html",
  client: "client-portal.html"
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

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const BASE = `http://127.0.0.1:${port}`;

const browser = await chromium.launch();
const report = { phase: PHASE, at: new Date().toISOString(), roles: {} };

for (const [role, home] of Object.entries(HOMES)) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await ctx.addInitScript((r) => {
    localStorage.setItem("fh_role", r);
    localStorage.setItem("fh_token", "nav-kill-shot");
  }, role);
  await ctx.route("**/api/**", (route) => {
    const url = route.request().url();
    if (url.includes("/api/auth/session")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          staff: { id: "shot", name: "DEMO " + role, email: role + "@demo.fundhub.local", role }
        })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, db: "up", migrations: 1 })
    });
  });

  const page = await ctx.newPage();
  await page.goto(`${BASE}/app/${home}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  if (role !== "client") {
    await page.waitForSelector("aside.side, #side", { timeout: 15000 });
    await page.waitForFunction(() => !document.getElementById("fh-gate-style"), { timeout: 15000 });
  } else {
    await page.waitForTimeout(600);
  }
  await page.evaluate(() => {
    document.querySelectorAll(".navgroup.closed").forEach((g) => g.classList.remove("closed"));
  });

  const nav = await page.evaluate(() => {
    const items = [...document.querySelectorAll("#fh-side-nav a.navitem")];
    const visible = items.filter((a) => {
      const st = getComputedStyle(a);
      if (st.display === "none" || st.visibility === "hidden") return false;
      if (a.getAttribute("data-fh-gated") === "1") return false;
      return a.getClientRects().length > 0;
    });
    return {
      hrefs: visible.map((a) => (a.getAttribute("href") || "").split("?")[0]),
      labels: visible.map((a) => (a.querySelector(".lbl")?.textContent || a.textContent || "").trim())
    };
  });

  const shot = path.join(OUT, `${role}-menu.png`);
  const side = page.locator("aside.side, #side");
  if ((await side.count()) && role !== "client") {
    await side.first().screenshot({ path: shot });
  } else {
    await page.screenshot({ path: shot, fullPage: false });
  }

  report.roles[role] = { home, ...nav, shot: path.relative(HERE, shot) };
  await ctx.close();
}

await browser.close();
server.close();
fs.writeFileSync(path.join(OUT, "nav.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ phase: PHASE, roles: Object.keys(report.roles).length, out: OUT }, null, 2));

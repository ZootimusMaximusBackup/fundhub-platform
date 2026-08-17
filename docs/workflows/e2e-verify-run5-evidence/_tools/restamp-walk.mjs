#!/usr/bin/env node
// Fixer restamp — live UI walk into <journey>/restamp-2026-08-17/
// Does not overwrite the original batch evidence.
//
// Usage: node .../restamp-walk.mjs <journey> <email>
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [journey, email] = process.argv.slice(2);
if (!journey || !email) {
  console.error("usage: restamp-walk.mjs <journey> <email>");
  process.exit(2);
}
const ROOT = process.cwd();
const BASE = process.env.BASE_URL || "https://fundhub.ai";
const OUT_DIR = path.join(ROOT, "docs/workflows/e2e-verify-run5-evidence", journey, "restamp-2026-08-17");
const SHOTS = path.join(OUT_DIR, "shots");
fs.mkdirSync(SHOTS, { recursive: true });

function loadEnvPassword() {
  if (process.env.STAFF_E2E_PASSWORD) return process.env.STAFF_E2E_PASSWORD;
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return "";
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?STAFF_E2E_PASSWORD\s*=\s*(.*)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  return "";
}
const password = loadEnvPassword();
if (!password) {
  console.error("STAFF_E2E_PASSWORD missing from env/.env — cannot log in");
  process.exit(2);
}

const DIRECT = [
  "/app/ops-admin.html",
  "/app/staff-teams.html",
  "/app/agent-editor.html",
  "/app/products-commissions.html",
  "/app/campaign-manager.html",
  "/app/sample-data.html",
  "/app/hiring.html",
  "/app/inquiry-remover.html",
  "/dashboard.html",
];

const rel = (p) => path.relative(ROOT, p);
const out = {
  journey,
  email,
  base: BASE,
  ranAt: new Date().toISOString(),
  login: {},
  landing: {},
  sidebar: [],
  screens: [],
  direct: [],
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
const page = await ctx.newPage();

let apiFails = [];
let consoleErrors = [];
page.on("response", (res) => {
  const u = res.url();
  if (u.includes("/api/") && res.status() >= 400) {
    apiFails.push({
      url: u.replace(BASE, "").replace(/^https?:\/\/[^/]+/, ""),
      status: res.status(),
      method: res.request().method(),
    });
  }
});
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(String(msg.text()).slice(0, 160));
});
page.on("pageerror", (err) =>
  consoleErrors.push("pageerror: " + String(err?.message || err).slice(0, 160)),
);

await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
const loginShot = path.join(SHOTS, "00-login-page.png");
await page.screenshot({ path: loginShot });
out.login.pageShot = rel(loginShot);
await page.locator('input[type="email"], #email, input[name="email"]').first().fill(email);
await page.locator('input[type="password"], #password, input[name="password"]').first().fill(password);
apiFails = [];
consoleErrors = [];
await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
try {
  await page.waitForURL((u) => !/login\.html/.test(u.toString()), { timeout: 30_000 });
  out.login.ok = true;
} catch {
  out.login.ok = false;
}
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(1500);
out.login.apiFails = apiFails.slice();
out.login.consoleErrors = consoleErrors.slice();
out.login.roleStored = await page.evaluate(() => localStorage.getItem("fh_role")).catch(() => null);

const landShot = path.join(SHOTS, "01-landing.png");
await page.screenshot({ path: landShot });
out.landing = {
  url: page.url().replace(BASE, ""),
  title: await page.title().catch(() => ""),
  shot: rel(landShot),
  apiFails: apiFails.slice(),
  consoleErrors: consoleErrors.slice(),
};

async function hasNav() {
  return page
    .locator("#fh-side-nav a.navitem, nav a.navitem, aside a")
    .count()
    .then((n) => n > 0)
    .catch(() => false);
}
for (const cand of ["/app/", "/app/pipeline.html", "/app/command-center.html"]) {
  if (await hasNav()) break;
  await page.goto(`${BASE}${cand}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);
}
const shellShot = path.join(SHOTS, "02-app-shell.png");
await page.screenshot({ path: shellShot });
out.landing.appShellUrl = page.url().replace(BASE, "");
out.landing.appShellShot = rel(shellShot);

await page.evaluate(() => {
  document.querySelectorAll(".navgroup.closed").forEach((g) => g.classList.remove("closed"));
}).catch(() => {});
await page.waitForTimeout(300);

const links = await page
  .evaluate(() => {
    const all = [...document.querySelectorAll("#fh-side-nav a.navitem, nav a.navitem, aside a")];
    return all.map((a) => {
      const r = a.getBoundingClientRect();
      const cs = getComputedStyle(a);
      const gated = a.getAttribute("data-fh-gated") === "1" || a.closest("[data-fh-gated='1']");
      const offered = !gated && cs.display !== "none" && cs.visibility !== "hidden";
      const painted = offered && r.width > 0 && r.height > 0 && !a.closest("[hidden]");
      return {
        href: a.getAttribute("href"),
        label: (a.textContent || "").trim().replace(/\s+/g, " "),
        gated: !!gated,
        offered,
        visible: painted,
      };
    });
  })
  .catch(() => []);
out.sidebar = links;

const visible = links.filter((l) => (l.offered || l.visible) && l.href && !/^https?:|^#|^mailto:/.test(l.href));
const seen = new Set();
let i = 3;
for (const l of visible) {
  if (seen.has(l.href)) continue;
  seen.add(l.href);
  const target = l.href.startsWith("/") ? BASE + l.href : `${BASE}/app/${l.href}`;
  apiFails = [];
  consoleErrors = [];
  const rec = { label: l.label, href: l.href };
  try {
    const resp = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45_000 });
    rec.httpStatus = resp ? resp.status() : null;
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1200);
    rec.finalUrl = page.url().replace(BASE, "");
    rec.bounced = !page.url().includes(l.href.replace(/^\//, "").split("?")[0]);
    rec.title = await page.title().catch(() => "");
    rec.h1 = await page.locator("h1").first().textContent({ timeout: 2000 }).catch(() => "");
    rec.bodyText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400);
    const shot = path.join(SHOTS, `${String(i).padStart(2, "0")}-${l.href.replace(/[^a-z0-9.-]/gi, "_")}.png`);
    await page.screenshot({ path: shot });
    rec.shot = rel(shot);
  } catch (e) {
    rec.error = String(e?.message || e).slice(0, 200);
  }
  rec.apiFails = apiFails.slice();
  rec.consoleErrors = consoleErrors.slice(0, 8);
  out.screens.push(rec);
  i++;
}

for (const href of DIRECT) {
  apiFails = [];
  consoleErrors = [];
  const rec = { href };
  try {
    const resp = await page.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    rec.httpStatus = resp ? resp.status() : null;
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1200);
    rec.finalUrl = page.url().replace(BASE, "");
    rec.bounced = !page.url().includes(href.replace(/^\//, "").split("?")[0]);
    rec.title = await page.title().catch(() => "");
    rec.bodyText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400);
    const shot = path.join(SHOTS, `direct-${href.replace(/[^a-z0-9.-]/gi, "_")}.png`);
    await page.screenshot({ path: shot });
    rec.shot = rel(shot);
  } catch (e) {
    rec.error = String(e?.message || e).slice(0, 200);
  }
  rec.apiFails = apiFails.slice();
  rec.consoleErrors = consoleErrors.slice(0, 8);
  out.direct.push(rec);
}

await browser.close();

fs.writeFileSync(path.join(OUT_DIR, "ui-walk.json"), JSON.stringify(out, null, 2));

const md = [];
md.push(`# ${journey} — restamp UI walk 2026-08-17`);
md.push("");
md.push(`Ran ${out.ranAt} against ${BASE} as \`${email}\`.`);
md.push("");
md.push(`| Login | ${out.login.ok ? "left login.html" : "STILL ON login.html"} · role=${out.login.roleStored ?? "—"} · api fails=${out.login.apiFails.length} |`);
md.push(`| Landed | ${out.landing.url} |`);
md.push(`| Sidebar | ${visible.length} visible / ${links.length} total |`);
md.push("");
md.push("## Sidebar");
md.push("");
md.push("| Label | Href | Visible |");
md.push("|---|---|---|");
for (const l of links) md.push(`| ${l.label} | \`${l.href}\` | ${l.visible ? "yes" : "no"} |`);
md.push("");
md.push("## Screens opened (visible rail)");
md.push("");
md.push("| Screen | HTTP | Final | Bounced | API 4xx/5xx | Console |");
md.push("|---|---|---|---|---|---|");
for (const s of out.screens) {
  const fails = s.apiFails.map((f) => `${f.method} ${f.url} → ${f.status}`).join("<br>");
  md.push(
    `| ${s.label} (\`${s.href}\`) | ${s.httpStatus ?? "—"} | ${s.finalUrl ?? "—"} | ${s.bounced ? "YES" : "no"} | ${fails || "—"} | ${s.consoleErrors.length ? s.consoleErrors.join("<br>") : "—"} |`,
  );
}
md.push("");
md.push("## Direct URL of previously-open screens");
md.push("");
md.push("| Href | Final | Bounced | API 4xx/5xx | Console |");
md.push("|---|---|---|---|---|");
for (const s of out.direct) {
  const fails = s.apiFails.map((f) => `${f.method} ${f.url} → ${f.status}`).join("<br>");
  md.push(
    `| \`${s.href}\` | ${s.finalUrl ?? "—"} | ${s.bounced ? "YES" : "no"} | ${fails || "—"} | ${s.consoleErrors.length ? s.consoleErrors.join("<br>") : "—"} |`,
  );
}
fs.writeFileSync(path.join(OUT_DIR, "ui-walk.md"), md.join("\n") + "\n");

console.log(
  JSON.stringify(
    {
      journey,
      email,
      login: { ok: out.login.ok, roleStored: out.login.roleStored, apiFails: out.login.apiFails.length },
      landing: out.landing.url,
      sidebar: { visible: visible.length, total: links.length, visibleHrefs: visible.map((l) => l.href) },
      dirtyScreens: out.screens
        .filter((s) => s.apiFails.length || s.consoleErrors.length || s.bounced)
        .map((s) => ({ href: s.href, bounced: s.bounced, apiFails: s.apiFails, console: s.consoleErrors })),
      dirtyDirect: out.direct
        .filter((s) => s.apiFails.length || s.consoleErrors.length || s.bounced)
        .map((s) => ({ href: s.href, final: s.finalUrl, bounced: s.bounced, apiFails: s.apiFails, console: s.consoleErrors })),
    },
    null,
    2,
  ),
);

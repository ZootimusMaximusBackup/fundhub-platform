#!/usr/bin/env node
// Auditor evidence tool — READ-ONLY browser walk of the live app as one role.
//
// 1. Opens /login.html, screenshots it, signs in with the role's email
//    (password from gitignored .env, never printed).
// 2. Screenshots where the role lands.
// 3. Reads every visible sidebar link and opens each one. For each screen it
//    records: final URL (did the shell bounce us?), page title, any API call
//    that answered 4xx/5xx, any console error, and a screenshot.
// Nothing is clicked except sidebar links. No forms are submitted.
//
// Usage: node docs/workflows/e2e-verify-run5-evidence/_tools/ui-walk.mjs <journey> <email>
// Output: docs/workflows/e2e-verify-run5-evidence/<journey>/ui-walk.json, ui-walk.md, shots/*.png

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [journey, email] = process.argv.slice(2);
if (!journey || !email) {
  console.error("usage: ui-walk.mjs <journey> <email>");
  process.exit(2);
}
const ROOT = process.cwd();
const BASE = process.env.BASE_URL || "https://fundhub.ai";
// REVERIFY COPY (auditor, 2026-08-17): output goes to <journey>/reverify/ and
// <journey>/reverify/shots/. Only this line differs from _tools/ui-walk.mjs.
const OUT_DIR = path.join(ROOT, "docs/workflows/e2e-verify-run5-evidence", journey, "reverify");
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

const rel = (p) => path.relative(ROOT, p);
const out = { journey, email, base: BASE, ranAt: new Date().toISOString(), login: {}, landing: {}, sidebar: [], screens: [] };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
const page = await ctx.newPage();

// per-navigation collectors
let apiFails = [];
let consoleErrors = [];
page.on("response", (res) => {
  const u = res.url();
  if (u.includes("/api/") && res.status() >= 400) apiFails.push({ url: u.replace(BASE, ""), status: res.status(), method: res.request().method() });
});
page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(String(msg.text()).slice(0, 160)); });
page.on("pageerror", (err) => consoleErrors.push("pageerror: " + String(err?.message || err).slice(0, 160)));

// Step 1 — login page + sign in
await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
const loginShot = path.join(SHOTS, "00-login-page.png");
await page.screenshot({ path: loginShot });
out.login.pageShot = rel(loginShot);
await page.locator('input[type="email"], #email, input[name="email"]').first().fill(email);
await page.locator('input[type="password"], #password, input[name="password"]').first().fill(password);
apiFails = []; consoleErrors = [];
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
const role = await page.evaluate(() => localStorage.getItem("fh_role")).catch(() => null);
out.login.roleStored = role;

// Step 2 — landing
const landShot = path.join(SHOTS, "01-landing.png");
await page.screenshot({ path: landShot });
out.landing = { url: page.url().replace(BASE, ""), title: await page.title().catch(() => ""), shot: rel(landShot), apiFails: apiFails.slice(), consoleErrors: consoleErrors.slice() };

// Make sure we are inside the app shell to read the sidebar. Some roles land
// on a screen with no sidebar (closer → /dashboard.html), so fall through a
// short list of shell screens until one shows a nav.
async function hasNav() {
  return page.locator("#fh-side-nav a.navitem, nav a.navitem, aside a").count().then((n) => n > 0).catch(() => false);
}
for (const cand of ["/app/", "/app/pipeline.html", "/app/command-center.html"]) {
  if (await hasNav()) break;
  await page.goto(`${BASE}${cand}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
}
const shellShot = path.join(SHOTS, "02-app-shell.png");
await page.screenshot({ path: shellShot });
out.landing.appShellUrl = page.url().replace(BASE, "");
out.landing.appShellShot = rel(shellShot);

// Step 3 — sidebar links (visible only) + hidden ones for the record
const links = await page.evaluate(() => {
  const all = [...document.querySelectorAll("#fh-side-nav a.navitem, nav a.navitem, aside a")];
  return all.map((a) => {
    const r = a.getBoundingClientRect();
    const cs = getComputedStyle(a);
    const visible = r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden" && !a.closest("[hidden]");
    return { href: a.getAttribute("href"), label: (a.textContent || "").trim().replace(/\s+/g, " "), visible };
  });
}).catch(() => []);
out.sidebar = links;

const visible = links.filter((l) => l.visible && l.href && !/^https?:|^#|^mailto:/.test(l.href));
const seen = new Set();
let i = 3;
for (const l of visible) {
  if (seen.has(l.href)) continue;
  seen.add(l.href);
  const target = l.href.startsWith("/") ? BASE + l.href : `${BASE}/app/${l.href}`;
  apiFails = []; consoleErrors = [];
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
    rec.bodyText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
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

await browser.close();

fs.writeFileSync(path.join(OUT_DIR, "ui-walk.json"), JSON.stringify(out, null, 2));

const md = [];
md.push(`# ${journey} — live UI walk`);
md.push(``);
md.push(`Ran ${out.ranAt} against ${BASE} as \`${email}\`.`);
md.push(``);
md.push(`| Step | Result | Evidence |`);
md.push(`|---|---|---|`);
md.push(`| Login page | shown | ${out.login.pageShot} |`);
md.push(`| Sign in | ${out.login.ok ? "left login.html" : "STILL ON login.html"} · role stored=${out.login.roleStored ?? "—"} · api fails=${out.login.apiFails.length} | ${out.landing.shot} |`);
md.push(`| Landed at | ${out.landing.url} (${out.landing.title}) | ${out.landing.shot} |`);
md.push(`| App shell | ${out.landing.appShellUrl} | ${out.landing.appShellShot} |`);
md.push(`| Sidebar | ${visible.length} visible / ${links.length} total links | ui-walk.json |`);
md.push(``);
md.push(`## Sidebar links`);
md.push(``);
md.push(`| Label | Href | Visible |`);
md.push(`|---|---|---|`);
for (const l of links) md.push(`| ${l.label} | \`${l.href}\` | ${l.visible ? "yes" : "no"} |`);
md.push(``);
md.push(`## Screens opened`);
md.push(``);
md.push(`| Screen | HTTP | Final URL | Bounced | API 4xx/5xx | Console errors | Shot |`);
md.push(`|---|---|---|---|---|---|---|`);
for (const s of out.screens) {
  const fails = s.apiFails.map((f) => `${f.method} ${f.url} → ${f.status}`).join("<br>");
  md.push(`| ${s.label} (\`${s.href}\`) | ${s.httpStatus ?? "—"} | ${s.finalUrl ?? "—"} | ${s.bounced ? "YES" : "no"} | ${fails || "—"} | ${s.consoleErrors.length ? s.consoleErrors.join("<br>") : "—"} | ${s.shot ?? s.error ?? "—"} |`);
}
fs.writeFileSync(path.join(OUT_DIR, "ui-walk.md"), md.join("\n") + "\n");

console.log(JSON.stringify({
  journey, email, login: { ok: out.login.ok, roleStored: out.login.roleStored, apiFails: out.login.apiFails },
  landing: { url: out.landing.url, appShellUrl: out.landing.appShellUrl },
  sidebar: { visible: visible.length, total: links.length },
  screens: out.screens.map((s) => ({ href: s.href, http: s.httpStatus, bounced: s.bounced, apiFails: s.apiFails.length, consoleErrors: s.consoleErrors.length, error: s.error }))
}, null, 2));

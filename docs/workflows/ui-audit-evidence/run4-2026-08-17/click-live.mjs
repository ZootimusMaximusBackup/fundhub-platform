#!/usr/bin/env node
// Human-click prove for UI-audit Run 4 — live https://fundhub.ai only.
// Signs in, opens each named screen, records what is on the page, screenshots.
// No writes after login (non-GET aborted). New-agent prompt is dismissed.
// Password from gitignored .env. Never printed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
const BASE = process.env.BASE_URL || "https://fundhub.ai";

function loadEnv() {
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadEnv();

const password = process.env.STAFF_E2E_PASSWORD || process.env.STAFF_INITIAL_PASSWORD || "";
if (!password) {
  console.error("STAFF_E2E_PASSWORD missing");
  process.exit(2);
}

fs.mkdirSync(path.join(HERE, "shots"), { recursive: true });

function chromiumPath() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const home = process.env.HOME || "";
  const root = path.join(home, "Library", "Caches", "ms-playwright");
  if (!fs.existsSync(root)) return undefined;
  const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    const exe = path.join(root, d, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing");
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}

async function login(page, email) {
  await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"], #email, input[name="email"]').first().fill(email);
  await page.locator('input[type="password"], #password, input[name="password"]').first().fill(password);
  await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
  await page.waitForURL((u) => !/login\.html/.test(u.toString()), { timeout: 30_000 });
  await page.waitForTimeout(800);
}

async function shot(page, name) {
  const file = path.join(HERE, "shots", `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return path.basename(file);
}

async function probe(page) {
  return page.evaluate(() => {
    const panes = [...document.querySelectorAll(".pane-title, .pane-title.eyebrow")].map((el) => (el.textContent || "").trim());
    const nav = [...document.querySelectorAll("a.navitem .lbl, a.navitem")].map((el) => (el.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean);
    const groups = [...document.querySelectorAll(".navgroup .navhead")].map((el) => (el.textContent || "").replace(/\s+/g, " ").trim());
    const chip = document.querySelector("[data-fh-in-header], #fh-session-chip, .fh-chip");
    const search = document.querySelector("#fh-shell-search, [data-fh-search], .fh-search");
    const beta = document.querySelector("#fh-beta-banner, .fh-beta-banner");
    const partnerSel = document.getElementById("partnerSel");
    const subsClient = document.getElementById("subsClient");
    const details = [...document.querySelectorAll("details")].map((d) => ({
      open: d.open,
      summary: ((d.querySelector("summary") || {}).textContent || "").replace(/\s+/g, " ").trim().slice(0, 80)
    }));
    const body = (document.body.innerText || "").replace(/\s+/g, " ");
    const codes = (body.match(/\b(CM|SS|AF|CD|CF|GX|TE|AE|HR|PM|CR)-\d{2}\b/g) || []);
    return {
      title: document.title,
      url: location.href,
      h1: ((document.querySelector("h1") || {}).textContent || "").trim(),
      panes,
      navGroups: groups,
      navHasContent: nav.some((t) => /\bContent\b/i.test(t) && !/control/i.test(t)),
      navHasHome: nav.some((t) => /^Home$/i.test(t)),
      chipInHeader: !!(chip && chip.closest(".topbar, .topbar-right, .page-hd, header")),
      chipFixed: chip ? getComputedStyle(chip).position === "fixed" : null,
      searchInHeader: !!(search && search.closest(".topbar, .topbar-right, .page-hd, header")),
      betaVisible: !!(beta && getComputedStyle(beta).display !== "none" && beta.offsetHeight > 0),
      partnerOptions: partnerSel ? [...partnerSel.options].map((o) => o.textContent.trim()).slice(0, 12) : null,
      partnerCount: partnerSel ? partnerSel.options.length : 0,
      subsClientCount: subsClient ? subsClient.options.length : 0,
      details,
      codes,
      hasDecline: /I do not want to sign|I don.t consent|declineBtn/i.test(document.body.innerHTML),
      firstNameFilled: /Hey [A-Za-z]/.test(body) && !/Hey \[First Name\]/.test(body),
      hasFirstNameToken: /\[First Name\]/.test(body),
      calcName: ((document.getElementById("calcClientName") || {}).textContent || "").trim(),
      staffRows: [...document.querySelectorAll("table tbody tr, .roster-row, .staff-row")].slice(0, 40).map((r) => (r.innerText || "").replace(/\s+/g, " ").trim()),
      statsCount: document.querySelectorAll(".stats > *").length || document.querySelectorAll(".stats .tile, .stats .stat").length
    };
  });
}

const report = { at: new Date().toISOString(), commit: "17c20bc", live: BASE, rows: [] };

const exe = chromiumPath();
const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}) });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

page.route("**/*", (route) => {
  const m = route.request().method();
  const url = route.request().url();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return route.continue();
  if (/\/api\/auth\/login/.test(url)) return route.continue();
  return route.abort();
});

async function visit(label, url, extra) {
  await page.goto(url.startsWith("http") ? url : `${BASE}${url}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const p = await probe(page);
  const shotName = await shot(page, label);
  const row = { label, ...p, shot: shotName, ...extra };
  report.rows.push(row);
  console.log(label, p.h1 || p.title, "codes", p.codes.length, "beta", p.betaVisible, "chipHeader", p.chipInHeader);
  return row;
}

// --- owner ---
await login(page, "owner@fundhub.ai");
await visit("01-command-center", "/app/command-center.html");
await visit("02-campaigns", "/app/campaign-manager.html");
await visit("03-social-studio", "/app/social-studio.html");
await visit("04-creative-factory", "/app/creative-factory.html");
await visit("05-subscriptions", "/app/subscriptions.html");
await visit("06-staff-teams", "/app/staff-teams.html");
await visit("07-hiring", "/app/hiring.html");
await visit("08-template-editor", "/app/template-editor.html");
await visit("09-agent-editor", "/app/agent-editor.html");
await visit("10-sales-floor", "/app/sales-floor.html");
await visit("11-galaxy", "/app/galaxy.html");

let agentPrompt = null;
page.once("dialog", (d) => {
  agentPrompt = d.message();
  d.dismiss();
});
await page.locator("#newBtn").click().catch(() => {});
await page.waitForTimeout(500);
report.rows.push({ label: "22-new-agent-prompt", agentPrompt });

const clientsRes = await page.evaluate(async () => {
  const token = localStorage.getItem("fh_token") || "";
  const r = await fetch("/api/dashboard/clients?limit=20", { headers: { Authorization: "Bearer " + token } });
  return r.json();
});
const clients = (clientsRes && (clientsRes.data || clientsRes.clients || clientsRes.rows)) || [];
const named = [].concat(clients).find((c) => c && (c.name || c.first_name || (c.custom_fields && c.custom_fields.name)));
const clientId = named && (named.id || named.client_id);
report.clientIdUsed = clientId || null;

await visit("12-contract", "/contract.html");

// --- closer ---
await ctx.clearCookies();
await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} });
await login(page, "closer@fundhub.ai");
await visit("13-closer-nav", "/app/closer-dashboard.html");
if (clientId) {
  await visit("14-closer-client", `/app/closer-dashboard.html?client_id=${encodeURIComponent(clientId)}`);
  await visit("15-present-client", `/app/present.html?client_id=${encodeURIComponent(clientId)}`);
  await page.setViewportSize({ width: 390, height: 844 });
  await visit("16-present-390", `/app/present.html?client_id=${encodeURIComponent(clientId)}`);
  await page.setViewportSize({ width: 1440, height: 900 });
}

// --- affiliate ---
await ctx.clearCookies();
await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} });
await login(page, "affiliate@fundhub.ai");
await visit("17-affiliate", "/app/affiliate.html");

// --- partner ---
await ctx.clearCookies();
await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} });
await login(page, "partner@fundhub.ai");
await visit("18-partner-galaxy", "/app/partner-galaxy.html");

await browser.close();
fs.writeFileSync(path.join(HERE, "clicks.json"), JSON.stringify(report, null, 2));
console.log("wrote", path.join(HERE, "clicks.json"), "rows", report.rows.length);

#!/usr/bin/env node
// Ticket 5 prove: every Command Center metric dash is gone or a real number.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const OUT = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || "http://localhost:8888";
const EMAIL = "owner@fundhub.ai";

function loadPassword() {
  if (process.env.STAFF_E2E_PASSWORD) return process.env.STAFF_E2E_PASSWORD;
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return "";
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?STAFF_E2E_PASSWORD\s*=\s*(.*)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  return "";
}

const password = loadPassword();
if (!password) {
  console.error("STAFF_E2E_PASSWORD missing");
  process.exit(2);
}

const browser = await chromium.launch();
const page = await browser.newPage();
const pipelineHits = [];
page.on("response", async (res) => {
  const u = res.url();
  if (!u.includes("/api/dashboard/pipeline")) return;
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  pipelineHits.push({
    key: (u.match(/key=([^&]+)/) || [])[1] || null,
    status: res.status(),
    stageCount: body && Array.isArray(body.stages) ? body.stages.length : 0,
    total: body && body.total != null ? body.total : null
  });
});

await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded" });
const login = await page.evaluate(async ({ email, password }) => {
  const r = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ email, password })
  });
  const j = await r.json();
  if (j.token) {
    try { localStorage.setItem("fh_token", j.token); } catch (e) {}
    try { localStorage.setItem("fh_role", (j.staff && j.staff.role) || ""); } catch (e) {}
  }
  return { status: r.status, ok: !!j.ok, role: j.staff && j.staff.role };
}, { email: EMAIL, password });
if (!login.ok) {
  console.error("login failed", login.status);
  process.exit(1);
}
await page.goto(BASE + "/app/command-center.html", { waitUntil: "domcontentloaded" });
await page.waitForSelector("#cc-pipeline-meta", { timeout: 20_000 });
await page.waitForFunction(() => {
  const totals = Array.from(document.querySelectorAll(".rail-total")).slice(0, 6);
  return totals.length === 6 && totals.every((el) => el.textContent.trim() !== "");
}, { timeout: 40_000 });

const ui = await page.evaluate(() => {
  const textOf = (sel) => Array.from(document.querySelectorAll(sel)).map((el) => ({
    sel,
    text: (el.textContent || "").replace(/\s+/g, " ").trim()
  }));
  const nodes = []
    .concat(textOf(".stage-count"))
    .concat(textOf(".stage-dollar"))
    .concat(textOf(".rail-total"))
    .concat(textOf(".kpi-value"))
    .concat(textOf("#cc-pipeline-meta"))
    .concat(textOf("#cc-active-clients"))
    .concat(textOf("#holdsEmpty"))
    .concat(textOf("#clock"));
  const leftoverDashes = nodes.filter((n) => n.text === "—" || n.text.includes(" · — ") || /^— /.test(n.text));
  return {
    paneMeta: (document.getElementById("cc-pipeline-meta") || {}).textContent || "",
    footer: (document.getElementById("cc-active-clients") || {}).textContent || "",
    holds: (document.getElementById("holdsEmpty") || {}).textContent || "",
    chipCount: document.querySelectorAll(".stage-chip").length,
    stageCounts: textOf(".stage-count").map((n) => n.text),
    railTotals: textOf(".rail-total").map((n) => n.text),
    kpiValues: textOf(".kpi-value").map((n) => n.text),
    leftoverDashes,
    holdChips: document.querySelectorAll(".hold-chip").length
  };
});

const shot = path.join(OUT, "command-center-shot.png");
await page.screenshot({ path: shot, fullPage: true });
await browser.close();

const out = {
  ticket: 5,
  email: EMAIL,
  base: BASE,
  ranAt: new Date().toISOString(),
  pipelineHits,
  ui,
  proved: ui.leftoverDashes.length === 0 && ui.holdChips === 0
    && (ui.chipCount > 0 || (ui.railTotals.filter(Boolean).length >= 6)),
  shot: "docs/workflows/e2e-verify-run5-evidence/role-owner/fixed/command-center-shot.png"
};
fs.writeFileSync(path.join(OUT, "command-center-network.json"), JSON.stringify(out, null, 2));
if (!out.proved) {
  console.error("FAIL leftover dashes", JSON.stringify(ui.leftoverDashes));
  process.exit(1);
}
console.log("PASS no leftover metric dashes; chips", ui.chipCount);

#!/usr/bin/env node
// Ticket 4 prove: owner opens Ops & Admin; compliance panel is empty state, not Loading.
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
const hits = [];
page.on("response", async (res) => {
  const u = res.url();
  if (!u.includes("/api/read/messages")) return;
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  hits.push({
    url: u.replace(BASE, ""),
    status: res.status(),
    ok: !!(body && body.ok),
    count: body && typeof body.count === "number" ? body.count : null,
    itemCount: body && Array.isArray(body.items) ? body.items.length : null
  });
});

await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded" });
await page.locator('input[type="email"], #email, input[name="email"]').first().fill(EMAIL);
await page.locator('input[type="password"], #password, input[name="password"]').first().fill(password);
await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
await page.waitForURL((u) => !/login\.html/.test(u.toString()), { timeout: 30_000 });
await page.goto(BASE + "/app/ops-admin.html", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => {
  const t = document.getElementById("compliance-blocked-table");
  if (!t) return false;
  const text = t.innerText || "";
  return text.includes("No messages stopped by the compliance gate")
    || (text.includes("CLIENT") && !text.includes("Loading"));
}, { timeout: 20_000 });

const panel = await page.evaluate(() => {
  const t = document.getElementById("compliance-blocked-table");
  const text = t ? t.innerText : "";
  return {
    tableText: text.replace(/\s+/g, " ").trim(),
    hasLoading: /Loading blocked messages/i.test(text),
    hasEmpty: /No messages stopped by the compliance gate/i.test(text),
    hasError: /Could not load stopped messages/i.test(text)
  };
});

const shot = path.join(OUT, "ops-admin-shot.png");
await page.screenshot({ path: shot, fullPage: true });
await browser.close();

const out = {
  ticket: 4,
  email: EMAIL,
  base: BASE,
  ranAt: new Date().toISOString(),
  fetchGet: hits[hits.length - 1] || null,
  networkHits: hits,
  panel,
  proved: panel.hasEmpty && !panel.hasLoading,
  shot: "docs/workflows/e2e-verify-run5-evidence/role-owner/fixed/ops-admin-shot.png"
};
fs.writeFileSync(path.join(OUT, "messages-network.json"), JSON.stringify(out, null, 2));
if (!out.proved) {
  console.error("FAIL", JSON.stringify(panel));
  process.exit(1);
}
console.log("PASS empty state, no Loading");

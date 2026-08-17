#!/usr/bin/env node
// Ticket 3 prove: owner login → /app/hiring.html board paints with flags:null rows.
// Password from gitignored .env. Never printed.

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

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 860 } });

const consoleErrors = [];
const pageErrors = [];
const candidatesHits = [];

page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(String(msg.text()).slice(0, 240));
});
page.on("pageerror", (err) => {
  pageErrors.push(String(err?.message || err).slice(0, 240));
});
page.on("response", async (res) => {
  const u = res.url();
  if (!u.includes("/api/hiring/candidates")) return;
  let body = null;
  try { body = await res.json(); } catch { body = { _parse: "failed" }; }
  const items = body && body.data && Array.isArray(body.data.items) ? body.data.items : [];
  candidatesHits.push({
    url: u.replace(BASE, ""),
    status: res.status(),
    method: res.request().method(),
    ok: body && body.ok === true,
    itemCount: items.length,
    flagsNullCount: items.filter((it) => it && it.flags == null).length,
    firstFlags: items[0] ? items[0].flags : undefined
  });
});

const loginPosts = [];
page.on("response", (res) => {
  if (res.request().method() !== "POST" || !res.url().includes("/api/auth/login")) return;
  loginPosts.push({ status: res.status(), url: res.url().replace(BASE, "") });
});

await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
await page.locator("#email, input[type=email]").first().fill(EMAIL);
await page.locator("#pw, input[type=password]").first().fill(password);

let loginOk = false;
for (let attempt = 1; attempt <= 6 && !loginOk; attempt++) {
  const loginResp = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().includes("/api/auth/login"),
    { timeout: 20_000 }
  );
  await page.locator("#go, button[type=submit]").first().click();
  let status = 0;
  try {
    const r = await loginResp;
    status = r.status();
  } catch {
    status = 0;
  }
  if (status === 200) {
    try {
      await page.waitForURL((u) => !/login\.html/.test(u.toString()), { timeout: 15_000 });
      loginOk = true;
    } catch {
      loginOk = false;
    }
  } else {
    await page.waitForTimeout(4000);
  }
}

const session = await page.evaluate(() => ({
  hasToken: !!localStorage.getItem("fh_token"),
  role: localStorage.getItem("fh_role")
}));

let sawCandidates = false;
if (loginOk && session.hasToken) {
  for (let attempt = 1; attempt <= 12; attempt++) {
    const probe = await page.evaluate(async () => {
      const token = localStorage.getItem("fh_token") || "";
      try {
        const r = await fetch("/api/hiring/candidates?state=all&limit=200", {
          headers: { accept: "application/json", authorization: "Bearer " + token }
        });
        let body = null;
        try { body = await r.json(); } catch { body = null; }
        const items = body && body.data && Array.isArray(body.data.items) ? body.data.items : [];
        return { status: r.status, ok: !!(body && body.ok), itemCount: items.length };
      } catch (e) {
        return { status: 0, ok: false, itemCount: 0 };
      }
    });
    if (probe.status === 200 && probe.ok) {
      const candidatesWait = page.waitForResponse(
        (r) => r.url().includes("/api/hiring/candidates") && r.request().method() === "GET",
        { timeout: 20_000 }
      );
      await page.goto(`${BASE}/app/hiring.html`, { waitUntil: "domcontentloaded" });
      try {
        await candidatesWait;
        sawCandidates = true;
      } catch { /* keep going */ }
      await page.waitForFunction(() => {
        const foot = (document.getElementById("footNote") || {}).textContent || "";
        const banner = (document.querySelector("[data-fh-banner], #fh-data-banner, .fh-data-banner") || {}).textContent || "";
        const body = document.body ? document.body.innerText : "";
        const loading = /loading hiring/i.test(foot) || /loading hiring/i.test(banner) || /loading hiring/i.test(body);
        const board = document.getElementById("board");
        return !loading && !!board;
      }, { timeout: 15_000 }).catch(() => false);
      break;
    }
    await page.waitForTimeout(8000);
  }
}

await page.locator("#board").scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(500);

const ui = await page.evaluate(() => {
  const foot = (document.getElementById("footNote") || {}).textContent || "";
  const bannerEl = document.querySelector("[data-fh-banner], #fh-data-banner, .fh-data-banner, [data-fh-note]");
  const banner = bannerEl ? (bannerEl.textContent || "").trim().replace(/\s+/g, " ") : "";
  const board = document.getElementById("board");
  const loadingOnScreen = /loading hiring/i.test(document.body.innerText || "");
  var apps = (typeof APPS !== "undefined" && Array.isArray(APPS)) ? APPS : [];
  return {
    url: location.pathname + location.search,
    title: document.title,
    footNote: foot.trim(),
    banner,
    loadingOnScreen,
    boardChildCount: board ? board.children.length : -1,
    boardCardCount: board ? board.querySelectorAll("[data-app]").length : -1,
    boardTextSample: board ? (board.textContent || "").trim().replace(/\s+/g, " ").slice(0, 240) : "",
    mappedFlags: apps.map(function (a) {
      return { name: a.full_name, flagsIsArray: Array.isArray(a.flags), flagsLength: a.flags ? a.flags.length : null };
    })
  };
});

const shot = path.join(OUT, "hiring-shot.png");
await page.screenshot({ path: shot, fullPage: false });

const flagsLengthError = [...pageErrors, ...consoleErrors].some((t) =>
  /flags\.length|Cannot read properties of null \(reading 'length'\)/i.test(t)
);
const lastHit = [...candidatesHits].reverse().find((h) => h.status === 200 && h.itemCount > 0)
  || [...candidatesHits].reverse().find((h) => h.status === 200)
  || candidatesHits[candidatesHits.length - 1]
  || null;
const crashed = flagsLengthError;
const proved = loginOk && !!(lastHit && lastHit.status === 200) && !crashed && ui.boardCardCount > 0 && /hiring\.html/.test(ui.url || "");

const network = {
  email: EMAIL,
  base: BASE,
  ranAt: new Date().toISOString(),
  loginOk,
  loginPosts,
  session,
  sawCandidatesRequest: sawCandidates,
  candidates: lastHit,
  candidatesHits,
  candidatesHitCount: candidatesHits.length,
  pageErrors,
  consoleErrors,
  flagsLengthPageerror: flagsLengthError,
  ui,
  crashed,
  proved,
  shot: "docs/workflows/e2e-verify-run5-evidence/role-owner/fixed/hiring-shot.png"
};

fs.writeFileSync(path.join(OUT, "hiring-network.json"), JSON.stringify(network, null, 2) + "\n");

await browser.close();

console.log("loginOk", loginOk, "loginPosts", loginPosts.map((x) => x.status).join(","), "candidatesStatus", lastHit && lastHit.status, "proved", proved, "boardCards", ui.boardCardCount, "pageErrors", pageErrors.length);
process.exit(proved ? 0 : 1);

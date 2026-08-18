#!/usr/bin/env node
// Named-fix prove — owner click path on the four CRITICAL rows.
// Password from gitignored .env. Never printed.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const BASE = process.env.BASE_URL || "https://fundhub.ai";
const EMAIL = "owner@fundhub.ai";
const PID = "9defaf28-47c5-43a0-8f5e-f41ef90f360a";
const OUT = path.join(ROOT, "docs/workflows/build-evidence/wl-marketing/live-prove");
fs.mkdirSync(OUT, { recursive: true });

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
const out = {
  when: new Date().toISOString(),
  site: BASE,
  role: "owner",
  email: EMAIL,
  partner_id: PID,
  checks: {}
};

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  return rel(file);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded", timeout: 45_000 });
await page.locator('input[type="email"], #email').first().fill(EMAIL);
await page.locator('input[type="password"], #password').first().fill(password);
await page.locator('button[type="submit"], button:has-text("Sign")').first().click();
await page.waitForURL((u) => !/login\.html/.test(u.pathname), { timeout: 30_000 });
out.login = { ok: true, landed: page.url().replace(BASE, "") };

{
  const rec = {};
  await page.goto(`${BASE}/app/brand-studio.html?partner_id=${PID}`, {
    waitUntil: "domcontentloaded", timeout: 45_000
  });
  await page.waitForTimeout(1800);
  const name = (await page.locator("#bName").inputValue().catch(() => "")).trim();
  const entity = (await page.locator("#bEntity").inputValue().catch(() => "")).trim();
  if (!name && !entity) {
    await page.locator("#bName").fill("TEST White-Label Partner");
  }
  const logoApi = [];
  const onLogo = (res) => {
    if (res.url().includes("generate-logo")) {
      logoApi.push({ method: res.request().method(), status: res.status() });
    }
  };
  page.on("response", onLogo);
  await page.locator("#genLogoBtn").click();
  await page.waitForTimeout(2800);
  page.off("response", onLogo);
  rec.api = logoApi;
  rec.genMsg = (await page.locator("#genMsg").textContent().catch(() => "")).trim();
  rec.suiteOnBtnDisplay = await page.evaluate(() => {
    const el = document.getElementById("suiteOnBtn");
    return el ? getComputedStyle(el).display : null;
  });
  rec.pvH1 = (await page.locator("#pvH1").textContent().catch(() => "")).trim();
  rec.shot = await shot(page, "brand-studio-wordmark.png");
  rec.pass = logoApi.some((x) => x.status === 200)
    && !/not_found/i.test(rec.genMsg)
    && /Wordmark saved/i.test(rec.genMsg);
  out.checks.wordmark = rec;
}

{
  const rec = {};
  await page.goto(`${BASE}/app/social-studio.html?partner_id=${PID}`, {
    waitUntil: "domcontentloaded", timeout: 45_000
  });
  await page.waitForTimeout(2500);
  rec.ui = await page.evaluate(() => ({
    notice: ((document.getElementById("ssNoticeTxt") || {}).textContent || "").trim(),
    oauthMsg: ((document.getElementById("oauthMsg") || {}).textContent || "").trim(),
    queueMsg: ((document.getElementById("queueMsg") || {}).textContent || "").trim(),
    kQueued: ((document.getElementById("kQueued") || {}).textContent || "").trim(),
    nQueued: ((document.getElementById("nQueued") || {}).textContent || "").trim(),
    queueEmpty: ((document.getElementById("tblQueued") || {}).innerText || "").replace(/\s+/g, " ").trim().slice(0, 200),
    picker: document.getElementById("partnerSel") && document.getElementById("partnerSel").selectedOptions[0]
      ? document.getElementById("partnerSel").selectedOptions[0].textContent : ""
  }));
  rec.postsApi = await page.evaluate(async (pid) => {
    const t = localStorage.getItem("fh_token") || "";
    const r = await fetch("/api/social/posts?partner_id=" + encodeURIComponent(pid), {
      headers: { accept: "application/json", authorization: "Bearer " + t }
    });
    const d = await r.json().catch(() => ({}));
    const items = d.items || (d.data && d.data.items) || [];
    return {
      status: r.status,
      count: items.length,
      statuses: items.reduce((a, it) => {
        a[it.status || "unset"] = (a[it.status || "unset"] || 0) + 1;
        return a;
      }, {})
    };
  }, PID);
  rec.shot = await shot(page, "social-studio-queue.png");
  rec.shotConnect = await shot(page, "social-studio-connect.png");
  const lie = /No partner is selected/i.test(rec.ui.oauthMsg)
    || /No partner selected/i.test(rec.ui.queueMsg);
  const queuedN = Number(rec.ui.kQueued);
  rec.pass = !lie && queuedN > 0 && !/Nothing queued/i.test(rec.ui.queueEmpty);
  out.checks.social = rec;
}

{
  const rec = {};
  await page.goto(`${BASE}/app/creative-factory.html?partner_id=${PID}`, {
    waitUntil: "domcontentloaded", timeout: 45_000
  });
  rec.firstPaint = await page.evaluate(() => {
    const btn = document.getElementById("genBtn");
    return {
      genDisabled: btn ? !!btn.disabled : null,
      genMsg: ((document.getElementById("genMsg") || {}).textContent || "").trim(),
      writeChip: ((document.getElementById("cfWriteChipTxt") || {}).textContent || "").trim(),
      banner: ((document.getElementById("scopeChipTxt") || {}).textContent || "").trim()
    };
  });
  rec.shotFirst = await shot(page, "creative-factory-first-paint.png");
  await page.waitForTimeout(2800);
  rec.settled = await page.evaluate(() => {
    const btn = document.getElementById("genBtn");
    const sel = document.getElementById("partnerSel");
    const chip = document.getElementById("scopeChipTxt");
    return {
      genDisabled: btn ? !!btn.disabled : null,
      genMsg: ((document.getElementById("genMsg") || {}).textContent || "").trim(),
      writeChip: ((document.getElementById("cfWriteChipTxt") || {}).textContent || "").trim(),
      useBody: ((document.getElementById("cfUseBody") || {}).innerText || "").replace(/\s+/g, " ").trim().slice(0, 240),
      picker: sel && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : "",
      banner: chip ? chip.textContent : ""
    };
  });
  rec.shotSettled = await shot(page, "creative-factory-settled.png");
  const otherIndex = await page.evaluate(() => {
    const sel = document.getElementById("partnerSel");
    if (!sel || sel.options.length < 2) return null;
    const cur = sel.value;
    for (const o of sel.options) if (o.value !== cur) return o.value;
    return null;
  });
  if (otherIndex != null) {
    await page.selectOption("#partnerSel", String(otherIndex));
    rec.pickerImmediate = await page.evaluate(() => {
      const sel = document.getElementById("partnerSel");
      const chip = document.getElementById("scopeChipTxt");
      const btn = document.getElementById("genBtn");
      return {
        picker: sel && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : "",
        banner: chip ? chip.textContent : "",
        genDisabled: btn ? !!btn.disabled : null,
        writeChip: ((document.getElementById("cfWriteChipTxt") || {}).textContent || "").trim()
      };
    });
    rec.shotPicker = await shot(page, "creative-factory-picker.png");
  }
  rec.pass = rec.firstPaint.genDisabled === true
    && !/budget loads/i.test(rec.settled.genMsg)
    && (!rec.pickerImmediate
      || (rec.pickerImmediate.picker
        && rec.pickerImmediate.banner
        && rec.pickerImmediate.banner.includes(rec.pickerImmediate.picker)
        && rec.pickerImmediate.genDisabled === true));
  out.checks.creative = rec;
}

await browser.close();
fs.writeFileSync(path.join(OUT, "prove.json"), JSON.stringify(out, null, 2));
const fails = Object.entries(out.checks).filter(([, v]) => !v.pass).map(([k]) => k);
console.log(JSON.stringify({
  ok: fails.length === 0,
  fails,
  wordmark: out.checks.wordmark && { pass: out.checks.wordmark.pass, genMsg: out.checks.wordmark.genMsg, api: out.checks.wordmark.api },
  social: out.checks.social && { pass: out.checks.social.pass, kQueued: out.checks.social.ui.kQueued, oauthMsg: out.checks.social.ui.oauthMsg },
  creative: out.checks.creative && {
    pass: out.checks.creative.pass,
    firstDisabled: out.checks.creative.firstPaint.genDisabled,
    settledMsg: out.checks.creative.settled.genMsg,
    picker: out.checks.creative.pickerImmediate
  }
}, null, 2));
process.exit(fails.length ? 1 : 0);

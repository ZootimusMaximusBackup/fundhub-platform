#!/usr/bin/env node
/**
 * Hole 1 FINISH — live click CCP + Fulfillment twice for Sim Fund Horse27.
 * No CRS. No charge. No outbound. Credentials from gitignored .env.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const EVIDENCE = path.join(ROOT, "docs/workflows/e2e-round-2026-08-27-evidence/hole1");
const BASE = "https://fundhub.ai";
const CLIENT_ID = "89f1a12f-f824-4451-9a53-5705b55374ca";
const EXPECTED = { experian: 718, equifax: 724, transunion: 731 };

function loadDotEnv() {
  const candidates = [
    path.join(ROOT, ".env"),
    path.join(ROOT, "..", "fundhub-platform", ".env")
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
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
    return;
  }
  throw new Error(".env missing");
}
loadDotEnv();

function chromiumPath() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const homeCache = path.join(process.env.HOME || "", "Library/Caches/ms-playwright");
  if (!fs.existsSync(homeCache)) return undefined;
  const dirs = fs.readdirSync(homeCache)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  const rels = [
    "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
  ];
  for (const d of dirs) {
    for (const rel of rels) {
      const exe = path.join(homeCache, d, rel);
      if (fs.existsSync(exe)) return exe;
    }
  }
  return undefined;
}

function scoreRun({ ccp, fulfill, apiFacts }) {
  const body = ccp.body_snip || "";
  const checks = {
    status_not_new_lead: !/^New Lead$/i.test(ccp.status || "") && !/\bNew Lead\b/.test(body.slice(0, 800)),
    no_saved_pull_crs: !/Saved on the record:\s*Pull CRS/i.test(body) && !/Saved on the record:\s*Pull CRS/i.test(ccp.saved || ""),
    no_awaiting_crs_hold: !/Awaiting CRS/i.test(ccp.hold || "") && !/Awaiting CRS/i.test(body),
    no_crs_incomplete_ccp: !/CRS incomplete/i.test(ccp.blockers || "") && !/Cannot start funding.*CRS incomplete/i.test(body),
    no_crs_incomplete_fulfill: !/CRS incomplete/i.test((fulfill.horse_blockers || []).join(" ")) && !/CRS incomplete/i.test(fulfill.horse_why || ""),
    scores_ex_718: /718/.test(ccp.scores || "") || /718/.test(ccp.facts_scores || ""),
    scores_eq_724: /724/.test(ccp.scores || "") || /724/.test(ccp.facts_scores || ""),
    scores_tu_731: /731/.test(ccp.scores || "") || /731/.test(ccp.facts_scores || ""),
    next_job_honest: /Apply Now|Apply for Funding|Get Consent|Collect payment|No step applies/i.test(ccp.next || "") ||
      /Apply Now|Apply for Funding|Get Consent/i.test(apiFacts.next_action || "")
  };
  const pass = Object.values(checks).every(Boolean);
  return { pass, checks };
}

async function onePass(page, request, token, passNum) {
  const dashRes = await request.get(`${BASE}/api/dashboard/client?id=${CLIENT_ID}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const dash = await dashRes.json();
  const c = dash.client || {};
  const cf = c.custom_fields || {};
  const tm = dash.tri_merge || {};
  const apiFacts = {
    dash_status: dashRes.status(),
    lifecycle_status: cf.lifecycle_status || null,
    employee_next_action: cf.employee_next_action || null,
    round_hold_reason: cf.round_hold_reason || null,
    next_action: dash.next_action || dash.fulfillment?.next_action || null,
    blockers: dash.active_blockers || dash.open_blockers || dash.fulfillment?.active_blockers || [],
    scores: {
      experian: tm.experian ?? null,
      equifax: tm.equifax ?? null,
      transunion: tm.transunion ?? null
    }
  };

  await page.goto(`${BASE}/app/client-control-panel.html?id=${CLIENT_ID}`, {
    waitUntil: "domcontentloaded"
  });
  await page.waitForFunction(() => {
    const n = document.getElementById("ccp-name");
    return n && /Horse27/i.test(n.textContent || "");
  }, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1800);

  const ccp = await page.evaluate(() => {
    function txt(id) {
      const el = document.getElementById(id);
      return el ? (el.innerText || el.textContent || "").trim() : "";
    }
    const body = document.body ? document.body.innerText : "";
    return {
      status: txt("ccp-status"),
      next: txt("ccp-next-action"),
      saved: txt("ccp-saved"),
      hold: txt("ccp-hold-reason"),
      scores: txt("ccp-scores"),
      facts_scores: txt("ccp-facts-scores"),
      blockers: txt("ccp-blocker-list"),
      body_snip: body.replace(/\s+/g, " ")
    };
  });

  await page.screenshot({
    path: path.join(EVIDENCE, `finish-ccp-${passNum}.png`),
    fullPage: true
  });

  await page.goto(`${BASE}/app/pipeline.html`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const fulfillBtn = page.locator("#lensFulfillment");
  if (await fulfillBtn.count()) await fulfillBtn.click();
  await page.waitForFunction(() => document.querySelectorAll(".fh-lens-row").length > 0, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const fulfill = await page.evaluate((id) => {
    const row = document.querySelector(`.fh-lens-row[data-client-id="${id}"]`);
    return {
      horse_chip: row ? (row.querySelector(".fh-chip")?.textContent || "").trim() : "",
      horse_why: row ? (row.querySelector(".lr-why")?.textContent || "").trim() : "",
      horse_blockers: row
        ? Array.from(row.querySelectorAll(".lr-blocker")).map((el) => (el.textContent || "").trim())
        : [],
      horse_text: row ? (row.innerText || "").trim() : ""
    };
  }, CLIENT_ID);

  if (fulfill.horse_text) {
    await page.locator(`.fh-lens-row[data-client-id="${CLIENT_ID}"]`).first().scrollIntoViewIfNeeded();
  }
  await page.screenshot({
    path: path.join(EVIDENCE, `finish-fulfillment-${passNum}.png`),
    fullPage: true
  });

  const scored = scoreRun({ ccp, fulfill, apiFacts });
  return { passNum, apiFacts, ccp, fulfill, ...scored };
}

async function main() {
  const password = process.env.STAFF_E2E_PASSWORD;
  if (!password) throw new Error("STAFF_E2E_PASSWORD missing");

  fs.mkdirSync(EVIDENCE, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    executablePath: chromiumPath()
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const request = context.request;

  const loginRes = await request.post(`${BASE}/api/auth/login`, {
    data: { email: "chris@fundhub.ai", password }
  });
  const loginBody = await loginRes.json();
  const token = loginBody.token;
  if (!token) {
    console.log(JSON.stringify({ login_ok: false, status: loginRes.status() }));
    await browser.close();
    process.exit(1);
  }

  const page = await context.newPage();
  await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => {
    localStorage.removeItem("fh_demo");
    localStorage.removeItem("fh_demo_staff");
    localStorage.setItem("fh_token", t);
    localStorage.setItem("fh_session", t);
  }, token);

  const pass1 = await onePass(page, request, token, 1);
  await page.waitForTimeout(2000);
  const pass2 = await onePass(page, request, token, 2);

  const out = {
    at: new Date().toISOString(),
    deploy: "6a8fef6bf97d0720eda373e4",
    expected_scores: EXPECTED,
    pass1: { pass: pass1.pass, checks: pass1.checks, ccp: pass1.ccp, fulfill: pass1.fulfill },
    pass2: { pass: pass2.pass, checks: pass2.checks, ccp: pass2.ccp, fulfill: pass2.fulfill },
    overall: pass1.pass && pass2.pass ? "PASS" : "FAIL"
  };

  fs.writeFileSync(path.join(EVIDENCE, "finish.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({
    overall: out.overall,
    pass1: { pass: pass1.pass, status: pass1.ccp.status, next: pass1.ccp.next, checks: pass1.checks },
    pass2: { pass: pass2.pass, status: pass2.ccp.status, next: pass2.ccp.next, checks: pass2.checks }
  }, null, 2));

  await browser.close();
  process.exit(out.overall === "PASS" ? 0 : 1);
}

main().catch((err) => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});

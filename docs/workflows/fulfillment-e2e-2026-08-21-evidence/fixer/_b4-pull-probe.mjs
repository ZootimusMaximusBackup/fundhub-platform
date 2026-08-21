#!/usr/bin/env node
/** B4 probe: click Pull TransUnion on live CCP. Plus-tag only. Never 9af65808. No simulate. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadEnv, BASE, openDb, q, guardClient, launchBrowser, staffLogin } from "../_lib.mjs";

loadEnv();
const HERE = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(HERE, "shots/_raw"), { recursive: true });
mkdirSync(join(HERE, "shots"), { recursive: true });

const CLIENT = process.env.B4_CLIENT_ID || "a7a383e0-eb07-4ac1-8318-b09c889e9230";
guardClient(CLIENT);

function applyMarks(name, legend, boxes) {
  const man = join(HERE, "shot-marks.json");
  let cur = {};
  if (existsSync(man)) {
    try { cur = JSON.parse(readFileSync(man, "utf8")); } catch { cur = {}; }
  }
  cur[`${name}.png`] = {
    legend,
    marks: (boxes || []).filter((b) => b.box).map((b, i) => ({
      n: b.n || String(i + 1), caption: b.caption, box: b.box
    }))
  };
  writeFileSync(man, JSON.stringify(cur, null, 2));
  const py = join(HERE, "_apply-marks.py");
  if (existsSync(py)) spawnSync("python3", [py], { cwd: HERE, stdio: "ignore" });
}

const db = await openDb();
const browser = await launchBrowser();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const reqs = [];
const resps = [];
page.on("request", (r) => {
  if (/crs-pull|soft-pull/.test(r.url())) reqs.push({ method: r.method(), url: r.url().replace(BASE, "") });
});
page.on("response", async (res) => {
  if (!/crs-pull|soft-pull/.test(res.url())) return;
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  resps.push({
    status: res.status(),
    url: res.url().replace(BASE, ""),
    ok: body?.ok ?? null,
    code: body?.code || null,
    error: typeof body?.error === "string" ? body.error.slice(0, 120) : null,
    message: typeof body?.message === "string" ? body.message.slice(0, 160) : null
  });
});

const proof = { started: new Date().toISOString(), client_id: CLIENT };
try {
  await staffLogin(page);
  await page.goto(`${BASE}/app/client-control-panel.html?client_id=${CLIENT}`, {
    waitUntil: "domcontentloaded", timeout: 60000
  });
  await page.waitForTimeout(3500);
  const btn = page.locator("#ccp-pull-tu").first();
  proof.disabled = await btn.isDisabled().catch(() => null);
  proof.visible = await btn.isVisible().catch(() => null);
  proof.box = await btn.boundingBox().catch(() => null);
  const box = proof.box;
  await page.screenshot({ path: join(HERE, "shots/_raw/b4-pull-1440.png"), fullPage: false });
  applyMarks("b4-pull-1440", "B4 Pull TransUnion", [
    { n: "1", caption: "Pull TransUnion", box: box ? { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) } : null }
  ]);
  let clickErr = null;
  await page.keyboard.press("Escape").catch(() => {});
  try {
    await btn.click({ timeout: 8000 });
  } catch (e) {
    clickErr = String(e.message || e).slice(0, 300);
    await btn.evaluate((el) => el.click());
    clickErr += " | evaluate-click";
  }
  proof.click_err = clickErr;
  await page.waitForTimeout(6000);
  proof.reqs = reqs;
  proof.resps = resps;
  proof.status_line = await page.locator("#ccp-issue-ir-status").innerText().catch(() => "");
  proof.consent_line = await page.locator("#ccp-consent-state").innerText().catch(() => "");
  proof.identity_line = await page.locator("#ccp-identity-state").innerText().catch(() => "");
  proof.posted = reqs.some((r) => r.method === "POST" && /crs-pull/.test(r.url));
  proof.honest_error = !!(resps[0] && resps[0].status >= 400 && (resps[0].code || resps[0].error));
  const crs = await q(db, `SELECT id FROM crs_results WHERE client_id = $1::uuid LIMIT 1`, [CLIENT]);
  proof.crs_row = crs.length > 0;
  delete proof.box;
  proof.pass = !!(proof.posted && proof.honest_error);
  proof.shots = ["fixer/shots/b4-pull-1440-MARKED.png"];
  await page.screenshot({ path: join(HERE, "shots/_raw/b4-pull-after-1440.png"), fullPage: false });
} catch (err) {
  proof.error = String(err && err.message ? err.message : err).slice(0, 500);
} finally {
  proof.finished = new Date().toISOString();
  writeFileSync(join(HERE, "b4-pull.json"), JSON.stringify(proof, null, 2));
  await browser.close().catch(() => {});
  await db.end().catch(() => {});
}
console.log(JSON.stringify({
  pass: proof.pass,
  posted: proof.posted,
  resps: proof.resps,
  status_line: proof.status_line,
  click_err: proof.click_err,
  error: proof.error || null
}, null, 2));
if (!proof.pass) process.exit(2);

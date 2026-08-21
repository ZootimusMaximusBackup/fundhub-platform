#!/usr/bin/env node
/**
 * B3 — human click Send agreement + pay link on Present S-23.
 * Serves local present.js so the click actually POSTs. Live APIs.
 * Plus-tag client only. Never 9af65808.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  loadEnv, BASE, FORBIDDEN, openDb, q, guardClient, launchBrowser, staffLogin
} from "../_lib.mjs";

loadEnv();
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../../..");
const RAW = join(HERE, "shots/_raw");
mkdirSync(RAW, { recursive: true });
mkdirSync(join(HERE, "shots"), { recursive: true });

const CLIENT = process.env.B3_CLIENT_ID || "4b659a62-5b85-4294-ad3d-24ac81e0de72";
guardClient(CLIENT);
if (String(CLIENT).startsWith("9af65808")) throw new Error("forbidden");

const presentJs = readFileSync(join(ROOT, "public/app/present.js"));

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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const net = [];
page.on("response", async (res) => {
  const u = res.url();
  if (!/\/api\/(closer-deck|payment-links)/.test(u)) return;
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  net.push({
    url: u.replace(/^https:\/\/fundhub\.ai/, ""),
    status: res.status(),
    method: res.request().method(),
    action: body?.action || null,
    ok: body?.ok ?? null,
    error: body?.error || body?.code || null,
    has_checkout: !!(body?.checkout_url || body?.link?.checkout_url || body?.payment_link?.checkout_url)
  });
});

const proof = { started: new Date().toISOString(), client_id: CLIENT, forbidden_touched: false };

try {
  await page.route("**/app/present.js", (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: presentJs
  }));

  await staffLogin(page);

  await page.goto(`${BASE}/app/present.html?contact=${encodeURIComponent(CLIENT)}`, {
    waitUntil: "domcontentloaded", timeout: 60000
  });
  await page.waitForTimeout(4000);

  const phase07 = page.locator('[data-act="phase:07"]').first();
  if (await phase07.count()) await phase07.click();
  await page.waitForTimeout(800);
  if (!(await page.getByText("Send agreement + pay link").count())) {
    for (let i = 0; i < 30; i++) {
      if (await page.getByText("Send agreement + pay link").count()) break;
      const next = page.locator("button").filter({ hasText: /Next screen/i }).first();
      if (await next.isEnabled().catch(() => false)) await next.click().catch(() => {});
      else await page.keyboard.press("ArrowRight").catch(() => {});
      await page.waitForTimeout(200);
    }
  }

  const motion = page.locator("#fh-sale-motion");
  if (await motion.count()) {
    await motion.selectOption("downsell").catch(() => {});
  }

  const payBtn = page.locator('[data-act="pay"]').first();
  const payBox = await payBtn.boundingBox().catch(() => null);
  const raw = join(RAW, "b3-s23-1440.png");
  await page.screenshot({ path: raw, fullPage: false });
  applyMarks("b3-s23-1440", "B3 Present S-23 pay link", [
    { n: "1", caption: "Send agreement + pay link", box: payBox ? { x: Math.round(payBox.x), y: Math.round(payBox.y), w: Math.round(payBox.width), h: Math.round(payBox.height) } : null }
  ]);

  await payBtn.click({ timeout: 8000 });
  await page.waitForTimeout(6000);

  const afterRaw = join(RAW, "b3-s23-after-1440.png");
  await page.screenshot({ path: afterRaw, fullPage: false });
  applyMarks("b3-s23-after-1440", "B3 after pay click", [
    { n: "1", caption: "After Send agreement + pay link", box: payBox }
  ]);

  const links = await q(db, `SELECT id, checkout_url, status, created_at
     FROM payment_links WHERE client_id = $1::uuid
     ORDER BY created_at DESC LIMIT 5`, [CLIENT]);

  proof.net = net;
  proof.posted = net.some((n) => n.method === "POST" && /closer-deck/.test(n.url));
  proof.links = links.map((l) => ({
    id: l.id,
    has_checkout_url: !!(l.checkout_url && String(l.checkout_url).startsWith("http")),
    status: l.status,
    created_at: l.created_at
  }));
  proof.pass = !!(proof.posted && proof.links.some((l) => l.has_checkout_url));
  proof.shots = ["fixer/shots/b3-s23-1440-MARKED.png"];
} catch (err) {
  proof.error = String(err && err.message ? err.message : err).slice(0, 500);
  proof.pass = false;
} finally {
  proof.finished = new Date().toISOString();
  writeFileSync(join(HERE, "b3-pay-link.json"), JSON.stringify(proof, null, 2));
  await browser.close().catch(() => {});
  await db.end().catch(() => {});
}

console.log(JSON.stringify({
  pass: proof.pass,
  posted: proof.posted,
  net: proof.net,
  links: (proof.links || []).length,
  error: proof.error || null
}));
if (!proof.pass) process.exit(2);

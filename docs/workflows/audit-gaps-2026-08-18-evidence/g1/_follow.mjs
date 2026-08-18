#!/usr/bin/env node
// G1 follow — expand nav groups, re-prove Brand save after hydrate,
// Social queue/discard, Creative enqueue card. No enable flip. No vendor send.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const BASE = process.env.BASE_URL || "https://fundhub.ai";
const EMAIL = "partner@fundhub.ai";
const OUT = path.join(ROOT, "docs/workflows/audit-gaps-2026-08-18-evidence/g1");
const SHOTS = path.join(OUT, "shots");
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
  console.error("STAFF_E2E_PASSWORD missing");
  process.exit(2);
}

const rel = (p) => path.relative(ROOT, p);
const follow = { when: new Date().toISOString(), nav: {}, brand: {}, social: {}, creative: {}, http: [] };
const apiLog = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("response", (res) => {
  const u = res.url();
  if (!u.includes("/api/") && !u.includes("/sites/")) return;
  apiLog.push({
    method: res.request().method(),
    url: u.replace(BASE, "").replace(/^https?:\/\/[^/]+/, "").slice(0, 220),
    status: res.status()
  });
});

await ctx.route("**/api/**", async (route) => {
  const req = route.request();
  const u = req.url();
  const method = req.method();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return route.continue();
  if (/\/api\/auth\/login(\?|$)/.test(u)) return route.continue();
  if (/\/api\/partner-marketing\/enable(\?|$)/.test(u)) {
    return route.fulfill({ status: 599, contentType: "application/json", body: JSON.stringify({ ok: false, error: "audit_blocked_enable" }) });
  }
  if (/\/api\/social\/oauth|\/api\/social\/publish|\/api\/creative\/(run|generate)/.test(u)) {
    return route.fulfill({ status: 599, contentType: "application/json", body: JSON.stringify({ ok: false, error: "audit_blocked_vendor_or_send" }) });
  }
  return route.continue();
});

async function shot(name) {
  const p = path.join(SHOTS, name);
  await page.screenshot({ path: p });
  return rel(p);
}

await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
await page.locator('#email, input[type="email"]').first().fill(EMAIL);
await page.locator('#pw, input[type="password"]').first().fill(password);
await page.locator('#go, button[type="submit"]').first().click();
await page.waitForURL((u) => !/login\.html/.test(u.toString()), { timeout: 30000 });
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(2000);

// Expand every nav group, then list visible rows
await page.evaluate(() => {
  document.querySelectorAll("#fh-side-nav .navhead, aside .navhead").forEach((b) => {
    const group = b.closest(".navgroup");
    const list = group && group.querySelector(".navlist");
    const hidden = list && (getComputedStyle(list).display === "none" || list.getBoundingClientRect().height < 4);
    if (hidden) b.click();
  });
});
await page.waitForTimeout(400);
follow.nav.afterExpandShot = await shot("80-nav-expanded.png");
follow.nav.visible = await page.evaluate(() => {
  return [...document.querySelectorAll("#fh-side-nav a.navitem")].map((a) => {
    const r = a.getBoundingClientRect();
    const cs = getComputedStyle(a);
    const visible = r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
    return { href: a.getAttribute("href"), label: (a.textContent || "").trim().replace(/\s+/g, " "), visible };
  }).filter((x) => x.visible);
});

follow.nav.opens = [];
let n = 81;
for (const row of follow.nav.visible) {
  const target = row.href.startsWith("/") ? row.href : "/app/" + row.href;
  const resp = await page.goto(BASE + target, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);
  const finalUrl = page.url().replace(BASE, "");
  const leaf = target.split("/").pop();
  follow.nav.opens.push({
    label: row.label,
    asked: target,
    httpStatus: resp ? resp.status() : null,
    finalUrl,
    bounced: !finalUrl.includes(leaf),
    verdict: finalUrl.includes(leaf) ? "OPEN" : "BOUNCE",
    shot: await shot(`${n}-${leaf.replace(/[^a-z0-9.-]/gi, "_")}.png`)
  });
  n += 1;
}

// Brand — wait for hydrate, read real values, save again
{
  await page.goto(`${BASE}/app/brand-studio.html`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2500);
  follow.brand.fields = await page.evaluate(() => {
    const read = (id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      return { value: el.value || "", placeholder: el.getAttribute("placeholder") || "" };
    };
    return {
      name: read("bName"),
      entity: read("bEntity"),
      addr: read("bAddr"),
      email: read("bEmail"),
      domain: read("bDomain") || read("domain"),
      saveMsg: (document.getElementById("saveMsg") || {}).textContent || "",
      draftEntity: window.D && window.D.entity,
      draftName: window.D && window.D.name
    };
  });
  const token = await page.evaluate(() => localStorage.getItem("fh_token"));
  const pid = await page.evaluate(() => window.__fhBrandPartnerId || null);
  const brandGet = await page.request.get(BASE + "/api/partner-brand?partner_id=" + encodeURIComponent(pid || ""), {
    headers: { accept: "application/json", authorization: "Bearer " + token }
  });
  follow.brand.partnerBrandHttp = brandGet.status();
  const brandBody = await brandGet.json().catch(() => ({}));
  follow.brand.partnerBrandOk = brandBody.ok;
  follow.brand.partnerBrandEntity = brandBody.brand && brandBody.brand.entity_name;
  follow.brand.partnerBrandError = brandBody.error || brandBody.message || null;
  const before = apiLog.length;
  await page.locator("#saveBtn").click();
  await page.waitForTimeout(2000);
  follow.brand.saveMsg = await page.locator("#saveMsg").innerText().catch(() => "");
  follow.brand.saveApi = apiLog.slice(before).filter((x) => /partner-brand|org-brand/.test(x.url));
  follow.brand.shot = await shot("85-brand-save-retry.png");
  follow.brand.generationShot = await shot("86-brand-generation.png");
  await page.locator("#bsGenCard").scrollIntoViewIfNeeded().catch(() => {});
  follow.brand.generationInView = await shot("87-brand-generation-inview.png");
  await page.evaluate(() => {
    const el = document.querySelector("[data-pub], button");
    const pub = [...document.querySelectorAll("button")].find((b) => /^Publish$/i.test((b.textContent || "").trim()));
    if (pub) pub.scrollIntoView();
  });
  follow.brand.publishShot = await shot("88-brand-publish.png");
}

// Social — queue attempt (no publish), discard search, connect text
{
  await page.goto(`${BASE}/app/social-studio.html`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1800);
  follow.social.connectBox = await page.locator("#oauthConnectBox").innerText().catch(() => null);
  follow.social.emptyAccounts = await page.locator("#chGrid").innerText().catch(() => null);
  follow.social.queue = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("tr[data-row]")].map((tr) => (tr.innerText || "").replace(/\s+/g, " ").trim().slice(0, 180));
    const discard = [...document.querySelectorAll("button, a")].filter((el) =>
      /throw|discard|delete|remove/i.test(el.textContent || "")
    ).map((el) => (el.textContent || "").trim());
    return {
      waitingText: (document.body.innerText || "").match(/Waiting \(\d+\)/)?.[0] || null,
      rows,
      discardLike: discard,
      queueDisabled: !!(document.getElementById("queueBtn") || {}).disabled,
      channelValue: (document.getElementById("cChannel") || {}).value || "",
      channelText: (document.getElementById("cChannel") && document.getElementById("cChannel").selectedOptions[0])
        ? document.getElementById("cChannel").selectedOptions[0].textContent
        : ""
    };
  });
  await page.locator("#composer").scrollIntoViewIfNeeded().catch(() => {});
  follow.social.composerShot = await shot("89-social-composer.png");
  await page.locator("#cCaption").fill("G1 audit draft — do not send. Checking whether queue works.");
  await page.locator("#cOffer").selectOption("funding").catch(() => {});
  const qBefore = apiLog.length;
  await page.locator("#queueBtn").click();
  await page.waitForTimeout(1500);
  follow.social.queueMsg = await page.locator("#queueMsg").innerText().catch(() => "");
  follow.social.queueApi = apiLog.slice(qBefore);
  follow.social.afterQueueShot = await shot("90-social-after-queue.png");
  await page.evaluate(() => {
    const box = document.getElementById("oauthConnectBox");
    if (box) box.scrollIntoView();
  });
  follow.social.connectShot = await shot("91-social-connect-box.png");
}

// Creative — locate generate card
{
  await page.goto(`${BASE}/app/creative-factory.html`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1800);
  follow.creative.generate = await page.evaluate(() => {
    const btn = document.getElementById("genBtn");
    const run = document.getElementById("runJobsBtn");
    const card = btn && btn.closest(".card");
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        text: (el.textContent || "").trim().slice(0, 80),
        disabled: !!el.disabled,
        display: cs.display,
        visibility: cs.visibility,
        w: Math.round(r.width),
        h: Math.round(r.height),
        y: Math.round(r.y)
      };
    };
    return {
      btn: box(btn),
      run: box(run),
      cardDisplay: card ? getComputedStyle(card).display : null,
      cardH: card ? Math.round(card.getBoundingClientRect().height) : null,
      cardText: card ? (card.innerText || "").replace(/\s+/g, " ").trim().slice(0, 300) : null,
      usage: (document.getElementById("cfUseBody") || {}).innerText || ""
    };
  });
  const btn = page.locator("#genBtn");
  if (await btn.count()) {
    await btn.scrollIntoViewIfNeeded().catch(() => {});
  }
  follow.creative.enqueueShot = await shot("92-creative-enqueue.png");
  follow.creative.didNotClickEnqueue = true;
}

follow.http = apiLog.slice(0, 250);
fs.writeFileSync(path.join(OUT, "follow.json"), JSON.stringify(follow, null, 2));
await browser.close();
console.log("follow done. visible nav:", follow.nav.visible.map((x) => x.label).join(" | "));
console.log("brand save:", follow.brand.saveMsg);
console.log("social queue:", follow.social.queueMsg);
console.log("creative gen:", JSON.stringify(follow.creative.generate && follow.creative.generate.btn));

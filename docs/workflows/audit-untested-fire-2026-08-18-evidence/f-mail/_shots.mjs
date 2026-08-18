// Open the issued magic-link as the client. Staff-open is extra only.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-fire-2026-08-18-evidence/f-mail");
const TEST = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const LIVE = "9af65808-a619-4e65-ae91-239766a006b7";
const BASE = "https://fundhub.ai";

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
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

function dump(name, obj) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 2) + "\n");
}

loadDotEnv();
const password = process.env.STAFF_E2E_PASSWORD || "";
if (!password) throw new Error("STAFF_E2E_PASSWORD missing");

const linkPath = "/tmp/f-mail-magic-link.txt";
if (!fs.existsSync(linkPath)) throw new Error("magic link file missing");
const link = fs.readFileSync(linkPath, "utf8").trim();
const u = new URL(link);
if (u.host !== "fundhub.ai") throw new Error("unexpected host");
if (u.pathname !== "/portal-login.html") throw new Error("unexpected path");
if (!u.searchParams.get("t")) throw new Error("no token");

const browser = await chromium.launch({ headless: true });
const clientCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await clientCtx.newPage();

let verifyHttp = null;
page.on("response", async (res) => {
  if (/\/api\/auth\/magic-link-verify/.test(res.url()) && res.request().method() === "POST") {
    const j = await res.json().catch(() => ({}));
    verifyHttp = {
      status: res.status(),
      ok: j.ok === true,
      kind: j.principal?.kind || j.account?.kind || null,
      client_id: j.principal?.clientId || j.principal?.client_id || j.account?.client_id || null
    };
  }
});

await page.goto(link, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(5000);

if (verifyHttp && verifyHttp.client_id === LIVE) {
  dump("15-portal.json", { stopped: "resolved_to_live_file", verifyHttp });
  await browser.close();
  throw new Error("magic-link resolved to live file");
}

const finalUrl = page.url();
const me = await page.evaluate(async () => {
  const r = await fetch("/api/me", { credentials: "include" });
  const j = await r.json().catch(() => ({}));
  return {
    status: r.status,
    kind: j.kind || j.principal?.kind || null,
    client_id: j.client_id || j.principal?.clientId || j.account?.client_id || null
  };
}).catch(() => null);

const bodyText = await page.evaluate(() => (document.body && document.body.innerText || "").slice(0, 8000));
const hasVideo = await page.locator("video, iframe").count();
const entitlements = /live entitlements · (\d+) unlocked · (\d+) locked/.exec(bodyText);
const disputeText = /You already signed|Sign to authorize dispute|I sign to authorize/i.exec(bodyText);

await page.screenshot({ path: path.join(OUT, "01-file-paint.png"), fullPage: true });
const hero = page.locator("#video-empty, video, .hero, .welcome").first();
if (await hero.count()) {
  await hero.screenshot({ path: path.join(OUT, "02-hero-video.png") }).catch(async () => {
    await page.screenshot({ path: path.join(OUT, "02-hero-video.png") });
  });
} else {
  await page.screenshot({ path: path.join(OUT, "02-hero-video.png") });
}

const ent = page.locator("text=/live entitlements/i").first();
if (await ent.count()) {
  await ent.screenshot({ path: path.join(OUT, "03-entitlements.png") }).catch(async () => {
    await page.screenshot({ path: path.join(OUT, "03-entitlements.png") });
  });
} else {
  await page.screenshot({ path: path.join(OUT, "03-entitlements.png") });
}

const dispute = page.locator("#dispute-auth-card, #dispute-auth-title").first();
if (await dispute.count()) {
  await dispute.screenshot({ path: path.join(OUT, "04-dispute-card.png") }).catch(async () => {
    await page.screenshot({ path: path.join(OUT, "04-dispute-card.png") });
  });
} else {
  await page.screenshot({ path: path.join(OUT, "04-dispute-card.png") });
}

const portal = {
  opened_magic_link: true,
  staff_open: false,
  final_path: (() => { try { return new URL(finalUrl).pathname; } catch { return null; } })(),
  verifyHttp,
  me,
  is_test: (verifyHttp && verifyHttp.client_id === TEST) || (me && me.client_id === TEST),
  is_live: (verifyHttp && verifyHttp.client_id === LIVE) || (me && me.client_id === LIVE),
  is_client_kind: (verifyHttp && verifyHttp.kind === "client") || (me && me.kind === "client"),
  saw_welcome_back_test: /Welcome back,\s*TEST/i.test(bodyText),
  saw_could_not_load: /could not load your file/i.test(bodyText),
  hero_empty: /Welcome video is not available/i.test(bodyText),
  video_or_iframe_count: hasVideo,
  entitlements_unlocked: entitlements ? Number(entitlements[1]) : null,
  entitlements_locked: entitlements ? Number(entitlements[2]) : null,
  dispute_match: disputeText ? disputeText[0] : null,
  did_not_press_sign: true
};
dump("15-portal.json", portal);

const staffCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const staff = await staffCtx.newPage();
await staff.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
await staff.locator('input[type="email"], #email, input[name="email"]').first().fill("chris@fundhub.ai");
await staff.locator('input[type="password"], #password, input[name="password"]').first().fill(password);
await staff.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
await staff.waitForURL((url) => !/login\.html/i.test(url.href), { timeout: 30000 }).catch(() => {});
await staff.goto(`${BASE}/app/messaging.html?client_id=${TEST}`, { waitUntil: "domcontentloaded", timeout: 45000 });
await staff.waitForTimeout(4000);
const staffText = await staff.evaluate(() => (document.body && document.body.innerText || "").slice(0, 8000));
const staffUrl = staff.url();
await staff.screenshot({ path: path.join(OUT, "05-staff-messaging.png"), fullPage: true });
dump("16-staff-messaging.json", {
  url_has_test_id: staffUrl.includes(TEST),
  url_has_live_id: staffUrl.includes(LIVE),
  saw_fire_reply: /e2e fire reply/i.test(staffText),
  saw_stop: /\bSTOP\b/.test(staffText),
  saw_thread_subject: /e2e fire thread/i.test(staffText),
  saw_test_name: /\bTEST\b/.test(staffText)
});

await browser.close();
console.log(JSON.stringify({
  portal_is_test: portal.is_test,
  portal_is_live: portal.is_live,
  portal_kind_client: portal.is_client_kind,
  entitlements: portal.entitlements_unlocked == null ? null : `${portal.entitlements_unlocked}/${portal.entitlements_unlocked + portal.entitlements_locked}`,
  staff_saw_reply: /e2e fire reply/i.test(staffText)
}));

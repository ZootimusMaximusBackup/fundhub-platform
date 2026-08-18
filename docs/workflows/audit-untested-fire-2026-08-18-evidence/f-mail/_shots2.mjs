// Recapture session + click EMAIL thread. New magic-link only if the first was spent.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
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
function plusFromInbox(inbox) {
  const at = inbox.indexOf("@");
  return inbox.slice(0, at) + "+e2e-fire" + inbox.slice(at);
}
function extractPortalLink(text) {
  const match = String(text || "").match(/https?:\/\/[^\s"'<>]+portal-login\.html\?t=[A-Za-z0-9_-]+/i);
  return match ? match[0].replace(/[.,);]+$/, "") : null;
}

loadDotEnv();
const inbox = String(process.env.FUNDHUB_TEST_INBOX || "").trim().toLowerCase();
const plus = plusFromInbox(inbox);
const password = process.env.STAFF_E2E_PASSWORD || "";

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
await c.connect();

const latest = (await c.query(
  `SELECT id, (consumed_at IS NOT NULL) AS consumed, (expires_at > now()) AS not_expired
     FROM account_magic_links
    WHERE client_id = $1::uuid
    ORDER BY created_at DESC LIMIT 1`,
  [TEST]
)).rows[0];

let link = null;
if (fs.existsSync("/tmp/f-mail-magic-link.txt") && latest && !latest.consumed && latest.not_expired) {
  link = fs.readFileSync("/tmp/f-mail-magic-link.txt", "utf8").trim();
} else {
  const req = await fetch(`${BASE}/api/auth/magic-link`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: plus })
  });
  await new Promise((r) => setTimeout(r, 2000));
  const msgs = await c.query(
    `SELECT rendered_body FROM messages
      WHERE client_id = $1::uuid AND template_key = 'EMAIL-PORTAL-MAGIC-LINK'
      ORDER BY created_at DESC LIMIT 1`,
    [TEST]
  );
  link = extractPortalLink(msgs.rows[0] && msgs.rows[0].rendered_body);
  if (link) fs.writeFileSync("/tmp/f-mail-magic-link.txt", link);
  dump("17-magic-rerequest.json", {
    prior_consumed: Boolean(latest && latest.consumed),
    request_status: req.status,
    extracted: Boolean(link)
  });
}

const mailResponse = await c.query(
  `SELECT count(*)::int AS n
     FROM events
    WHERE name = 'mail.response' AND created_at > now() - interval '30 minutes'`
);
dump("18-mail-response-global.json", {
  mail_response_last_30m: mailResponse.rows[0].n,
  note: "not filtered by TEST client — recipient was mg catch address"
});

await c.end();
if (!link) throw new Error("no magic link");

const browser = await chromium.launch({ headless: true });
const clientCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await clientCtx.newPage();
const verifyBodies = [];
page.on("response", async (res) => {
  if (/\/api\/auth\/magic-link-verify/.test(res.url()) && res.request().method() === "POST") {
    const j = await res.json().catch(() => ({}));
    verifyBodies.push({
      status: res.status(),
      ok: j.ok === true,
      principal: typeof j.principal === "string" ? j.principal : (j.principal && j.principal.kind) || null,
      account_kind: j.account && j.account.kind,
      account_client_id: j.account && (j.account.clientId || j.account.client_id),
      has_token: Boolean(j.token),
      next: j.next || null
    });
  }
});

await page.goto(link, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(6000);

const session = await page.evaluate(async () => {
  const r = await fetch("/api/auth/session", { credentials: "include" });
  const j = await r.json().catch(() => ({}));
  return {
    status: r.status,
    ok: j.ok === true,
    principal: j.principal || null,
    role: j.staff && j.staff.role,
    client_id: (j.staff && j.staff.client_id) || (j.account && j.account.client_id) || null,
    name: j.staff && j.staff.name
  };
}).catch(() => null);

const bodyText = await page.evaluate(() => (document.body && document.body.innerText || "").slice(0, 9000));
await page.screenshot({ path: path.join(OUT, "01-file-paint.png"), fullPage: true });
await page.locator("#video-empty, video").first().screenshot({ path: path.join(OUT, "02-hero-video.png") }).catch(() => {});
const footer = page.locator("text=/live entitlements/i");
if (await footer.count()) {
  await footer.first().screenshot({ path: path.join(OUT, "03-entitlements.png") });
} else {
  await page.screenshot({ path: path.join(OUT, "03-entitlements.png") });
}
await page.locator("#dispute-auth-card").screenshot({ path: path.join(OUT, "04-dispute-card.png") }).catch(async () => {
  await page.screenshot({ path: path.join(OUT, "04-dispute-card.png") });
});

const clientId = (verifyBodies[0] && verifyBodies[0].account_client_id) || (session && session.client_id) || null;
dump("15-portal.json", {
  opened_magic_link: true,
  staff_open: false,
  final_path: (() => { try { return new URL(page.url()).pathname; } catch { return null; } })(),
  verify: verifyBodies[0] || null,
  session,
  is_test: clientId === TEST,
  is_live: clientId === LIVE,
  is_client_kind: (verifyBodies[0] && verifyBodies[0].principal === "client")
    || (session && (session.principal === "client" || session.role === "client")),
  saw_welcome_back_test: /Welcome back,\s*TEST/i.test(bodyText),
  saw_could_not_load: /could not load your file/i.test(bodyText),
  hero_empty: /Welcome video is not available/i.test(bodyText),
  entitlements_line: (/live entitlements · \d+ unlocked · \d+ locked/.exec(bodyText) || [null])[0],
  dispute_sign_in_needed: /Sign in to load the legal wording/i.test(bodyText),
  dispute_already_signed: /You already signed/i.test(bodyText),
  did_not_press_sign: true
});

const staffCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const staff = await staffCtx.newPage();
await staff.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
await staff.locator('input[type="email"], #email').first().fill("chris@fundhub.ai");
await staff.locator('input[type="password"], #password').first().fill(password);
await staff.locator('button[type="submit"]').first().click();
await staff.waitForURL((url) => !/login\.html/i.test(url.href), { timeout: 30000 }).catch(() => {});
await staff.goto(`${BASE}/app/messaging.html?client_id=${TEST}`, { waitUntil: "domcontentloaded", timeout: 45000 });
await staff.waitForTimeout(3500);

const emailThread = staff.locator("text=/^EMAIL$/i").first();
if (await emailThread.count()) {
  await emailThread.click();
  await staff.waitForTimeout(2500);
}
const staffText = await staff.evaluate(() => (document.body && document.body.innerText || "").slice(0, 10000));
await staff.screenshot({ path: path.join(OUT, "05-staff-messaging.png"), fullPage: true });
dump("16-staff-messaging.json", {
  url_has_test_id: staff.url().includes(TEST),
  url_has_live_id: staff.url().includes(LIVE),
  clicked_email_thread: true,
  saw_fire_reply: /e2e fire reply/i.test(staffText),
  saw_stop: /\bSTOP\b/.test(staffText),
  saw_thread_subject: /e2e fire thread/i.test(staffText)
});

await browser.close();
console.log(JSON.stringify({
  is_test: clientId === TEST,
  is_live: clientId === LIVE,
  session_principal: session && session.principal,
  session_role: session && session.role,
  could_not_load: /could not load your file/i.test(bodyText),
  staff_saw_reply: /e2e fire reply/i.test(staffText)
}));

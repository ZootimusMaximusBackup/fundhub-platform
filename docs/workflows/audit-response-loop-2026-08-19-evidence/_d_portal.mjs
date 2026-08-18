// Portal chat as the sim client via a real magic-link row. Never uses bare inbox.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-response-loop-2026-08-19-evidence");
const SHOTS = path.join(OUT, "shots");
const DUMPS = path.join(OUT, "dumps");
const BASE = "https://fundhub.ai";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";
const session = JSON.parse(fs.readFileSync("/tmp/p3-response-loop-session.json", "utf8"));

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadDotEnv();
const PASSWORD = process.env.STAFF_E2E_PASSWORD || "";
const INBOX = String(process.env.FUNDHUB_TEST_INBOX || "").trim().toLowerCase();

function chromeExe() {
  const home = process.env.HOME || "";
  const root = path.join(home, "Library/Caches/ms-playwright");
  if (!fs.existsSync(root)) return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    const exe = path.join(root, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (fs.existsSync(exe)) return exe;
  }
  return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
}

function db() {
  return new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
}
async function query(sql, params = []) {
  const c = db();
  await c.connect();
  try { return (await c.query(sql, params)).rows; }
  finally { await c.end(); }
}

async function main() {
  if (session.client_id === FORBIDDEN) throw new Error("forbidden");
  const client = (await query(
    `SELECT id, lower(email) AS email, is_demo FROM clients WHERE id = $1`,
    [session.client_id]
  ))[0];
  if (!client || client.email === INBOX) throw new Error("refusing: client email is bare inbox or missing");

  const plusTag = String(session.plus_tag || "").toLowerCase();
  if (plusTag && plusTag === INBOX) throw new Error("plus-tag collapsed");

  // Probe plus-tag resolution without sending if it would hit the live file.
  const plusResolve = plusTag ? (await query(
    `SELECT id FROM clients WHERE lower(email) = $1 ORDER BY created_at ASC, id ASC LIMIT 1`,
    [plusTag]
  ))[0] : null;
  const inboxResolve = (await query(
    `SELECT id FROM clients WHERE lower(email) = $1 ORDER BY created_at ASC, id ASC LIMIT 1`,
    [INBOX]
  ))[0];

  const resolveDump = {
    plus_tag_resolves: Boolean(plusResolve),
    plus_tag_resolves_to_sim: plusResolve && plusResolve.id === session.client_id,
    plus_tag_resolves_to_live: plusResolve && plusResolve.id === FORBIDDEN,
    bare_inbox_resolves_to_live: inboxResolve && inboxResolve.id === FORBIDDEN,
    client_email_is_demo: /@demo\.fundhub\.local$/i.test(client.email),
    will_request_magic_link_for: "sim_demo_email_not_inbox_not_plus_tag"
  };
  fs.writeFileSync(path.join(DUMPS, "17-magic-resolve.json"), JSON.stringify(resolveDump, null, 2));

  if (inboxResolve && inboxResolve.id === FORBIDDEN) {
    // good — confirms why we must not request a link for the bare inbox
  }

  const reqRes = await fetch(`${BASE}/api/auth/magic-link`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: client.email })
  });
  const reqJson = await reqRes.json().catch(() => ({}));
  fs.writeFileSync(path.join(DUMPS, "18-magic-request.json"), JSON.stringify({
    status: reqRes.status,
    ok: reqJson.ok === true,
    has_message: Boolean(reqJson.message),
    requested_for: "sim_demo_email"
  }, null, 2));

  await new Promise((r) => setTimeout(r, 1500));
  const msgs = await query(
    `SELECT id, template_key, status, provider, rendered_body, created_at
       FROM messages
      WHERE client_id = $1 AND template_key = 'EMAIL-PORTAL-MAGIC-LINK'
      ORDER BY created_at DESC LIMIT 3`,
    [session.client_id]
  );
  let link = null;
  let msgId = null;
  for (const m of msgs) {
    const body = String(m.rendered_body || "");
    const match = body.match(/https?:\/\/[^\s"'<>]+/i);
    if (match && /fundhub\.ai/i.test(match[0])) {
      link = match[0].replace(/[.,);]+$/, "");
      msgId = m.id;
      break;
    }
  }
  fs.writeFileSync(path.join(DUMPS, "19-magic-message.json"), JSON.stringify({
    rows: msgs.length,
    extracted_link: Boolean(link),
    link_host: link ? new URL(link).host : null,
    link_path: link ? new URL(link).pathname : null,
    has_token_query: link ? /[?&](token|t)=/i.test(link) : false,
    message_id: msgId,
    statuses: msgs.map((m) => ({ id: m.id, status: m.status, provider: m.provider }))
  }, null, 2));
  if (link) fs.writeFileSync("/tmp/p3-magic-link.txt", link);

  const out = {
    extracted_link: Boolean(link),
    verified_client_id: null,
    is_sim: null,
    is_live: null,
    portal_http: null,
    staff_saw_message: null
  };

  if (!link) {
    fs.writeFileSync(path.join(DUMPS, "20-portal.json"), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out));
    return;
  }

  const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  let verifyHttp = null;
  page.on("response", async (res) => {
    if (/\/api\/auth\/magic-link-verify/.test(res.url()) && res.request().method() === "POST") {
      const j = await res.json().catch(() => ({}));
      verifyHttp = {
        status: res.status(),
        ok: j.ok === true,
        principal_client_id: j.principal?.clientId || j.principal?.client_id || j.client_id || null
      };
    }
  });
  await page.goto(link, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(SHOTS, "07-portal-after-magic.png") });

  // If verify didn't fire, try clicking through portal-login
  if (!verifyHttp) {
    const go = page.locator("button, a").filter({ hasText: /continue|sign in|enter/i }).first();
    if (await go.count()) {
      await go.click();
      await page.waitForTimeout(3000);
    }
  }

  const meRes = await page.evaluate(async () => {
    const r = await fetch("/api/me", { credentials: "include" });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, client_id: j.client_id || j.principal?.clientId || j.account?.client_id || null, kind: j.kind || j.principal?.kind || null };
  }).catch(() => null);

  const verifiedId = (verifyHttp && verifyHttp.principal_client_id) || (meRes && meRes.client_id) || null;
  out.verified_client_id = verifiedId;
  out.is_sim = verifiedId === session.client_id;
  out.is_live = verifiedId === FORBIDDEN;
  out.verifyHttp = verifyHttp;
  out.me = meRes;

  if (verifiedId === FORBIDDEN) {
    fs.writeFileSync(path.join(DUMPS, "20-portal.json"), JSON.stringify({ ...out, stopped: "resolved_to_live_file" }, null, 2));
    await browser.close();
    console.log(JSON.stringify({ ...out, stopped: "resolved_to_live_file" }));
    return;
  }

  if (verifiedId === session.client_id) {
    const chat = await page.evaluate(async () => {
      const r = await fetch("/api/chat/portal-message", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channel: "email",
          body: "P3 audit portal chat — sim client only. Please ignore."
        })
      });
      const j = await r.json().catch(() => ({}));
      return { status: r.status, ok: j.ok === true, conversation_id: j.conversation_id || null, message_id: j.message && j.message.id, error: j.error || null };
    });
    out.portal_http = chat;
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(SHOTS, "08-portal-chat.png") });

    const dbMsg = (await query(
      `SELECT id, direction, channel, status, sender_kind, conversation_id
         FROM messages WHERE client_id = $1 AND direction = 'inbound' AND sender_kind = 'client'
         ORDER BY created_at DESC LIMIT 3`,
      [session.client_id]
    ));
    out.inbound_rows = dbMsg;
  }

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "chris@fundhub.ai", password: PASSWORD })
  });
  const loginJson = await loginRes.json().catch(() => ({}));
  const token = loginJson.token || null;
  if (token) {
    const staff = await context.newPage();
    await staff.context().addCookies([{ name: "fundhub_session", value: token, url: BASE }]);
    await staff.goto(`${BASE}/app/messaging.html?client_id=${session.client_id}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await staff.waitForTimeout(3500);
    const text = await staff.evaluate(() => (document.body && document.body.innerText || "").slice(0, 5000));
    await staff.screenshot({ path: path.join(SHOTS, "09-staff-messaging.png") });
    out.staff_saw_message = /P3 audit portal chat/i.test(text);
    out.staff_has_sim_name = /Simulated Client/i.test(text);
    out.staff_has_live_name = /ProveFunding/i.test(text);
    fs.writeFileSync(path.join(DUMPS, "21-staff-messaging.json"), JSON.stringify({
      url: staff.url(),
      staff_saw_message: out.staff_saw_message,
      staff_has_sim_name: out.staff_has_sim_name,
      staff_has_live_name: out.staff_has_live_name
    }, null, 2));
  }

  fs.writeFileSync(path.join(DUMPS, "20-portal.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({
    extracted_link: out.extracted_link,
    is_sim: out.is_sim,
    is_live: out.is_live,
    portal_status: out.portal_http && out.portal_http.status,
    staff_saw_message: out.staff_saw_message
  }));
  await browser.close();
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
});

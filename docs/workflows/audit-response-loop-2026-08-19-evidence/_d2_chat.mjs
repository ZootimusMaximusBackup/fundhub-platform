// Second hop: new magic link, prove session client_id, send portal chat, staff Messaging in a fresh browser.
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
  const dirs = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1])) : [];
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
  const client = (await query(`SELECT id, lower(email) AS email FROM clients WHERE id = $1`, [session.client_id]))[0];
  if (!client || client.email === INBOX) throw new Error("refuse inbox email");

  const reqRes = await fetch(`${BASE}/api/auth/magic-link`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: client.email })
  });
  await new Promise((r) => setTimeout(r, 1200));
  const msgs = await query(
    `SELECT id, rendered_body, created_at FROM messages
      WHERE client_id = $1 AND template_key = 'EMAIL-PORTAL-MAGIC-LINK'
      ORDER BY created_at DESC LIMIT 1`,
    [session.client_id]
  );
  const body = String(msgs[0] && msgs[0].rendered_body || "");
  const match = body.match(/https?:\/\/[^\s"'<>]+/i);
  const link = match ? match[0].replace(/[.,);]+$/, "") : null;
  if (!link) throw new Error("no magic link in message body");

  const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });
  const clientCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await clientCtx.newPage();
  let verify = null;
  page.on("response", async (res) => {
    if (/\/api\/auth\/magic-link-verify/.test(res.url()) && res.request().method() === "POST") {
      const j = await res.json().catch(() => ({}));
      verify = {
        status: res.status(),
        ok: j.ok === true,
        principal_kind: j.principal || null,
        account_client_id: j.account && (j.account.clientId || j.account.client_id || j.account.id) || null,
        account_kind: j.account && j.account.kind || null,
        next: j.next || null,
        error: j.error || null
      };
    }
  });
  await page.goto(link, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4000);

  const sess = await page.evaluate(async () => {
    const r = await fetch("/api/auth/session", { credentials: "include" });
    const j = await r.json().catch(() => ({}));
    return {
      status: r.status,
      ok: j.ok === true,
      kind: j.kind || j.principal?.kind || j.account?.kind || null,
      client_id: j.client_id || j.principal?.clientId || j.principal?.client_id || j.account?.client_id || null
    };
  });

  const verifiedId = (verify && verify.account_client_id) || sess.client_id || null;
  const safe = {
    magic_http: reqRes.status,
    verify,
    session: sess,
    verified_client_id: verifiedId,
    is_sim: verifiedId === session.client_id,
    is_live: verifiedId === FORBIDDEN
  };
  fs.writeFileSync(path.join(DUMPS, "23-portal-session.json"), JSON.stringify(safe, null, 2));

  if (verifiedId === FORBIDDEN) {
    await browser.close();
    console.log(JSON.stringify({ ...safe, stopped: "live_file" }));
    return;
  }

  let chatUi = null;
  let chatApi = null;
  if (verifiedId === session.client_id || (sess.kind === "client" && !verifiedId)) {
    const input = page.locator("textarea, input[placeholder*='Message' i]").first();
    if (await input.count()) {
      await input.fill("P3 audit portal chat — sim client only. Please ignore.");
      const send = page.locator("button").filter({ hasText: /^send$/i }).first();
      if (await send.count()) await send.click();
      await page.waitForTimeout(2000);
      chatUi = { typed: true };
    }
    chatApi = await page.evaluate(async () => {
      const r = await fetch("/api/chat/portal-message", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel: "email", body: "P3 audit portal chat API — sim client only." })
      });
      const j = await r.json().catch(() => ({}));
      return { status: r.status, ok: j.ok === true, conversation_id: j.conversation_id || null, message_id: j.message && j.message.id, error: j.error || null };
    });
    await page.screenshot({ path: path.join(SHOTS, "10-portal-chat-sent.png") });
  }
  await page.screenshot({ path: path.join(SHOTS, "10b-portal-state.png") });

  const inbound = await query(
    `SELECT id, direction, channel, status, sender_kind, left(rendered_body, 80) AS preview
       FROM messages
      WHERE client_id = $1 AND (
        rendered_body ILIKE 'P3 audit portal chat%'
        OR (direction='inbound' AND sender_kind='client')
      )
      ORDER BY created_at DESC LIMIT 5`,
    [session.client_id]
  );

  const staffCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "chris@fundhub.ai", password: PASSWORD })
  });
  const loginJson = await loginRes.json().catch(() => ({}));
  const token = loginJson.token;
  await staffCtx.addCookies([{ name: "fundhub_session", value: token, url: BASE }]);
  const staff = await staffCtx.newPage();
  await staff.goto(`${BASE}/app/messaging.html?client_id=${session.client_id}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await staff.waitForTimeout(3500);
  const text = await staff.evaluate(() => (document.body && document.body.innerText || "").slice(0, 6000));
  await staff.screenshot({ path: path.join(SHOTS, "11-staff-messaging.png") });

  const dump = {
    ...safe,
    chatUi,
    chatApi,
    inbound_for_sim: inbound.map((r) => ({
      id: r.id, direction: r.direction, channel: r.channel, status: r.status, sender_kind: r.sender_kind, preview_is_p3: /P3 audit/i.test(r.preview || "")
    })),
    staff: {
      url: staff.url(),
      saw_p3: /P3 audit portal chat/i.test(text),
      has_sim_name: /Simulated Client/i.test(text),
      has_live_name: /ProveFunding/i.test(text)
    }
  };
  fs.writeFileSync(path.join(DUMPS, "24-portal-chat.json"), JSON.stringify(dump, null, 2));
  console.log(JSON.stringify({
    is_sim: dump.is_sim,
    is_live: dump.is_live,
    chat_status: chatApi && chatApi.status,
    inbound: dump.inbound_for_sim.length,
    staff_saw_p3: dump.staff.saw_p3,
    staff_url: dump.staff.url
  }));
  await browser.close();
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
});

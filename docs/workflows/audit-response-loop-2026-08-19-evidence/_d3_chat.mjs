// If the portal header says Simulated Client, send chat. Dump session shape. Confirm not live file.
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

function pickIds(obj, acc = []) {
  if (!obj || typeof obj !== "object") return acc;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v)) acc.push({ key: k, id: v });
    else if (v && typeof v === "object") pickIds(v, acc);
  }
  return acc;
}

async function main() {
  const client = (await query(`SELECT id, lower(email) AS email FROM clients WHERE id = $1`, [session.client_id]))[0];
  if (!client || client.email === INBOX) throw new Error("refuse");

  const issued = await query(
    `SELECT client_id, outcome, created_at FROM account_magic_links
      WHERE client_id = $1 ORDER BY created_at DESC LIMIT 5`,
    [session.client_id]
  );

  const reqRes = await fetch(`${BASE}/api/auth/magic-link`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: client.email })
  });
  await new Promise((r) => setTimeout(r, 1200));
  const msgs = await query(
    `SELECT rendered_body FROM messages
      WHERE client_id = $1 AND template_key = 'EMAIL-PORTAL-MAGIC-LINK'
      ORDER BY created_at DESC LIMIT 1`,
    [session.client_id]
  );
  const match = String(msgs[0] && msgs[0].rendered_body || "").match(/https?:\/\/[^\s"'<>]+/i);
  const link = match ? match[0].replace(/[.,);]+$/, "") : null;
  if (!link) throw new Error("no link");

  const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  let rawVerify = null;
  page.on("response", async (res) => {
    if (/\/api\/auth\/magic-link-verify/.test(res.url()) && res.request().method() === "POST") {
      rawVerify = await res.json().catch(() => ({}));
    }
  });
  await page.goto(link, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4500);

  const header = await page.evaluate(() => {
    const bar = document.querySelector("header, .top, .shell-top, #who, .who") || document.body;
    return (document.body.innerText || "").split("\n").slice(0, 8);
  });
  const sessRaw = await page.evaluate(async () => {
    const r = await fetch("/api/auth/session", { credentials: "include" });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  });
  const ids = pickIds(sessRaw.body);
  const verifyIds = pickIds(rawVerify || {});
  const hasLive = [...ids, ...verifyIds].some((x) => x.id === FORBIDDEN);
  const hasSim = [...ids, ...verifyIds].some((x) => x.id === session.client_id);
  const headerHasSim = header.join(" ").includes("Simulated Client");
  const headerHasLive = /ProveFunding/i.test(header.join(" "));

  const dump = {
    magic_http: reqRes.status,
    issued_link_client_ids: issued.map((r) => ({ client_id: r.client_id, outcome: r.outcome })),
    verify_ok: rawVerify && rawVerify.ok === true,
    verify_error: rawVerify && rawVerify.error || null,
    verify_ids: verifyIds,
    session_ok: sessRaw.body && sessRaw.body.ok === true,
    session_keys: sessRaw.body ? Object.keys(sessRaw.body) : [],
    session_ids: ids,
    has_sim_id: hasSim,
    has_live_id: hasLive,
    header_has_sim: headerHasSim,
    header_has_live: headerHasLive
  };
  fs.writeFileSync(path.join(DUMPS, "25-session-shape.json"), JSON.stringify(dump, null, 2));

  if (hasLive || headerHasLive) {
    await browser.close();
    console.log(JSON.stringify({ stopped: "live", ...dump }));
    return;
  }

  let chat = null;
  if (hasSim || headerHasSim) {
    chat = await page.evaluate(async () => {
      const r = await fetch("/api/chat/portal-message", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel: "email", body: "P3 audit portal chat API — sim client only." })
      });
      const j = await r.json().catch(() => ({}));
      return { status: r.status, ok: j.ok === true, conversation_id: j.conversation_id || null, message_id: j.message && j.message.id, error: j.error || null };
    });
    const box = page.locator("textarea, input[placeholder*='Message' i]").first();
    if (await box.count()) {
      await box.fill("P3 audit portal chat UI — sim client only.");
      const send = page.getByRole("button", { name: /^send$/i });
      if (await send.count()) await send.click();
      await page.waitForTimeout(2000);
    }
    await page.screenshot({ path: path.join(SHOTS, "12-portal-chat-attempt.png") });
  }

  const inbound = await query(
    `SELECT id, direction, channel, status, sender_kind, conversation_id
       FROM messages WHERE client_id = $1 AND created_at > now() - interval '20 minutes'
       ORDER BY created_at DESC`,
    [session.client_id]
  );
  fs.writeFileSync(path.join(DUMPS, "26-portal-chat-result.json"), JSON.stringify({
    chat,
    inbound: inbound.map((r) => ({
      id: r.id, direction: r.direction, channel: r.channel, status: r.status,
      sender_kind: r.sender_kind, conversation_id: r.conversation_id
    }))
  }, null, 2));
  console.log(JSON.stringify({
    has_sim_id: hasSim,
    has_live_id: hasLive,
    header_has_sim: headerHasSim,
    chat_status: chat && chat.status,
    chat_ok: chat && chat.ok,
    inbound: inbound.length
  }));
  await browser.close();
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
});

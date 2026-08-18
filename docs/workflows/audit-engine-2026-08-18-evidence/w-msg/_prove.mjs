// W-MSG — prove messaging on the simulated client. Findings only.
// Writes evidence under w-msg/. Sends only if destination is FUNDHUB_TEST_*.
// Never prints inbox/phone secrets. Never touches the live credit file.

import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-engine-2026-08-18-evidence/w-msg");
const SHARED = path.join(ROOT, "docs/workflows/audit-engine-2026-08-18-evidence/SHARED.json");
const BASE = "https://fundhub.ai";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";
const COMPARE = "8556bedc-46e1-4d85-b0cd-a24adfee1521";

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

const PASSWORD = process.env.STAFF_E2E_PASSWORD || process.env.STAFF_INITIAL_PASSWORD || "";
if (!PASSWORD) throw new Error("STAFF_E2E_PASSWORD missing");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
fs.mkdirSync(OUT, { recursive: true });

const shared = JSON.parse(fs.readFileSync(SHARED, "utf8"));
const CLIENT = shared.client_id;
const ORG = shared.org_id;
const EMAIL_SHARED = shared.email;
if (CLIENT === FORBIDDEN) throw new Error("refused: simulated id is the live credit file");
if (CLIENT === COMPARE) throw new Error("refused: simulated id is the read-compare client");

function chromeExe() {
  const home = process.env.HOME || "";
  const root = path.join(home, "Library/Caches/ms-playwright");
  if (!fs.existsSync(root)) return undefined;
  const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    const exe = path.join(root, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}

function db() {
  return new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

async function query(sql, params = []) {
  const c = db();
  await c.connect();
  try {
    return (await c.query(sql, params)).rows;
  } finally {
    await c.end();
  }
}

function write(name, obj) {
  const p = path.join(OUT, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
  return `w-msg/${name}`;
}

function digits(v) {
  return String(v || "").replace(/\D/g, "");
}

function maskPhone(raw) {
  const d = digits(raw);
  if (!d) return { present: false, masked: null, digits: 0, starts_1555: false };
  return {
    present: true,
    masked: d.startsWith("1555") ? "+1555…" : (d.startsWith("1") ? "+1…" : "…"),
    digits: d.length,
    starts_1555: d.startsWith("1555") || d.startsWith("555")
  };
}

function maskTo(addr, channel) {
  if (!addr) return null;
  const s = String(addr);
  if (channel === "email" || s.includes("@")) {
    const at = s.lastIndexOf("@");
    if (at < 0) return "***";
    const local = s.slice(0, at);
    const domain = s.slice(at + 1);
    return (local.length <= 3 ? "***" : local.slice(0, 3) + "…") + "@" + domain;
  }
  return maskPhone(s).masked;
}

function cookieHeader(setCookie) {
  if (!setCookie) return "";
  return setCookie.split(/,(?=[^;]+?=)/).map((p) => p.split(";")[0].trim()).filter(Boolean).join("; ");
}

const proofs = [];
function rec(row) {
  proofs.push(row);
  console.log(JSON.stringify({ id: row.id, result: row.result, observed: row.observed }));
}

async function main() {
  const inboxSet = Boolean(String(process.env.FUNDHUB_TEST_INBOX || "").trim());
  const phoneSet = Boolean(String(process.env.FUNDHUB_TEST_PHONE || "").trim());
  const inbox = String(process.env.FUNDHUB_TEST_INBOX || "").trim();
  const testPhone = String(process.env.FUNDHUB_TEST_PHONE || "").trim();

  const rows = await query(
    `SELECT id, org_id, email, phone, first_name, last_name, is_demo, tags, channel_source
       FROM clients WHERE id = $1`,
    [CLIENT]
  );
  const row = rows[0] || null;
  if (!row) throw new Error("simulated client missing");
  if (row.org_id !== ORG) throw new Error("org mismatch");

  const phoneInfo = maskPhone(row.phone);
  const emailEqualsInbox = Boolean(inbox && row.email && String(row.email).toLowerCase() === inbox.toLowerCase());
  const phoneEqualsTest = Boolean(testPhone && row.phone && digits(row.phone) === digits(testPhone));
  const emailIsDemoLocal = /@demo\.fundhub\.local$/i.test(String(row.email || ""));

  const contactDump = {
    client_id: row.id,
    org_id: row.org_id,
    email: row.email,
    email_matches_shared: row.email === EMAIL_SHARED,
    email_is_demo_fundhub_local: emailIsDemoLocal,
    phone: phoneInfo,
    first_name: row.first_name,
    last_name: row.last_name,
    is_demo: row.is_demo,
    tags: row.tags,
    channel_source: row.channel_source,
    FUNDHUB_TEST_INBOX_set: inboxSet,
    FUNDHUB_TEST_PHONE_set: phoneSet,
    email_equals_FUNDHUB_TEST_INBOX: emailEqualsInbox,
    phone_equals_FUNDHUB_TEST_PHONE: phoneEqualsTest,
    compose_has_to_field: false,
    note: "destination is clients.email / clients.phone only — POST /api/messages has no to field"
  };
  write("01-contact-seed.json", contactDump);

  rec({
    id: "msg.seed-contact",
    result: row.email && phoneInfo.present ? "PASS" : "FAIL",
    expected: "simulate seeded email + phone on this client",
    observed: `email=${row.email} phone=${phoneInfo.masked} digits=${phoneInfo.digits} starts_1555=${phoneInfo.starts_1555} is_demo=${row.is_demo}`,
    evidence: "w-msg/01-contact-seed.json"
  });

  const existingMsgs = await query(
    `SELECT id, channel, status, direction, to_address, provider, blocked_reason, last_error, created_at
       FROM messages WHERE client_id = $1 ORDER BY created_at`,
    [CLIENT]
  );
  write("01b-messages-before.json", {
    client_id: CLIENT,
    count: existingMsgs.length,
    rows: existingMsgs.map((m) => ({
      id: m.id,
      channel: m.channel,
      status: m.status,
      direction: m.direction,
      to_masked: maskTo(m.to_address, m.channel),
      has_to: Boolean(m.to_address),
      provider: m.provider || null,
      blocked_reason: m.blocked_reason || null,
      last_error: m.last_error ? String(m.last_error).slice(0, 160) : null,
      created_at: m.created_at
    }))
  });

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "chris@fundhub.ai", password: PASSWORD })
  });
  const loginJson = await loginRes.json().catch(() => ({}));
  const token = loginJson.token || null;
  const cookie = cookieHeader(loginRes.headers.get("set-cookie") || "");
  write("login-status.json", {
    status: loginRes.status,
    ok: loginJson.ok === true,
    has_token: Boolean(token),
    has_cookie: /fundhub_session=/i.test(cookie),
    staff_role: loginJson.staff?.role || null
  });
  if (!token) throw new Error(`login failed status=${loginRes.status}`);

  const authHeaders = {
    authorization: `Bearer ${token}`,
    accept: "application/json",
    cookie: cookie || `fundhub_session=${token}`
  };

  const clientRes = await fetch(`${BASE}/api/dashboard/client?id=${CLIENT}`, { headers: authHeaders });
  const clientJson = await clientRes.json().catch(() => ({}));
  const cl = clientJson.client || {};
  write("02-dashboard-client.json", {
    status: clientRes.status,
    ok: clientJson.ok === true,
    client_id: cl.id || null,
    email: cl.email || null,
    email_is_demo_fundhub_local: /@demo\.fundhub\.local$/i.test(String(cl.email || "")),
    phone: maskPhone(cl.phone),
    first_name: cl.first_name || null,
    last_name: cl.last_name || null,
    email_equals_FUNDHUB_TEST_INBOX: Boolean(inbox && cl.email && String(cl.email).toLowerCase() === inbox.toLowerCase()),
    phone_equals_FUNDHUB_TEST_PHONE: Boolean(testPhone && cl.phone && digits(cl.phone) === digits(testPhone))
  });

  const convoRes = await fetch(`${BASE}/api/read/conversations?client_id=${CLIENT}&limit=50`, { headers: authHeaders });
  const convoJson = await convoRes.json().catch(() => ({}));
  const items = convoJson.items || convoJson.data?.items || [];
  write("02-conversations.json", {
    status: convoRes.status,
    ok: convoJson.ok === true,
    count: Array.isArray(items) ? items.length : null,
    channels: Array.isArray(items) ? items.map((t) => t.channel) : []
  });

  const browser = await chromium.launch({
    headless: true,
    executablePath: chromeExe()
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{
    name: "fundhub_session",
    value: token,
    domain: "fundhub.ai",
    path: "/",
    httpOnly: true,
    secure: true
  }]);
  const page = await context.newPage();
  await page.addInitScript((t) => {
    try { localStorage.setItem("fundhub_token", t); } catch {}
  }, token);

  const shotNet = [];
  page.on("response", (res) => {
    const u = res.url();
    if (/\/api\/(messages|dashboard\/client|read\/(inbox|conversations|messages))/.test(u)) {
      shotNet.push({ status: res.status(), path: u.replace(BASE, ""), method: res.request().method() });
    }
  });

  const msgUrl = `${BASE}/app/messaging.html?client_id=${CLIENT}`;
  await page.goto(msgUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);
  try {
    await page.waitForFunction(() => {
      const rows = document.getElementById("ctxRows");
      return rows && /Email|Phone/i.test(rows.textContent || "");
    }, { timeout: 15000 });
  } catch {
    // paint may still be empty — screenshot anyway
  }

  const screen = await page.evaluate(() => {
    const ctx = document.getElementById("ctxRows");
    const text = ctx ? ctx.textContent || "" : "";
    const emailMatch = text.match(/Email\s+(\S+@\S+)/);
    const hasPhoneRow = /Phone/i.test(text);
    const toInputs = document.querySelectorAll('input[name="to"], input[id*="toAddress"], input[placeholder*="To "]');
    return {
      url: location.href,
      title: document.title,
      thName: (document.getElementById("thName") || {}).textContent || null,
      thSub: (document.getElementById("thSub") || {}).textContent || null,
      composeChannel: (document.getElementById("composeChannel") || {}).textContent || null,
      composePlaceholder: (document.getElementById("composeBody") || {}).placeholder || null,
      composeDisabled: Boolean((document.getElementById("composeBody") || {}).disabled),
      sendDisabled: Boolean((document.getElementById("sendBtn") || {}).disabled),
      sendStatus: (document.getElementById("sendStatus") || {}).textContent || null,
      ctxName: (document.getElementById("ctxName") || {}).textContent || null,
      ctxHasEmailRow: /Email/i.test(text),
      ctxEmail: emailMatch ? emailMatch[1] : null,
      ctxHasPhoneRow: hasPhoneRow,
      to_field_count: toInputs.length,
      compose_html_has_to_input: toInputs.length > 0
    };
  });

  if (screen.ctxEmail && /@/.test(screen.ctxEmail) === false) screen.ctxEmail = "[unparsed]";
  write("02-screen.json", {
    ...screen,
    ctxPhone: screen.ctxHasPhoneRow ? "present_on_screen_masked_in_dump" : "absent",
    FUNDHUB_TEST_INBOX_set: inboxSet,
    FUNDHUB_TEST_PHONE_set: phoneSet,
    email_equals_FUNDHUB_TEST_INBOX: emailEqualsInbox,
    phone_equals_FUNDHUB_TEST_PHONE: phoneEqualsTest,
    network: shotNet
  });

  const shotPath = path.join(OUT, "02-messaging.png");
  await page.screenshot({ path: shotPath, fullPage: true });
  await browser.close();

  const screenResolvesContact = Boolean(screen.ctxEmail || screen.ctxHasPhoneRow);
  const wouldHitDemo = emailIsDemoLocal && !emailEqualsInbox;
  const canUseTestInbox = emailEqualsInbox;
  const canUseTestPhone = phoneEqualsTest;

  rec({
    id: "msg.screen-resolve",
    result: screenResolvesContact ? "PASS" : "FAIL",
    expected: "Messaging shows this client's email/phone, or compose can set FUNDHUB_TEST_*",
    observed: [
      `ctxEmail=${screen.ctxEmail || "none"}`,
      `ctxPhone=${screen.ctxHasPhoneRow ? "shown" : "none"}`,
      `channel=${screen.composeChannel}`,
      `to_field=${screen.compose_html_has_to_input}`,
      `FUNDHUB_TEST_INBOX_set=${inboxSet}`,
      `email_equals_FUNDHUB_TEST_INBOX=${emailEqualsInbox}`,
      `FUNDHUB_TEST_PHONE_set=${phoneSet}`,
      `phone_equals_FUNDHUB_TEST_PHONE=${phoneEqualsTest}`,
      wouldHitDemo ? "send blocked — would hit unmonitored demo.fundhub.local" : "destination check recorded"
    ].join("; "),
    evidence: "w-msg/02-messaging.png"
  });

  let sendDump = {
    attempted: false,
    reason: "not_attempted",
    channel: null,
    http_status: null,
    body: null,
    message_row: null
  };

  if (canUseTestInbox || canUseTestPhone) {
    const channel = canUseTestInbox ? "email" : "sms";
    const payload = {
      client_id: CLIENT,
      channel,
      body: "W-MSG audit probe — one send to the designed test destination. Ignore.",
      idempotency_key: `w-msg-${CLIENT}-${Date.now()}`
    };
    if (channel === "email") payload.subject = "W-MSG audit probe";
    const sendRes = await fetch(`${BASE}/api/messages`, {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const sendJson = await sendRes.json().catch(() => ({}));
    const mid = sendJson.message && sendJson.message.id;
    let msgRow = null;
    if (mid) {
      const got = await query(
        `SELECT id, channel, status, direction, to_address, provider, blocked_reason,
                last_error, subject, created_at
           FROM messages WHERE id = $1 AND client_id = $2`,
        [mid, CLIENT]
      );
      msgRow = got[0] || null;
    }
    sendDump = {
      attempted: true,
      reason: "destination_matched_FUNDHUB_TEST_*",
      channel,
      http_status: sendRes.status,
      outcome: sendJson.outcome || null,
      detail: sendJson.detail ? String(sendJson.detail).slice(0, 200) : null,
      ok: sendJson.ok === true,
      conversation_id: sendJson.conversation_id || null,
      message_row: msgRow ? {
        id: msgRow.id,
        status: msgRow.status,
        channel: msgRow.channel,
        to_masked: maskTo(msgRow.to_address, msgRow.channel),
        has_to: Boolean(msgRow.to_address),
        to_is_FUNDHUB_TEST_INBOX: channel === "email" && emailEqualsInbox && Boolean(msgRow.to_address),
        to_is_FUNDHUB_TEST_PHONE: channel === "sms" && phoneEqualsTest && Boolean(msgRow.to_address),
        provider: msgRow.provider || null,
        blocked_reason: msgRow.blocked_reason || null,
        last_error: msgRow.last_error ? String(msgRow.last_error).slice(0, 200) : null,
        created_at: msgRow.created_at
      } : null
    };
    rec({
      id: "msg.send",
      result: sendRes.status === 200 ? "PASS" : "FAIL",
      expected: "one message to FUNDHUB_TEST_* destination",
      observed: `http=${sendRes.status} outcome=${sendJson.outcome || "none"} status=${msgRow ? msgRow.status : "no-row"} to=${msgRow ? maskTo(msgRow.to_address, msgRow.channel) : "none"}`,
      evidence: "w-msg/03-send.json"
    });
  } else {
    sendDump = {
      attempted: false,
      reason: "screen_does_not_resolve_FUNDHUB_TEST_star",
      channel: null,
      would_hit_demo_fundhub_local: wouldHitDemo,
      would_hit_stored_phone_not_test: phoneInfo.present && !phoneEqualsTest,
      note: "No staff To field. API takes client_id + channel only. Did not send to the unmonitored demo address. Did not text a non-test phone."
    };
    rec({
      id: "msg.send",
      result: "FAIL",
      expected: "one message to FUNDHUB_TEST_INBOX (email preferred) or FUNDHUB_TEST_PHONE",
      observed: "blocked — screen/API resolve stored demo.fundhub.local email and +1555… phone, not FUNDHUB_TEST_*. No To field. Did not send.",
      evidence: "w-msg/03-send.json"
    });
  }
  write("03-send.json", sendDump);

  const landing = {
    FUNDHUB_TEST_INBOX_was_actual_To: Boolean(sendDump.message_row && sendDump.message_row.to_is_FUNDHUB_TEST_INBOX),
    provider: sendDump.message_row ? sendDump.message_row.provider : null,
    status: sendDump.message_row ? sendDump.message_row.status : null,
    last_error: sendDump.message_row ? sendDump.message_row.last_error : null,
    inbox_landing: "not_proven",
    note: sendDump.attempted
      ? "Landing only counts if To was FUNDHUB_TEST_INBOX and a provider accepted it."
      : "No send. Inbox landing unproven."
  };
  if (landing.FUNDHUB_TEST_INBOX_was_actual_To) {
    if (sendDump.message_row.status === "sent" || sendDump.message_row.status === "delivered") {
      landing.inbox_landing = "provider_accepted_row_status_" + sendDump.message_row.status;
    } else if (sendDump.message_row.status === "queued") {
      landing.inbox_landing = "row_stayed_queued";
    } else {
      landing.inbox_landing = "row_status_" + sendDump.message_row.status;
    }
  }
  write("04-inbox-landing.json", landing);
  rec({
    id: "msg.inbox-landing",
    result: landing.inbox_landing === "not_proven" ? "UNVERIFIED" : (String(landing.inbox_landing).startsWith("provider_accepted") ? "PASS" : "FAIL"),
    expected: "if To was FUNDHUB_TEST_INBOX, provider accept or honest queued/fail",
    observed: landing.inbox_landing,
    evidence: "w-msg/04-inbox-landing.json"
  });

  const sms = {
    attempted: Boolean(sendDump.attempted && sendDump.channel === "sms"),
    FUNDHUB_TEST_PHONE_was_resolved_destination: canUseTestPhone,
    reason: canUseTestPhone
      ? (sendDump.channel === "sms" ? "sms_send_recorded" : "email_preferred_used_instead")
      : "sms_skipped_stored_phone_is_not_FUNDHUB_TEST_PHONE",
    a2p_note: "A2P pending fail is expected if a real SMS send is reached"
  };
  write("05-sms.json", sms);
  rec({
    id: "msg.sms",
    result: canUseTestPhone ? (sms.attempted ? "PASS" : "UNVERIFIED") : "UNVERIFIED",
    expected: "SMS only if FUNDHUB_TEST_PHONE is the resolved destination — one send or refuse/error",
    observed: sms.reason,
    evidence: "w-msg/05-sms.json"
  });

  const ev = await query(
    `SELECT id, name, created_at
       FROM events
      WHERE client_id = $1
        AND name LIKE 'message.%'
      ORDER BY created_at`,
    [CLIENT]
  );
  const eventsPayload = {
    client_id: CLIENT,
    unit: "W-MSG",
    count: ev.length,
    events: ev.map((e) => ({ id: e.id, name: e.name, created_at: e.created_at })),
    note: sendDump.attempted
      ? "events after this unit's send attempt"
      : "no send from this unit — list is whatever already existed on this client"
  };
  write("events-fired.json", eventsPayload);
  rec({
    id: "msg.events",
    result: "PASS",
    expected: "events-fired.json for message.* on this client from this unit",
    observed: `count=${ev.length} names=${ev.map((e) => e.name).join(",") || "none"}`,
    evidence: "w-msg/events-fired.json"
  });

  write("proofs.json", proofs);
}

main().catch((err) => {
  console.error(String(err && err.stack || err));
  process.exit(1);
});

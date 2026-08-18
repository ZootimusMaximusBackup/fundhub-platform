/**
 * K1 rest of the walk: calendar API + demo, messaging, documents, pipeline.
 * Calendar day/week/strip shots already exist from _walk.mjs.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-keep-going-2026-08-18-evidence/k1");
const BASE = "https://fundhub.ai";
const TEST = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const FUNNEL = "edca0767-88e9-4cf4-8837-47382049503a";
const TASK = "d5300a31-7620-4abf-8ca7-c9295d1ebbaf";
const LIVE = "9af65808-a619-4e65-ae91-239766a006b7";

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
loadDotEnv();
const PASSWORD = process.env.STAFF_E2E_PASSWORD || "";
if (!PASSWORD) throw new Error("STAFF_E2E_PASSWORD missing");

function chromeExe() {
  const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return fs.existsSync(mac) ? mac : undefined;
}

function dump(name, obj) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 2) + "\n");
}

const clicks = [];
function record(claim, happen, extra) {
  clicks.push({ claim, happen, ...(extra || {}) });
}

const browser = await chromium.launch({
  headless: true,
  executablePath: chromeExe(),
  args: ["--disable-blink-features=AutomationControlled"]
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  timezoneId: "America/Phoenix"
});
const page = await context.newPage();
const taskHttp = [];
page.on("response", async (res) => {
  if (!/\/api\/(tasks|read\/|dashboard\/pipeline|me)/.test(res.url())) return;
  const j = await res.json().catch(() => ({}));
  const tasks = j.tasks || [];
  taskHttp.push({
    url: res.url().replace(/^https:\/\/fundhub\.ai/, "").slice(0, 160),
    status: res.status(),
    ok: j.ok === true,
    n: Array.isArray(tasks) ? tasks.length : (j.items ? j.items.length : null),
    error: j.error || null,
    has_k1_task: Array.isArray(tasks) && tasks.some((t) => t && t.id === TASK)
  });
});

await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator('input[type="email"], #email, input[name="email"]').first().fill("chris@fundhub.ai");
await page.locator('input[type="password"], #password, input[name="password"]').first().fill(PASSWORD);
await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
await page.waitForFunction(() => !/login\.html|portal-login\.html/i.test(location.pathname), null, { timeout: 30000 });
await page.waitForTimeout(2000);

const me = await page.evaluate(async () => {
  const r = await fetch("/api/me", { credentials: "include" });
  const j = await r.json().catch(() => ({}));
  return {
    status: r.status,
    role: j.role || j.staff?.role || j.principal?.role || null,
    has_token: Boolean(localStorage.getItem("fh_token")),
    demo: localStorage.getItem("fh_demo")
  };
});
dump("00-me.json", me);

await page.goto(BASE + "/app/calendar.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(6000);

const calLoad = await page.evaluate(async (ids) => {
  const banner = (document.querySelector(".fh-banner, .banner, [data-banner], .fh-wire") || {}).textContent || "";
  let queue = null;
  if (typeof FHData !== "undefined" && FHData.taskQueue) {
    const open = await FHData.taskQueue({ done: false, limit: 200 });
    const closed = await FHData.taskQueue({ done: true, limit: 200 });
    const ot = (open && open.data && open.data.tasks) || [];
    const ct = (closed && closed.data && closed.data.tasks) || [];
    queue = {
      open: { ok: open && open.ok, source: open && open.source, error: open && open.error, n: ot.length },
      closed: { ok: closed && closed.ok, source: closed && closed.source, error: closed && closed.error, n: ct.length },
      has_task: ot.concat(ct).some((t) => t && t.id === ids.TASK),
      strategy: ot.concat(ct).filter((t) => /strategy session booked/i.test((t && t.title) || "")).map((t) => ({
        id: t.id, due_at: t.due_at, client_id: t.client_id, client_name: t.client_name, done: t.done
      }))
    };
  }
  const raw = await fetch("/api/tasks?done=false&limit=200", { credentials: "include" }).then(async (r) => {
    const j = await r.json().catch(() => ({}));
    return { status: r.status, ok: j.ok === true, n: (j.tasks || []).length, error: j.error || null, has_task: (j.tasks || []).some((t) => t && t.id === ids.TASK) };
  });
  return {
    booked: document.getElementById("statBooked")?.textContent || "",
    foot: document.getElementById("footView")?.textContent || "",
    banner: String(banner).replace(/\s+/g, " ").trim().slice(0, 300),
    hasFH: typeof FHData !== "undefined",
    queue,
    raw
  };
}, { TASK });
dump("13-calendar-api.json", calLoad);

await page.locator("#demoToggle").click({ force: true }).catch(() => {});
await page.waitForTimeout(400);
const demoOpen = await page.evaluate(() => {
  const body = document.getElementById("demoBody");
  return { hidden: body ? body.hidden : null, text: (body && body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 400) };
});
await page.screenshot({ path: path.join(OUT, "11-calendar-demo.png"), fullPage: true });
dump("11-calendar-demo.json", demoOpen);
record("Demonstration states toggle", demoOpen.hidden === false ? "drawer open" : `hidden=${demoOpen.hidden}`);
record("Join Call", "not clicked — could open a real meeting");
record("Client file", "disabled / no client linked on empty day");

// Messaging
await page.goto(`${BASE}/app/messaging.html?client_id=${TEST}`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(5000);
if (page.url().includes(LIVE)) throw new Error("messaging opened live file");

async function messagingState() {
  return page.evaluate((ids) => {
    const text = (document.body && document.body.innerText) || "";
    const convos = [].slice.call(document.querySelectorAll(".convo")).map((el) => ({
      id: el.dataset.id || null,
      active: el.classList.contains("active"),
      text: el.textContent.replace(/\s+/g, " ").trim().slice(0, 240)
    }));
    const msgs = [].slice.call(document.querySelectorAll(".msg")).map((el) =>
      el.textContent.replace(/\s+/g, " ").trim().slice(0, 220)
    );
    return {
      href: location.href,
      has_test: location.href.includes(ids.TEST),
      has_live: location.href.includes(ids.LIVE),
      convos,
      msgs: msgs.slice(0, 20),
      saw_email_tag: /EMAIL/.test(text),
      saw_sms_tag: /\bSMS\b/.test(text),
      saw_reply: /e2e fire reply/i.test(text),
      saw_stop: /\bSTOP\b/.test(text),
      saw_ping: /e2e ping/i.test(text),
      saw_fire_thread: /e2e fire/i.test(text),
      thread_sub: document.getElementById("thSub")?.textContent || "",
      text: text.replace(/\s+/g, " ").trim().slice(0, 2500)
    };
  }, { TEST, LIVE });
}

const msgHome = await messagingState();
await page.screenshot({ path: path.join(OUT, "14-messaging-home.png"), fullPage: true });
dump("14-messaging-home.json", msgHome);

const emailConvo = page.locator(".convo").filter({ hasText: /EMAIL/i }).first();
if (await emailConvo.count()) {
  await emailConvo.click();
  await page.waitForTimeout(2000);
  const emailSt = await messagingState();
  await page.screenshot({ path: path.join(OUT, "15-messaging-email.png"), fullPage: true });
  dump("15-messaging-email.json", emailSt);
  record("TEST EMAIL thread shows the inbound e2e fire reply", emailSt.saw_reply ? "reply visible" : "EMAIL open, reply not visible");
} else {
  record("TEST EMAIL thread shows the inbound e2e fire reply", "no EMAIL conversation row");
  await page.screenshot({ path: path.join(OUT, "15-messaging-email-missing.png"), fullPage: true });
}

const smsConvo = page.locator(".convo").filter({ hasText: /\bSMS\b/i }).first();
if (await smsConvo.count()) {
  await smsConvo.click();
  await page.waitForTimeout(2000);
  const smsSt = await messagingState();
  await page.screenshot({ path: path.join(OUT, "16-messaging-sms.png"), fullPage: true });
  dump("16-messaging-sms.json", smsSt);
  record("TEST SMS thread shows the sent e2e ping", smsSt.saw_ping ? "ping visible" : "SMS open, ping not visible");
} else {
  record("TEST SMS thread shows the sent e2e ping", "no SMS conversation row");
  await page.screenshot({ path: path.join(OUT, "16-messaging-sms-missing.png"), fullPage: true });
}

const msgApi = await page.evaluate(async (testId) => {
  const convos = await fetch("/api/read/conversations?client_id=" + testId, { credentials: "include" }).then((r) => r.json().catch(() => ({})));
  const items = convos.items || convos.conversations || convos.data || [];
  const threads = [];
  for (const row of items) {
    const msgs = await fetch("/api/read/messages?conversation_id=" + row.id, { credentials: "include" }).then((r) => r.json().catch(() => ({})));
    const list = msgs.items || msgs.messages || [];
    threads.push({
      id: row.id,
      channel: row.channel,
      n: list.length,
      reply: list.some((m) => /e2e fire reply/i.test((m.subject || "") + " " + (m.body || m.rendered_body || ""))),
      ping: list.some((m) => /e2e ping/i.test((m.body || m.rendered_body || "") + " " + (m.subject || ""))),
      subjects: list.map((m) => m.subject).filter(Boolean).slice(0, 8)
    });
  }
  return { convo_n: items.length, threads };
}, TEST);
dump("17-messaging-api.json", msgApi);

// Documents
await page.goto(`${BASE}/app/documents.html`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(4500);
const qBox = page.locator("#q");
if (await qBox.count()) {
  await qBox.fill("E2e Fire");
  await page.waitForTimeout(800);
}
const docsState = await page.evaluate((funnel) => {
  const text = (document.body && document.body.innerText) || "";
  const rows = [].slice.call(document.querySelectorAll("table tbody tr")).map((el) =>
    el.textContent.replace(/\s+/g, " ").trim()
  ).filter(Boolean);
  return {
    href: location.href,
    saw_funnel_id: text.includes(funnel),
    saw_e2e: /e2e/i.test(text),
    empty: /no documents on file yet|nothing matches that filter/i.test(text),
    rows: rows.slice(0, 12),
    text: text.replace(/\s+/g, " ").trim().slice(0, 2200)
  };
}, FUNNEL);
await page.screenshot({ path: path.join(OUT, "18-documents-funnel.png"), fullPage: true });
dump("18-documents-funnel.json", docsState);

if (await qBox.count()) {
  await qBox.fill(FUNNEL);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, "18b-documents-funnel-id.png"), fullPage: true });
}

const docsApi = await page.evaluate(async (funnel) => {
  const r = await fetch("/api/read/documents?client_id=" + funnel, { credentials: "include" });
  const j = await r.json().catch(() => ({}));
  const items = j.items || j.documents || [];
  return { status: r.status, ok: j.ok === true, n: items.length, error: j.error || null, kinds: items.map((d) => ({ kind: d.kind, subtype: d.subtype, title: d.title })) };
}, FUNNEL);
dump("19-documents-api.json", docsApi);
record("Documents paints the new funnel client", docsState.empty && docsApi.n === 0 ? "empty — 0 documents" : (docsState.saw_e2e || docsApi.n ? "something painted" : "page painted, funnel not seen"));

// Pipeline
await page.goto(`${BASE}/app/pipeline.html`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(5000);
const pipeSearch = page.locator("input[type=search], input[placeholder*='earch' i], #q").first();
if (await pipeSearch.count()) {
  await pipeSearch.fill("E2e Fire");
  await page.waitForTimeout(800);
}
const pipeState = await page.evaluate((ids) => {
  const text = (document.body && document.body.innerText) || "";
  const cards = [].slice.call(document.querySelectorAll("[data-client-id]")).map((el) => ({
    clientId: el.dataset.clientId || null,
    text: el.textContent.replace(/\s+/g, " ").trim().slice(0, 200)
  }));
  const funnelCards = cards.filter((c) => c.clientId === ids.FUNNEL);
  return {
    href: location.href,
    saw_funnel_id: text.includes(ids.FUNNEL),
    saw_e2e: /e2e fire/i.test(text),
    saw_booked: /\bbooked\b/i.test(text),
    card_n: cards.length,
    funnel_card_n: funnelCards.length,
    funnel_cards: funnelCards.slice(0, 5),
    text: text.replace(/\s+/g, " ").trim().slice(0, 2500)
  };
}, { FUNNEL });
await page.screenshot({ path: path.join(OUT, "20-pipeline-funnel.png"), fullPage: true });
dump("20-pipeline-funnel.json", pipeState);

const pipeApi = await page.evaluate(async (funnel) => {
  const r = await fetch("/api/dashboard/pipeline", { credentials: "include" });
  const j = await r.json().catch(() => ({}));
  const raw = JSON.stringify(j);
  const mentioned = raw.includes(funnel);
  return {
    status: r.status,
    ok: j.ok === true,
    keys: Object.keys(j || {}).slice(0, 24),
    mentioned,
    error: j.error || null
  };
}, FUNNEL);
dump("21-pipeline-api.json", pipeApi);
record("Pipeline paints the new funnel client", pipeState.funnel_card_n > 0 || pipeState.saw_e2e ? "funnel card/name seen" : "funnel not on the board");

// Open the Booked column card if present (existing row, no email)
const funnelCard = page.locator("[data-client-id='" + FUNNEL + "']").first();
if (await funnelCard.count()) {
  await funnelCard.click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, "20b-pipeline-funnel-open.png"), fullPage: true });
  record("Click existing pipeline card for funnel client", "drawer/card opened");
}

dump("13b-task-http.json", taskHttp);
dump("22-clicks.json", { at: new Date().toISOString(), me, clicks });

await browser.close();
console.log(JSON.stringify({
  me,
  cal_booked: calLoad.booked,
  cal_queue: calLoad.queue,
  cal_raw: calLoad.raw,
  email: clicks.find((c) => /EMAIL/.test(c.claim))?.happen,
  sms: clicks.find((c) => /SMS/.test(c.claim))?.happen,
  docs: clicks.find((c) => /Documents/.test(c.claim))?.happen,
  pipe: clicks.find((c) => /Pipeline paints/.test(c.claim))?.happen
}));

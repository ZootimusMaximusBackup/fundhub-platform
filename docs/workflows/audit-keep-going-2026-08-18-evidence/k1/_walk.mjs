/**
 * K1 live walk. Owner chris@. Shots + claim vs happen.
 * Does not email a new person. Does not open the live file.
 * Does not press Send. Does not Join Call.
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
  if (fs.existsSync(mac)) return mac;
  const home = process.env.HOME || "";
  const root = path.join(home, "Library/Caches/ms-playwright");
  if (!fs.existsSync(root)) return undefined;
  const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    const exe = path.join(root, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}

function dump(name, obj) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 2) + "\n");
}

function clipText(s, n = 4000) {
  return String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
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

await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator('input[type="email"], #email, input[name="email"]').first().fill("chris@fundhub.ai");
await page.locator('input[type="password"], #password, input[name="password"]').first().fill(PASSWORD);
await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
await page.waitForFunction(() => !/login\.html|portal-login\.html/i.test(location.pathname), null, { timeout: 30000 });

const me = await page.evaluate(async () => {
  const r = await fetch("/api/me", { credentials: "include" });
  const j = await r.json().catch(() => ({}));
  return {
    status: r.status,
    role: j.role || j.staff?.role || j.principal?.role || null,
    email_is_chris: /chris@/i.test(JSON.stringify(j).slice(0, 800))
  };
});

// ---------- Calendar ----------
const taskHttp = [];
page.on("response", async (res) => {
  if (!/\/api\/tasks/.test(res.url())) return;
  const j = await res.json().catch(() => ({}));
  const tasks = j.tasks || [];
  taskHttp.push({
    url: res.url().replace(/^https:\/\/fundhub\.ai/, ""),
    status: res.status(),
    ok: j.ok === true,
    n: tasks.length,
    error: j.error || null,
    strategy_n: tasks.filter((t) => /strategy session booked/i.test(t.title || "")).length,
    has_k1_task: tasks.some((t) => t && t.id === TASK)
  });
});

await page.goto(BASE + "/app/calendar.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForFunction(() => {
  const el = document.getElementById("statBooked");
  return el && el.textContent && el.textContent.trim() !== "—";
}, null, { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);

async function calendarState() {
  return page.evaluate((ids) => {
    const text = (document.body && document.body.innerText) || "";
    const foot = document.getElementById("footView")?.textContent || "";
    const chips = [].slice.call(document.querySelectorAll(".ws-chip")).map((el) => el.textContent.trim());
    const evts = [].slice.call(document.querySelectorAll(".evt-client, .evt-meta")).map((el) => el.textContent.trim());
    const thenRows = [].slice.call(document.querySelectorAll(".then-row")).map((el) => ({
      text: el.textContent.replace(/\s+/g, " ").trim(),
      taskId: el.dataset.taskId || null
    }));
    const days = [].slice.call(document.querySelectorAll(".ws-day")).map((el) => ({
      ymd: el.dataset.ymd || null,
      text: el.textContent.replace(/\s+/g, " ").trim(),
      empty: el.classList.contains("empty")
    }));
    const join = document.getElementById("unJoin");
    const file = document.getElementById("unFile");
    const fileClient = (file && file.dataset.clientId) || null;
    const queue = {
      n: (typeof datedTasks !== "undefined" && datedTasks) ? datedTasks.length : null,
      ids: (typeof datedTasks !== "undefined" && datedTasks)
        ? datedTasks.map((t) => t && t.id).filter(Boolean).slice(0, 30)
        : [],
      has_task: (typeof datedTasks !== "undefined" && datedTasks)
        ? datedTasks.some((t) => t && t.id === ids.TASK)
        : null,
      has_funnel: (typeof datedTasks !== "undefined" && datedTasks)
        ? datedTasks.some((t) => t && t.client_id === ids.FUNNEL)
        : null,
      match: (typeof datedTasks !== "undefined" && datedTasks)
        ? datedTasks.filter((t) => t && (t.id === ids.TASK || t.client_id === ids.FUNNEL || /strategy session booked/i.test(t.title || "") || /e2e/i.test(t.client_name || "")))
          .map((t) => ({
            id: t.id,
            title: t.title,
            due_at: t.due_at,
            client_id: t.client_id,
            client_name: t.client_name,
            done: t.done
          }))
        : []
    };
    return {
      href: location.href,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      clock: document.querySelector(".clock")?.textContent || "",
      datelabel: document.querySelector(".datelabel")?.textContent || "",
      view: document.body.classList.contains("week-view") ? "week" : "day",
      booked: document.getElementById("statBooked")?.textContent || "",
      done: document.getElementById("statDone")?.textContent || "",
      left: document.getElementById("statLeft")?.textContent || "",
      foot,
      upNext: document.getElementById("unClient")?.textContent || "",
      upWhen: document.getElementById("unWhen")?.textContent || "",
      upMeta: document.getElementById("unMeta")?.textContent || "",
      joinDisabled: join ? join.disabled : null,
      fileDisabled: file ? file.disabled : null,
      fileClient,
      fileIsLive: fileClient === ids.LIVE,
      fileIsFunnel: fileClient === ids.FUNNEL,
      fileIsTest: fileClient === ids.TEST,
      nothingBooked: /nothing booked/i.test(text),
      sawStrategy: /strategy session booked/i.test(text),
      sawE2e: /e2e/i.test(text),
      saw800: /8:00/.test(text),
      saw1100: /11:00/.test(text),
      chips,
      evts: evts.slice(0, 20),
      thenRows: thenRows.slice(0, 12),
      days,
      queue,
      text: text.replace(/\s+/g, " ").trim().slice(0, 2200)
    };
  }, { TASK, FUNNEL, TEST, LIVE });
}

const calToday = await calendarState();
await page.screenshot({ path: path.join(OUT, "01-calendar-today.png"), fullPage: true });
dump("01-calendar-today.json", calToday);
record(
  "Owner Calendar today Aug 18 shows 8:00 PM Strategy session booked / E2e Fire hold",
  calToday.sawStrategy || calToday.queue.has_task || calToday.sawE2e
    ? "hold visible or in loaded queue"
    : (calToday.nothingBooked ? "Nothing booked. Hold not painted." : "day painted without the hold")
);

// Day (already active) — click to record
const daySeg = page.locator('#seg span[data-v="day"]');
const weekSeg = page.locator('#seg span[data-v="week"]');
await weekSeg.click();
await page.waitForTimeout(400);
const calWeek = await calendarState();
await page.screenshot({ path: path.join(OUT, "02-calendar-week.png"), fullPage: true });
dump("02-calendar-week.json", calWeek);
record("Week control switches the view to week", calWeek.view === "week" ? "view=week" : `view=${calWeek.view}`);

await daySeg.click();
await page.waitForTimeout(400);
const calDay = await calendarState();
await page.screenshot({ path: path.join(OUT, "03-calendar-day.png"), fullPage: true });
dump("03-calendar-day.json", calDay);
record("Day control switches the view back to day", calDay.view === "day" ? "view=day" : `view=${calDay.view}`);

const navPrev = page.locator(".navbtn").nth(0);
const navNext = page.locator(".navbtn").nth(1);
const todayBtn = page.locator(".today-btn");

const beforePrev = calDay.datelabel;
await navPrev.click();
await page.waitForTimeout(300);
const afterPrev = await calendarState();
await page.screenshot({ path: path.join(OUT, "04-calendar-prev.png"), fullPage: true });
dump("04-calendar-prev.json", afterPrev);
record("‹ moves to the previous day", afterPrev.datelabel !== beforePrev ? `${beforePrev} → ${afterPrev.datelabel}` : `label stayed ${afterPrev.datelabel}`);

await navNext.click();
await page.waitForTimeout(300);
const afterNext = await calendarState();
await page.screenshot({ path: path.join(OUT, "05-calendar-next-back.png"), fullPage: true });
dump("05-calendar-next-back.json", afterNext);
record("› moves forward one day", afterNext.datelabel !== afterPrev.datelabel ? `${afterPrev.datelabel} → ${afterNext.datelabel}` : `label stayed ${afterNext.datelabel}`);

await navNext.click();
await page.waitForTimeout(300);
const afterNext2 = await calendarState();
await page.screenshot({ path: path.join(OUT, "06-calendar-next.png"), fullPage: true });
dump("06-calendar-next.json", afterNext2);
record("› again moves to the next day", afterNext2.datelabel !== afterNext.datelabel ? `${afterNext.datelabel} → ${afterNext2.datelabel}` : `label stayed ${afterNext2.datelabel}`);

await todayBtn.click();
await page.waitForTimeout(300);
const afterToday = await calendarState();
await page.screenshot({ path: path.join(OUT, "07-calendar-today-btn.png"), fullPage: true });
dump("07-calendar-today-btn.json", afterToday);
record("Today jumps back to Aug 18", /august 18/i.test(afterToday.datelabel) ? `label=${afterToday.datelabel}` : `label=${afterToday.datelabel}`);

const dayCount = await page.locator("#wsGrid .ws-day").count();
const stripClicks = [];
for (let i = 0; i < dayCount; i++) {
  const day = page.locator("#wsGrid .ws-day").nth(i);
  const ymd = await day.getAttribute("data-ymd");
  await day.click();
  await page.waitForTimeout(250);
  const st = await calendarState();
  const shot = `08-calendar-strip-${ymd || i}.png`;
  await page.screenshot({ path: path.join(OUT, shot), fullPage: true });
  dump(shot.replace(".png", ".json"), st);
  const happen = `label=${st.datelabel}; booked=${st.booked}; nothing=${st.nothingBooked}`;
  record(`Week-strip day ${ymd} opens that day`, happen);
  stripClicks.push({ ymd, happen, nothingBooked: st.nothingBooked, booked: st.booked, sawStrategy: st.sawStrategy });
}
dump("08-calendar-strip.json", stripClicks);

await todayBtn.click();
await page.waitForTimeout(300);

const thenCount = await page.locator(".then-row[data-task-id]").count();
if (thenCount) {
  const row = page.locator(".then-row[data-task-id]").first();
  const tid = await row.getAttribute("data-task-id");
  if (tid === LIVE) {
    record("Then row", "SKIPPED — task id matched forbidden live file");
  } else {
    await row.click();
    await page.waitForTimeout(400);
    const st = await calendarState();
    await page.screenshot({ path: path.join(OUT, "09-calendar-then-row.png"), fullPage: true });
    dump("09-calendar-then-row.json", st);
    record("Existing Then row selects that hold", `task=${tid}; upNext=${st.upNext}; label=${st.datelabel}`);
  }
} else {
  record("Existing Then row", "no dated Then row to click");
  await page.screenshot({ path: path.join(OUT, "09-calendar-then-empty.png"), fullPage: true });
}

const evtCount = await page.locator(".evt").count();
if (evtCount) {
  await page.locator(".evt").first().click();
  await page.waitForTimeout(300);
  const st = await calendarState();
  await page.screenshot({ path: path.join(OUT, "10-calendar-event-row.png"), fullPage: true });
  dump("10-calendar-event-row.json", st);
  record("Existing day row is clickable", `evt count=${evtCount}; upNext=${st.upNext}`);
} else {
  record("Existing day row", "no event row on the selected day");
}

const demo = page.locator("#demoToggle");
if (await demo.count()) {
  await demo.click();
  await page.waitForTimeout(300);
  const demoOpen = await page.evaluate(() => {
    const body = document.getElementById("demoBody");
    return { hidden: body ? body.hidden : null, text: (body && body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 400) };
  });
  await page.screenshot({ path: path.join(OUT, "11-calendar-demo.png"), fullPage: true });
  dump("11-calendar-demo.json", demoOpen);
  record("Demonstration states toggle opens the demo drawer", demoOpen.hidden === false ? "drawer open" : `hidden=${demoOpen.hidden}`);
}

const fileBtn = page.locator("#unFile");
const fileMeta = await page.evaluate((live) => {
  const el = document.getElementById("unFile");
  return {
    disabled: el ? el.disabled : true,
    clientId: el && el.dataset.clientId || null,
    isLive: el && el.dataset.clientId === live
  };
}, LIVE);
if (!fileMeta.disabled && fileMeta.clientId && !fileMeta.isLive && (fileMeta.clientId === FUNNEL || fileMeta.clientId === TEST)) {
  await fileBtn.click();
  await page.waitForTimeout(2000);
  const href = page.url();
  await page.screenshot({ path: path.join(OUT, "12-calendar-client-file.png"), fullPage: true });
  dump("12-calendar-client-file.json", { href, opened_live: href.includes(LIVE) });
  record("Client file opens the linked test/funnel file", href.includes(LIVE) ? "STOPPED live file" : href);
  await page.goto(BASE + "/app/calendar.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2000);
} else {
  record("Client file", fileMeta.isLive ? "SKIPPED live file" : `disabled=${fileMeta.disabled}; client=${fileMeta.clientId || "none"}`);
}
record("Join Call", "not clicked — could open a real meeting");

const calApi = await page.evaluate(async () => {
  async function grab(done) {
    const r = await fetch("/api/tasks?done=" + done + "&limit=200", { credentials: "include" });
    const j = await r.json().catch(() => ({}));
    const tasks = j.tasks || [];
    return {
      status: r.status,
      ok: j.ok === true,
      n: tasks.length,
      dated: tasks.filter((t) => t && t.due_at).length,
      strategy: tasks.filter((t) => /strategy session booked/i.test(t.title || "")).map((t) => ({
        id: t.id,
        due_at: t.due_at,
        client_id: t.client_id,
        client_name: t.client_name,
        done: t.done
      }))
    };
  }
  return { open: await grab("false"), closed: await grab("true") };
});
dump("13-calendar-api.json", calApi);
dump("13b-task-http.json", taskHttp);

// ---------- Messaging TEST ----------
await page.goto(`${BASE}/app/messaging.html?client_id=${TEST}`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(4500);
if (page.url().includes(LIVE)) throw new Error("messaging opened live file");

async function messagingState() {
  return page.evaluate((ids) => {
    const text = (document.body && document.body.innerText) || "";
    const convos = [].slice.call(document.querySelectorAll(".convo")).map((el) => ({
      id: el.dataset.id || null,
      active: el.classList.contains("active"),
      text: el.textContent.replace(/\s+/g, " ").trim().slice(0, 240)
    }));
    return {
      href: location.href,
      has_test: location.href.includes(ids.TEST),
      has_live: location.href.includes(ids.LIVE),
      convos,
      saw_email_tag: /EMAIL/.test(text),
      saw_sms_tag: /\bSMS\b/.test(text),
      saw_reply: /e2e fire reply/i.test(text),
      saw_stop: /\bSTOP\b/.test(text),
      saw_ping: /e2e ping/i.test(text),
      saw_fire_thread: /e2e fire/i.test(text),
      compose_note: document.getElementById("composeNote")?.textContent || "",
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
  await page.waitForTimeout(1500);
  const emailSt = await messagingState();
  await page.screenshot({ path: path.join(OUT, "15-messaging-email.png"), fullPage: true });
  dump("15-messaging-email.json", emailSt);
  record(
    "TEST EMAIL thread shows the inbound e2e fire reply",
    emailSt.saw_reply ? "reply visible" : "EMAIL open, reply not visible"
  );
} else {
  record("TEST EMAIL thread shows the inbound e2e fire reply", "no EMAIL conversation row");
  await page.screenshot({ path: path.join(OUT, "15-messaging-email-missing.png"), fullPage: true });
}

const smsConvo = page.locator(".convo").filter({ hasText: /\bSMS\b/i }).first();
if (await smsConvo.count()) {
  await smsConvo.click();
  await page.waitForTimeout(1500);
  const smsSt = await messagingState();
  await page.screenshot({ path: path.join(OUT, "16-messaging-sms.png"), fullPage: true });
  dump("16-messaging-sms.json", smsSt);
  record(
    "TEST SMS thread shows the sent e2e ping",
    smsSt.saw_ping ? "ping visible" : "SMS open, ping not visible"
  );
} else {
  record("TEST SMS thread shows the sent e2e ping", "no SMS conversation row");
  await page.screenshot({ path: path.join(OUT, "16-messaging-sms-missing.png"), fullPage: true });
}

const msgApi = await page.evaluate(async (testId) => {
  const inbox = await fetch("/api/read/inbox?limit=50", { credentials: "include" }).then((r) => r.json().catch(() => ({})));
  const convos = await fetch("/api/read/conversations?client_id=" + testId, { credentials: "include" }).then((r) => r.json().catch(() => ({})));
  const items = convos.items || convos.conversations || convos.data || [];
  const threads = [];
  for (const row of items) {
    const id = row.id;
    const msgs = await fetch("/api/read/messages?conversation_id=" + id, { credentials: "include" }).then((r) => r.json().catch(() => ({})));
    const list = msgs.items || msgs.messages || [];
    threads.push({
      id,
      channel: row.channel,
      n: list.length,
      reply: list.some((m) => /e2e fire reply/i.test((m.subject || "") + " " + (m.body || m.rendered_body || ""))),
      ping: list.some((m) => /e2e ping/i.test(m.body || m.rendered_body || "")),
      subjects: list.map((m) => m.subject).filter(Boolean).slice(0, 8)
    });
  }
  return {
    inbox_ok: inbox.ok === true,
    convo_n: items.length,
    threads
  };
}, TEST);
dump("17-messaging-api.json", msgApi);

// ---------- Documents funnel ----------
await page.goto(`${BASE}/app/documents.html`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(4000);
const qBox = page.locator("#q, input[type=search], input[placeholder*='earch' i]").first();
if (await qBox.count()) {
  await qBox.fill(FUNNEL);
  await page.waitForTimeout(800);
}
const docsState = await page.evaluate((funnel) => {
  const text = (document.body && document.body.innerText) || "";
  const rows = [].slice.call(document.querySelectorAll("table tbody tr, .doc-row, tr")).slice(0, 20)
    .map((el) => el.textContent.replace(/\s+/g, " ").trim()).filter(Boolean);
  return {
    href: location.href,
    saw_funnel_id: text.includes(funnel),
    saw_e2e: /e2e/i.test(text),
    empty: /no documents on file yet|nothing matches that filter/i.test(text),
    row_n: rows.length,
    rows: rows.slice(0, 12),
    text: text.replace(/\s+/g, " ").trim().slice(0, 2200)
  };
}, FUNNEL);
await page.screenshot({ path: path.join(OUT, "18-documents-funnel.png"), fullPage: true });
dump("18-documents-funnel.json", docsState);
record("Documents paints the new funnel client", docsState.empty ? "empty / no match" : (docsState.saw_funnel_id || docsState.saw_e2e ? "funnel visible" : "page painted, funnel not seen"));

const docsApi = await page.evaluate(async (funnel) => {
  const r = await fetch("/api/read/documents?client_id=" + funnel, { credentials: "include" });
  const j = await r.json().catch(() => ({}));
  const items = j.items || j.documents || [];
  return {
    status: r.status,
    ok: j.ok === true,
    n: items.length,
    kinds: items.map((d) => ({ kind: d.kind, subtype: d.subtype, title: d.title }))
  };
}, FUNNEL);
dump("19-documents-api.json", docsApi);

// ---------- Pipeline funnel ----------
await page.goto(`${BASE}/app/pipeline.html`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(4500);
const pipeSearch = page.locator("input[type=search], input[placeholder*='earch' i], #q").first();
if (await pipeSearch.count()) {
  const funnelName = (calApi.open.strategy.find((t) => t.client_id === FUNNEL) || {}).client_name || "";
  await pipeSearch.fill(funnelName || FUNNEL.slice(0, 8));
  await page.waitForTimeout(800);
}
const pipeState = await page.evaluate((ids) => {
  const text = (document.body && document.body.innerText) || "";
  const cards = [].slice.call(document.querySelectorAll("[data-client-id], .card, .pipe-card")).map((el) => ({
    clientId: el.dataset.clientId || null,
    text: el.textContent.replace(/\s+/g, " ").trim().slice(0, 160)
  }));
  const funnelCards = cards.filter((c) => c.clientId === ids.FUNNEL);
  return {
    href: location.href,
    saw_funnel_id: text.includes(ids.FUNNEL),
    saw_e2e: /e2e/i.test(text),
    card_n: cards.length,
    funnel_card_n: funnelCards.length,
    funnel_cards: funnelCards.slice(0, 5),
    text: text.replace(/\s+/g, " ").trim().slice(0, 2200)
  };
}, { FUNNEL });
await page.screenshot({ path: path.join(OUT, "20-pipeline-funnel.png"), fullPage: true });
dump("20-pipeline-funnel.json", pipeState);
record("Pipeline paints the new funnel client", pipeState.funnel_card_n > 0 || pipeState.saw_e2e || pipeState.saw_funnel_id ? "funnel card/name seen" : "funnel not on the board");

const pipeApi = await page.evaluate(async (funnel) => {
  const r = await fetch("/api/dashboard/pipeline", { credentials: "include" });
  const j = await r.json().catch(() => ({}));
  const cards = j.cards || j.items || (j.pipelines || []).flatMap((p) => p.cards || []) || [];
  const hit = (Array.isArray(cards) ? cards : []).filter((c) => c && (c.client_id === funnel || c.clientId === funnel));
  return {
    status: r.status,
    ok: j.ok === true,
    keys: Object.keys(j || {}).slice(0, 20),
    funnel_n: hit.length,
    funnel: hit.slice(0, 5).map((c) => ({
      id: c.id,
      stage: c.stage || c.stage_key || c.stage_name,
      name: c.name || c.client_name
    }))
  };
}, FUNNEL);
dump("21-pipeline-api.json", pipeApi);

dump("00-me.json", me);
dump("22-clicks.json", { at: new Date().toISOString(), me, clicks });

await browser.close();
console.log(JSON.stringify({
  me,
  cal_nothing: calToday.nothingBooked,
  cal_strategy: calToday.sawStrategy,
  cal_queue_has_task: calToday.queue.has_task,
  email_reply: clicks.find((c) => /EMAIL/.test(c.claim))?.happen,
  sms_ping: clicks.find((c) => /SMS/.test(c.claim))?.happen,
  docs: clicks.find((c) => /Documents/.test(c.claim))?.happen,
  pipe: clicks.find((c) => /Pipeline/.test(c.claim))?.happen,
  click_n: clicks.length
}));

#!/usr/bin/env node
/**
 * B1 — human click on apply.fundhub.ai/funding-book-call with a plus-tag.
 * Wait 2 minutes. Prove clients + booking + confirm messages.
 * No API seeding. Never touches 9af65808.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  loadEnv, plusTag, FUNNEL, FORBIDDEN, openDb, q, guardClient, launchBrowser
} from "../_lib.mjs";

loadEnv();

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, "shots/_raw");
const SHOTS = join(HERE, "shots");
mkdirSync(RAW, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

const stamp = `b1ghost-${Date.now()}`;
const email = plusTag(stamp);
const phone = String(process.env.FUNDHUB_TEST_PHONE || "").replace(/\D/g, "") || "6616180865";
const WAIT_MS = 120000;

function writeProof(obj) {
  const p = join(HERE, "b1-ghost-booking.json");
  writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}

async function shot(page, name, marks = []) {
  const raw = join(RAW, `${name}.png`);
  await page.screenshot({ path: raw, fullPage: false });
  const boxes = [];
  for (const m of marks) {
    let box = null;
    try {
      if (m.sel) {
        const loc = page.locator(m.sel).first();
        if (await loc.count()) {
          await loc.scrollIntoViewIfNeeded().catch(() => null);
          box = await loc.boundingBox();
        }
      }
    } catch { /* keep going */ }
    boxes.push({
      n: m.n,
      caption: m.caption,
      box: box ? { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) } : null
    });
  }
  return { raw: `fixer/shots/_raw/${name}.png`, boxes };
}

function applyMarks(name, legend, boxes) {
  const man = join(HERE, "shot-marks.json");
  let cur = {};
  if (existsSync(man)) {
    try { cur = JSON.parse(readFileSync(man, "utf8")); } catch { cur = {}; }
  }
  cur[`${name}.png`] = {
    legend,
    marks: (boxes || []).filter((b) => b.box).map((b, i) => ({
      n: b.n || String(i + 1),
      caption: b.caption,
      box: b.box
    }))
  };
  writeFileSync(man, JSON.stringify(cur, null, 2));
  const py = join(HERE, "_apply-marks.py");
  if (existsSync(py)) spawnSync("python3", [py], { cwd: HERE, stdio: "inherit" });
}

async function clickFirstTime(scope) {
  const slotBtn = scope.locator("button, a, [role=button], div, span").filter({ hasText: /\d{1,2}:\d{2}|\bAM\b|\bPM\b/i });
  const n = await slotBtn.count();
  for (let i = 0; i < Math.min(n, 40); i++) {
    const txt = ((await slotBtn.nth(i).innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
    if (!/\d/.test(txt)) continue;
    if (txt.length > 40) continue;
    await slotBtn.nth(i).click({ timeout: 4000 }).catch(() => {});
    return { clicked: true, text: txt.slice(0, 80) };
  }
  return { clicked: false, text: null, counted: n };
}

async function fillIfVisible(scope, sel, value) {
  const loc = scope.locator(sel).first();
  if (await loc.isVisible().catch(() => false)) {
    await loc.fill(value);
    return true;
  }
  return false;
}

const db = await openDb();
const browser = await launchBrowser();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
});
await context.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
});
const page = await context.newPage();

const proof = {
  started: new Date().toISOString(),
  email_is_plus: email.includes("+"),
  forbidden_touched: false,
  wait_ms: WAIT_MS
};

try {
  await page.goto(`${FUNNEL}/funding-book-call`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(5000);

  const before = await shot(page, "b1-funnel-before-1440", [
    { n: "1", sel: "h1, [data-page-element='AppointmentScheduler/V1']", caption: "Book-call page before picking a time" }
  ]);
  applyMarks("b1-funnel-before-1440", "B1 funnel before book", before.boxes);

  let slot = await clickFirstTime(page);
  if (!slot.clicked) {
    for (const frame of page.frames()) {
      slot = await clickFirstTime(frame);
      if (slot.clicked) break;
    }
  }
  await page.waitForTimeout(1500);

  const confirm = page.locator("button, a, [role=button]").filter({ hasText: /^Confirm/i }).first();
  if (await confirm.isVisible().catch(() => false)) await confirm.click().catch(() => {});
  await page.waitForTimeout(1500);

  const filled = {
    name: await fillIfVisible(page, 'input[name="name"], input[placeholder*="Name" i]', "B1 Ghost Book"),
    email: await fillIfVisible(page, 'input[name="email"], input[type="email"]', email),
    phone: await fillIfVisible(page, 'input[name="phone_number"], input[type="tel"], input[name="phone"]', phone)
  };
  if (!filled.email) {
    for (const frame of page.frames()) {
      filled.name = filled.name || await fillIfVisible(frame, 'input[name="name"], input[placeholder*="Name" i]', "B1 Ghost Book");
      filled.email = filled.email || await fillIfVisible(frame, 'input[name="email"], input[type="email"]', email);
      filled.phone = filled.phone || await fillIfVisible(frame, 'input[name="phone_number"], input[type="tel"], input[name="phone"]', phone);
    }
  }

  const bookBtn = page.locator("button, a, [role=button]").filter({ hasText: /book appointment|schedule|confirm booking/i }).first();
  let bookedClick = false;
  if (await bookBtn.isVisible().catch(() => false)) {
    await bookBtn.click().catch(() => {});
    bookedClick = true;
  } else {
    for (const frame of page.frames()) {
      const fb = frame.locator("button, a, [role=button]").filter({ hasText: /book appointment|schedule|confirm booking/i }).first();
      if (await fb.isVisible().catch(() => false)) {
        await fb.click().catch(() => {});
        bookedClick = true;
        break;
      }
    }
  }
  await page.waitForTimeout(8000);

  const bodyTxt = await page.locator("body").innerText().catch(() => "");
  const thankYou = /booked|confirmed|thank you|you.re all set|success/i.test(bodyTxt);
  const after = await shot(page, "b1-thankyou-1440", [
    { n: "1", sel: "h1, h2, [class*='thank']", caption: "Thank-you / booked copy" }
  ]);
  applyMarks("b1-thankyou-1440", "B1 thank-you after book click", after.boxes);

  proof.ui = {
    url: page.url(),
    slot,
    filled,
    bookedClick,
    thankYou,
    body_preview: bodyTxt.replace(/\s+/g, " ").slice(0, 400),
    shots: [
      "fixer/shots/b1-funnel-before-1440-MARKED.png",
      "fixer/shots/b1-thankyou-1440-MARKED.png"
    ]
  };

  const polls = [];
  let client = null;
  let bookings = [];
  let events = [];
  const t0 = Date.now();
  while (Date.now() - t0 < WAIT_MS) {
    const rows = await q(db, `SELECT id, org_id, email, first_name, last_name, created_at
       FROM clients
      WHERE lower(email) = lower($1)
        AND id::text NOT LIKE '9af65808%'
      ORDER BY created_at DESC LIMIT 1`, [email]);
    client = rows[0] || null;
    if (client) guardClient(client.id);
    events = await q(db, `SELECT id, name, client_id, created_at,
            payload->>'email' AS payload_email,
            payload->>'startTime' AS start_time
       FROM events
      WHERE lower(payload->>'email') = lower($1)
        AND created_at > now() - interval '20 minutes'
      ORDER BY created_at ASC`, [email]).catch((e) => [{ error: String(e.message).slice(0, 200) }]);
    bookings = client
      ? await q(db, `SELECT id, client_id, provider_uid, starts_at, status, attendee_email, created_at
           FROM bookings WHERE client_id = $1::uuid
           ORDER BY created_at DESC LIMIT 5`, [client.id]).catch((e) => [{ error: String(e.message).slice(0, 200) }])
      : await q(db, `SELECT id, client_id, provider_uid, starts_at, status, attendee_email, created_at
           FROM bookings WHERE lower(attendee_email) = lower($1)
             AND created_at > now() - interval '20 minutes'
           ORDER BY created_at DESC LIMIT 5`, [email]).catch((e) => [{ error: String(e.message).slice(0, 200) }]);
    const hasBooking = Array.isArray(bookings) && bookings[0] && bookings[0].id;
    const hasBookingEvt = Array.isArray(events) && events.some((e) => e.name === "booking.created");
    const messagesSoFar = client
      ? await q(db, `SELECT id, channel, template_key, status, created_at
           FROM messages WHERE client_id = $1::uuid
           ORDER BY created_at DESC LIMIT 20`, [client.id]).catch(() => [])
      : [];
    const confirmQueuedSoFar = Array.isArray(messagesSoFar) && messagesSoFar.some((m) =>
      m.template_key === "SMS-S04-01-CONFIRM" || m.template_key === "SMS-BS01-01-BOOKED"
    );
    polls.push({
      at_ms: Date.now() - t0,
      client: !!client,
      bookings: Array.isArray(bookings) ? bookings.length : 0,
      booking_created: !!hasBookingEvt,
      confirm_queued: confirmQueuedSoFar
    });
    if (client && hasBooking && hasBookingEvt && confirmQueuedSoFar) break;
    await new Promise((r) => setTimeout(r, 10000));
  }

  if (client) guardClient(client.id);

  const messages = client
    ? await q(db, `SELECT id, channel, template_key, status, created_at
         FROM messages WHERE client_id = $1::uuid
         ORDER BY created_at DESC LIMIT 20`, [client.id]).catch((e) => [{ error: String(e.message).slice(0, 200) }])
    : [];

  const bookingCreated = Array.isArray(events) && events.some((e) => e.name === "booking.created" && e.payload_email);
  const confirmKeys = new Set([
    "SMS-S04-01-CONFIRM",
    "SMS-BS01-01-BOOKED",
    "EMAIL-S04-01-CONFIRM"
  ]);
  const confirmQueued = Array.isArray(messages) && messages.some((m) => confirmKeys.has(m.template_key));

  proof.elapsed_ms = Date.now() - t0;
  proof.polls = polls;
  proof.client = client
    ? { id: client.id, created_at: client.created_at, name: `${client.first_name || ""} ${client.last_name || ""}`.trim() }
    : null;
  proof.events = Array.isArray(events)
    ? events.map((e) => ({
        id: e.id,
        name: e.name,
        client_id: e.client_id,
        has_email: !!e.payload_email,
        start_time: e.start_time || null,
        created_at: e.created_at
      }))
    : events;
  proof.bookings = Array.isArray(bookings)
    ? bookings.map((b) => ({
        id: b.id,
        client_id: b.client_id,
        status: b.status,
        starts_at: b.starts_at,
        created_at: b.created_at,
        attendee_is_plus: String(b.attendee_email || "").includes("+")
      }))
    : bookings;
  proof.messages = Array.isArray(messages)
    ? messages.map((m) => ({
        id: m.id,
        channel: m.channel,
        template_key: m.template_key,
        status: m.status,
        created_at: m.created_at
      }))
    : messages;
  proof.booking_created_with_email = bookingCreated;
  proof.confirm_queued = confirmQueued;
  proof.pass = !!(client && (Array.isArray(bookings) && bookings[0] && bookings[0].id) && (bookingCreated || confirmQueued));
  proof.finished = new Date().toISOString();
  writeProof(proof);
  console.log(JSON.stringify({
    pass: proof.pass,
    thankYou,
    client: !!client,
    bookings: Array.isArray(bookings) ? bookings.length : 0,
    booking_created_with_email: bookingCreated,
    confirm_queued: confirmQueued,
    wait_ms: WAIT_MS
  }));
} catch (err) {
  proof.error = String(err && err.message ? err.message : err).slice(0, 500);
  proof.finished = new Date().toISOString();
  writeProof(proof);
  throw err;
} finally {
  await browser.close().catch(() => {});
  await db.end().catch(() => {});
}

if (!proof.pass) process.exit(2);

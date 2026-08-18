import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-crm-whole-2026-08-18-evidence/w4");
const BASE = "https://fundhub.ai";
const DEMO = "94796e0e-d012-4987-8721-676093aaed79";
const TEST_CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const PORTAL_EMAIL = "client@fundhub.ai";

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
if (!PASSWORD) throw new Error("STAFF_E2E_PASSWORD missing");

function chromeExe() {
  const home = process.env.HOME || "";
  const root = path.join(home, "Library/Caches/ms-playwright");
  const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    const exe = path.join(root, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (fs.existsSync(exe)) return exe;
  }
}

function db() {
  return new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
}

const clicks = [];
const nets = [];
function rec(row) {
  clicks.push({ at: new Date().toISOString(), ...row });
  console.log(JSON.stringify({ screen: row.screen, control: row.control, happened: (row.happened || "").slice(0, 180), shot: row.shot || null }));
}
async function shot(page, slug, full = false) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: full }).catch(() => {});
  return path.relative(ROOT, file);
}
function attach(page) {
  page.on("dialog", async (d) => { await d.dismiss(); });
  page.on("response", (res) => {
    const url = res.url().replace(BASE, "").slice(0, 220);
    const status = res.status();
    const method = res.request().method();
    if (status >= 400 || method !== "GET") nets.push({ status, method, url });
  });
}
async function login(page, email) {
  await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator('input[type="email"], #email').first().fill(email);
  await page.locator('input[type="password"], #password').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForFunction(() => !/login\.html/i.test(location.pathname), null, { timeout: 30000 });
}
async function textOf(page, sel) {
  return (await page.locator(sel).first().innerText().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 280);
}
async function openRole(page, role, slug, file) {
  try {
    await page.goto(`${BASE}/app/${file}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  } catch (e) {
    await page.waitForTimeout(800);
  }
  await page.waitForTimeout(1000);
  const pathNow = await page.evaluate(() => location.pathname + location.search).catch(() => "?");
  const bounced = !new RegExp(file.replace(".", "\\."), "i").test(pathNow);
  rec({
    screen: file,
    control: `open as ${role}`,
    claimed: `${role} opens ${file}`,
    happened: bounced ? `bounced to ${pathNow}` : `stayed on ${pathNow} · ${await textOf(page, "h1")}`,
    shot: await shot(page, `${slug}-${role}`),
    bounced,
    path: pathNow
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: chromeExe(), args: ["--disable-dev-shm-usage"] });

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  attach(page);
  await login(page, "chris@fundhub.ai");

  await page.goto(`${BASE}/app/social-studio.html?partner_id=${DEMO}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2200);
  const genOn = await page.locator("#ssGenBtn").isEnabled().catch(() => false);
  rec({
    screen: "social-studio",
    control: "Write 3 posts for me (after suite on)",
    claimed: "Generate 3 drafts now that DEMO suite is on",
    happened: genOn ? "button is live" : "still disabled",
    shot: await shot(page, "social-after-enable", true)
  });
  if (genOn) {
    await page.locator("#ssGenBtn").click();
    await page.waitForTimeout(5000);
    rec({
      screen: "social-studio",
      control: "Write 3 posts for me",
      claimed: "Generate 3 drafts",
      happened: await textOf(page, "#ssGenMsg") || "clicked",
      api: nets.filter((n) => /social\/generate/.test(n.url)).slice(-1)[0] || null,
      shot: await shot(page, "social-generate-after")
    });
  }

  await page.goto(`${BASE}/app/creative-factory.html?partner_id=${DEMO}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2500);
  const enq = await page.locator("#genBtn").isEnabled().catch(() => false);
  rec({
    screen: "creative-factory",
    control: "Enqueue generation (after suite on)",
    claimed: "Enqueue a job now that DEMO suite is on",
    happened: enq ? "button is live" : `still off · ${await textOf(page, "#genMsg")}`,
    shot: await shot(page, "creative-after-enable", true)
  });
  if (enq) {
    await page.locator("#genKind").selectOption("copy").catch(() => {});
    await page.locator("#genPrompt").fill("DEMO audit after enable. One short line. Do not publish.");
    await page.locator("#genIdem").fill(`w4-after-${Date.now()}`);
    await page.locator("#genBtn").click();
    await page.waitForTimeout(2500);
    rec({
      screen: "creative-factory",
      control: "Enqueue generation",
      claimed: "Put a job on the queue",
      happened: await textOf(page, "#genMsg") || "clicked",
      api: nets.filter((n) => /creative\/generate/.test(n.url)).slice(-1)[0] || null,
      shot: await shot(page, "creative-enqueue-after")
    });
    if (await page.locator("#runJobsBtn").isEnabled().catch(() => false)) {
      await page.locator("#runJobsBtn").click();
      await page.waitForTimeout(3500);
      rec({
        screen: "creative-factory",
        control: "Run queued jobs now",
        claimed: "Start queued jobs",
        happened: await textOf(page, "#genMsg") || "clicked",
        api: nets.filter((n) => /creative\/run/.test(n.url)).slice(-1)[0] || null,
        shot: await shot(page, "creative-run-after")
      });
    }
  }

  await page.goto(`${BASE}/app/campaign-manager.html?partner_id=${DEMO}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4000);
  rec({
    screen: "campaigns",
    control: "Reload after wait",
    claimed: "Spend panels finish reading",
    happened: await textOf(page, "#footNote, #loadWarn, #scopeName"),
    shot: await shot(page, "campaigns-after-wait", true)
  });
  await ctx.close();

  const files = [
    ["campaigns", "campaign-manager.html"],
    ["social", "social-studio.html"],
    ["creative", "creative-factory.html"],
    ["brand", "brand-studio.html"],
    ["galaxy", "galaxy.html"],
    ["brain", "company-brain.html"],
    ["affiliate", "affiliate.html"],
    ["portal", "client-portal.html"]
  ];

  for (const { role, email } of [
    { role: "advisor", email: "advisor@fundhub.ai" },
    { role: "affiliate", email: "affiliate@fundhub.ai" }
  ]) {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await c.newPage();
    attach(p);
    await login(p, email);
    rec({
      screen: "login",
      control: `Sign in as ${role}`,
      claimed: `${email} reaches home`,
      happened: await p.evaluate(() => location.pathname),
      shot: await shot(p, `00-${role}-login`)
    });
    if (role === "affiliate") {
      await p.goto(`${BASE}/app/affiliate.html`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await p.waitForTimeout(1500);
      rec({
        screen: "affiliate",
        control: "Open as affiliate",
        claimed: "Affiliate portal with own code",
        happened: `code=${await textOf(p, "#affCode")} link=${await p.locator("#reflink").inputValue().catch(() => "")} referred=${await textOf(p, "#kRef")}`,
        shot: await shot(p, "affiliate-affiliate", true)
      });
      if (await p.locator("#brainQ").isVisible().catch(() => false)) {
        await p.locator("#brainQ").fill("What docs can an affiliate see?");
        await p.locator("#brainBtn").click();
        await p.waitForTimeout(5000);
        rec({
          screen: "affiliate",
          control: "Ask",
          claimed: "Answer from approved affiliate docs",
          happened: await textOf(p, "#brainAnswer, #brainStatus"),
          api: nets.filter((n) => /company-brain-affiliate/.test(n.url)).slice(-1)[0] || null,
          shot: await shot(p, "affiliate-affiliate-brain")
        });
      }
      if (await p.locator("#blasterBtn").isVisible().catch(() => false)) {
        await p.locator("#blasterBtn").click();
        await p.waitForTimeout(2000);
        rec({
          screen: "affiliate",
          control: "Download Message Blaster",
          claimed: "Download the Mac gift",
          happened: await textOf(p, "#blasterStatus"),
          api: nets.filter((n) => /message-blaster/.test(n.url)).slice(-1)[0] || null,
          shot: await shot(p, "affiliate-affiliate-blaster")
        });
      }
      await p.locator('button.tab[data-tab="payouts"]').click().catch(() => {});
      await shot(p, "affiliate-affiliate-payouts");
      await p.locator('button.tab[data-tab="terms"]').click().catch(() => {});
      await shot(p, "affiliate-affiliate-terms");
    }
    for (const [slug, file] of files) {
      if (role === "affiliate" && file === "affiliate.html") continue;
      await openRole(p, role, slug, file);
    }
    await c.close();
  }

  const loginCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const lp = await loginCtx.newPage();
  attach(lp);
  await lp.goto(`${BASE}/portal-login.html`, { waitUntil: "domcontentloaded", timeout: 45000 });
  rec({
    screen: "portal-login",
    control: "Open portal login",
    claimed: "Email-link only, no password",
    happened: `passwords=${await lp.locator('input[type="password"]').count()}`,
    shot: await shot(lp, "portal-login")
  });
  let recent = 99;
  try {
    const c = db();
    await c.connect();
    const r = await c.query(
      `SELECT count(*)::int AS n FROM account_magic_links
        WHERE lower(email) = lower($1) AND created_at > now() - interval '15 minutes'`,
      [PORTAL_EMAIL]
    );
    recent = r.rows[0].n;
    await c.end();
  } catch (e) {
    rec({ screen: "portal-login", control: "rate check", claimed: "count recent links", happened: String(e.message || e).slice(0, 160) });
  }
  if (recent < 2) {
    await lp.locator("#email").fill(PORTAL_EMAIL);
    await lp.locator("#go").click();
    await lp.waitForTimeout(2500);
    rec({
      screen: "portal-login",
      control: "Email me a sign-in link",
      claimed: "Queue a sign-in email",
      happened: await textOf(lp, "#ok-box, #err") || "clicked",
      api: nets.filter((n) => /magic-link/.test(n.url)).slice(-1)[0] || null,
      shot: await shot(lp, "portal-login-requested")
    });
  } else {
    rec({
      screen: "portal-login",
      control: "Email me a sign-in link",
      claimed: "Queue a sign-in email",
      happened: `skipped — ${recent} links in last 15 min`,
      shot: await shot(lp, "portal-login")
    });
  }
  await loginCtx.close();

  let link = "";
  try {
    const c = db();
    await c.connect();
    const r = await c.query(
      `SELECT rendered_body FROM messages
        WHERE client_id = $1 AND template_key = 'EMAIL-PORTAL-MAGIC-LINK'
        ORDER BY created_at DESC LIMIT 3`,
      [TEST_CLIENT]
    );
    for (const row of r.rows) {
      const m = String(row.rendered_body || "").match(/https?:\/\/[^"'\\\s>]+portal-login\.html\?t=[A-Za-z0-9_-]+/);
      if (m) { link = m[0]; break; }
    }
    await c.end();
  } catch (e) {
    rec({ screen: "client-portal", control: "find magic link", claimed: "reuse queued link", happened: String(e.message || e).slice(0, 160) });
  }

  const w1dir = path.join(ROOT, "docs/workflows/audit-crm-whole-2026-08-18-evidence/w1");
  const w1has = fs.existsSync(w1dir) && fs.readdirSync(w1dir).some((f) => /portal|client/i.test(f));
  if (w1has) {
    rec({
      screen: "client-portal",
      control: "Open as client",
      claimed: "Client session",
      happened: "W1 already has portal/client evidence — not opening a second magic link"
    });
  } else if (link) {
    const c4 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p4 = await c4.newPage();
    attach(p4);
    await p4.goto(link, { waitUntil: "domcontentloaded", timeout: 45000 });
    await p4.waitForFunction(() => /client-portal\.html/i.test(location.pathname), null, { timeout: 25000 }).catch(() => {});
    await p4.waitForTimeout(1500);
    rec({
      screen: "client-portal",
      control: "Open magic link as client",
      claimed: "Land on own portal",
      happened: await p4.evaluate(() => location.pathname + location.search),
      shot: await shot(p4, "portal-client", true)
    });
    rec({
      screen: "client-portal",
      control: "I sign to authorize…",
      claimed: "Record dispute-letter signature",
      happened: "not pressed — W1 owns dispute sign"
    });
    await c4.close();
  } else {
    rec({
      screen: "client-portal",
      control: "Open as client",
      claimed: "Client session",
      happened: "no unused magic-link URL in messages"
    });
  }

  await browser.close();

  let snap = {};
  try {
    const c = db();
    await c.connect();
    const social = await c.query(`SELECT id, state, left(coalesce(caption,''),80) AS caption, created_at FROM social_posts WHERE partner_id=$1 AND created_at>now()-interval '3 hours' ORDER BY created_at DESC LIMIT 8`, [DEMO]);
    const jobs = await c.query(`SELECT id, status, kind, created_at FROM generation_jobs WHERE partner_id=$1 AND created_at>now()-interval '3 hours' ORDER BY created_at DESC LIMIT 8`, [DEMO]);
    const pages = await c.query(`SELECT id, slug, status, created_at FROM partner_pages WHERE partner_id=$1 ORDER BY created_at DESC LIMIT 8`, [DEMO]);
    const filesR = await c.query(`SELECT id, title, approval_status, created_at FROM brain_files WHERE created_at>now()-interval '3 hours' ORDER BY created_at DESC LIMIT 8`);
    const links = await c.query(`SELECT outcome, created_at FROM account_magic_links WHERE lower(email)=lower($1) AND created_at>now()-interval '15 minutes' ORDER BY created_at DESC`, [PORTAL_EMAIL]);
    const msgs = await c.query(`SELECT id, status, channel, template_key, created_at FROM messages WHERE client_id=$1 AND created_at>now()-interval '3 hours' ORDER BY created_at DESC LIMIT 8`, [TEST_CLIENT]);
    snap = { social_posts: social.rows, generation_jobs: jobs.rows, partner_pages: pages.rows, brain_files: filesR.rows, magic_links_15m: links.rows, messages: msgs.rows };
    await c.end();
  } catch (e) {
    snap = { error: String(e.message || e).slice(0, 240) };
  }

  const prevClicks = JSON.parse(fs.readFileSync(path.join(OUT, "clicks.json"), "utf8"));
  const all = prevClicks.concat(clicks);
  fs.writeFileSync(path.join(OUT, "clicks.json"), JSON.stringify(all, null, 2));
  const prevNets = fs.existsSync(path.join(OUT, "nets.json")) ? JSON.parse(fs.readFileSync(path.join(OUT, "nets.json"), "utf8")) : [];
  fs.writeFileSync(path.join(OUT, "nets.json"), JSON.stringify(prevNets.concat(nets), null, 2));
  fs.writeFileSync(path.join(OUT, "summary-resume.json"), JSON.stringify({ ended: new Date().toISOString(), clicks: clicks.length, db: snap, writes: nets }, null, 2));
  console.log(JSON.stringify({ done: true, extra: clicks.length, db_error: snap.error || null, pages: (snap.partner_pages || []).length }));
}

main().catch((e) => { console.error(e); process.exit(1); });

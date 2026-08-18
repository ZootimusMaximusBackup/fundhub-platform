#!/usr/bin/env node
// G1 auditor evidence — live partner walk. Findings only. No app edits.
// Password from gitignored .env. Never printed. Never POSTs enable.
// Never opens client 9af65808-a619-4e65-ae91-239766a006b7.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const FORBIDDEN_CLIENT = "9af65808-a619-4e65-ae91-239766a006b7";
const ROOT = process.cwd();
const BASE = process.env.BASE_URL || "https://fundhub.ai";
const EMAIL = "partner@fundhub.ai";
const OUT = path.join(ROOT, "docs/workflows/audit-gaps-2026-08-18-evidence/g1");
const SHOTS = path.join(OUT, "shots");
fs.mkdirSync(SHOTS, { recursive: true });

function loadEnvPassword() {
  if (process.env.STAFF_E2E_PASSWORD) return process.env.STAFF_E2E_PASSWORD;
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return "";
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?STAFF_E2E_PASSWORD\s*=\s*(.*)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  return "";
}
const password = loadEnvPassword();
if (!password) {
  console.error("STAFF_E2E_PASSWORD missing from env/.env — cannot log in");
  process.exit(2);
}

const rel = (p) => path.relative(ROOT, p);
const out = {
  when: new Date().toISOString(),
  site: BASE,
  email: EMAIL,
  roleExpected: "partner",
  login: {},
  landing: {},
  sidebar: { all: [], visible: [] },
  navOpens: [],
  brand: {},
  social: {},
  creative: {},
  contentAdmin: {},
  publicPage: {},
  blocked: [],
  session: {},
  http: [],
  notes: []
};

function elState() {
  const vis = (el) => {
    if (!el) return { present: false };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const visible = cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) !== 0 && r.width > 0 && r.height > 0;
    return {
      present: true,
      visible,
      disabled: !!el.disabled,
      text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 220),
      title: el.getAttribute("title") || "",
      display: cs.display,
      id: el.id || ""
    };
  };
  return vis;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const apiLog = [];
page.on("response", (res) => {
  const u = res.url();
  if (!u.includes("/api/") && !u.includes("/sites/")) return;
  const short = u.replace(BASE, "").replace(/^https?:\/\/[^/]+/, "");
  if (short.includes(FORBIDDEN_CLIENT)) {
    out.notes.push("FORBIDDEN_CLIENT appeared in a URL — aborted that request record");
    return;
  }
  apiLog.push({
    method: res.request().method(),
    url: short.slice(0, 220),
    status: res.status()
  });
});

await ctx.route("**/api/**", async (route) => {
  const req = route.request();
  const u = req.url();
  const method = req.method();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return route.continue();
  if (/\/api\/auth\/login(\?|$)/.test(u)) return route.continue();
  if (/\/api\/partner-marketing\/enable(\?|$)/.test(u)) {
    out.notes.push("BLOCKED write: partner-marketing/enable (auditor must not flip)");
    return route.fulfill({
      status: 599,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "audit_blocked_enable" })
    });
  }
  if (/\/api\/social\/oauth(\?|$)/.test(u)) {
    out.notes.push("BLOCKED write: social/oauth (do not connect a real network)");
    return route.fulfill({
      status: 599,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "audit_blocked_oauth" })
    });
  }
  if (/\/api\/social\/publish(\?|$)/.test(u) || /\/api\/creative\/run(\?|$)/.test(u) || /\/api\/creative\/generate(\?|$)/.test(u)) {
    out.notes.push("BLOCKED write: " + u.replace(BASE, "") + " (vendor / send)");
    return route.fulfill({
      status: 599,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "audit_blocked_vendor_or_send" })
    });
  }
  // Brand color/logo save is the one write the board asked to prove.
  if (/\/api\/(partner-brand|org-brand)(\?|$)/.test(u) && method === "PUT") return route.continue();
  return route.continue();
});

async function shot(name) {
  const p = path.join(SHOTS, name);
  await page.screenshot({ path: p, fullPage: false });
  return rel(p);
}
async function shotFull(name) {
  const p = path.join(SHOTS, name);
  await page.screenshot({ path: p, fullPage: true });
  return rel(p);
}

async function openPath(p, timeout = 45000) {
  const resp = await page.goto(BASE + p, { waitUntil: "domcontentloaded", timeout });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1400);
  return {
    asked: p,
    httpStatus: resp ? resp.status() : null,
    finalUrl: page.url().replace(BASE, ""),
    title: await page.title().catch(() => "")
  };
}

function bounced(asked, finalUrl) {
  const leaf = asked.replace(/^\//, "").split("?")[0].split("/").pop();
  if (!leaf) return false;
  return !finalUrl.includes(leaf);
}

// 1. Login
await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
out.login.pageShot = await shot("01-login-page.png");
await page.locator('#email, input[type="email"]').first().fill(EMAIL);
await page.locator('#pw, input[type="password"]').first().fill(password);
await page.locator('#go, button[type="submit"]').first().click();
try {
  await page.waitForURL((u) => !/login\.html/.test(u.toString()), { timeout: 30000 });
  out.login.ok = true;
} catch {
  out.login.ok = false;
}
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(1600);
out.login.landedAt = page.url().replace(BASE, "");
out.login.role = await page.evaluate(() => localStorage.getItem("fh_role")).catch(() => null);
out.landing = {
  url: page.url().replace(BASE, ""),
  title: await page.title().catch(() => ""),
  h1: await page.locator("h1").first().textContent().catch(() => ""),
  shot: await shot("02-landing.png")
};

const sess = await page.evaluate(() => {
  let account = null;
  try { account = JSON.parse(localStorage.getItem("fh_account") || "null"); } catch (e) { account = null; }
  return {
    role: localStorage.getItem("fh_role"),
    accountKind: account && account.kind,
    partnerId: account && (account.partnerId || account.partner_id),
    hasToken: !!(localStorage.getItem("fh_token"))
  };
});
out.session = sess;
if (String(out.landing.url || "").includes(FORBIDDEN_CLIENT) || String(sess.partnerId || "") === FORBIDDEN_CLIENT) {
  out.notes.push("Stopped: forbidden client id appeared");
  fs.writeFileSync(path.join(OUT, "proofs.json"), JSON.stringify(out, null, 2));
  await browser.close();
  process.exit(2);
}

// Sidebar
const links = await page.evaluate(() => {
  const all = [...document.querySelectorAll("#fh-side-nav a.navitem, nav a.navitem, aside a.navitem")];
  return all.map((a) => {
    const r = a.getBoundingClientRect();
    const cs = getComputedStyle(a);
    const visible = r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
    return {
      href: a.getAttribute("href"),
      label: (a.textContent || "").trim().replace(/\s+/g, " "),
      visible
    };
  });
}).catch(() => []);
out.sidebar.all = links;
out.sidebar.visible = links.filter((l) => l.visible);
out.sidebar.shot = await shot("03-sidebar.png");

const visible = [];
const seen = new Set();
for (const l of out.sidebar.visible) {
  if (!l.href || seen.has(l.href)) continue;
  if (/^https?:|^#|^mailto:/.test(l.href)) continue;
  seen.add(l.href);
  visible.push(l);
}

let i = 10;
for (const l of visible) {
  const target = l.href.startsWith("/") ? l.href : "/app/" + l.href.replace(/^\.\//, "");
  const rec = { label: l.label, href: l.href, asked: target };
  try {
    const opened = await openPath(target);
    Object.assign(rec, opened);
    rec.bounced = bounced(target, opened.finalUrl);
    rec.verdict = rec.bounced ? "BOUNCE" : "OPEN";
    rec.h1 = await page.locator("h1").first().textContent().catch(() => "");
    rec.bodySlice = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 280);
    const slug = (l.href || "item").replace(/[^a-z0-9.-]/gi, "_").slice(0, 40);
    rec.shot = await shot(`${i}-${slug}.png`);
  } catch (e) {
    rec.error = String(e?.message || e).slice(0, 200);
    rec.verdict = "ERROR";
  }
  out.navOpens.push(rec);
  i += 1;
}

// 3. Brand Studio
{
  const opened = await openPath("/app/brand-studio.html");
  await page.waitForTimeout(800);
  const rec = {
    load: opened,
    bounced: bounced("/app/brand-studio.html", opened.finalUrl),
    shot: await shot("20-brand-studio.png"),
    shotFull: await shotFull("20-brand-studio-full.png")
  };
  rec.ui = await page.evaluate(() => {
    const vis = (id) => {
      const el = document.getElementById(id);
      if (!el) return { present: false };
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const visible = cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0;
      return {
        present: true,
        visible,
        disabled: !!el.disabled,
        text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240),
        title: el.getAttribute("title") || "",
        display: cs.display
      };
    };
    return {
      partnerId: window.__fhBrandPartnerId || null,
      mode: window.__fhBrandMode || null,
      suiteTxt: vis("suiteTxt"),
      suiteOffMsg: vis("suiteOffMsg"),
      suiteOwnerRow: vis("suiteOwnerRow"),
      suiteOnBtn: vis("suiteOnBtn"),
      suiteOffBtn: vis("suiteOffBtn"),
      suiteOnTools: vis("suiteOnTools"),
      genCopyBtn: vis("genCopyBtn"),
      genLogoBtn: vis("genLogoBtn"),
      saveBtn: vis("saveBtn"),
      submitBtn: vis("submitBtn"),
      kTokens: vis("kTokens"),
      kLive: vis("kLive"),
      subPrev: vis("subPrev"),
      domainField: (() => {
        const el = document.getElementById("bDomain") || document.getElementById("domain");
        return el ? { present: true, value: el.value || "" } : { present: false };
      })(),
      publishButtons: [...document.querySelectorAll("[data-pub], [data-unpub], button")].filter((b) =>
        /publish/i.test(b.textContent || "") || b.hasAttribute("data-pub")
      ).map((b) => ({
        text: (b.textContent || "").trim().slice(0, 40),
        disabled: !!b.disabled,
        visible: getComputedStyle(b).display !== "none"
      })),
      bodyHasOwnerOff: /owner has not turned this on/i.test(document.body.innerText || "")
    };
  });
  rec.save = { clicked: false };
  if (rec.ui.saveBtn && rec.ui.saveBtn.visible && !rec.ui.saveBtn.disabled) {
    const before = apiLog.length;
    await page.locator("#saveBtn").click();
    await page.waitForTimeout(1800);
    rec.save.clicked = true;
    rec.save.msg = await page.locator("#saveMsg").innerText().catch(() => "");
    rec.save.api = apiLog.slice(before).filter((x) => /partner-brand|org-brand/.test(x.url));
    rec.save.shot = await shot("21-brand-after-save.png");
  }
  rec.shotAfter = await shot("20b-brand-studio-scrolled.png");
  out.brand = rec;
}

const partnerId = (out.brand.ui && out.brand.ui.partnerId) || sess.partnerId || null;
out.session.partnerIdFromBrand = out.brand.ui && out.brand.ui.partnerId;
out.session.partnerId = partnerId;

// 4. Social Studio
{
  const opened = await openPath("/app/social-studio.html");
  await page.waitForTimeout(1000);
  const rec = {
    load: opened,
    bounced: bounced("/app/social-studio.html", opened.finalUrl),
    shot: await shot("30-social-studio.png"),
    shotFull: await shotFull("30-social-studio-full.png")
  };
  rec.ui = await page.evaluate(() => {
    const vis = (id) => {
      const el = document.getElementById(id);
      if (!el) return { present: false };
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const visible = cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0;
      return {
        present: true,
        visible,
        disabled: !!el.disabled,
        text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240),
        title: el.getAttribute("title") || ""
      };
    };
    const box = document.getElementById("oauthConnectBox");
    return {
      suiteTxt: vis("ssSuiteTxt"),
      suiteMsg: vis("ssSuiteMsg"),
      genBtn: vis("ssGenBtn"),
      queueBtn: vis("queueBtn"),
      publishDueBtn: vis("publishDueBtn"),
      oauthFb: vis("oauthFb"),
      oauthIg: vis("oauthIg"),
      oauthLi: vis("oauthLi"),
      oauthBoxText: box ? (box.innerText || "").replace(/\s+/g, " ").trim().slice(0, 400) : null,
      notice: vis("ssNoticeTxt"),
      whenField: vis("cWhen"),
      caption: vis("cCaption"),
      connectButtonsVisible: ["oauthFb", "oauthIg", "oauthLi"].filter((id) => {
        const el = document.getElementById(id);
        if (!el) return false;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs.display !== "none" && r.width > 0 && r.height > 0;
      }),
      discardButtons: [...document.querySelectorAll("button")].filter((b) =>
        /throw|discard|delete post|remove from queue/i.test(b.textContent || "")
      ).map((b) => (b.textContent || "").trim()),
      bodyHasConnect: /Connect Facebook|Connect Instagram|Connect LinkedIn/.test(document.body.innerText || ""),
      bodyHasOwnerOff: /owner has not turned this on/i.test(document.body.innerText || ""),
      suiteEnabledFlag: window.__ssSuiteEnabled === true
    };
  });
  rec.didNotConnect = true;
  rec.didNotPublish = true;
  out.social = rec;
}

// 5. Creative Factory
{
  const opened = await openPath("/app/creative-factory.html");
  await page.waitForTimeout(1200);
  const rec = {
    load: opened,
    bounced: bounced("/app/creative-factory.html", opened.finalUrl),
    shot: await shot("40-creative-factory.png"),
    shotFull: await shotFull("40-creative-factory-full.png")
  };
  rec.ui = await page.evaluate(() => {
    const vis = (id) => {
      const el = document.getElementById(id);
      if (!el) return { present: false };
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const visible = cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0;
      return {
        present: true,
        visible,
        disabled: !!el.disabled,
        text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 400),
        title: el.getAttribute("title") || ""
      };
    };
    return {
      useBody: vis("cfUseBody"),
      useBadge: vis("cfUseBadge"),
      genBtn: vis("genBtn"),
      runJobsBtn: vis("runJobsBtn"),
      genMsg: vis("genMsg"),
      bodyHas250k: /250,?000/.test(document.body.innerText || ""),
      bodyHasOwnerOff: /owner has not turned this on/i.test(document.body.innerText || ""),
      bodySlice: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 500)
    };
  });
  rec.enqueued = false;
  rec.enqueueReason = rec.ui.genBtn && rec.ui.genBtn.visible && !rec.ui.genBtn.disabled
    ? "Enqueue was live — did not click. That button POSTs /api/creative/generate, which can later call a vendor."
    : "Enqueue was not live (missing, hidden, or disabled). Did not click.";
  out.creative = rec;
}

// 6. Content Admin — no Content row + bounce if typed
{
  const navHasContent = out.sidebar.all.some((l) =>
    /content/i.test(l.label || "") || /content-admin/i.test(l.href || "")
  );
  const visibleContent = out.sidebar.visible.some((l) =>
    /content/i.test(l.label || "") || /content-admin/i.test(l.href || "")
  );
  const opened = await openPath("/app/content-admin.html");
  const rec = {
    navHasContentRow: navHasContent,
    visibleContentRow: visibleContent,
    load: opened,
    bounced: bounced("/app/content-admin.html", opened.finalUrl),
    shot: await shot("50-content-admin.png")
  };
  rec.verdict = !visibleContent && rec.bounced ? "NO_NAV_AND_BOUNCE"
    : !visibleContent ? "NO_NAV"
    : rec.bounced ? "BOUNCE"
    : "OPEN";
  out.contentAdmin = rec;
}

// 7. Session + public page
{
  const token = await page.evaluate(() => localStorage.getItem("fh_token"));
  const headers = {
    accept: "application/json",
    ...(token ? { authorization: "Bearer " + token } : {})
  };
  const rec = { partnerId };
  const sessRes = await page.request.get(BASE + "/api/auth/session", { headers });
  rec.sessionHttp = sessRes.status();
  const sessBody = await sessRes.json().catch(() => ({}));
  rec.sessionKind = sessBody.account && sessBody.account.kind;
  rec.sessionRole = sessBody.staff && sessBody.staff.role || sessBody.role;
  rec.sessionPartnerId = (sessBody.account && (sessBody.account.partnerId || sessBody.account.partner_id))
    || (sessBody.staff && (sessBody.staff.partner_id || sessBody.staff.partnerId))
    || null;
  const pid = partnerId || rec.sessionPartnerId;
  rec.resolvedPartnerId = pid;
  if (pid) {
    const pagesRes = await page.request.get(BASE + "/api/partner-pages?partner_id=" + encodeURIComponent(pid), { headers });
    rec.pagesHttp = pagesRes.status();
    const pagesBody = await pagesRes.json().catch(() => ({}));
    const items = pagesBody.pages || pagesBody.items || pagesBody.rows || [];
    rec.pageCount = Array.isArray(items) ? items.length : null;
    rec.pages = Array.isArray(items)
      ? items.map((p) => ({
        slug: p.slug,
        status: p.status,
        live_path: p.live_path || null,
        domain: p.domain || p.custom_domain || null
      }))
      : [];
    const published = rec.pages.filter((p) => p.status === "published" || p.live_path);
    rec.published = published;
    const tryPaths = [];
    for (const p of published) {
      if (p.live_path) tryPaths.push(p.live_path);
      else if (p.slug) tryPaths.push(`/sites/${pid}/${p.slug}`);
    }
    tryPaths.push(`/sites/${pid}/apply`);
    rec.liveGets = [];
    const seenP = new Set();
    let n = 60;
    for (const pth of tryPaths) {
      if (seenP.has(pth)) continue;
      seenP.add(pth);
      const r = await page.request.get(BASE + pth, { maxRedirects: 0 }).catch(async () =>
        page.request.get(BASE + pth)
      );
      const row = { path: pth, status: r.status(), final: r.url().replace(BASE, "") };
      rec.liveGets.push(row);
      await page.goto(BASE + pth, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(800);
      row.browserUrl = page.url().replace(BASE, "");
      row.browserTitle = await page.title().catch(() => "");
      row.shot = await shot(`${n}-public-${pth.replace(/[^a-z0-9.-]/gi, "_").slice(0, 50)}.png`);
      n += 1;
    }
    const usage = await page.request.get(BASE + "/api/partner-marketing/usage?partner_id=" + encodeURIComponent(pid), { headers });
    rec.usageHttp = usage.status();
    const usageBody = await usage.json().catch(() => ({}));
    rec.usage = {
      ok: usageBody.ok,
      enabled: usageBody.enabled,
      used: usageBody.used,
      remaining: usageBody.remaining,
      cap: usageBody.cap
    };
    rec.customDomainOnScreen = (out.brand.ui && out.brand.ui.domainField && out.brand.ui.domainField.value) || null;
  } else {
    rec.missingPartnerId = true;
  }
  out.publicPage = rec;
}

// 8. Blocked routes
const blocked = [
  { label: "Pipeline", path: "/app/pipeline.html" },
  { label: "Finance OS", path: "/app/finance-os.html" },
  { label: "Staff", path: "/app/staff-teams.html" },
  { label: "Hiring", path: "/app/hiring.html" },
  { label: "Client Control Panel", path: "/app/client-control-panel.html" }
];
let b = 70;
for (const row of blocked) {
  const opened = await openPath(row.path);
  const rec = {
    ...row,
    ...opened,
    bounced: bounced(row.path, opened.finalUrl),
    shot: await shot(`${b}-${row.label.replace(/\s+/g, "-").toLowerCase()}.png`)
  };
  rec.verdict = rec.bounced || !opened.finalUrl.includes(row.path.split("/").pop())
    ? "BOUNCE"
    : "OPEN";
  out.blocked.push(rec);
  b += 1;
}

out.http = apiLog.slice(0, 400);
fs.writeFileSync(path.join(OUT, "proofs.json"), JSON.stringify(out, null, 2));
await browser.close();
console.log("G1 walk done. Landing:", out.landing.url, "partnerId:", partnerId ? "set" : "missing");
console.log("Visible nav:", out.sidebar.visible.map((l) => l.label).join(" | "));
console.log("Wrote", rel(path.join(OUT, "proofs.json")));

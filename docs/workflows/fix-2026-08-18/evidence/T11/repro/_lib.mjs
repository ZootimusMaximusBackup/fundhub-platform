// T11 live repro helper. READ-MOSTLY. Password is read from .env and never printed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

export const BASE = process.env.BASE_URL || "https://fundhub.ai";
export const OUT = "/tmp/wt-T11/docs/workflows/fix-2026-08-18/evidence/T11/repro";
const STATE_DIR = process.env.T11_STATE_DIR || path.join(os.tmpdir(), "t11-repro-state");
fs.mkdirSync(STATE_DIR, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

function password() {
  if (process.env.STAFF_E2E_PASSWORD) return process.env.STAFF_E2E_PASSWORD;
  const p = "/Users/zootimusmaximus/fundhub-platform/.env";
  if (!fs.existsSync(p)) return "";
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?STAFF_E2E_PASSWORD\s*=\s*(.*)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  return "";
}

export function save(name, obj) {
  const f = path.join(OUT, name);
  fs.writeFileSync(f, typeof obj === "string" ? obj : JSON.stringify(obj, null, 2));
  console.log("wrote " + name);
}

// Only these non-GET calls are ever allowed out. Everything else is refused
// locally with a 599 and recorded.
const ALLOW_WRITE = [
  /\/api\/auth\/login(\?|$)/,
  ...(process.env.T11_ALLOW ? process.env.T11_ALLOW.split(",").map((s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))) : [])
];

export async function session(email) {
  const pw = password();
  if (!pw) throw new Error("STAFF_E2E_PASSWORD missing");
  const stateFile = path.join(STATE_DIR, email.replace(/[^a-z0-9@.-]/gi, "_") + ".json");
  const browser = await chromium.launch();
  let storageState;
  if (fs.existsSync(stateFile) && Date.now() - fs.statSync(stateFile).mtimeMs < 6 * 3600e3) {
    try {
      const st = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      const o = (st.origins || []).find((x) => x.origin === BASE);
      const tok = o && (o.localStorage || []).find((kv) => kv.name === "fh_token");
      if (tok && tok.value) {
        const probe = await (await browser.newContext()).request
          .get(BASE + "/api/auth/session", { headers: { authorization: "Bearer " + tok.value }, timeout: 20000 })
          .catch(() => null);
        if (probe && probe.ok()) storageState = st;
      }
    } catch { /* ignore */ }
  }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...(storageState ? { storageState } : {}) });
  const page = await ctx.newPage();

  const rec = { api: [], console: [], dialogs: [], intercepted: [], bodies: [] };
  page.on("response", async (res) => {
    const u = res.url();
    if (!u.includes("/api/")) return;
    const row = { method: res.request().method(), url: u.replace(BASE, ""), status: res.status() };
    rec.api.push(row);
  });
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") rec.console.push(m.type() + ": " + String(m.text()).slice(0, 300)); });
  page.on("pageerror", (e) => rec.console.push("pageerror: " + String(e && e.message || e).slice(0, 300)));
  page.on("dialog", async (d) => { rec.dialogs.push({ type: d.type(), message: d.message().slice(0, 400) }); await d.dismiss().catch(() => {}); });

  await ctx.route("**/api/**", async (route) => {
    const req = route.request();
    if (req.method() === "GET" || req.method() === "HEAD") return route.continue();
    if (ALLOW_WRITE.some((re) => re.test(req.url()))) {
      let keys = [];
      try { const b = req.postDataJSON(); if (b && typeof b === "object") keys = Object.keys(b); } catch {}
      rec.intercepted.push({ ALLOWED_OUT: true, method: req.method(), url: req.url().replace(BASE, ""), bodyKeys: keys });
      return route.continue();
    }
    let keys = [];
    try { const b = req.postDataJSON(); if (b && typeof b === "object") keys = Object.keys(b); } catch {}
    rec.intercepted.push({ ALLOWED_OUT: false, method: req.method(), url: req.url().replace(BASE, ""), bodyKeys: keys });
    return route.fulfill({ status: 599, contentType: "application/json", body: JSON.stringify({ ok: false, error: "repro_intercepted" }) });
  });

  if (storageState) {
    rec.login = { cached: true };
  } else {
    await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded" });
    await page.locator('#email, input[type="email"]').first().fill(email);
    await page.locator('#pw, input[type="password"]').first().fill(pw);
    await page.locator('#go, button[type="submit"]').first().click();
    let ok = true;
    try { await page.waitForURL((u) => !/login\.html/.test(u.toString()), { timeout: 40000 }); } catch { ok = false; }
    await page.waitForTimeout(1200);
    rec.login = { cached: false, ok, landedAt: page.url().replace(BASE, "") };
    if (ok) { try { fs.writeFileSync(stateFile, JSON.stringify(await ctx.storageState())); } catch {} }
    else throw new Error("login failed for " + email);
  }
  rec.role = await page.evaluate(() => { try { return localStorage.getItem("fh_role"); } catch { return null; } }).catch(() => null);

  return { browser, ctx, page, rec, reset() { rec.api = []; rec.console = []; rec.dialogs = []; rec.intercepted = []; } };
}

export async function open(page, p) {
  const resp = await page.goto(BASE + p, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  return { status: resp ? resp.status() : null, finalUrl: page.url().replace(BASE, "") };
}

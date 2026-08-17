#!/usr/bin/env node
// Perf Auditor evidence tool — READ-ONLY. One page, 3 Lighthouse runs, median.
//
// Mobile emulation (390x844), Slow 4G + 4x CPU throttle (Lighthouse's own
// `mobileSlow4G` constants — devtools throttling method, not simulated).
// For gated CRM pages, pass --role <email> and it logs in once (cached
// under $LH_AUDIT_STATE_DIR, same storageState shape ui-audit.mjs uses —
// point it at the same dir to share a session with that tool) then injects
// fh_token/fh_role into the SAME Chrome instance Lighthouse audits, with
// disableStorageReset so the session survives into the run. Public pages
// (funnel, index.html) omit --role.
//
// Usage:
//   node docs/workflows/perf-audit-evidence/_tools/lighthouse-audit.mjs <url> [--role email] [--slug name] [--runs 3] [--out DIR]
//   e.g. node .../lighthouse-audit.mjs https://apply.fundhub.ai/watch --slug funnel-watch
//        node .../lighthouse-audit.mjs https://fundhub.ai/app/pipeline.html --role closer@fundhub.ai --slug pipeline
//
// Output: docs/workflows/perf-audit-evidence/<slug>/{run-N.report.json,run-N.report.html,summary.json,summary.md}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";
import { chromium } from "playwright";

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith("--"));
const flag = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const [url] = positional;
if (!url) {
  console.error("usage: lighthouse-audit.mjs <url> [--role email] [--slug name] [--runs 3] [--out DIR]");
  process.exit(2);
}
const ROOT = process.cwd();
const role = flag("--role", null);
const RUNS = Number(flag("--runs", "3"));
const SLUG = flag("--slug", new URL(url).pathname.replace(/^\/|\/$/g, "").replace(/[^a-z0-9-]/gi, "_") || "root");
const OUT_DIR = path.join(flag("--out", path.join(ROOT, "docs/workflows/perf-audit-evidence")), SLUG);
fs.mkdirSync(OUT_DIR, { recursive: true });
const STATE_DIR = flag("--state-dir", process.env.LH_AUDIT_STATE_DIR || process.env.UI_AUDIT_STATE_DIR || path.join(os.tmpdir(), "fundhub-ui-audit-state"));
fs.mkdirSync(STATE_DIR, { recursive: true });

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

const ORIGIN = new URL(url).origin;

// ---- Slow-4G + 4x-CPU mobile throttling (Lighthouse's own mobileSlow4G constants) ----
const PERF_CONFIG = {
  extends: "lighthouse:default",
  settings: {
    onlyCategories: ["performance"],
    formFactor: "mobile",
    screenEmulation: { mobile: true, width: 390, height: 844, deviceScaleFactor: 2, disabled: false },
    throttlingMethod: "devtools",
    throttling: {
      rttMs: 150,
      throughputKbps: 1638.4,
      requestLatencyMs: 562.5,
      downloadThroughputKbps: 1474.56,
      uploadThroughputKbps: 675,
      cpuSlowdownMultiplier: 4,
    },
  },
};

const chrome = await chromeLauncher.launch({ chromeFlags: ["--headless=new", "--disable-gpu", "--no-sandbox"] });
let extra = {};
const cdp = await chromium.connectOverCDP(`http://localhost:${chrome.port}`);
const ctx = cdp.contexts()[0] || (await cdp.newContext());
const page = ctx.pages()[0] || (await ctx.newPage());
// Auth (fh_token in localStorage) must survive across the 3 runs, so Lighthouse
// is called with disableStorageReset:true — but that ALSO skips Lighthouse's
// own cache clear, so runs 2/3 (and even run 1, warmed by the extras pass
// below) would silently load from HTTP cache and report a fake near-zero
// byte count. Clear ONLY the HTTP cache ourselves before every run instead.
const cdpSession = await ctx.newCDPSession(page);
const clearHttpCache = () => cdpSession.send("Network.clearBrowserCache").catch(() => {});
try {
  if (role) {
    const password = loadEnvPassword();
    if (!password) throw new Error("STAFF_E2E_PASSWORD missing from env/.env — cannot log in");
    const STATE_FILE = path.join(STATE_DIR, role.replace(/[^a-z0-9@.-]/gi, "_") + "@" + ORIGIN.replace(/[^a-z0-9.]/gi, "_") + ".json");

    let injected = false;
    if (fs.existsSync(STATE_FILE) && (Date.now() - fs.statSync(STATE_FILE).mtimeMs) < 6 * 3600e3) {
      try {
        const st = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
        const originState = (st.origins || []).find((o) => o.origin === ORIGIN);
        const tok = originState && (originState.localStorage || []).find((kv) => kv.name === "fh_token");
        const roleVal = originState && (originState.localStorage || []).find((kv) => kv.name === "fh_role");
        if (tok && tok.value) {
          const probe = await ctx.request.get(ORIGIN + "/api/auth/session", { headers: { authorization: "Bearer " + tok.value }, timeout: 20_000 }).catch(() => null);
          if (probe && probe.ok()) {
            await page.goto(ORIGIN + "/login.html", { waitUntil: "commit" });
            await page.evaluate(([t, r]) => { localStorage.setItem("fh_token", t); if (r) localStorage.setItem("fh_role", r); }, [tok.value, roleVal && roleVal.value]);
            injected = true;
          }
        }
      } catch { injected = false; }
    }
    if (!injected) {
      await page.goto(ORIGIN + "/login.html", { waitUntil: "domcontentloaded" });
      await page.locator('#email, input[type="email"]').first().fill(role);
      await page.locator('#pw, input[type="password"]').first().fill(password);
      await page.locator('#go, button[type="submit"]').first().click();
      await page.waitForURL((u) => !/login\.html/.test(u.toString()), { timeout: 30_000 });
      await page.waitForLoadState("networkidle").catch(() => {});
      try { fs.writeFileSync(STATE_FILE, JSON.stringify(await ctx.storageState())); } catch { /* ignore */ }
    }
    extra.role = await page.evaluate(() => localStorage.getItem("fh_role")).catch(() => null);

    // extra DOM metrics not in Lighthouse's audit set: inline style count, head render-blocking tag count
    await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 }).catch(() => {});
    extra.inlineStyleCount = await page.evaluate(() => document.querySelectorAll("[style]").length).catch(() => null);
    extra.headBlockingScripts = await page.evaluate(() => Array.from(document.querySelectorAll("head script:not([async]):not([defer])")).filter((s) => s.src).length).catch(() => null);
    extra.finalUrl = page.url();
  } else {
    // Unauthenticated page: still warm it once via CDP for the extra DOM read.
    await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 }).catch(() => {});
    extra.inlineStyleCount = await page.evaluate(() => document.querySelectorAll("[style]").length).catch(() => null);
    extra.headBlockingScripts = await page.evaluate(() => Array.from(document.querySelectorAll("head script:not([async]):not([defer])")).filter((s) => s.src).length).catch(() => null);
    // VSL check: funnel pages carry a <video> — record muted/playsinline if present.
    extra.video = await page.evaluate(() => {
      const v = document.querySelector("video");
      if (!v) return null;
      return { muted: v.muted || v.hasAttribute("muted"), playsinline: v.hasAttribute("playsinline") || v.hasAttribute("webkit-playsinline"), autoplay: v.hasAttribute("autoplay"), src: v.currentSrc || v.src || null };
    }).catch(() => null);
    extra.finalUrl = page.url();
  }

  const runs = [];
  for (let i = 1; i <= RUNS; i++) {
    await clearHttpCache();
    const result = await lighthouse(url, { port: chrome.port, disableStorageReset: true, output: ["json", "html"], logLevel: "error" }, PERF_CONFIG);
    const lhr = result.lhr;
    fs.writeFileSync(path.join(OUT_DIR, `run-${i}.report.json`), result.report[0]);
    fs.writeFileSync(path.join(OUT_DIR, `run-${i}.report.html`), result.report[1]);
    const byType = {};
    for (const it of lhr.audits["resource-summary"]?.details?.items || []) byType[it.resourceType] = { requestCount: it.requestCount, transferSize: it.transferSize };
    runs.push({
      run: i,
      performanceScore: lhr.categories.performance?.score != null ? Math.round(lhr.categories.performance.score * 100) : null,
      lcpMs: lhr.audits["largest-contentful-paint"]?.numericValue ?? null,
      lcpElement: lhr.audits["largest-contentful-paint-element"]?.details?.items?.[0]?.items?.[0]?.node?.snippet ?? lhr.audits["largest-contentful-paint-element"]?.details?.items?.[0]?.node?.snippet ?? null,
      tbtMs: lhr.audits["total-blocking-time"]?.numericValue ?? null,
      clsScore: lhr.audits["cumulative-layout-shift"]?.numericValue ?? null,
      ttfbMs: lhr.audits["server-response-time"]?.numericValue ?? null,
      speedIndexMs: lhr.audits["speed-index"]?.numericValue ?? null,
      totalBytes: byType.total?.transferSize ?? null,
      byType,
      renderBlockingMs: lhr.audits["render-blocking-resources"]?.details?.overallSavingsMs ?? null,
      renderBlockingItems: (lhr.audits["render-blocking-resources"]?.details?.items || []).map((it) => ({ url: it.url, wastedMs: it.wastedMs, totalBytes: it.totalBytes })),
      thirdParty: (lhr.audits["third-party-summary"]?.details?.items || []).map((it) => ({ entity: it.entity?.text ?? it.entity, transferSize: it.transferSize, blockingMs: it.blockingTime })),
    });
  }
  await cdpSession.detach().catch(() => {});
  await cdp.close().catch(() => {});
  const median = (arr) => { const s = [...arr].filter((v) => v != null).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
  const summary = {
    url, slug: SLUG, role: role || null, ranAt: new Date().toISOString(), runs: RUNS,
    median: {
      performanceScore: median(runs.map((r) => r.performanceScore)),
      lcpMs: median(runs.map((r) => r.lcpMs)),
      tbtMs: median(runs.map((r) => r.tbtMs)),
      clsScore: median(runs.map((r) => r.clsScore)),
      ttfbMs: median(runs.map((r) => r.ttfbMs)),
      speedIndexMs: median(runs.map((r) => r.speedIndexMs)),
      totalBytes: median(runs.map((r) => r.totalBytes)),
    },
    lcpElement: runs.find((r) => r.lcpElement)?.lcpElement ?? null,
    byTypeMedianRun: runs[Math.floor((RUNS - 1) / 2)]?.byType ?? null,
    renderBlockingItems: runs.flatMap((r) => r.renderBlockingItems).slice(0, 5),
    thirdParty: runs[0]?.thirdParty ?? [],
    extra,
    runs,
  };
  fs.writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "summary.md"), [
    `# ${SLUG}`,
    ``,
    `URL: ${url}${role ? `  ·  role: ${role}` : "  ·  public"}`,
    ``,
    `| Metric | Median (${RUNS} runs) |`,
    `|---|---|`,
    `| Performance score | ${summary.median.performanceScore} |`,
    `| LCP | ${summary.median.lcpMs != null ? (summary.median.lcpMs / 1000).toFixed(2) + "s" : "—"} |`,
    `| TBT (INP proxy) | ${summary.median.tbtMs != null ? Math.round(summary.median.tbtMs) + "ms" : "—"} |`,
    `| CLS | ${summary.median.clsScore ?? "—"} |`,
    `| TTFB | ${summary.median.ttfbMs != null ? Math.round(summary.median.ttfbMs) + "ms" : "—"} |`,
    `| Speed Index | ${summary.median.speedIndexMs != null ? (summary.median.speedIndexMs / 1000).toFixed(2) + "s" : "—"} |`,
    `| Total bytes | ${summary.median.totalBytes != null ? Math.round(summary.median.totalBytes / 1024) + "KB" : "—"} |`,
    `| LCP element | ${summary.lcpElement ?? "—"} |`,
    `| Inline style attrs | ${extra.inlineStyleCount ?? "—"} |`,
    `| Render-blocking <head> scripts | ${extra.headBlockingScripts ?? "—"} |`,
    extra.video ? `| VSL video muted/playsinline | ${extra.video.muted}/${extra.video.playsinline} (autoplay=${extra.video.autoplay}) |` : "",
  ].filter(Boolean).join("\n") + "\n");
  console.log(`OK ${SLUG} -> ${path.relative(ROOT, OUT_DIR)}  score=${summary.median.performanceScore} lcp=${summary.median.lcpMs}ms`);
} finally {
  try { await chrome.kill(); } catch { /* ignore */ }
}

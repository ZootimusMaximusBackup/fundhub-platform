#!/usr/bin/env node
// Fresh independent live re-verify (pass 2). Writes shots + verify.json.
// Does not edit app code, tests, baselines, hooks, env, or intended journeys.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const BASE = "https://fundhub.ai";
const OUT = path.join(ROOT, "docs/workflows/fixer-three-2026-08-17-evidence/reverify-2");
const SHOTS = path.join(OUT, "shots");
fs.mkdirSync(SHOTS, { recursive: true });

function loadEnv(key) {
  if (process.env[key]) return process.env[key];
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return "";
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(new RegExp("^\\s*(?:export\\s+)?" + key + "\\s*=\\s*(.*)\\s*$"));
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  return "";
}

function sanitizeUrl(u) {
  try {
    const url = new URL(u, BASE);
    if (url.hostname !== "fundhub.ai") {
      return { host: url.hostname, path: url.pathname + url.search, live: false };
    }
    url.searchParams.delete("token");
    return url.pathname + url.search;
  } catch {
    return String(u).split("?")[0];
  }
}

function pathHasPartner(p) {
  const s = typeof p === "string" ? p : p?.path || "";
  return /[?&]partner_id=/.test(s);
}

const password = loadEnv("STAFF_E2E_PASSWORD");
if (!password) {
  console.error("STAFF_E2E_PASSWORD missing");
  process.exit(2);
}

const email = "owner@fundhub.ai";
const out = {
  ranAt: new Date().toISOString(),
  base: BASE,
  email,
  verifier: "fresh-auditor-reverify-2",
  deployedCommitExpected: "597df13",
  liveHostConfirmed: false,
  items: {}
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const apiHits = [];
page.on("response", async (res) => {
  const url = res.url();
  if (!url.includes("/api/")) return;
  let bodyPreview = null;
  try {
    const ct = res.headers()["content-type"] || "";
    if (ct.includes("json")) {
      const j = await res.json();
      bodyPreview = {
        ok: j.ok,
        error: j.error || null,
        message: j.message || null,
        detail: j.detail || null,
        keys: Object.keys(j).slice(0, 24),
        partnerCount: Array.isArray(j.partners) ? j.partners.length : undefined,
        itemCount: Array.isArray(j.items) ? j.items.length : undefined,
        tileCount: Array.isArray(j.tiles) ? j.tiles.length : undefined,
        videoCount: Array.isArray(j.videos) ? j.videos.length : undefined,
        campaignCount: Array.isArray(j.campaigns) ? j.campaigns.length : undefined
      };
    }
  } catch {
    bodyPreview = { parse: "failed" };
  }
  apiHits.push({
    path: sanitizeUrl(url),
    status: res.status(),
    hasPartnerId: pathHasPartner(sanitizeUrl(url)),
    body: bodyPreview
  });
});

await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
out.loginPageHost = new URL(page.url()).hostname;
out.liveHostConfirmed = out.loginPageHost === "fundhub.ai";
if (!out.liveHostConfirmed) {
  console.error("Not hitting live fundhub.ai — aborting");
  await browser.close();
  process.exit(2);
}

await page.locator('input[type="email"], #email, input[name="email"]').first().fill(email);
await page.locator('input[type="password"], #password, input[name="password"]').first().fill(password);
await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
await page.waitForURL((u) => !/login\.html/.test(u.href), { timeout: 30_000 });
out.loginUrl = page.url();
out.loginUrlHost = new URL(page.url()).hostname;
await page.screenshot({ path: path.join(SHOTS, "00-after-login.png") });

/* 1 — Campaigns partner dropdown */
const campHitsBefore = apiHits.length;
await page.goto(`${BASE}/app/campaign-manager.html`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
out.campaignsHost = new URL(page.url()).hostname;

const partnersApi = await page.evaluate(async () => {
  const t = localStorage.getItem("fh_token") || "";
  const r = await fetch("/api/read/partners?limit=200", {
    headers: t ? { accept: "application/json", authorization: "Bearer " + t } : { accept: "application/json" }
  });
  const body = await r.json().catch(() => ({}));
  const items = Array.isArray(body.items) ? body.items : Array.isArray(body.partners) ? body.partners : [];
  return {
    httpOk: r.ok,
    bodyOk: body.ok === true,
    count: items.length,
    names: items.map((p) => p.name || p.legal_name || p.display_name || p.id).filter(Boolean),
    keys: Object.keys(body)
  };
});

const partnerSel = page.locator("#partnerSel");
const partnerHtml = await partnerSel.innerHTML().catch(() => "");
const partnerDisabled = await partnerSel.isDisabled().catch(() => true);
const partnerOptions = await partnerSel.locator("option").evaluateAll((opts) =>
  opts.map((o) => ({ text: (o.textContent || "").trim(), value: o.value || "" }))
);
const visibleError = await page.locator("text=Could not load partners").count();
await page.screenshot({ path: path.join(SHOTS, "01-campaigns-dropdown.png"), fullPage: true });

const realOptions = partnerOptions.filter((o) => o.value && !/could not|no partners|choose/i.test(o.text));
const pick = realOptions[0] || null;
let afterPick = null;
if (pick) {
  const campHitsMid = apiHits.length;
  await partnerSel.selectOption(pick.value);
  await page.waitForTimeout(3500);
  await page.screenshot({ path: path.join(SHOTS, "01b-campaigns-after-pick.png"), fullPage: true });
  const afterHits = apiHits.slice(campHitsMid).filter((h) => {
    const p = typeof h.path === "string" ? h.path : h.path?.path || "";
    return /\/api\/campaigns\//.test(p);
  });
  const emptyHint = await page.locator("body").innerText();
  const readsNamedPartner = afterHits.length > 0 && afterHits.every((h) => h.hasPartnerId);
  const anyMissingPartner = afterHits.some((h) => !h.hasPartnerId);
  const refusedMissingPartner = afterHits.some(
    (h) => !h.hasPartnerId && (h.body?.error === "partner_id_required" || h.status >= 400)
  );
  afterPick = {
    partnerName: pick.text,
    partnerId: pick.value,
    url: page.url(),
    urlHost: new URL(page.url()).hostname,
    urlHasPartner: page.url().includes("partner_id="),
    urlPartnerMatches: page.url().includes(pick.value),
    campaignReads: afterHits,
    readsNamedPartner,
    anyMissingPartner,
    refusedMissingPartner,
    pageMentionsEmpty: /no campaigns|no ads|0 campaigns|nothing to show|no spend|empty/i.test(emptyHint),
    pageMentionsRefused: /turned down|could not be read|nothing can be shown until a partner/i.test(emptyHint)
  };
}

out.items.campaigns = {
  partnersApi,
  optionCount: partnerOptions.length,
  options: partnerOptions,
  disabled: partnerDisabled,
  couldNotLoadInHtml: /Could not load partners/i.test(partnerHtml),
  couldNotLoadVisible: visibleError > 0,
  afterPick,
  pageApiHits: apiHits.slice(campHitsBefore).filter((h) => {
    const p = typeof h.path === "string" ? h.path : h.path?.path || "";
    return /partners|campaigns/.test(p);
  })
};

/* 2 — Command Center tiles */
const kpiRes = await page.evaluate(async () => {
  const t = localStorage.getItem("fh_token") || "";
  const r = await fetch("/api/dashboard/kpis?period=today", {
    headers: t ? { accept: "application/json", authorization: "Bearer " + t } : { accept: "application/json" }
  });
  const body = await r.json().catch(() => ({}));
  return {
    httpOk: r.ok,
    bodyOk: body.ok === true,
    keys: Object.keys(body),
    display: body.display || null,
    kpis: body.kpis
      ? {
          cash_collected_cents: body.kpis.cash_collected_cents,
          close_rate: body.kpis.close_rate,
          funded_count: body.kpis.funded_count,
          booked_count: body.kpis.booked_count
        }
      : null,
    missingFromPayload: {
      cash: body.display == null || body.display.cash == null,
      close: body.display == null || !("close" in (body.display || {})),
      funded: body.display == null || body.display.funded == null
    }
  };
});

await page.goto(`${BASE}/app/command-center.html`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
out.commandCenterHost = new URL(page.url()).hostname;
const tiles = await page.locator(".kpi-grid .kpi-tile").evaluateAll((els) =>
  els.map((el) => ({
    label: (el.querySelector(".kpi-label")?.textContent || "").trim(),
    value: (el.querySelector(".kpi-value")?.textContent || "").trim()
  }))
);
await page.screenshot({ path: path.join(SHOTS, "02-command-center-kpis.png") });

const cashTile = tiles.find((t) => /cash/i.test(t.label));
const closeTile = tiles.find((t) => /close rate/i.test(t.label));
const fundedTile = tiles.find((t) => /funded today/i.test(t.label));
const apiCash = kpiRes.display?.cash ?? null;
const apiClose = kpiRes.display?.close ?? null;
const apiFunded = kpiRes.display?.funded ?? null;

out.items.commandCenter = {
  api: kpiRes,
  tiles,
  match: {
    cash: cashTile ? cashTile.value === String(apiCash) : false,
    close: closeTile ? closeTile.value === String(apiClose) : false,
    funded: fundedTile ? fundedTile.value === String(apiFunded) : false
  },
  blankTiles: tiles.filter((t) => t.value === "").map((t) => t.label)
};

/* 3 — Content */
const contentGet = await page.evaluate(async () => {
  const t = localStorage.getItem("fh_token") || "";
  const r = await fetch("/api/content/tiles", {
    headers: t ? { accept: "application/json", authorization: "Bearer " + t } : { accept: "application/json" }
  });
  const text = await r.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 400) };
  }
  return {
    httpOk: r.ok,
    bodyOk: body.ok === true,
    message: body.message || null,
    error: body.error || null,
    detail: body.detail || null,
    tileCount: Array.isArray(body.tiles) ? body.tiles.length : 0,
    videoCount: Array.isArray(body.videos) ? body.videos.length : 0,
    productCount: Array.isArray(body.products) ? body.products.length : 0,
    mapKeys: body.map && typeof body.map === "object" ? Object.keys(body.map) : [],
    tiles: Array.isArray(body.tiles)
      ? body.tiles.map((t) => ({
          code: t.code || t.id,
          name: t.name,
          copy: t.copy || "",
          on: t.on,
          price_cents: t.price_cents
        }))
      : [],
    keys: Object.keys(body)
  };
});

let contentSave = null;
if (contentGet.bodyOk && contentGet.tiles.length) {
  contentSave = await page.evaluate(async (tiles) => {
    const t = localStorage.getItem("fh_token") || "";
    const r = await fetch("/api/content/tiles", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(t ? { authorization: "Bearer " + t } : {})
      },
      body: JSON.stringify({
        action: "save",
        tiles: tiles.map((x) => ({
          code: x.code,
          name: x.name,
          copy: x.copy,
          on: x.on,
          price_cents: x.price_cents
        }))
      })
    });
    const body = await r.json().catch(() => ({}));
    return {
      httpOk: r.ok,
      bodyOk: body.ok === true,
      action: body.action || null,
      error: body.error || null,
      message: body.message || null,
      detail: body.detail || null,
      tileCount: Array.isArray(body.tiles) ? body.tiles.length : 0
    };
  }, contentGet.tiles);
}

const videoProbe = await page.evaluate(async () => {
  const t = localStorage.getItem("fh_token") || "";
  const r = await fetch("/api/content/tiles", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(t ? { authorization: "Bearer " + t } : {})
    },
    body: JSON.stringify({
      action: "save",
      map: { default: "00000000-0000-0000-0000-000000000001" }
    })
  });
  const body = await r.json().catch(() => ({}));
  return {
    httpOk: r.ok,
    bodyOk: body.ok === true,
    error: body.error || null,
    message: body.message || null,
    detail: body.detail || null
  };
});

await page.goto(`${BASE}/app/content-admin.html`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
out.contentHost = new URL(page.url()).hostname;
const saveVisible = await page.locator("#saveBtn").isVisible().catch(() => false);
const saveHiddenAttr = await page.locator("#saveBtn").getAttribute("hidden").catch(() => "missing");
const saveTilesVisible = await page.locator("#saveTilesBtn").isVisible().catch(() => false);
const saveTilesHiddenAttr = await page.locator("#saveTilesBtn").getAttribute("hidden").catch(() => "missing");
const uploadVisible = await page.locator("#uploadBox").isVisible().catch(() => false);
const uploadHiddenAttr = await page.locator("#uploadBox").getAttribute("hidden").catch(() => "missing");
const notice = (await page.locator("#noticeTxt").textContent().catch(() => "")) || "";
const bodyText = await page.locator("body").innerText();
const tileCards = await page.locator("[data-tile], .tile-card, .tile-row, .locked-tile").count().catch(() => 0);
await page.screenshot({ path: path.join(SHOTS, "03-content.png"), fullPage: true });

out.items.content = {
  api: contentGet,
  saveProbe: contentSave,
  videoProbe,
  saveVisible,
  saveHiddenAttr: saveHiddenAttr !== null,
  saveTilesVisible,
  saveTilesHiddenAttr: saveTilesHiddenAttr !== null,
  uploadVisible,
  uploadHiddenAttr: uploadHiddenAttr !== null,
  notice: notice.trim(),
  tileCardCount: tileCards,
  pageMentionsError: /wrong|fail|missing|error|could not/i.test(notice + " " + bodyText.slice(0, 800)),
  deadButtons:
    (!contentGet.bodyOk && (saveVisible || uploadVisible))
};

out.shots = [
  "shots/00-after-login.png",
  "shots/01-campaigns-dropdown.png",
  "shots/01b-campaigns-after-pick.png",
  "shots/02-command-center-kpis.png",
  "shots/03-content.png"
];

fs.writeFileSync(path.join(OUT, "verify.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  liveHostConfirmed: out.liveHostConfirmed,
  hosts: {
    login: out.loginUrlHost,
    campaigns: out.campaignsHost,
    commandCenter: out.commandCenterHost,
    content: out.contentHost
  },
  campaigns: {
    optionCount: partnerOptions.length,
    couldNotLoad: visibleError > 0,
    afterPick: afterPick && {
      urlHasPartner: afterPick.urlHasPartner,
      readsNamedPartner: afterPick.readsNamedPartner,
      anyMissingPartner: afterPick.anyMissingPartner,
      refusedMissingPartner: afterPick.refusedMissingPartner,
      readCount: afterPick.campaignReads.length
    }
  },
  commandCenter: {
    match: out.items.commandCenter.match,
    blankTiles: out.items.commandCenter.blankTiles,
    display: kpiRes.display
  },
  content: {
    getOk: contentGet.bodyOk,
    tileCount: contentGet.tileCount,
    saveVisible,
    uploadVisible,
    deadButtons: out.items.content.deadButtons,
    saveProbe: contentSave,
    videoProbe
  }
}, null, 2));
await browser.close();

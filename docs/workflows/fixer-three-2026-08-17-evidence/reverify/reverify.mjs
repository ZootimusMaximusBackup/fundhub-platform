#!/usr/bin/env node
// Independent live re-verify. Writes shots + verify.json. Does not trust fixer prove.json.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const BASE = "https://fundhub.ai";
const OUT = path.join(ROOT, "docs/workflows/fixer-three-2026-08-17-evidence/reverify");
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
    url.searchParams.delete("token");
    return url.pathname + url.search;
  } catch {
    return String(u).split("?")[0];
  }
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
  verifier: "fresh-auditor-reverify",
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
        keys: Object.keys(j).slice(0, 20),
        partnerCount: Array.isArray(j.partners) ? j.partners.length : undefined,
        itemCount: Array.isArray(j.items) ? j.items.length : undefined,
        tileCount: Array.isArray(j.tiles) ? j.tiles.length : undefined
      };
    }
  } catch {
    bodyPreview = { parse: "failed" };
  }
  apiHits.push({
    path: sanitizeUrl(url),
    status: res.status(),
    body: bodyPreview
  });
});

await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
await page.locator('input[type="email"], #email, input[name="email"]').first().fill(email);
await page.locator('input[type="password"], #password, input[name="password"]').first().fill(password);
await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first().click();
await page.waitForURL((u) => !/login\.html/.test(u.href), { timeout: 30_000 });
out.loginUrl = page.url();
await page.screenshot({ path: path.join(SHOTS, "00-after-login.png") });

/* 1 — Campaigns partner dropdown */
const campHitsBefore = apiHits.length;
await page.goto(`${BASE}/app/campaign-manager.html`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

const partnersApi = await page.evaluate(async () => {
  const t = localStorage.getItem("fh_token") || "";
  const r = await fetch("/api/read/partners", {
    headers: t ? { accept: "application/json", authorization: "Bearer " + t } : { accept: "application/json" }
  });
  const body = await r.json().catch(() => ({}));
  const partners = Array.isArray(body.partners) ? body.partners : [];
  return {
    httpOk: r.ok,
    bodyOk: body.ok === true,
    count: partners.length,
    names: partners.map((p) => p.name || p.legal_name || p.display_name || p.id).filter(Boolean)
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
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(SHOTS, "01b-campaigns-after-pick.png"), fullPage: true });
  const afterHits = apiHits.slice(campHitsMid).filter((h) => /\/api\/campaigns\//.test(h.path));
  const emptyHint = await page.locator("body").innerText();
  afterPick = {
    partnerName: pick.text,
    partnerId: pick.value,
    url: page.url(),
    urlHasPartner: page.url().includes("partner_id="),
    urlPartnerMatches: page.url().includes(pick.value),
    campaignReads: afterHits,
    pageMentionsEmpty:
      /no campaigns|no ads|0 campaigns|nothing to show|no spend|empty/i.test(emptyHint)
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
  pageApiHits: apiHits.slice(campHitsBefore).filter((h) => /partners|campaigns/.test(h.path))
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
    display: body.display || null,
    kpis: body.kpis
      ? {
          cash_collected_cents: body.kpis.cash_collected_cents,
          close_rate: body.kpis.close_rate,
          funded_count: body.kpis.funded_count,
          booked_count: body.kpis.booked_count
        }
      : null
  };
});

await page.goto(`${BASE}/app/command-center.html`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
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
const contentRes = await page.evaluate(async () => {
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
    message: body.message || body.error || null,
    tileCount: Array.isArray(body.tiles) ? body.tiles.length : 0,
    keys: Object.keys(body),
    hint: String(body.message || body.error || text).slice(0, 300)
  };
});

await page.goto(`${BASE}/app/content-admin.html`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
const saveVisible = await page.locator("#saveBtn").isVisible().catch(() => false);
const saveHiddenAttr = await page.locator("#saveBtn").getAttribute("hidden").catch(() => "missing");
const uploadVisible = await page.locator("#uploadBox").isVisible().catch(() => false);
const uploadHiddenAttr = await page.locator("#uploadBox").getAttribute("hidden").catch(() => "missing");
const notice = (await page.locator("#noticeTxt").textContent().catch(() => "")) || "";
const bodyText = await page.locator("body").innerText();
await page.screenshot({ path: path.join(SHOTS, "03-content.png"), fullPage: true });

out.items.content = {
  api: contentRes,
  saveVisible,
  saveHiddenAttr: saveHiddenAttr !== null,
  uploadVisible,
  uploadHiddenAttr: uploadHiddenAttr !== null,
  notice: notice.trim(),
  pageMentionsError: /wrong|fail|missing|error|could not/i.test(notice + " " + bodyText.slice(0, 800))
};

out.shots = [
  "shots/00-after-login.png",
  "shots/01-campaigns-dropdown.png",
  "shots/01b-campaigns-after-pick.png",
  "shots/02-command-center-kpis.png",
  "shots/03-content.png"
];

fs.writeFileSync(path.join(OUT, "verify.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();

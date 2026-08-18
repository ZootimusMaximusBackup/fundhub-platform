/* Before/after for the pipeline board, run against the REAL public/ files.
 *
 * The API is stubbed at a fixed delay so the only thing that varies between the
 * two runs is the page's own behaviour: how many reads it makes, in what order,
 * and whether it makes any at all. Built on the shape of W3's local-waterfall.
 *
 *   node verify.mjs before   → serves public/app/*.html and data.js from git HEAD
 *   node verify.mjs after    → serves the working tree
 *
 * API_DELAY defaults to 400ms, the middle of what W2 measured live (353-673ms).
 */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const REPO = "/Users/zootimusmaximus/fundhub-platform";
const ROOT = path.join(REPO, "public");
// before     — git HEAD exactly, i.e. what is live right now
// crashfix    — git HEAD with ONLY the DOMContentLoaded wrap, so the eight-rail
//               prefetch is still in place. Isolates what the counts endpoint bought.
// after       — the working tree, both fixes
const MODE = ["before", "crashfix", "after"].includes(process.argv[2]) ? process.argv[2] : "after";
const API_DELAY = Number(process.env.API_DELAY || 400);
const CARDS = Number(process.env.CARDS || 50);
const RUNS = Number(process.env.RUNS || 3);

// The two files the fix touches. In "before" mode they come from git HEAD, so
// the comparison is against what is actually live, not a hand-edited copy.
const PATCHED = new Set(["/app/pipeline.html", "/app/data.js"]);
function fromHead(rel) {
  return execFileSync("git", ["show", `HEAD:public${rel}`], { cwd: REPO, maxBuffer: 1 << 26 });
}

function stages() {
  return ["New", "Contacted", "Booked", "Presented", "Won", "Lost"].map((n, i) => ({
    key: "s" + i, name: n, count: CARDS, amount: CARDS * 15000,
    cards: Array.from({ length: CARDS }, (_, j) => ({
      id: "c" + i + "_" + j, client_id: "cl" + i + "_" + j, name: "Person " + i + "-" + j,
      amount: 15000, entered_at: new Date(Date.now() - j * 3600e3).toISOString(),
      owner: "Rep " + (j % 7), survey_fico: "700-750"
    }))
  }));
}
const RAIL_KEYS = ["sales", "funding_card_stacking", "funding_altfin", "optimization",
  "inquiry_removal", "ar_collections", "affiliates_white_label", "hiring"];

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const j = (o, d = API_DELAY) => setTimeout(() => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(o));
  }, d);
  if (u.pathname.startsWith("/api/")) {
    if (u.pathname === "/api/auth/session")
      return j({ ok: true, staff: { id: "s1", name: "Owner", role: "owner", org_id: "o1", email: "owner@fundhub.ai" } }, 120);
    if (u.pathname === "/api/health") return j({ ok: true, db: "up", migrations: 120 }, 60);
    if (u.pathname === "/api/dashboard/pipeline") return j({ ok: true, stages: stages() });
    if (u.pathname === "/api/dashboard/pipeline-counts")
      return j({ ok: true, counts: Object.fromEntries(RAIL_KEYS.map((k) => [k, CARDS * 6])) });
    if (u.pathname === "/api/org-brand") return j({ ok: true, brand: {} }, 80);
    if (u.pathname === "/api/demo/mode") return j({ ok: true, demo_mode_enabled: false }, 80);
    return j({ ok: true }, 20);
  }
  try {
    let body;
    if (MODE === "after" || !PATCHED.has(u.pathname)) {
      body = fs.readFileSync(path.join(ROOT, u.pathname));
    } else {
      body = fromHead(u.pathname);
      if (MODE === "crashfix" && u.pathname === "/app/pipeline.html") {
        const t = String(body);
        const from = '  loadRailCounts("R-01");\n  load("R-01", "Sales");';
        const to = '  document.addEventListener("DOMContentLoaded", function () {\n' +
                   '    loadRailCounts("R-01");\n    load("R-01", "Sales");\n  });';
        if (!t.includes(from)) throw new Error("crashfix anchor missing in HEAD pipeline.html");
        body = Buffer.from(t.replace(from, to));
      }
    }
    const ct = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[path.extname(u.pathname)]
      || "application/octet-stream";
    res.writeHead(200, { "content-type": ct });
    res.end(body);
  } catch { res.writeHead(404); res.end("nf"); }
});

await new Promise((r) => srv.listen(0, r));
const port = srv.address().port;
const browser = await chromium.launch();
const results = [];

for (let run = 0; run < RUNS; run++) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, body: "", contentType: "text/css" }));
  await ctx.route("https://fonts.gstatic.com/**", (r) => r.abort());
  const page = await ctx.newPage();

  const errors = [];
  const api = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  page.on("request", (r) => {
    const p = new URL(r.url()).pathname;
    if (p.startsWith("/api/")) api.push({ path: p, at: Date.now() });
  });

  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/app/pipeline.html`, { waitUntil: "commit" });

  let firstCard = null;
  try {
    await page.waitForSelector(".card", { timeout: 15000 });
    firstCard = Date.now() - t0;
  } catch { /* stays null — no card ever appeared */ }

  // "All cards in" = the count stopped changing for 1200ms.
  let allIn = null, cardCount = 0;
  if (firstCard !== null) {
    let last = -1, stableSince = Date.now();
    while (Date.now() - t0 < 20000) {
      const n = await page.locator(".card").count();
      if (n !== last) { last = n; stableSince = Date.now(); }
      else if (Date.now() - stableSince >= 1200) break;
      await page.waitForTimeout(100);
    }
    cardCount = last;
    allIn = stableSince - t0;
  }

  const boardReads = api.filter((a) => a.path === "/api/dashboard/pipeline").length;
  const countReads = api.filter((a) => a.path === "/api/dashboard/pipeline-counts").length;
  results.push({
    run: run + 1, firstCardMs: firstCard, allCardsInMs: allIn, cardCount,
    boardReads, countReads, apiRequests: api.length,
    pageErrors: errors.slice()
  });
  await ctx.close();
}

await browser.close();
srv.close();

const med = (k) => {
  const v = results.map((r) => r[k]).filter((x) => x !== null).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};
const summary = {
  mode: MODE, apiDelayMs: API_DELAY, cardsPerStage: CARDS, runs: RUNS,
  medianFirstCardMs: med("firstCardMs"),
  medianAllCardsInMs: med("allCardsInMs"),
  cardCount: results[0].cardCount,
  boardReads: results[0].boardReads,
  countReads: results[0].countReads,
  totalApiRequests: results[0].apiRequests,
  pageErrors: results[0].pageErrors,
  raw: results
};
fs.writeFileSync(path.join(REPO, "docs/workflows/pipeline-perf-evidence/w4-fix", `${MODE}.json`),
  JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

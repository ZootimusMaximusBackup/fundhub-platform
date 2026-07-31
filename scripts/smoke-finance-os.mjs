#!/usr/bin/env node
// Browser smoke test for finance-os.html — drives real Chromium, no dependencies.
//
// WHY THIS FILE EXISTS AT ALL. scripts/dev-server.mjs's own header records the
// lesson: "Every ad-hoc verification harness in this project had to reimplement
// this, which is the clearest possible sign it belonged in the repo." This is
// the browser half of the same argument.
//
// WHY IT IS NOT A *.test.mjs. package.json's glob collects "scripts/**/*.test.mjs",
// so naming it that way would put a test needing a browser and a database into
// every CI run, where it would fail for reasons that have nothing to do with the
// code. It is a script you run deliberately.
//
// WHY IT SPEAKS CDP INSTEAD OF USING PLAYWRIGHT. The repo has exactly two
// dependencies, pg and inngest, and the rule is not to add one for something
// this small. Node 22 ships a global WebSocket, and Chromium's DevTools Protocol
// is reachable over it, so the whole driver is a few dozen lines.
//
// WHAT IT ASSERTS, and this is the part that matters. AUDIT-FINDINGS.md's
// sharpest lesson about screens is that "banner tone plus no console errors does
// not mean a screen works" — seven screens passed exactly that check while
// painting into a hidden drawer, reverting to sample data on the first
// keystroke, or rendering 5 of 10 columns. So this asserts the real numbers are
// VISIBLE IN THE RIGHT ELEMENTS, not merely that nothing exploded.
//
//   DATABASE_URL=... node scripts/smoke-finance-os.mjs --client <uuid> [--port 8931]

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv;
const arg = (n, d) => (argv.indexOf(n) > -1 ? argv[argv.indexOf(n) + 1] : d);
const CLIENT = arg("--client");
const PORT = Number(arg("--port", "8947"));
const CDP_PORT = Number(arg("--cdp-port", "9333"));
// /opt/pw-browsers/chromium is a SYMLINK TO THE BINARY, not to a directory —
// appending chrome-linux/chrome to it spawns with ENOTDIR.
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";

if (!CLIENT) { console.error("usage: --client <uuid>"); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${detail ? "  — " + detail : ""}`);
  if (!ok) fails.push(label);
};

/* A minimal CDP client: one WebSocket, id-matched replies, and the two events
   we care about (console messages and failed requests). */
async function attach(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  const failedRequests = [];

  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      consoleErrors.push((msg.params.args || []).map((a) => a.value ?? a.description).join(" "));
    }
    if (msg.method === "Runtime.exceptionThrown") {
      consoleErrors.push(msg.params.exceptionDetails?.exception?.description || "uncaught exception");
    }
    if (msg.method === "Network.loadingFailed") {
      /* Keep blockedReason, not just errorText: a request killed by
         Network.setBlockedURLs reports blockedReason "inspector" and an EMPTY
         errorText, so filtering on the text alone counted our own deliberate
         webfont block as two mystery failures with no message. */
      failedRequests.push({
        errorText: msg.params.errorText || "",
        blockedReason: msg.params.blockedReason || null
      });
    }
  };

  const send = (method, params = {}) => new Promise((res) => {
    const myId = ++id;
    pending.set(myId, res);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });

  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };

  return { send, evaluate, consoleErrors, failedRequests, close: () => ws.close() };
}

const server = spawn(process.execPath, [path.join(ROOT, "scripts/dev-server.mjs"), "--port", String(PORT)],
  { cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox",
  `--remote-debugging-port=${CDP_PORT}`,
  "--user-data-dir=/tmp/fos-smoke-profile", "about:blank"
], { stdio: ["ignore", "pipe", "pipe"] });

/* ATTACH TO THE PAGE TARGET, NOT THE BROWSER TARGET. The websocket Chromium
   prints on stderr is the BROWSER endpoint, and Page.* / Runtime.* are page
   domains — sending them there returns a reply with no `result`, so every
   evaluate came back undefined and the first assertion to touch it blamed the
   screen. /json/list gives the page's own webSocketDebuggerUrl. */
async function pageWsUrl() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(100);
  }
  return null;
}

const shutdown = () => { try { server.kill("SIGKILL"); } catch {} try { chrome.kill("SIGKILL"); } catch {} };
process.on("exit", shutdown);

/* Wait for the SERVER to actually answer before driving the browser. Without
   this, a port collision or a bad DATABASE_URL shows up as "login failed" and
   then a cascade of unrelated assertion errors, which is a harness lying about
   what broke. */
async function serverReady(base) {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(base + "/api/health"); if (r.ok) return true; } catch {}
    await sleep(100);
  }
  return false;
}

try {
  if (!(await serverReady(`http://127.0.0.1:${PORT}`))) {
    throw new Error(`dev-server never answered on port ${PORT} — port in use, or DATABASE_URL unset`);
  }
  const wsUrl = await pageWsUrl();
  if (!wsUrl) throw new Error("chromium never exposed a page target on the devtools port");

  const page = await attach(wsUrl);
  await page.send("Runtime.enable");
  await page.send("Network.enable");
  await page.send("Page.enable");

  /* BLOCK THE WEBFONT CDN, or nothing renders and the reason is invisible.
     Every screen in public/app/ loads Google Fonts from a render-blocking
     <link> in <head>. This sandbox has no direct outbound network, so that
     request HANGS rather than failing — the HTML parser stops partway through
     <head>, document.body is never created, and the page reports readyState
     "loading" forever with zero console errors and zero FAILED requests. The
     first version of this harness read that as "the screen rendered nothing"
     and blamed the screen.

     Blocking makes the request fail immediately, the parser continues, and the
     page renders with fallback fonts — which is exactly what a real visitor on
     a blocked or very slow network gets, so this is not a fiction invented for
     the test. NOTE: it is also a real finding about every screen in this repo,
     not something specific to finance-os.html. */
  await page.send("Network.setBlockedURLs", {
    urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*"]
  });

  // Sign in for real, through the real endpoint, and stash the token exactly the
  // way login.html does — a smoke test that fakes the session is not testing the
  // screen a user sees.
  const base = `http://127.0.0.1:${PORT}`;
  await page.send("Page.navigate", { url: `${base}/login.html` });
  await sleep(900);

  const login = await page.evaluate(`
    fetch("/api/auth/login", { method:"POST", headers:{"content-type":"application/json"},
      body: JSON.stringify({ email:"chris@fundhub.ai", password:${JSON.stringify(process.env.STAFF_INITIAL_PASSWORD || "")} })
    }).then(r => r.json()).then(d => { if (d.token) localStorage.setItem("fh_token", d.token); return !!d.token; })
  `);
  check(login === true, "signed in through the real /api/auth/login");

  console.log("\n-- live client --");
  await page.send("Page.navigate", { url: `${base}/app/finance-os.html?client_id=${CLIENT}` });
  await sleep(1800);

  const live = await page.evaluate(`(() => {
    const rows = [...document.querySelectorAll("#fosGrid .fos-row")].map(r => ({
      label: r.querySelector(".fos-label")?.firstChild?.textContent?.trim(),
      basis: r.querySelector(".fos-basis")?.textContent?.trim(),
      value: r.querySelector(".fos-value")?.textContent?.trim(),
      unknown: !!r.querySelector(".fos-value.is-unknown"),
      partial: r.classList.contains("is-partial")
    }));
    const b = document.getElementById("fh-data-banner");
    return { rows, banner: b && b.textContent, bannerBg: b && getComputedStyle(b).backgroundColor,
             source: document.getElementById("fosSource")?.textContent,
             bodyScrollsX: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  })()`);

  check(live.rows.length === 7, "seven rows rendered", `got ${live.rows.length}`);
  check(/live finance grid/.test(live.banner || ""), "banner reports live data", live.banner);
  check(live.bannerBg === "rgb(168, 216, 176)", "banner tone is mint (real)", live.bannerBg);
  check(live.source === "tradelines", "source chip names the data source", live.source);

  // The seeded file: limits 10000 + 5000 + 3000, balances 2500 + 1000 + 900,
  // and one line with NO APR. The numbers below are the arithmetic those imply.
  const byLabel = Object.fromEntries(live.rows.map((r) => [r.label, r]));
  check(byLabel["Total credit limit"]?.value === "18,000.00", "total credit limit is the real sum",
    byLabel["Total credit limit"]?.value);
  check(byLabel["Total balance"]?.value === "4,400.00", "total balance is the real sum",
    byLabel["Total balance"]?.value);
  check(byLabel["Available credit"]?.value === "13,600.00", "available credit is the real headroom",
    byLabel["Available credit"]?.value);
  check(byLabel["Open revolving lines"]?.value === "3", "line count is real",
    byLabel["Open revolving lines"]?.value);

  // THE ROW THAT MATTERS. One line reports no APR, so the APR row is a partial
  // and must SAY it is a partial rather than presenting itself as the answer.
  const apr = byLabel["Average APR (limit-weighted)"];
  check(apr?.partial === true, "the APR row is flagged partial (one line has no rate)");
  check(/floor/.test(apr?.basis || ""), "the APR row's basis line says it is a floor", apr?.basis);
  const cheapest = byLabel["Cheapest money available"];
  check(!/Capital One/.test(cheapest?.value || ""), "the unpriced line is NOT named as cheapest money",
    cheapest?.value);

  check(live.bodyScrollsX === false, "page does not scroll horizontally");
  check(page.consoleErrors.length === 0, "no console errors", page.consoleErrors.join(" | "));
  const realFailures = page.failedRequests.filter((f) => !f.blockedReason);
  check(realFailures.length === 0,
    `no failed requests (${page.failedRequests.length - realFailures.length} webfont request(s) blocked on purpose)`,
    realFailures.map((f) => f.errorText || "unknown failure").join(" | "));

  console.log("\n-- client with no tradelines --");
  await page.send("Page.navigate", { url: `${base}/app/finance-os.html?client_id=00000000-0000-0000-0000-000000000000` });
  await sleep(1500);
  const empty = await page.evaluate(`(() => {
    const vals = [...document.querySelectorAll("#fosGrid .fos-value")].map(v => v.textContent.trim());
    const b = document.getElementById("fh-data-banner");
    return { vals, banner: b && b.textContent };
  })()`);
  // UNKNOWN MUST NOT RENDER AS ZERO. "Nobody pulled this client" and "this
  // client has no credit" are opposite facts.
  // The banner check is not decoration: without it this assertion passes
  // vacuously whenever the READ failed and the sample markup stayed on screen,
  // which is precisely what happened on the first run.
  check(/live finance grid|no finance os in the database/.test(empty.banner || ""),
    "the empty-file read actually reached the backend", empty.banner);
  check(!empty.vals.some((v) => /^[\d,]+\.\d\d$/.test(v)),
    "an empty file renders no money figure at all — unknown is not 0.00", empty.vals.join(" / "));

  console.log("\n-- no client_id in the url --");
  await page.send("Page.navigate", { url: `${base}/app/finance-os.html` });
  await sleep(1200);
  const bare = await page.evaluate(`(() => {
    const b = document.getElementById("fh-data-banner");
    return { banner: b && b.textContent, bg: b && getComputedStyle(b).backgroundColor,
             rows: document.querySelectorAll("#fosGrid .fos-row").length };
  })()`);
  check(/client_id/.test(bare.banner || ""), "a missing client_id is explained, not reported as an outage", bare.banner);
  check(bare.bg !== "rgb(168, 216, 176)", "a missing client_id does NOT show a mint live banner", bare.bg);
  check(bare.rows === 7, "the sample grid stays on screen — a screen never blanks", String(bare.rows));

  page.close();
} catch (e) {
  console.error("SMOKE HARNESS FAILED:", e.message);
  fails.push("harness: " + e.message);
}

shutdown();
console.log(`\n${fails.length ? "FAILED: " + fails.length : "ALL CHECKS PASSED"}`);
process.exit(fails.length ? 1 : 0);

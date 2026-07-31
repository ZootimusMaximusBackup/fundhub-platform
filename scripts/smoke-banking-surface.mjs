#!/usr/bin/env node
// Browser smoke test for banking-surface.html — drives real Chromium, no dependencies.
//
// THE CLAIM UNDER TEST IS ONE SENTENCE: unknown is not personal.
// Migration 082 enforces it in storage and src/finance/banking-surface.mjs
// enforces it in the read. This checks the last mile — that the SCREEN does
// not quietly undo either, by folding an unclassified account into the
// personal card or by printing one total across all three groups. Both are
// things a unit test cannot see and a human would not notice.
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
//   DATABASE_URL=... node scripts/smoke-banking-surface.mjs --client <uuid> [--port 8931]

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv;
const arg = (n, d) => (argv.indexOf(n) > -1 ? argv[argv.indexOf(n) + 1] : d);
const CLIENT = arg("--client");
const PORT = Number(arg("--port", "8971"));
const CDP_PORT = Number(arg("--cdp-port", "9371"));
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
  "--user-data-dir=/tmp/bs-smoke-profile", "about:blank"
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
     not something specific to banking-surface.html. */
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
  await page.send("Page.navigate", { url: `${base}/app/banking-surface.html?client_id=${CLIENT}` });
  await sleep(1800);

  const live = await page.evaluate(`(() => {
    const groups = [...document.querySelectorAll("#bsGroups .bs-group")].map(g => ({
      label: g.querySelector(".bs-glabel")?.firstChild?.textContent?.trim(),
      basis: g.querySelector(".bs-gbasis")?.textContent?.trim(),
      total: g.querySelector(".bs-gtotal")?.textContent?.trim(),
      isUnknownCard: g.classList.contains("is-unknown"),
      accounts: [...g.querySelectorAll(".bs-acct")].map(a => ({
        name: a.querySelector(".bs-aname")?.firstChild?.textContent?.trim(),
        meta: a.querySelector(".bs-ameta")?.textContent?.trim(),
        bal: a.querySelector(".bs-abal")?.textContent?.trim(),
        over: !!a.querySelector(".bs-abal.is-over")
      }))
    }));
    const b = document.getElementById("fh-data-banner");
    const todo = document.getElementById("bsTodo");
    return { groups, banner: b && b.textContent, bannerBg: b && getComputedStyle(b).backgroundColor,
             source: document.getElementById("bsSource")?.textContent,
             todoShown: todo && getComputedStyle(todo).display !== "none",
             todoText: todo && todo.textContent.trim(),
             bodyText: document.body.innerText,
             bodyScrollsX: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  })()`);

  check(/live banking surface/.test(live.banner || ""), "banner reports live data", live.banner);
  check(live.bannerBg === "rgb(168, 216, 176)", "banner tone is mint (real)", live.bannerBg);
  check(live.source === "bank_accounts", "source chip names the data source", live.source);

  const byLabel = {};
  live.groups.forEach(g => { byLabel[(g.label || "").split("—")[0].trim()] = g; });

  // Seeded: personal = 1500 + 8800 + (-420) open, plus one CLOSED 9999.99.
  // business = 5000. unclassified = 9000.
  const personal = byLabel["Personal"];
  const business = byLabel["Business"];
  const unknown  = byLabel["Unclassified"];

  check(!!personal && !!business && !!unknown, "all three groups are drawn separately",
    Object.keys(byLabel).join(" / "));

  // ---- THE RULE ----
  check(unknown && unknown.accounts.length === 1,
    "the unclassified account has its own group", unknown && String(unknown.accounts.length));
  check(personal && !personal.accounts.some(a => /Unnamed Institution/.test(a.name || "")),
    "the unclassified account is NOT listed under Personal");
  check(personal && personal.total === "9,880.00",
    "the personal total excludes unclassified AND closed money", personal && personal.total);
  check(unknown && unknown.total === "9,000.00", "the unclassified total stands alone",
    unknown && unknown.total);
  check(business && business.total === "5,000.00", "the business total stands alone",
    business && business.total);

  // No combined figure anywhere on the page. 9880 + 5000 + 9000 = 23880.
  check(!/23,880\.00/.test(live.bodyText || ""),
    "no single total spanning personal + business + unclassified appears on the page");
  check(!/18,880\.00/.test(live.bodyText || ""),
    "no total folding unclassified into personal appears on the page");

  check(live.todoShown === true, "the unclassified call-to-action banner is shown");
  check(/NOT counted as the client/.test(live.todoText || ""),
    "the call to action says unclassified money is not the client's", live.todoText);
  check(unknown && /not established/.test(unknown.accounts[0].meta || ""),
    "the unclassified account says whose money is not established",
    unknown && unknown.accounts[0].meta);

  // ---- overdrafts and closed accounts ----
  const over = personal && personal.accounts.find(a => /Overdrawn/.test(a.name || ""));
  check(!!over && over.bal === "-420.00", "an overdraft is shown as negative, not clamped to zero",
    over && over.bal);
  check(!!over && over.over === true, "the overdrawn account is visually marked");
  check(personal && personal.accounts.some(a => /Old Closed Account/.test(a.name || "")),
    "a closed account is still listed");
  check(personal && /closed/.test((personal.accounts.find(a => /Old Closed/.test(a.name || "")) || {}).meta || ""),
    "the closed account is labelled closed");
  /* THE FLOOR CASE. One open personal account reports no balance at all, so the
     group total is a floor, not a figure — and the card has to say so rather
     than presenting 9,880.00 as the answer. The total is unchanged; what
     changes is whether the screen admits it is incomplete. */
  check(personal && /this is a floor/.test(personal.basis || ""),
    "the personal group admits its total is a floor when an account did not report",
    personal && personal.basis);
  check(personal && /counted 3 of 4/.test(personal.basis || ""),
    "the floor line names how many accounts were counted and how many were not",
    personal && personal.basis);

  check(live.bodyScrollsX === false, "page does not scroll horizontally");
  check(page.consoleErrors.length === 0, "no console errors", page.consoleErrors.join(" | "));
  const realFailures = page.failedRequests.filter((f) => !f.blockedReason);
  check(realFailures.length === 0,
    `no failed requests (${page.failedRequests.length - realFailures.length} webfont request(s) blocked on purpose)`,
    realFailures.map((f) => f.errorText || "unknown failure").join(" | "));

  console.log("\n-- client with no bank accounts --");
  await page.send("Page.navigate", { url: `${base}/app/banking-surface.html?client_id=00000000-0000-0000-0000-000000000000` });
  await sleep(1500);
  const empty = await page.evaluate(`(() => {
    const b = document.getElementById("fh-data-banner");
    return { banner: b && b.textContent, bodyText: document.body.innerText };
  })()`);
  check(/no banking in the database|live banking surface/.test(empty.banner || ""),
    "the empty read actually reached the backend", empty.banner);

  console.log("\n-- no client_id in the url --");
  await page.send("Page.navigate", { url: `${base}/app/banking-surface.html` });
  await sleep(1200);
  const bare = await page.evaluate(`(() => {
    const b = document.getElementById("fh-data-banner");
    return { banner: b && b.textContent, bg: b && getComputedStyle(b).backgroundColor,
             groups: document.querySelectorAll("#bsGroups .bs-group").length };
  })()`);
  check(/client_id/.test(bare.banner || ""), "a missing client_id is explained, not reported as an outage", bare.banner);
  check(bare.bg !== "rgb(168, 216, 176)", "a missing client_id does NOT show a mint live banner", bare.bg);
  check(bare.groups > 0, "the sample markup stays on screen — a screen never blanks", String(bare.groups));

  page.close();
} catch (e) {
  console.error("SMOKE HARNESS FAILED:", e.message);
  fails.push("harness: " + e.message);
}

shutdown();
console.log(`\n${fails.length ? "FAILED: " + fails.length : "ALL CHECKS PASSED"}`);
process.exit(fails.length ? 1 : 0);

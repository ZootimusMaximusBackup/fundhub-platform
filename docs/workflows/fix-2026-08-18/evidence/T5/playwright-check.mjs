/* Playwright check for the two UI changes in T5 (definition of done, item 4).
   Serves public/ locally and stubs every /api/** call, so this proves the
   SCREENS, not the server. Nothing here touches production. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = "/tmp/wt-T5/public";
const OUT = "/tmp/wt-T5/docs/workflows/fix-2026-08-18/evidence/T5/after";
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split("?")[0]);
  const file = path.join(ROOT, p === "/" ? "/index.html" : p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end("not found");
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond, extra });
  console.log((cond ? "PASS  " : "FAIL  ") + name + (extra ? "  — " + extra : ""));
};

/* ── 1. the unsubscribe page ───────────────────────────────────────────── */
{
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const page = await ctx.newPage();
  let posted = null;
  await page.route("**/api/public/unsubscribe*", async (route) => {
    const req = route.request();
    if (req.method() === "POST") { posted = JSON.parse(req.postData() || "{}"); 
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, channel: "email", unsubscribed: true }) }); }
    return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ ok: true, channel: "email", already_unsubscribed: false }) });
  });
  const q = "org=11111111-1111-4111-8111-111111111111&client=22222222-2222-4222-8222-222222222222" +
            "&channel=email&exp=9999999999&sig=" + "a".repeat(64);
  await page.goto(`${BASE}/unsubscribe.html?${q}`);
  await page.waitForSelector("#ask:not([hidden])", { timeout: 5000 });
  ok("unsubscribe page offers a button on a valid link", await page.isVisible("#go"));
  await page.screenshot({ path: path.join(OUT, "unsub-1-ask.png") });

  await page.click("#go");
  await page.waitForFunction(() => getComputedStyle(document.getElementById("done-box")).display !== "none", null, { timeout: 5000 });
  ok("pressing it confirms, and only the POST unsubscribes", posted && posted.client === "22222222-2222-4222-8222-222222222222",
      JSON.stringify(posted));
  ok("the confirmation is shown in plain words",
      /will not get any more/i.test(await page.textContent("#done-box")));
  await page.screenshot({ path: path.join(OUT, "unsub-2-done.png") });
  await ctx.close();
}

/* a link the server rejects shows a dead-end-free error */
{
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const page = await ctx.newPage();
  await page.route("**/api/public/unsubscribe*", (route) => route.fulfill({
    status: 400, contentType: "application/json",
    body: JSON.stringify({ ok: false, error: "invalid_or_expired",
      message: "This unsubscribe link is not valid any more. Reply to any of our emails with the word STOP and we will take you off the list." })
  }));
  await page.goto(`${BASE}/unsubscribe.html?org=a&client=b&channel=email&exp=1&sig=c`);
  await page.waitForSelector("#err", { state: "visible", timeout: 5000 });
  const txt = await page.textContent("#err");
  ok("a bad link explains another way out rather than just failing", /STOP/.test(txt));
  ok("a bad link offers no button that cannot work", !(await page.isVisible("#go")));
  await page.screenshot({ path: path.join(OUT, "unsub-3-badlink.png") });
  await ctx.close();
}

/* ── 2. the Messaging destination box ──────────────────────────────────── */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
  const CONVO = "3f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b";
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    const j = (data) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
    if (u.pathname.endsWith("/auth/session")) return j({ ok: true, staff: { id: "s1", role: "owner", email: "owner@fundhub.ai", first_name: "Owner", last_name: "Test", org_id: "o1" } });
    if (u.pathname.includes("/read/inbox")) return j({ ok: true, items: [{ id: CONVO, client_id: CLIENT, channel: "sms", first_name: "Test", last_name: "Person", needs_reply: true, last_at: new Date().toISOString(), last_body: "hello" }], hasMore: false });
    if (u.pathname.includes("/read/messages")) return j({ ok: true, items: [] });
    if (u.pathname.includes("/read/conversations")) return j({ ok: true, items: [] });
    if (u.pathname.includes("/dashboard/client")) return j({ ok: true, client: { id: CLIENT, email: "", phone: "" } });
    return j({ ok: true, items: [] });
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("fh_token", "test-token"); } catch (e) {} });
  await page.goto(`${BASE}/app/messaging.html`);
  await page.waitForTimeout(1200);
  await page.waitForSelector("#composeTo", { timeout: 8000 });
  ok("Messaging now HAS a destination box", await page.isVisible("#composeTo"));
  ok("it is labelled", (await page.textContent('label[for="composeTo"]')).trim().length > 0);

  await page.click(".convo[data-id]", { timeout: 8000 });
  await page.waitForTimeout(600);

  // A client with no phone on file: the box is empty and says so, and Send is off.
  const emptyNote = await page.textContent("#composeToNote").catch(() => "");
  ok("an empty destination explains what is missing BEFORE Send is pressed", /phone number/i.test(emptyNote), emptyNote.trim());
  // Empty is a WARNING, not a lock: the send falls back to the client record,
  // as it always did. Gating Send on this box being filled tied sending to a
  // separate client read and killed the button when that read failed.
  ok("an empty destination warns but still lets the send fall back",
      !(await page.isDisabled("#sendBtn")));
  await page.screenshot({ path: path.join(OUT, "messaging-1-no-address.png") });

  await page.fill("#composeTo", "5551234567");
  await page.waitForTimeout(200);
  ok("a filled-but-malformed number DOES switch Send off",
      await page.isDisabled("#sendBtn"), (await page.textContent("#composeToNote")).trim());
  await page.screenshot({ path: path.join(OUT, "messaging-2-bad-address.png") });

  await page.fill("#composeTo", "+15551234567");
  await page.fill("#composeBody", "Testing the destination box.");
  await page.waitForTimeout(200);
  ok("a good number enables Send", !(await page.isDisabled("#sendBtn")));
  ok("and the warning goes away", await page.getAttribute("#composeToNote", "hidden") !== null);
  await page.screenshot({ path: path.join(OUT, "messaging-3-good-address.png") });
  await ctx.close();
}

await browser.close();
server.close();
fs.writeFileSync(path.join(OUT, "playwright-check.json"), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

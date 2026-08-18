import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-response-loop-2026-08-19-evidence");
const session = JSON.parse(fs.readFileSync("/tmp/p3-response-loop-session.json", "utf8"));
function loadDotEnv() {
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadDotEnv();
function chromeExe() {
  const home = process.env.HOME || "";
  const root = path.join(home, "Library/Caches/ms-playwright");
  const dirs = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1])) : [];
  for (const d of dirs) {
    const exe = path.join(root, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (fs.existsSync(exe)) return exe;
  }
  return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const ev = await c.query(
  `SELECT name, count(*)::int AS n FROM events WHERE client_id = $1 GROUP BY 1 ORDER BY 1`,
  [session.client_id]
);
const inboundEv = await c.query(
  `SELECT id, name, created_at FROM events WHERE client_id = $1 AND name IN ('message.inbound','mail.response') ORDER BY created_at DESC LIMIT 10`,
  [session.client_id]
);
fs.writeFileSync(path.join(OUT, "dumps/27-events.json"), JSON.stringify({
  by_name: ev.rows,
  inbound_or_mail_response: inboundEv.rows.map((r) => ({ id: r.id, name: r.name, created_at: r.created_at }))
}, null, 2));
await c.end();

const loginRes = await fetch("https://fundhub.ai/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "chris@fundhub.ai", password: process.env.STAFF_E2E_PASSWORD })
});
const token = (await loginRes.json()).token;
const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: "fundhub_session", value: token, url: "https://fundhub.ai" }]);
const page = await ctx.newPage();
await page.goto(`https://fundhub.ai/app/messaging.html?client_id=${session.client_id}`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(3500);
const text = await page.evaluate(() => (document.body && document.body.innerText || "").slice(0, 7000));
await page.screenshot({ path: path.join(OUT, "shots/13-staff-messaging-after-chat.png") });
const emailTab = page.getByText(/email/i).first();
if (await emailTab.count()) {
  await emailTab.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, "shots/14-staff-messaging-email.png") });
}
fs.writeFileSync(path.join(OUT, "dumps/28-staff-messaging-after.json"), JSON.stringify({
  url: page.url(),
  saw_p3: /P3 audit portal chat/i.test(text),
  has_sim: /Simulated Client/i.test(text),
  has_live: /ProveFunding/i.test(text),
  has_no_thread: /no thread yet/i.test(text),
  has_received: /received|inbound|P3 audit/i.test(text)
}, null, 2));
console.log(JSON.stringify({
  events: ev.rows,
  inbound_events: inboundEv.rows.length,
  staff_saw_p3: /P3 audit portal chat/i.test(text),
  has_sim: /Simulated Client/i.test(text)
}));
await browser.close();

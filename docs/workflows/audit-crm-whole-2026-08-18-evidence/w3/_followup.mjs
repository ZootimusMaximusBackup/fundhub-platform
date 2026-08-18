import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-crm-whole-2026-08-18-evidence/w3");
const BASE = "https://fundhub.ai";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadDotEnv();
const PASSWORD = process.env.STAFF_E2E_PASSWORD || "";
if (!PASSWORD) throw new Error("STAFF_E2E_PASSWORD missing");

function chromeExe() {
  const home = process.env.HOME || "";
  const root = path.join(home, "Library/Caches/ms-playwright");
  if (!fs.existsSync(root)) return undefined;
  const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    const exe = path.join(root, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}

const extra = [];
function rec(row) {
  extra.push(row);
  console.log(JSON.stringify(row));
}

async function login(page, email) {
  await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator("#email").fill(email);
  await page.locator("#pw").fill(PASSWORD);
  await page.locator("#go").click();
  await page.waitForFunction(() => !/login\.html/i.test(location.pathname), null, { timeout: 30000 });
}

async function shot(page, slug) {
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return path.relative(ROOT, file);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });

  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const net = [];
    page.on("dialog", (d) => d.dismiss());
    page.on("response", (res) => {
      const u = res.url();
      if (/\/api\//.test(u)) {
        try {
          const x = new URL(u);
          net.push({ status: res.status(), method: res.request().method(), path: (x.pathname + x.search).slice(0, 200) });
        } catch {}
      }
    });
    await login(page, "inquiry@fundhub.ai");
    await page.goto(BASE + "/app/inquiry-remover.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);
    const queueText = await page.locator("#queue-status-row").innerText().catch(() => "(no status row)");
    const inqCalls = net.filter((n) => /inquir/i.test(n.path));
    rec({
      role: "inquiry", screen: "specialist", claimed: "Work queue finishes loading",
      happened: queueText.replace(/\s+/g, " ").slice(0, 200) + " | apis=" + JSON.stringify(inqCalls),
      evidence: await shot(page, "inquiry-spec-queue-wait")
    });
    const caseRows = page.locator("#caseQueueBody tr, table.queue tbody tr").filter({ hasText: "TEST" });
    const n = await caseRows.count();
    rec({ role: "inquiry", screen: "specialist", claimed: "Queued test cases are clickable", happened: `${n} TEST rows` });
    if (n) {
      await caseRows.first().click();
      await page.waitForTimeout(1200);
      const acts = await page.evaluate(() =>
        [...document.querySelectorAll("[data-act], [data-case-act], button.primary, button.qbtn, a.qbtn")]
          .filter((e) => e.offsetParent)
          .map((e) => ({
            text: (e.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80),
            act: e.getAttribute("data-act") || e.getAttribute("data-case-act") || "",
            disabled: !!e.disabled
          }))
      );
      const cid = await page.evaluate(() => {
        const el = document.querySelector("[data-case-id], tr[data-client-id], .case-expand");
        return (el && (el.getAttribute("data-case-id") || el.getAttribute("data-client-id"))) || "";
      });
      rec({
        role: "inquiry", screen: "specialist",
        claimed: "Click a Queued case row opens letter / send / upload",
        happened: JSON.stringify({ clientHint: cid, acts }),
        evidence: await shot(page, "inquiry-spec-case-open"),
        note: cid === FORBIDDEN ? "would skip fire" : "test case"
      });
      const packet = page.locator('[data-act="packet"]').first();
      if (await packet.count() && await packet.isVisible()) {
        const [popup] = await Promise.all([
          page.waitForEvent("popup", { timeout: 4000 }).catch(() => null),
          packet.click()
        ]);
        rec({
          role: "inquiry", screen: "specialist",
          claimed: "Download packet opens this client's documents",
          happened: popup ? `popup ${popup.url()}` : "clicked — no popup",
          evidence: await shot(page, "inquiry-spec-packet")
        });
        if (popup) await popup.close().catch(() => {});
      }
      rec({
        role: "inquiry", screen: "specialist",
        claimed: "Send mails the bureau letter",
        happened: "NOT clicked — FIRE belongs to W1; test case only, no PostGrid from W3"
      });
      rec({
        role: "inquiry", screen: "specialist",
        claimed: "Upload FTC or police report attaches a file",
        happened: "NOT clicked — no file chosen; would POST /api/documents-upload"
      });
      rec({
        role: "inquiry", screen: "specialist",
        claimed: "Mark cleared / Close writes the case",
        happened: "NOT clicked — would mutate W1's Queued test cases"
      });
    }
    const allLetters = page.locator("a:has-text('All letters')");
    if (await allLetters.count()) {
      await allLetters.first().click();
      await page.waitForTimeout(1200);
      rec({
        role: "inquiry", screen: "specialist",
        claimed: "All letters ↗ opens the letters list",
        happened: page.url(),
        evidence: await shot(page, "inquiry-spec-all-letters")
      });
    }
    await ctx.close();
  }

  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on("dialog", (d) => d.dismiss());
    await login(page, "chris@fundhub.ai");

    await page.goto(BASE + "/app/finance-os.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const dismiss = page.locator("#fh-beta-banner button, button:has-text('Dismiss')").first();
    if (await dismiss.count() && await dismiss.isVisible()) {
      await dismiss.click();
      await page.waitForTimeout(500);
      const still = await page.locator("#fh-beta-banner").isVisible().catch(() => false);
      rec({
        role: "owner", screen: "finance",
        claimed: "Dismiss hides the beta bar",
        happened: still ? "bar still visible" : "bar gone",
        evidence: await shot(page, "owner-finance-dismiss")
      });
    }

    await page.goto(BASE + "/app/products-commissions.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const prod = page.locator("tbody tr").filter({ hasText: "Diagnostic" }).first();
    if (await prod.count()) {
      await prod.click();
      await page.waitForTimeout(700);
      rec({
        role: "owner", screen: "products",
        claimed: "Click a product row opens the editor",
        happened: (await page.locator("#edTitle").innerText().catch(() => "")).slice(0, 80),
        evidence: await shot(page, "owner-products-row-edit")
      });
      await page.locator("#edCancel").click().catch(() => {});
    }

    await page.goto(BASE + "/app/messaging.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    await page.locator('button.ctab[data-filter="all"]').click();
    await page.waitForTimeout(1500);
    const convo = page.locator(".convo").first();
    if (await convo.count() && await convo.isVisible()) {
      const label = (await convo.innerText()).replace(/\s+/g, " ").trim().slice(0, 80);
      await convo.click();
      await page.waitForTimeout(1500);
      rec({
        role: "owner", screen: "messaging",
        claimed: "Open a conversation reads the thread",
        happened: `opened ${label} → ${(await page.locator("#thName").innerText()).slice(0, 80)}`,
        evidence: await shot(page, "owner-msg-thread")
      });
      await page.locator("#composeBody").fill("W3 audit do not send").catch(() => {});
      rec({
        role: "owner", screen: "messaging",
        claimed: "Send posts a reply on this channel",
        happened: "typed only — NOT clicked; would POST /api/messages (live mail/SMS)",
        evidence: await shot(page, "owner-msg-compose")
      });
    }

    await page.goto(BASE + "/app/staff-teams.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await page.locator('button.tab[data-tab="telemetry"]').click();
    await page.waitForTimeout(1200);
    rec({
      role: "owner", screen: "staff",
      claimed: "Telemetry tab shows Hubstaff activity",
      happened: (await page.locator("main, .content, body").innerText()).replace(/\s+/g, " ").slice(400, 700),
      evidence: await shot(page, "owner-staff-tele-wait")
    });

    await page.goto(BASE + "/app/inquiry-remover.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);
    rec({
      role: "owner", screen: "specialist",
      claimed: "Owner sees the same test cases as Specialist",
      happened: (await page.locator("body").innerText()).includes("TEST Client")
        ? "TEST Client rows visible"
        : "TEST Client rows not visible; queue=" + (await page.locator("#queue-status-row").innerText().catch(() => "n/a")),
      evidence: await shot(page, "owner-spec-after-w1")
    });

    await ctx.close();
  }

  fs.writeFileSync(path.join(OUT, "followup.json"), JSON.stringify(extra, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

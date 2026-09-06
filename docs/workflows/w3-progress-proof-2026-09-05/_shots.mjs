/* Marked proof shots for the progress-page repair pass, 2026-09-05.
 *
 * WHY THE MARKS ARE DRAWN IN THE PAGE AND NOT PAINTED ON AFTERWARDS.
 * Owner rule (CLAUDE.md §8): a red box must sit ON the element its caption
 * names. Four shots in this project have pointed at an empty status bar because
 * the box was positioned by hand against a remembered layout. Here the box is
 * built from the element's OWN getBoundingClientRect() a few milliseconds
 * before the shutter, so it cannot be aimed at the wrong thing: if the selector
 * misses, the script throws rather than producing a confidently wrong picture.
 *
 * RUN IT:
 *   node e2e/static-server.mjs &            (E2E_PORT=43460)
 *   E2E_PORT=43460 node docs/workflows/w3-progress-proof-2026-09-05/_shots.mjs
 *
 * It needs the same Chromium the Playwright config finds. Nothing here talks to
 * a database or to a live site: every /api/** call is answered in the browser.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.E2E_PORT || 43460);
const BASE = `http://127.0.0.1:${PORT}`;
const CLIENT_ID = "aaaaaaaa-1111-4111-8111-111111111111";

const CLIENT_SESSION = {
  ok: true,
  staff: {
    id: CLIENT_ID, name: "Dana Whitfield", email: "dana@example.com",
    role: "client", org_id: "org-1", status: "active"
  }
};

const TIMELINE = [
  { at: "2026-03-04T00:00:00.000Z", text: "Mar 3 · letters mailed to all three bureaus" },
  { at: "2026-02-13T00:00:00.000Z", text: "Feb 12 · photo ID received" }
];

function payload(over = {}) {
  return {
    ok: true,
    stage: {
      key: "in_transit", roundCurrent: 2, roundCap: 6,
      enteredAt: "2026-03-03T00:00:00Z",
      expectedResponseBy: "2026-04-02T00:00:00Z", waitingOn: "bureaus"
    },
    scores: {
      personal: [
        { bureau: "experian", score: 651, pulledAt: "2026-03-01T00:00:00Z", reportDocumentId: null },
        { bureau: "equifax", score: 648, pulledAt: "2026-03-01T00:00:00Z", reportDocumentId: null },
        { bureau: "transunion", score: null, pulledAt: null, reportDocumentId: null }
      ],
      business: []
    },
    movement: {
      middleScoreNow: null, middleScoreBaseline: null, baselineAt: null,
      itemsRemoved: 2, itemsDisputed: 7, series: []
    },
    waypoints: [], nextStep: null, timeline: TIMELINE, deliverables: [], paidServices: [],
    referral: { enrolled: false, shareUrl: null, code: null },
    ...over
  };
}

/* The chat panel opens itself over the right third of the portal. Shut it so a
   marked box is never half-hidden behind it. */
async function closeChat(page) {
  const close = page.locator("#fh-chat-panel #fh-chat-close, #fh-chat-panel .fh-chat-close");
  if (await close.count()) { await close.first().click().catch(() => {}); return; }
  await page.evaluate(() => {
    const p = document.getElementById("fh-chat-panel");
    if (p) p.classList.remove("open");
  });
}

/* Draws numbered red boxes on real elements plus a legend, then returns the
   captions so the caller can write them next to the file. Throws on a miss. */
async function mark(page, marks) {
  const missing = await page.evaluate((ms) => {
    const gone = [];
    const layer = document.createElement("div");
    layer.id = "__marks";
    layer.style.cssText =
      "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:2147483647";
    document.body.appendChild(layer);

    ms.forEach((m, i) => {
      const el = document.querySelector(m.sel);
      if (!el) { gone.push(m.sel); return; }
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) { gone.push(m.sel + " (zero size)"); return; }
      const box = document.createElement("div");
      box.style.cssText =
        "position:absolute;border:3px solid #E5484D;border-radius:6px;" +
        "left:" + (r.left + window.scrollX - 4) + "px;" +
        "top:" + (r.top + window.scrollY - 4) + "px;" +
        "width:" + (r.width + 8) + "px;height:" + (r.height + 8) + "px";
      const tag = document.createElement("div");
      tag.textContent = String(i + 1);
      tag.style.cssText =
        "position:absolute;left:-34px;top:-4px;background:#E5484D;color:#fff;" +
        "font:700 13px/18px system-ui,sans-serif;padding:1px 8px;border-radius:4px";
      box.appendChild(tag);
      layer.appendChild(box);
    });

    const legend = document.createElement("div");
    legend.style.cssText =
      "position:absolute;left:16px;top:8px;max-width:560px;" +
      "background:#111;color:#fff;font:500 12px/1.55 system-ui,sans-serif;" +
      "padding:10px 14px;border-radius:8px;border:2px solid #E5484D";
    legend.innerHTML = ms
      .map((m, i) => "<div><b>" + (i + 1) + "</b> — " + m.cap.replace(/[<>&]/g, "") + "</div>")
      .join("");
    layer.appendChild(legend);
    return gone;
  }, marks);

  if (missing.length) throw new Error("mark target not on the page: " + missing.join(", "));
}

async function shoot(page, file) {
  const out = path.join(HERE, file);
  await page.screenshot({ path: out, fullPage: true });
  // eslint-disable-next-line no-console
  console.log("wrote", out);
}

async function routeProgress(page, body, status = 200) {
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const reply = (b, s = 200) => route.fulfill({
      status: s, contentType: "application/json", body: JSON.stringify(b)
    });
    if (url.includes("/api/auth/session")) return reply(CLIENT_SESSION);
    if (url.includes("/api/read/client-progress")) return reply(body, status);
    return reply({ ok: true });
  });
}

const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM;

async function main() {
  fs.mkdirSync(HERE, { recursive: true });
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await ctx.addInitScript(() => {
    localStorage.setItem("fh_token", "proof-token");
    localStorage.setItem("fh_role", "client");
  });

  // 01 — the portal link, on a client with NO funding entitlement.
  {
    const page = await ctx.newPage();
    await routeProgress(page, payload());
    await page.goto(`${BASE}/app/client-portal.html?id=${CLIENT_ID}`);
    await page.waitForTimeout(1400);
    await closeChat(page);
    await mark(page, [
      { sel: "#prog-link a", cap: "The link to the progress page. Clicking it now changes the address bar — proven in e2e/progress-page.spec.mjs, which prints the URL before and after." },
      { sel: ".prog-card.precall-only", cap: "What this client sees instead of the funding card: body still carries class no-funding, so the funding-only card the link used to be inside is not on the page at all. The link is below this card, outside it." }
    ]);
    await shoot(page, "01-portal-link-outside-the-funding-card.png");
    await page.close();
  }

  // 02 — one date per timeline row.
  {
    const page = await ctx.newPage();
    await routeProgress(page, payload());
    await page.goto(`${BASE}/progress.html`);
    await page.waitForTimeout(700);
    await page.locator("#cTimeline .ev").first().scrollIntoViewIfNeeded();
    await mark(page, [
      { sel: "#cTimeline .ev:nth-child(1)", cap: "One date. The server sent 'Mar 3 · letters mailed to all three bureaus' with at=2026-03-04T00:00:00Z; the row now reads 4 March 2026 once, from at." },
      { sel: "#cTimeline .ev:nth-child(2)", cap: "The same on the second row: 13 February 2026, not '13 February 2026 / Feb 12'." }
    ]);
    await shoot(page, "02-timeline-one-date-per-row.png");
    await page.close();
  }

  // 03 / 04 — round 4 on a cancelled file and on a file that is on hold.
  for (const [key, file, cap] of [
    ["cancelled", "03-round-4-cancelled.png",
      "Round 4 on a cancelled file. It says none are being prepared or sent, and never that anything was filed."],
    ["on_hold", "04-round-4-on-hold.png",
      "Round 4 on a file that is on hold. Same sentence, same refusal to imply work is happening."]
  ]) {
    const page = await ctx.newPage();
    await routeProgress(page, payload({
      stage: {
        key, roundCurrent: 4, roundCap: 6,
        enteredAt: "2026-03-03T00:00:00Z", expectedResponseBy: null, waitingOn: null
      }
    }));
    await page.goto(`${BASE}/progress.html`);
    await page.waitForTimeout(700);
    await mark(page, [
      { sel: "#cStage .note", cap },
      { sel: "#cStage .badge", cap: "The stage badge, straight from stage.key." }
    ]);
    await shoot(page, file);
    await page.close();
  }

  // 05 — the portal Activity tab when the read fails.
  {
    const page = await ctx.newPage();
    await page.route("**/api/**", async (route) => {
      const url = route.request().url();
      const reply = (b, s = 200) => route.fulfill({
        status: s, contentType: "application/json", body: JSON.stringify(b)
      });
      if (url.includes("/api/auth/session")) return reply(CLIENT_SESSION);
      if (url.includes("/api/read/client-progress")) return reply({ ok: false }, 404);
      return reply({ ok: true });
    });
    await page.goto(`${BASE}/app/client-portal.html?id=${CLIENT_ID}`);
    await page.waitForTimeout(1200);
    await closeChat(page);
    await page.locator("#acct").evaluate((el) => { el.open = true; });
    await page.locator('button.tab[data-tab="act"]').click();
    await page.waitForTimeout(300);
    await page.locator("#tp-act").scrollIntoViewIfNeeded();
    await mark(page, [
      { sel: "#tp-act .timeline-item", cap: "The read failed, so the tab says the read failed. It no longer leaves 'No activity recorded on this file yet' — a sentence about the file that a failed read cannot know." }
    ]);
    await shoot(page, "05-activity-tab-failed-read.png");
    await page.close();
  }

  await browser.close();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

/* Hole 10 — the live click. Two passes over the same eight URLs on
   https://fundhub.ai.

   Pass A is the site exactly as deployed today.
   Pass B serves the two fixed files off this branch in place of the deployed
   ones (page.route), so the LIVE backend answers a patched page. That is the
   fix proved against real data without deploying it first. */
import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { BASE, liveStaffLogin } from "./live-auth.mjs";

const ID = "ac1ac964-e02b-468b-9cbe-7030e03dd13b";
const KEYS = ["id", "client", "client_id", "contact"];
const OUT = process.env.HOLE10_LIVE_OUT || "/tmp/hole10-live";
const MODE = process.env.HOLE10_MODE || "asis";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

fs.mkdirSync(OUT, { recursive: true });

async function servePatched(page) {
  const files = {
    "**/app/client-control-panel.html*": ["public/app/client-control-panel.html", "text/html"],
    "**/app/present.js*": ["public/app/present.js", "application/javascript"]
  };
  for (const [glob, [rel, type]] of Object.entries(files)) {
    const body = fs.readFileSync(path.join(ROOT, rel), "utf8");
    await page.route(glob, (route) =>
      route.fulfill({ status: 200, contentType: type, body })
    );
  }
}

test.describe.configure({ mode: "serial" });

test(`live ${MODE}: sign in`, async ({ page }) => {
  await liveStaffLogin(page);
  await page.context().storageState({ path: `${OUT}/state.json` });
});

for (const key of KEYS) {
  for (const screen of ["client-control-panel.html", "present.html"]) {
    const short = screen.startsWith("client") ? "ccp" : "present";
    test(`live ${MODE}: ${short} ?${key}=`, async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: `${OUT}/state.json` });
      const page = await ctx.newPage();
      if (MODE === "fixed") await servePatched(page);
      const seen = [];
      page.on("request", (r) => {
        if (r.url().includes("/api/") && r.url().includes(ID)) seen.push(r.url());
      });
      await page.goto(`${BASE}/app/${screen}?${key}=${ID}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4000);
      await page.screenshot({ path: `${OUT}/${short}-${key}.png` });
      const body = await page.locator("body").innerText();
      fs.appendFileSync(`${OUT}/report.txt`,
        `${MODE} ${short} ?${key}=  idInApiCalls=${seen.length > 0}  ` +
        `needsContact=${body.includes("needs ?contact=")}  ` +
        `noClientOpen=${body.includes("no client open")}\n`);
      await ctx.close();
    });
  }
}

#!/usr/bin/env node
/** Test intercepting Vimeo /config JSON from Notion page */
import fs from "node:fs";
import { chromium } from "@playwright/test";
import { PROFILE_DIR } from "./notion-scrape/lib.mjs";
import { urlsFromVimeoConfig } from "./notion-scrape/transcribe.mjs";

const notionUrl = "https://app.notion.com/p/legacystrong/Rebuilding-Credit-5ae3e5483e1e4b398af75f375961b594";
const configs = [];
const vtts = [];

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false, viewport: { width: 1440, height: 900 } });
const page = ctx.pages()[0] || (await ctx.newPage());

page.on("response", async (resp) => {
  const u = resp.url();
  if (u.includes("/config") && u.includes("vimeo")) {
    try {
      const j = await resp.json();
      configs.push({ url: u, json: j });
      console.log("CONFIG", u.slice(0, 100));
    } catch {}
  }
  if (/\.vtt|texttrack|captions/i.test(u)) {
    try {
      vtts.push({ url: u, text: await resp.text() });
      console.log("VTT", u.slice(0, 100));
    } catch {}
  }
});

await page.goto(notionUrl, { waitUntil: "commit", timeout: 120000 });
await page.waitForTimeout(5000);
const iframe = page.locator('iframe[src*="896034390"]');
await iframe.first().waitFor({ timeout: 30000 }).catch(() => console.log("no iframe"));
await iframe.first().scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(3000);
const frame = page.frameLocator('iframe[src*="896034390"]').first();
await frame.locator("button").first().click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(12000);

for (const c of configs) {
  const tt = c.json?.request?.text_tracks || c.json?.text_tracks;
  console.log("text_tracks:", tt ? JSON.stringify(tt).slice(0, 300) : "none");
  console.log("progressive urls:", urlsFromVimeoConfig(c.json).slice(0, 2));
}

fs.writeFileSync("credentials/notion-scrape/vimeo-config-test.json", JSON.stringify({ configs: configs.length, vtts, sample: configs[0]?.json?.request?.text_tracks }, null, 2));
await ctx.close();

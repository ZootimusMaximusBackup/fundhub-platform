#!/usr/bin/env node
/** Quick test: capture Vimeo VTT/caption URLs from Notion embed */
import fs from "node:fs";
import { chromium } from "@playwright/test";
import { PROFILE_DIR } from "./notion-scrape/lib.mjs";

const notionUrl = process.argv[2] || "https://app.notion.com/p/legacystrong/Rebuilding-Credit-5ae3e548a2d4f6a9c58c0de6a0d159f";
const hits = [];

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  viewport: { width: 1440, height: 900 },
});
const page = ctx.pages()[0] || (await ctx.newPage());

page.on("response", async (resp) => {
  const u = resp.url();
  if (/texttrack|\.vtt|captions|subtitle|chapters|transcript/i.test(u)) {
    let body = "";
    try { body = (await resp.text()).slice(0, 500); } catch {}
    hits.push({ url: u, status: resp.status(), body });
    console.log("CAPTION?", u.slice(0, 120));
  }
});

await page.goto(notionUrl, { waitUntil: "commit", timeout: 120000 });
await page.waitForTimeout(4000);
await page.locator('iframe[src*="vimeo"]').first().scrollIntoViewIfNeeded().catch(() => {});
const frame = page.frameLocator('iframe[src*="vimeo"]').first();
await frame.locator("button, .vp-play, [data-play-button]").first().click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(15000);

// Try CC button
await frame.locator('[aria-label*="Caption"], [aria-label*="caption"], .vp-controls-cc').first().click({ timeout: 3000 }).catch(() => {});
await page.waitForTimeout(5000);

// Evaluate inside iframe for textTracks
const tracks = await frame.locator("body").evaluate(() => {
  const v = document.querySelector("video");
  if (!v) return { video: false };
  return {
    video: true,
    textTracks: [...v.textTracks].map((t) => ({ label: t.label, language: t.language, mode: t.mode, cues: t.cues?.length })),
  };
}).catch((e) => ({ error: e.message }));

console.log("\nTracks:", JSON.stringify(tracks, null, 2));
console.log("\nHits:", hits.length);
fs.writeFileSync("credentials/notion-scrape/vimeo-caption-test.json", JSON.stringify({ notionUrl, hits, tracks }, null, 2));
await ctx.close();

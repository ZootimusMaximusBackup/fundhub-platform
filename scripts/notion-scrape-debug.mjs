#!/usr/bin/env node
/** One-off debug: dump links visible on saved Notion session. */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { PROFILE_DIR, START_URL_FILE } from "./notion-scrape/lib.mjs";

const startUrl = fs.readFileSync(START_URL_FILE, "utf8").trim();
const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: true,
  viewport: { width: 1440, height: 900 },
});
const page = context.pages()[0] || (await context.newPage());
await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForTimeout(5000);

const info = await page.evaluate(() => {
  const all = [];
  for (const a of document.querySelectorAll("a[href]")) {
    all.push({ href: a.href, text: (a.textContent || "").trim().slice(0, 80) });
  }
  return {
    url: location.href,
    title: document.title,
    linkCount: all.length,
    notionLinks: all.filter((l) => /notion\.(com|so|site)/i.test(l.href)).slice(0, 40),
    sampleAll: all.slice(0, 20),
  };
});

const out = path.join(PROFILE_DIR, "..", "debug-links.json");
fs.writeFileSync(out, JSON.stringify(info, null, 2));
console.log(JSON.stringify(info, null, 2));
await context.close();

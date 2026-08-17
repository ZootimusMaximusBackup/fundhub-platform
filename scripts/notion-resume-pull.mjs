#!/usr/bin/env node
/**
 * Resume crawl — visit any legacystrong links we haven't saved yet.
 *   npm run notion:resume
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import {
  PROFILE_DIR,
  OUTPUT_DIR,
  START_URL_FILE,
  folderNameForPage,
  pageIdFromUrl,
  isNotionPageUrl,
  normalizeUrl,
  walkOutputDirs,
  readMeta,
} from "./notion-scrape/lib.mjs";

const NAV_OPTS = { waitUntil: "commit", timeout: 120_000 };

// Re-use pull helpers inline (import would cycle — duplicate minimal save)
async function scrollToLoad(page) {
  await page.evaluate(async () => {
    const scroller =
      document.querySelector(".notion-scroller") ||
      document.querySelector('[role="main"]') ||
      document.documentElement;
    if (!scroller) return;
    for (let i = 0; i < 8; i++) {
      scroller.scrollTop = scroller.scrollHeight;
      await new Promise((r) => setTimeout(r, 400));
    }
  });
  await page.waitForTimeout(1500);
}

async function extractPage(page) {
  return page.evaluate(() => {
    const sidebar =
      document.querySelector('[data-testid="sidebar"]') ||
      document.querySelector(".notion-sidebar");
    function inSidebar(el) {
      return sidebar && sidebar.contains(el);
    }
    const titleEl =
      document.querySelector('[placeholder="Untitled"]') ||
      document.querySelector("h1");
    const title = titleEl?.textContent?.trim() || document.title.replace(/\s*\|\s*Notion$/, "").trim();
    const root =
      document.querySelector(".notion-page-content") ||
      document.querySelector(".notion-scroller") ||
      document.body;

    const blocks = [];
    for (const el of root.querySelectorAll("[data-block-id]")) {
      if (inSidebar(el)) continue;
      const text = el.innerText?.trim();
      if (text) blocks.push(text);
    }
    const bodyText = blocks.length ? blocks.join("\n\n") : root.innerText?.trim() || "";

    const videoEmbeds = [];
    for (const el of root.querySelectorAll("[data-block-id]")) {
      if (inSidebar(el)) continue;
      for (const iframe of el.querySelectorAll("iframe[src]")) videoEmbeds.push(iframe.src);
      for (const v of el.querySelectorAll("video[src], video source[src]")) videoEmbeds.push(v.src);
    }

    const childPages = [];
    const seen = new Set();
    for (const a of document.querySelectorAll("a[href]")) {
      if (inSidebar(a)) continue;
      const href = a.href?.split("?")[0].split("#")[0];
      const label = a.textContent?.trim();
      if (!href || !label || label.length > 120) continue;
      if (!/notion\.(com|so|site)/i.test(href)) continue;
      if (!href.includes("/p/legacystrong/")) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      childPages.push({ label, href });
    }

    const externalLinks = [];
    const extSeen = new Set();
    for (const a of root.querySelectorAll("a[href]")) {
      if (inSidebar(a)) continue;
      const href = a.href?.split("?")[0];
      if (!href || /notion\.(com|so|site)/i.test(href)) continue;
      if (extSeen.has(href)) continue;
      extSeen.add(href);
      externalLinks.push({ label: a.textContent?.trim() || href, href });
    }

    return { title, bodyText, videoEmbeds: [...new Set(videoEmbeds)], childPages, externalLinks };
  });
}

function savePage(url, data) {
  const dir = path.join(OUTPUT_DIR, folderNameForPage(data.title, url));
  fs.mkdirSync(dir, { recursive: true });
  const meta = {
    url,
    pageId: pageIdFromUrl(url),
    title: data.title,
    bodyText: data.bodyText,
    videoEmbeds: data.videoEmbeds,
    externalLinks: data.externalLinks,
    childPages: data.childPages,
    scrapedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, "page.md"), `# ${data.title}\n\nSource: ${url}\n\n${data.bodyText}\n`);
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  return dir;
}

function collectKnownUrls() {
  const known = new Set();
  for (const dir of walkOutputDirs()) {
    const meta = readMeta(dir);
    if (meta.url) known.add(normalizeUrl(meta.url));
  }
  return known;
}

function collectQueuedUrls() {
  const queue = new Set();
  for (const dir of walkOutputDirs()) {
    const meta = readMeta(dir);
    for (const c of meta.childPages || []) queue.add(normalizeUrl(c.href));
  }
  const startFile = START_URL_FILE;
  if (fs.existsSync(startFile)) {
    queue.add(normalizeUrl(fs.readFileSync(startFile, "utf8").trim()));
  }
  return queue;
}

async function main() {
  const known = collectKnownUrls();
  const queue = [...collectQueuedUrls()].filter((u) => isNotionPageUrl(u) && !known.has(u));

  if (!queue.length) {
    console.log("Resume: no missing pages in link graph.");
    return;
  }

  console.log(`Resume: ${queue.length} pages not yet saved.\n`);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    viewport: { width: 1440, height: 900 },
  });
  const page = context.pages()[0] || (await context.newPage());
  const visited = new Set(known);
  let saved = 0;

  while (queue.length) {
    const url = queue.shift();
    if (!isNotionPageUrl(url) || visited.has(url)) continue;
    visited.add(url);

    console.log(`→ ${url}`);
    try {
      await page.goto(url, NAV_OPTS);
      await scrollToLoad(page);
      const data = await extractPage(page);
      savePage(url, data);
      saved++;
      for (const c of data.childPages) {
        const child = normalizeUrl(c.href);
        if (!visited.has(child)) queue.push(child);
      }
    } catch (err) {
      console.warn(`  skip: ${err.message}`);
    }
  }

  // Write master external links index
  const allExternal = [];
  for (const dir of walkOutputDirs()) {
    const meta = readMeta(dir);
    for (const l of meta.externalLinks || []) {
      allExternal.push({ page: meta.title, ...l });
    }
  }
  const extPath = path.join(OUTPUT_DIR, "EXTERNAL-LINKS.md");
  const lines = ["# External links (not downloaded — URLs only)", "", `Total: ${allExternal.length}`, ""];
  for (const e of allExternal) {
    lines.push(`- **${e.page}** — [${e.label || e.href}](${e.href})`);
  }
  fs.writeFileSync(extPath, lines.join("\n") + "\n");

  await context.close();
  console.log(`\nResume done. ${saved} new pages. External links → ${extPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

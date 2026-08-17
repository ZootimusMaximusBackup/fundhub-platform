#!/usr/bin/env node
/**
 * Pull Legacy Strong (or any Notion workspace) via logged-in browser.
 * No Notion API. Uses Playwright with a saved browser profile.
 *
 * First time:
 *   npm run notion:login
 *   Log into Notion, open the workspace sidebar, press Enter in the terminal.
 *
 * Full pipeline:
 *   npm run notion:all        # pull → transcribe → organize
 *
 * Steps alone:
 *   npm run notion:pull
 *   npm run notion:transcribe
 *   npm run notion:organize
 *
 * Output: credentials/notion-scrape/output/<page-slug--id>/
 *   page.md, meta.json, files/, videos listed in meta for transcribe step
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { chromium } from "@playwright/test";
import {
  PROFILE_DIR,
  OUTPUT_DIR,
  START_URL_FILE,
  folderNameForPage,
  pageIdFromUrl,
  isNotionPageUrl,
  normalizeUrl,
} from "./notion-scrape/lib.mjs";

const DEFAULT_START = "https://www.notion.so";
const NAV_OPTS = { waitUntil: "commit", timeout: 120_000 };

function waitForEnter(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

async function launchContext(headless) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
  });
}

/** Extract page body text, embeds, files, and in-content subpages only. */
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
      document.querySelector("h1") ||
      document.querySelector('[data-testid="page-title"]');
    const title =
      titleEl?.textContent?.trim() ||
      document.title.replace(/\s*-\s*Notion$/, "").trim();

    const scroller =
      document.querySelector(".notion-page-content") ||
      document.querySelector(".notion-scroller") ||
      document.querySelector('[role="main"]');

    const root = scroller || document.body;

    const blocks = [];
    for (const el of root.querySelectorAll("[data-block-id]")) {
      if (inSidebar(el)) continue;
      const text = el.innerText?.replace(/\s+\n/g, "\n").trim();
      if (text) blocks.push(text);
    }
    const bodyText = blocks.length ? blocks.join("\n\n") : root.innerText?.trim() || "";

    const videoEmbeds = [];
    const addVideo = (src) => {
      if (src && !videoEmbeds.includes(src)) videoEmbeds.push(src);
    };

    for (const el of root.querySelectorAll("[data-block-id]")) {
      if (inSidebar(el)) continue;
      for (const iframe of el.querySelectorAll("iframe[src]")) {
        addVideo(iframe.getAttribute("src"));
      }
      for (const video of el.querySelectorAll("video[src], video source[src]")) {
        addVideo(video.getAttribute("src"));
      }
      const a = el.querySelector('a[href*="youtube.com"], a[href*="youtu.be"], a[href*="loom.com"], a[href*="vimeo.com"]');
      if (a?.href) addVideo(a.href);
    }

    const fileLinks = [];
    const seenFiles = new Set();
    for (const a of root.querySelectorAll("a[href]")) {
      if (inSidebar(a)) continue;
      const href = a.href;
      if (!href) continue;
      if (
        !href.includes("file.notion.so") &&
        !href.includes("amazonaws.com") &&
        !a.hasAttribute("download") &&
        !/\.(pdf|mp4|mov|webm|zip|doc|docx|xls|xlsx|ppt|pptx)(\?|$)/i.test(href)
      ) {
        continue;
      }
      const key = href.split("?")[0];
      if (seenFiles.has(key)) continue;
      seenFiles.add(key);
      fileLinks.push({ label: a.textContent?.trim() || pathBasename(href), href });
    }

    function pathBasename(href) {
      try {
        return new URL(href).pathname.split("/").pop() || href;
      } catch {
        return href;
      }
    }

    const childPages = [];
    const seenPages = new Set();
    for (const a of document.querySelectorAll("a[href]")) {
      if (inSidebar(a)) continue;
      const href = a.href?.split("?")[0].split("#")[0];
      const label = a.textContent?.trim();
      if (!href || !label || label.length > 120) continue;
      if (label === "Skip to content") continue;
      if (!/notion\.(com|so|site)/i.test(href)) continue;
      if (href.includes("/login") || href.includes("marketplace")) continue;
      if (!href.includes("/p/legacystrong/")) continue;
      if (seenPages.has(href)) continue;
      seenPages.add(href);
      childPages.push({ label, href });
    }

    return { title, bodyText, videoEmbeds, fileLinks, childPages };
  });
}

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

/** Crawl seeds from the Library / sidebar link list. Do not scroll here — it hides rows. */
async function getSeedPages(page) {
  await page.waitForTimeout(5000);
  const seeds = await page.evaluate(() => {
    const links = [];
    const seen = new Set();
    for (const a of document.querySelectorAll("a[href]")) {
      const href = a.href?.split("?")[0].split("#")[0];
      const label = a.textContent?.trim().replace(/\s+/g, " ");
      if (!href || !label || label.length > 120 || label === "Skip to content") continue;
      if (!/notion\.(com|so|site)/i.test(href)) continue;
      if (!href.includes("/p/legacystrong/")) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      links.push({ label, href });
    }
    return links;
  });
  return { sidebar: seeds, seeds };
}

async function downloadFiles(page, pageDir, fileLinks) {
  const filesDir = path.join(pageDir, "files");
  fs.mkdirSync(filesDir, { recursive: true });
  const saved = [];

  for (const file of fileLinks) {
    const name = safeFilename(file.label || path.basename(file.href));
    const dest = path.join(filesDir, name);
    if (fs.existsSync(dest)) {
      saved.push({ ...file, localPath: dest, status: "exists" });
      continue;
    }
    try {
      const res = await page.request.get(file.href);
      if (!res.ok()) {
        saved.push({ ...file, status: "failed", error: `HTTP ${res.status()}` });
        continue;
      }
      fs.writeFileSync(dest, Buffer.from(await res.body()));
      saved.push({ ...file, localPath: dest, status: "saved" });
    } catch (err) {
      saved.push({ ...file, status: "failed", error: err.message });
    }
  }
  return saved;
}

function safeFilename(name) {
  return name.replace(/[/\\?%*:|"<>]/g, "-").slice(0, 120) || "file";
}

async function savePage(outBase, url, data, fileResults) {
  const pageId = pageIdFromUrl(url);
  const dir = path.join(outBase, folderNameForPage(data.title, url));
  fs.mkdirSync(dir, { recursive: true });

  const meta = {
    url,
    pageId,
    title: data.title,
    bodyText: data.bodyText,
    videoEmbeds: data.videoEmbeds,
    fileLinks: fileResults || data.fileLinks,
    childPages: data.childPages,
    scrapedAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.join(dir, "page.md"),
    `# ${data.title}\n\nSource: ${url}\nPage ID: ${pageId || "unknown"}\n\n${data.bodyText}\n`,
  );
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  return dir;
}

async function crawlPage(page, url, outBase, visited, queue) {
  const normalized = normalizeUrl(url);
  if (!isNotionPageUrl(normalized) || visited.has(normalized)) return;
  visited.add(normalized);

  console.log(`  → ${normalized}`);
  await page.goto(normalized, NAV_OPTS);
  await scrollToLoad(page);

  let data;
  try {
    data = await extractPage(page);
  } catch (err) {
    console.warn(`    skip (extract failed): ${err.message}`);
    return;
  }

  const dir = path.join(outBase, folderNameForPage(data.title, normalized));
  const fileResults = await downloadFiles(page, dir, data.fileLinks);
  await savePage(outBase, normalized, data, fileResults);
  console.log(`    saved ${dir} (${data.videoEmbeds.length} videos, ${fileResults.length} files)`);

  for (const child of data.childPages) {
    const childUrl = normalizeUrl(child.href);
    if (isNotionPageUrl(childUrl) && !visited.has(childUrl)) {
      queue.push(childUrl);
    }
  }
}

async function loginMode() {
  console.log("Opening browser. Log into Notion and open Legacy Strong (sidebar visible).");
  const context = await launchContext(false);
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(DEFAULT_START, NAV_OPTS);
  await waitForEnter("\nWhen the workspace sidebar is open, press Enter here… ");
  const url = page.url();
  fs.mkdirSync(path.dirname(PROFILE_DIR), { recursive: true });
  fs.writeFileSync(START_URL_FILE, url);
  console.log(`Saved start URL: ${url}`);
  console.log(`Profile saved under credentials/notion-scrape/profile/`);
  await context.close();
}

async function pullMode() {
  const startUrl = fs.existsSync(START_URL_FILE)
    ? fs.readFileSync(START_URL_FILE, "utf8").trim()
    : DEFAULT_START;

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const context = await launchContext(true);
  const page = context.pages()[0] || (await context.newPage());

  await page.goto(startUrl, NAV_OPTS);

  const { sidebar, seeds } = await getSeedPages(page);
  console.log(`Found ${seeds.length} seed pages (${sidebar.length} in sidebar).`);

  const visited = new Set();
  const queue = seeds.map((l) => normalizeUrl(l.href));

  if (!queue.length) {
    queue.push(normalizeUrl(page.url()));
  }

  while (queue.length) {
    const next = queue.shift();
    await crawlPage(page, next, OUTPUT_DIR, visited, queue);
  }

  const index = {
    pulledAt: new Date().toISOString(),
    startUrl,
    pageCount: visited.size,
    sidebarPages: sidebar,
    pages: [...visited],
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, "index.json"), JSON.stringify(index, null, 2));
  console.log(`\nPull done. ${visited.size} pages → ${OUTPUT_DIR}`);

  await context.close();
}

const args = new Set(process.argv.slice(2));
if (args.has("--login")) {
  await loginMode();
} else if (args.has("--pull")) {
  await pullMode();
} else {
  console.log(`Usage:
  npm run notion:login   # once: log in, save session
  npm run notion:pull    # crawl sidebar + subpages, download files
`);
  process.exit(1);
}

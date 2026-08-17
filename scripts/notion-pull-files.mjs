#!/usr/bin/env node
/**
 * Download every file/attachment on already-scraped Notion pages.
 * Clicks file blocks, catches browser downloads + network URLs.
 *
 *   npm run notion:files
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import {
  PROFILE_DIR,
  OUTPUT_DIR,
  walkOutputDirs,
  readMeta,
  writeMeta,
} from "./notion-scrape/lib.mjs";

const NAV_OPTS = { waitUntil: "commit", timeout: 120_000 };

function safeName(name) {
  return (name || "file").replace(/[/\\?%*:|"<>]/g, "-").slice(0, 120);
}

async function scrollToLoad(page) {
  await page.evaluate(async () => {
    const scroller =
      document.querySelector(".notion-scroller") ||
      document.querySelector('[role="main"]') ||
      document.documentElement;
    if (!scroller) return;
    for (let i = 0; i < 10; i++) {
      scroller.scrollTop = scroller.scrollHeight;
      await new Promise((r) => setTimeout(r, 350));
    }
  });
  await page.waitForTimeout(1500);
}

/** Collect file URLs from DOM + filenames visible on page. */
async function findFileCandidates(page) {
  return page.evaluate(() => {
    const items = [];
    const seen = new Set();

    function add(label, href, kind) {
      const key = (href || label || "").split("?")[0];
      if (!key || seen.has(key)) return;
      seen.add(key);
      items.push({ label: label || key, href: href || null, kind });
    }

    for (const a of document.querySelectorAll("a[href]")) {
      const href = a.href;
      const label = a.textContent?.trim();
      if (!href) continue;
      if (
        href.includes("file.notion.so") ||
        href.includes("prod-files-secure") ||
        href.includes("amazonaws.com") ||
        a.hasAttribute("download") ||
        (/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|csv|png|jpg|jpeg|gif|webp|mp4|mov)(\?|$)/i.test(href) &&
          /^https?:\/\//i.test(href))
      ) {
        add(label, href, "link");
      }
    }

    // File blocks: text like "Something.pdf" or "13.9KB"
    for (const el of document.querySelectorAll("[data-block-id]")) {
      const text = el.innerText?.trim() || "";
      const fileMatch = text.match(/([^\n/]+\.(pdf|docx?|xlsx?|pptx?|zip|csv|png|jpe?g|gif|webp|mp4|mov))/i);
      if (fileMatch) {
        const name = fileMatch[1].trim();
        const link = el.querySelector("a[href]");
        add(name, link?.href || null, "block");
      }
    }

    return items;
  });
}

async function downloadUrl(page, url, dest) {
  if (!url || !/^https?:\/\//i.test(url)) {
    return { ok: false, error: "not a downloadable http url" };
  }
  const res = await page.request.get(url);
  if (!res.ok()) return { ok: false, error: `HTTP ${res.status()}` };
  fs.writeFileSync(dest, Buffer.from(await res.body()));
  return { ok: true };
}

async function clickFileBlocks(page, filesDir) {
  const saved = [];
  const networkUrls = [];

  page.on("response", (resp) => {
    const u = resp.url();
    if (u.includes("file.notion.so") || u.includes("prod-files-secure") || u.includes("amazonaws.com")) {
      networkUrls.push(u);
    }
  });

  const clickables = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("[data-block-id]")) {
      const t = el.innerText || "";
      if (!/\.(pdf|docx?|xlsx?|pptx?|zip|csv)/i.test(t)) continue;
      const name = t.split("\n").find((l) => /\.(pdf|docx?|xlsx?|pptx?|zip|csv)/i.test(l))?.trim();
      if (!name) continue;
      el.setAttribute("data-fh-file", name);
      out.push(name);
    }
    return [...new Set(out)];
  });

  for (const name of clickables) {
    const dest = path.join(filesDir, safeName(name));
    if (fs.existsSync(dest)) {
      saved.push({ label: name, localPath: dest, status: "exists" });
      continue;
    }

    try {
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 12_000 }),
        page.locator(`[data-fh-file="${name.replace(/"/g, '\\"')}"]`).first().click({ timeout: 5000 }),
      ]);
      await download.saveAs(dest);
      saved.push({ label: name, localPath: dest, status: "saved", method: "click" });
    } catch {
      // no download event — try network URLs below
    }
  }

  for (const url of [...new Set(networkUrls)]) {
    const base = safeName(decodeURIComponent(url.split("/").pop()?.split("?")[0] || "file"));
    const dest = path.join(filesDir, base);
    if (fs.existsSync(dest)) continue;
    const dl = await downloadUrl(page, url, dest);
    if (dl.ok) saved.push({ label: base, href: url, localPath: dest, status: "saved", method: "network" });
  }

  return saved;
}

async function main() {
  const dirs = walkOutputDirs();
  if (!dirs.length) {
    console.error("No pages. Run notion:pull first.");
    process.exit(1);
  }

  console.log(`File pass: ${dirs.length} pages\n`);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    viewport: { width: 1440, height: 900 },
  });
  const page = context.pages()[0] || (await context.newPage());

  let totalSaved = 0;

  for (const dir of dirs) {
    const meta = readMeta(dir);
    const filesDir = path.join(dir, "files");
    fs.mkdirSync(filesDir, { recursive: true });

    try {
      await page.goto(meta.url, NAV_OPTS);
      await scrollToLoad(page);
    } catch (err) {
      console.warn(`skip ${meta.title}: ${err.message}`);
      continue;
    }

    const candidates = await findFileCandidates(page);
    const saved = [];
    const seen = new Set();

    for (const c of candidates) {
      if (!c.href) continue;
      const dest = path.join(filesDir, safeName(c.label || path.basename(c.href)));
      if (seen.has(dest) || fs.existsSync(dest)) continue;
      seen.add(dest);
      const dl = await downloadUrl(page, c.href, dest);
      if (dl.ok) {
        saved.push({ ...c, localPath: dest, status: "saved", method: "href" });
      }
    }

    const clicked = await clickFileBlocks(page, filesDir);
    for (const s of clicked) {
      if (!saved.find((x) => x.localPath === s.localPath)) saved.push(s);
    }

    if (saved.length) {
      console.log(`${meta.title}: ${saved.length} file(s)`);
      totalSaved += saved.length;
    }

    const existing = meta.fileLinks || [];
    meta.fileLinks = [...existing, ...saved];
    meta.filesPassAt = new Date().toISOString();
    writeMeta(dir, meta);
  }

  await context.close();
  console.log(`\nFile pass done. ${totalSaved} new files saved.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

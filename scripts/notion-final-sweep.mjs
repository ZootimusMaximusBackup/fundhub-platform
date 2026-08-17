#!/usr/bin/env node
/**
 * Final sweep: comment links, external resources, meta cleanup.
 * Skips comment body text — only saves comments that contain links.
 *
 *   npm run notion:sweep
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
import { isBadVideoUrl } from "./notion-scrape/transcribe.mjs";

const NAV_OPTS = { waitUntil: "commit", timeout: 120_000 };

async function launchBrowser() {
  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    channel: "chrome",
    viewport: { width: 1440, height: 900 },
    ignoreDefaultArgs: ["--enable-automation"],
    args: ["--disable-blink-features=AutomationControlled"],
  });
}

async function scrollToLoad(page) {
  await page.evaluate(async () => {
    const s = document.querySelector(".notion-scroller") || document.documentElement;
    if (!s) return;
    for (let i = 0; i < 6; i++) {
      s.scrollTop = s.scrollHeight;
      await new Promise((r) => setTimeout(r, 300));
    }
  });
  await page.waitForTimeout(1000);
}

/** Open comment UI if present; return links found in comment/discussion regions. */
async function harvestCommentLinks(page) {
  // Try opening page discussion / comments
  await page.keyboard.press("Escape").catch(() => {});
  const openers = [
    '[aria-label*="Comment" i]',
    '[data-testid*="comment" i]',
    'button:has-text("Comment")',
  ];
  for (const sel of openers) {
    await page.locator(sel).first().click({ timeout: 2000 }).catch(() => {});
  }
  await page.waitForTimeout(1500);

  return page.evaluate(() => {
    const links = [];
    const seen = new Set();

    const regions = [
      ...document.querySelectorAll(
        '[class*="discussion" i], [class*="comment" i], [data-testid*="comment" i], [role="dialog"]',
      ),
    ];

    const roots = regions.length ? regions : [document.body];

    for (const root of roots) {
      for (const a of root.querySelectorAll("a[href]")) {
        const href = a.href?.split("?")[0];
        if (!href || !/^https?:\/\//i.test(href)) continue;
        if (/notion\.(com|so|site)/i.test(href)) continue;
        if (seen.has(href)) continue;
        seen.add(href);
        links.push({
          label: a.textContent?.trim() || href,
          href,
          from: "comment",
        });
      }
    }
    return links;
  });
}

function harvestBodyLinks(meta) {
  const links = [];
  const seen = new Set();
  const text = meta.bodyText || "";
  for (const m of text.matchAll(/https?:\/\/[^\s)\]"']+/g) || []) {
    const href = m[0].replace(/[.,;]+$/, "").split("?")[0];
    if (/notion\.(com|so|site)/i.test(href)) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    links.push({ label: href, href, from: "body" });
  }
  return links;
}

function cleanupTranscripts(meta) {
  if (!meta.transcripts?.length) return false;
  let changed = false;
  meta.transcripts = meta.transcripts.map((t) => {
    if (isBadVideoUrl(t.url) && t.status !== "done") {
      changed = true;
      return { ...t, status: "skipped", error: "bogus embed url (not a real video)" };
    }
    return t;
  });
  return changed;
}

async function main() {
  const dirs = walkOutputDirs();
  console.log(`Final sweep: ${dirs.length} pages\n`);

  const context = await launchBrowser();
  const page = context.pages()[0] || (await context.newPage());

  const allCommentLinks = [];
  const allExternal = [];
  let pagesWithCommentLinks = 0;

  for (const dir of dirs) {
    const meta = readMeta(dir);
    cleanupTranscripts(meta);

    let commentLinks = [];
    try {
      await page.goto(meta.url, NAV_OPTS);
      await scrollToLoad(page);
      commentLinks = await harvestCommentLinks(page);
    } catch (err) {
      console.warn(`  skip comments ${meta.title}: ${err.message}`);
    }

    const bodyLinks = harvestBodyLinks(meta);
    const externalLinks = [...bodyLinks];
    const seen = new Set(bodyLinks.map((l) => l.href));
    for (const c of commentLinks) {
      if (!seen.has(c.href)) {
        seen.add(c.href);
        externalLinks.push(c);
      }
    }

    meta.commentLinks = commentLinks;
    meta.externalLinks = externalLinks;
    meta.sweepAt = new Date().toISOString();
    writeMeta(dir, meta);

    if (commentLinks.length) {
      pagesWithCommentLinks++;
      console.log(`${meta.title}: ${commentLinks.length} comment link(s)`);
      allCommentLinks.push(...commentLinks.map((l) => ({ page: meta.title, ...l })));
    }

    for (const e of externalLinks) {
      allExternal.push({ page: meta.title, ...e });
    }
  }

  await context.close();

  const commentPath = path.join(OUTPUT_DIR, "COMMENT-LINKS.md");
  const lines = [
    "# Comment links (resources shared in comments)",
    "",
    `Pages with comment links: **${pagesWithCommentLinks}**`,
    `Total links: **${allCommentLinks.length}**`,
    "",
  ];
  for (const l of allCommentLinks) {
    lines.push(`- **${l.page}** — [${l.label}](${l.href})`);
  }
  fs.writeFileSync(commentPath, lines.join("\n") + "\n");

  const extPath = path.join(OUTPUT_DIR, "EXTERNAL-LINKS.md");
  const extLines = [
    "# All external links (body + comments)",
    "",
    `Total: **${allExternal.length}**`,
    "",
  ];
  const extSeen = new Set();
  for (const e of allExternal) {
    const key = `${e.page}|${e.href}`;
    if (extSeen.has(key)) continue;
    extSeen.add(key);
    extLines.push(`- **${e.page}** (${e.from}) — [${e.label || e.href}](${e.href})`);
  }
  fs.writeFileSync(extPath, extLines.join("\n") + "\n");

  console.log(`\nSweep done.`);
  console.log(`  Comment links → ${commentPath}`);
  console.log(`  External links → ${extPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

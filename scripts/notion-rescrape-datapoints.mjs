#!/usr/bin/env node
/**
 * Re-scrape Alec datapoint / lender database pages (logged-in Notion).
 *   node scripts/notion-rescrape-datapoints.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import {
  PROFILE_DIR,
  OUTPUT_DIR,
  folderNameForPage,
  pageIdFromUrl,
  readMeta,
  writeMeta,
} from "./notion-scrape/lib.mjs";

const NAV_OPTS = { waitUntil: "commit", timeout: 120_000 };

const TARGETS = [
  { name: "Bank Datapoints", url: "https://app.notion.com/p/legacystrong/0f24772388034f8daa72266efe32faa0" },
  { name: "State Funding Boards", url: "https://app.notion.com/p/legacystrong/409f6157c310494f8308c87f2f0944a9" },
  { name: "Bankers", url: "https://app.notion.com/p/legacystrong/58819778a99a44b5b7ffea2597d4cba1" },
  { name: "Deep State Datapoints", url: "https://app.notion.com/p/legacystrong/Deep-State-Datapoints-253c3aa761d2803084ffd4d28370ae9a" },
  { name: "RMs", url: "https://app.notion.com/p/legacystrong/RMs-d42db2db75564d06ad18fb68d4aaa8b8" },
  { name: "The Vault", url: "https://app.notion.com/p/legacystrong/The-Vault-8f2a819d357d404994cd081d52ca19cf" },
];

async function scrollToLoad(page) {
  await page.evaluate(async () => {
    const scrollers = [
      document.querySelector(".notion-scroller"),
      document.querySelector('[role="main"]'),
      document.querySelector(".notion-page-content"),
      document.documentElement,
    ].filter(Boolean);
    for (const scroller of scrollers) {
      for (let i = 0; i < 12; i++) {
        scroller.scrollTop = scroller.scrollHeight;
        await new Promise((r) => setTimeout(r, 350));
      }
    }
  });
  await page.waitForTimeout(1200);
}

async function clickLoadMore(page) {
  let clicks = 0;
  for (let round = 0; round < 30; round++) {
    const btn = page.locator('button:has-text("Load more"), div[role="button"]:has-text("Load more")').first();
    const visible = await btn.isVisible({ timeout: 800 }).catch(() => false);
    if (!visible) break;
    await btn.click({ timeout: 5000 }).catch(() => {});
    clicks++;
    await scrollToLoad(page);
  }
  return clicks;
}

async function extractRich(page) {
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
      document.title.replace(/\s*[-|]\s*Notion$/, "").trim();

    const main =
      document.querySelector(".notion-page-content") ||
      document.querySelector(".notion-scroller") ||
      document.querySelector('[role="main"]') ||
      document.body;

    const blocks = [];
    for (const el of main.querySelectorAll("[data-block-id]")) {
      if (inSidebar(el)) continue;
      const text = el.innerText?.replace(/\s+\n/g, "\n").trim();
      if (text && text.length > 1) blocks.push(text);
    }
    const bodyText = blocks.length ? blocks.join("\n\n") : main.innerText?.trim() || "";

    const tableRows = [];
    const rowEls = main.querySelectorAll('[role="row"], .notion-table-row, .notion-collection-item');
    for (const row of rowEls) {
      if (inSidebar(row)) continue;
      const cells = [...row.querySelectorAll('[role="cell"], .notion-table-cell, [data-col-index]')]
        .map((c) => c.innerText?.trim())
        .filter(Boolean);
      const text = cells.length ? cells.join("\t") : row.innerText?.trim();
      if (text && text.length > 2) tableRows.push({ cells, text });
    }

    const childPages = [];
    const seenPages = new Set();
    for (const a of main.querySelectorAll("a[href]")) {
      if (inSidebar(a)) continue;
      const href = a.href?.split("?")[0].split("#")[0];
      const label = a.textContent?.trim();
      if (!href || !label || label.length > 140) continue;
      if (!/notion\.(com|so|site)/i.test(href)) continue;
      if (!href.includes("/p/legacystrong/")) continue;
      if (seenPages.has(href)) continue;
      seenPages.add(href);
      childPages.push({ label, href });
    }

    const externalLinks = [];
    const extSeen = new Set();
    for (const a of document.querySelectorAll("a[href]")) {
      if (inSidebar(a)) continue;
      const href = a.href?.split("#")[0];
      if (!href || /notion\.(com|so|site)/i.test(href)) continue;
      if (extSeen.has(href)) continue;
      extSeen.add(href);
      externalLinks.push({ label: a.textContent?.trim() || href, href });
    }

    return { title, bodyText, tableRows, childPages, externalLinks };
  });
}

function tableToMd(title, rows) {
  const lines = [`# ${title} — database extract`, "", `Rows: ${rows.length}`, ""];
  for (const r of rows) {
    lines.push(r.cells?.length ? `| ${r.cells.join(" | ")} |` : r.text);
  }
  return lines.join("\n") + "\n";
}

function saveExtract(url, data) {
  const dir = path.join(OUTPUT_DIR, folderNameForPage(data.title, url));
  fs.mkdirSync(dir, { recursive: true });
  const prev = fs.existsSync(path.join(dir, "meta.json")) ? readMeta(dir) : {};

  const meta = {
    ...prev,
    url,
    pageId: pageIdFromUrl(url),
    title: data.title,
    bodyText: data.bodyText,
    childPages: data.childPages,
    externalLinks: data.externalLinks,
    databaseRowCount: data.tableRows.length,
    rescrapedAt: new Date().toISOString(),
  };
  writeMeta(dir, meta);

  fs.writeFileSync(
    path.join(dir, "page.md"),
    `# ${data.title}\n\nSource: ${url}\n\n${data.bodyText}\n`
  );
  fs.writeFileSync(path.join(dir, "database-table.json"), JSON.stringify(data.tableRows, null, 2));
  fs.writeFileSync(path.join(dir, "database-table.md"), tableToMd(data.title, data.tableRows));

  return { dir, rowCount: data.tableRows.length, bodyLen: data.bodyText.length };
}

async function fetchSheetCsv(page, sheetUrl, dest) {
  const m = sheetUrl.match(/\/spreadsheets\/d\/([^/]+)/);
  if (!m) return { ok: false, error: "no sheet id" };
  const exportUrl = `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv`;
  const res = await page.request.get(exportUrl);
  if (!res.ok()) return { ok: false, error: `HTTP ${res.status()}` };
  const text = await res.text();
  if (!text.trim() || text.includes("<!DOCTYPE html")) {
    return { ok: false, error: "not csv (auth?)" };
  }
  fs.writeFileSync(dest, text);
  const lines = text.trim().split("\n").length;
  return { ok: true, lines, exportUrl };
}

async function main() {
  const logPath = path.join(OUTPUT_DIR, "rescrape-datapoints-log.json");
  const results = [];

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    channel: "chrome",
    viewport: { width: 1440, height: 900 },
    ignoreDefaultArgs: ["--enable-automation"],
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = context.pages()[0] || (await context.newPage());

  for (const target of TARGETS) {
    console.log(`\n→ ${target.name}`);
    try {
      await page.goto(target.url, NAV_OPTS);
      await page.waitForTimeout(4000);
      const loadMore = await clickLoadMore(page);
      await scrollToLoad(page);
      const data = await extractRich(page);
      const saved = saveExtract(target.url, data);
      console.log(`  rows=${saved.rowCount} body=${saved.bodyLen} loadMore=${loadMore} externals=${data.externalLinks.length}`);
      results.push({ ...target, ...saved, loadMore, externals: data.externalLinks.length, externalLinks: data.externalLinks });
    } catch (err) {
      console.warn(`  FAIL: ${err.message}`);
      results.push({ ...target, error: err.message });
    }
  }

  const sheetLinks = [];
  for (const r of results) {
    for (const l of r.externalLinks || []) {
      if (/docs\.google\.com\/spreadsheets/i.test(l.href)) sheetLinks.push({ page: r.name, ...l });
    }
  }

  let sheetFetch = null;
  if (sheetLinks.length) {
    const dest = path.join(OUTPUT_DIR, "inquiry-master-database.csv");
    sheetFetch = await fetchSheetCsv(page, sheetLinks[0].href, dest);
    sheetFetch.page = sheetLinks[0].page;
    sheetFetch.label = sheetLinks[0].label;
    console.log(`\nSheet: ${sheetFetch.ok ? "saved" : sheetFetch.error} (${sheetLinks[0].label})`);
  } else {
    console.log("\nNo Google Sheet link found on target pages.");
  }

  await context.close();

  const summary = { at: new Date().toISOString(), results, sheetLinks, sheetFetch };
  fs.writeFileSync(logPath, JSON.stringify(summary, null, 2));
  console.log(`\nLog → ${logPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Merge scraped pages + transcripts into one organized library.
 *
 *   npm run notion:organize
 *
 * Output:
 *   credentials/notion-scrape/output/INDEX.md     — full site map
 *   credentials/notion-scrape/output/manifest.json
 *   <page-folder>/FULL.md                       — page text + all transcripts
 */

import fs from "node:fs";
import path from "node:path";
import {
  OUTPUT_DIR,
  walkOutputDirs,
  readMeta,
  folderNameForPage,
} from "./notion-scrape/lib.mjs";

function readIfExists(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function buildFullMd(meta, pageDir) {
  const pageMd = readIfExists(path.join(pageDir, "page.md"));
  const parts = [pageMd.trim()];

  const transcriptDir = path.join(pageDir, "transcripts");
  if (fs.existsSync(transcriptDir)) {
    const files = fs.readdirSync(transcriptDir).filter((f) => f.endsWith(".txt")).sort();
    for (const file of files) {
      const body = fs.readFileSync(path.join(transcriptDir, file), "utf8").trim();
      if (!body) continue;
      parts.push(`\n---\n\n## Transcript: ${file.replace(/\.txt$/, "")}\n\n${body}`);
    }
  }

  if (meta.transcripts?.length) {
    const failed = meta.transcripts.filter((t) => t.status && t.status !== "done");
    if (failed.length) {
      parts.push("\n---\n\n## Videos not transcribed\n");
      for (const f of failed) {
        parts.push(`- ${f.label || f.url}: ${f.error || f.status}`);
      }
    }
  }

  return parts.filter(Boolean).join("\n") + "\n";
}

function main() {
  const dirs = walkOutputDirs();
  if (!dirs.length) {
    console.error("No scraped pages. Run: npm run notion:pull");
    process.exit(1);
  }

  const entries = [];
  for (const pageDir of dirs) {
    const meta = readMeta(pageDir);
    const fullPath = path.join(pageDir, "FULL.md");
    fs.writeFileSync(fullPath, buildFullMd(meta, pageDir));

    entries.push({
      title: meta.title,
      url: meta.url,
      folder: path.basename(pageDir),
      expectedFolder: folderNameForPage(meta.title, meta.url),
      pageId: meta.pageId,
      videoCount: (meta.videoEmbeds || []).length + (meta.fileLinks || []).filter((f) =>
        /\.(mp4|mov|webm|m4v|mkv)(\?|$)/i.test(f.href),
      ).length,
      transcriptCount: (meta.transcripts || []).filter((t) => t.status === "done").length,
      hasFullMd: true,
    });
  }

  entries.sort((a, b) => a.title.localeCompare(b.title));

  const indexLines = [
    "# Legacy Strong — scraped library",
    "",
    `Pages: **${entries.length}**`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "| Page | Videos | Transcripts | Folder |",
    "| --- | ---: | ---: | --- |",
  ];

  for (const e of entries) {
    indexLines.push(`| [${e.title}](${e.folder}/FULL.md) | ${e.videoCount} | ${e.transcriptCount} | \`${e.folder}\` |`);
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, "INDEX.md"), indexLines.join("\n") + "\n");

  const manifest = {
    generatedAt: new Date().toISOString(),
    pageCount: entries.length,
    totalVideos: entries.reduce((n, e) => n + e.videoCount, 0),
    totalTranscripts: entries.reduce((n, e) => n + e.transcriptCount, 0),
    pages: entries,
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));

  const missing = [];
  for (const pageDir of dirs) {
    const meta = readMeta(pageDir);
    for (const t of meta.transcripts || []) {
      if (t.status && t.status !== "done") {
        missing.push({
          page: meta.title,
          notionUrl: meta.url,
          videoUrl: t.url,
          error: (t.error || t.status).slice(0, 200),
        });
      }
    }
  }

  if (missing.length) {
    const lines = [
      "# Could not download — screenshot or watch manually",
      "",
      `Items: **${missing.length}**`,
      "",
    ];
    for (const m of missing) {
      lines.push(`## ${m.page}`);
      lines.push(`- Notion: ${m.notionUrl}`);
      lines.push(`- Video: ${m.videoUrl}`);
      lines.push(`- Why: ${m.error}`);
      lines.push("");
    }
    fs.writeFileSync(path.join(OUTPUT_DIR, "MISSING.md"), lines.join("\n"));
    console.log(`Missing list → ${OUTPUT_DIR}/MISSING.md (${missing.length} items)`);
  }

  console.log(`Organized ${entries.length} pages → ${OUTPUT_DIR}/INDEX.md`);
}

main();

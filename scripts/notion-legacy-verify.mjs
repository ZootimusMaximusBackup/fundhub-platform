#!/usr/bin/env node
/**
 * Double-check notion-scrape output: pages, videos, transcripts, files, gaps.
 *   npm run notion:verify
 */

import fs from "node:fs";
import path from "node:path";
import { OUTPUT_DIR, walkOutputDirs, readMeta } from "./notion-scrape/lib.mjs";

function countVideos(meta) {
  const embeds = meta.videoEmbeds?.length || 0;
  const files = (meta.fileLinks || []).filter((f) =>
    /\.(mp4|mov|webm|m4v|mkv)(\?|$)/i.test(f.href || f.url || ""),
  ).length;
  return embeds + files;
}

function main() {
  const dirs = walkOutputDirs();
  const report = {
    checkedAt: new Date().toISOString(),
    pages: dirs.length,
    pagesWithText: 0,
    emptyPages: [],
    totalVideosFound: 0,
    transcriptsDone: 0,
    transcriptsFailed: 0,
    transcriptsMissing: 0,
    filesSaved: 0,
    filesFailed: 0,
    failures: [],
    pagesWithoutVideos: 0,
  };

  for (const dir of dirs) {
    const meta = readMeta(dir);
    const textLen = (meta.bodyText || "").trim().length;
    if (textLen > 20) report.pagesWithText++;
    else report.emptyPages.push({ title: meta.title, url: meta.url, chars: textLen });

    const videoCount = countVideos(meta);
    report.totalVideosFound += videoCount;
    if (!videoCount) report.pagesWithoutVideos++;

    const transcripts = meta.transcripts || [];
    const done = transcripts.filter((t) => t.status === "done").length;
    const failed = transcripts.filter((t) => t.status && t.status !== "done").length;
    report.transcriptsDone += done;
    report.transcriptsFailed += failed;

    const expected = videoCount;
    const accounted = transcripts.length;
    if (expected > accounted) report.transcriptsMissing += expected - accounted;

    for (const t of transcripts) {
      if (t.status === "done") {
        if (t.transcriptPath && !fs.existsSync(t.transcriptPath)) {
          report.failures.push({
            page: meta.title,
            issue: "transcript marked done but file missing",
            path: t.transcriptPath,
          });
        }
      } else if (t.status) {
        report.failures.push({
          page: meta.title,
          issue: t.status,
          video: t.url,
          error: (t.error || "").slice(0, 150),
        });
      }
    }

    for (const f of meta.fileLinks || []) {
      if (f.status === "saved" || f.status === "exists") report.filesSaved++;
      else if (f.status === "failed") {
        report.filesFailed++;
        report.failures.push({
          page: meta.title,
          issue: "file download failed",
          file: f.label || f.href,
          error: f.error,
        });
      }
    }

    const fullMd = path.join(dir, "FULL.md");
    if (!fs.existsSync(fullMd)) {
      report.failures.push({ page: meta.title, issue: "FULL.md missing" });
    }
  }

  const hasIndex = fs.existsSync(path.join(OUTPUT_DIR, "INDEX.md"));
  const hasMissing = fs.existsSync(path.join(OUTPUT_DIR, "MISSING.md"));
  const pullIndex = fs.existsSync(path.join(OUTPUT_DIR, "index.json"));

  const lines = [
    "# Notion scrape — double-check report",
    "",
    `Checked: ${report.checkedAt}`,
    "",
    "## Summary",
    "",
    `| Check | Count |`,
    `| --- | ---: |`,
    `| Pages saved | ${report.pages} |`,
    `| Pages with real text | ${report.pagesWithText} |`,
    `| Pages with no/minimal text | ${report.emptyPages.length} |`,
    `| Videos found | ${report.totalVideosFound} |`,
    `| Transcripts done | ${report.transcriptsDone} |`,
    `| Transcripts failed | ${report.transcriptsFailed} |`,
    `| Transcripts not attempted | ${report.transcriptsMissing} |`,
    `| Files downloaded | ${report.filesSaved} |`,
    `| File download failures | ${report.filesFailed} |`,
    `| INDEX.md | ${hasIndex ? "yes" : "NO" } |`,
    `| MISSING.md | ${hasMissing ? "yes" : "no" } |`,
    `| Pull index.json | ${pullIndex ? "yes" : "NO" } |`,
    "",
  ];

  if (report.emptyPages.length) {
    lines.push("## Pages with little or no text", "");
    for (const p of report.emptyPages.slice(0, 30)) {
      lines.push(`- **${p.title}** (${p.chars} chars) — ${p.url}`);
    }
    lines.push("");
  }

  const videoFailures = report.failures.filter((f) => f.video || f.issue?.includes("transcript"));
  if (videoFailures.length) {
    lines.push("## Videos still missing", "");
    for (const f of videoFailures) {
      lines.push(`- **${f.page}**: ${f.issue}`);
      if (f.video) lines.push(`  - ${f.video}`);
      if (f.error) lines.push(`  - ${f.error}`);
    }
    lines.push("");
  }

  const otherFailures = report.failures.filter((f) => !f.video && !f.issue?.includes("transcript"));
  if (otherFailures.length) {
    lines.push("## Other issues", "");
    for (const f of otherFailures.slice(0, 30)) {
      lines.push(`- **${f.page}**: ${f.issue}${f.error ? ` — ${f.error}` : ""}`);
    }
    lines.push("");
  }

  if (!videoFailures.length && !report.emptyPages.length && report.transcriptsFailed === 0) {
    lines.push("**All checks passed.** Nothing obvious missing.", "");
  } else {
    lines.push("## What to do about gaps", "");
    lines.push("1. Run `npm run notion:vimeo` for failed Vimeo embeds");
    lines.push("2. Open pages listed in MISSING.md and screenshot manually");
    lines.push("3. Re-run `npm run notion:pull` if pages have little/no text (pull may have stopped early)");
    lines.push("");
  }

  const outPath = path.join(OUTPUT_DIR, "VERIFY.md");
  fs.writeFileSync(outPath, lines.join("\n"));

  console.log(lines.join("\n"));
  console.log(`\nReport saved → ${outPath}`);

  if (report.transcriptsFailed || report.transcriptsMissing || report.emptyPages.length) {
    process.exitCode = 1;
  }
}

main();

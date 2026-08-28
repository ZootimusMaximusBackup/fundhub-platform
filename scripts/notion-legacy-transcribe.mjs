#!/usr/bin/env node
/**
 * Download videos from notion-scrape output and transcribe with OpenAI Whisper.
 * Requires: ffmpeg (audio extract), yt-dlp (embed downloads), OPENAI_API_KEY in .env
 *
 *   npm run notion:transcribe
 */

import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "./load-env.mjs";
import {
  OUTPUT_DIR,
  walkOutputDirs,
  readMeta,
  writeMeta,
  fileExists,
} from "./notion-scrape/lib.mjs";
import { bin, run, toMp3, transcribeAudio, isBadVideoUrl } from "./notion-scrape/transcribe.mjs";

loadEnv();

const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".m4v", ".mkv", ".mp3", ".m4a", ".wav"]);

function isVideoFile(href) {
  try {
    const ext = path.extname(new URL(href).pathname).toLowerCase();
    return VIDEO_EXT.has(ext);
  } catch {
    return /\.(mp4|mov|webm|m4v|mkv)(\?|$)/i.test(href);
  }
}

function embedKind(url) {
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  if (/loom\.com/i.test(url)) return "loom";
  if (/vimeo\.com/i.test(url)) return "vimeo";
  if (/wistia\.(com|net)/i.test(url)) return "wistia";
  if (/drive\.google\.com/i.test(url)) return "google-drive";
  if (/file\.notion\.so|amazonaws\.com/i.test(url)) return "direct";
  return "embed";
}

async function downloadWithYtDlp(url, outPath, opts = {}) {
  const ytdlp = bin("yt-dlp");
  if (!ytdlp) return { ok: false, error: "yt-dlp not installed (brew install yt-dlp)" };

  if (await fileExists(outPath)) return { ok: true, skipped: true };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  let fetchUrl = url;
  const args = [
    fetchUrl,
    "-o",
    outPath,
    "--no-playlist",
    "--restrict-filenames",
    "--merge-output-format",
    "mp4",
  ];

  if (/vimeo/i.test(url)) {
    const id = url.match(/vimeo\.com\/video\/(\d+)/i)?.[1] || url.match(/vimeo\.com\/(\d+)/i)?.[1];
    if (id) fetchUrl = `https://vimeo.com/${id}`;
    args[0] = fetchUrl;
    args.push("--referer", opts.referer || "https://app.notion.com/");
    args.push("--add-header", "Referer:https://app.notion.com/");
  }

  const r = run(ytdlp, args);
  if (!r.ok) return { ok: false, error: r.stderr.slice(-500) };
  return { ok: true };
}

async function downloadDirect(url, outPath, headers = {}) {
  if (await fileExists(outPath)) return { ok: true, skipped: true };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  try {
    const res = await fetch(url, { headers, redirect: "follow" });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(outPath, buf);
    return { ok: true };
  } catch (err) {
    const msg = err?.cause?.code || err?.code || err?.message || "network_error";
    return { ok: false, error: `download failed: ${msg}` };
  }
}

function fileExistsSync(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

async function processVideoItem(pageDir, item, index, notionPageUrl) {
  const videosDir = path.join(pageDir, "videos");
  const transcriptsDir = path.join(pageDir, "transcripts");
  fs.mkdirSync(videosDir, { recursive: true });
  fs.mkdirSync(transcriptsDir, { recursive: true });

  const label = slug(item.label || item.url);
  const base = `${String(index).padStart(2, "0")}-${label}`;
  const videoPath = path.join(videosDir, `${base}.mp4`);
  const audioPath = path.join(videosDir, `${base}.mp3`);
  const transcriptPath = path.join(transcriptsDir, `${base}.txt`);

  if (fileExistsSync(transcriptPath)) {
    return {
      ...item,
      status: "done",
      videoPath: fileExistsSync(videoPath) ? videoPath : undefined,
      audioPath: fileExistsSync(audioPath) ? audioPath : undefined,
      transcriptPath,
    };
  }

  if (isBadVideoUrl(item.url)) {
    return { ...item, status: "skipped", error: "bogus embed url" };
  }

  let download = { ok: false, error: "unknown source" };
  const kind = embedKind(item.url);

  if (kind === "direct" || isVideoFile(item.url)) {
    download = await downloadDirect(item.url, videoPath);
  } else {
    download = await downloadWithYtDlp(item.url, videoPath, { referer: notionPageUrl });
  }

  if (!download.ok) {
    return { ...item, status: "download_failed", error: download.error };
  }

  const audio = toMp3(videoPath, audioPath);
  if (!audio.ok) {
    return { ...item, status: "audio_failed", error: audio.error, videoPath };
  }

  const key = process.env.OPENAI_API_KEY;
  const tx = fileExistsSync(transcriptPath)
    ? { ok: true, text: fs.readFileSync(transcriptPath, "utf8") }
    : await transcribeAudio(audioPath, transcriptPath, key);
  if (!tx.ok) {
    return { ...item, status: "transcribe_failed", error: tx.error, videoPath, audioPath };
  }

  return {
    ...item,
    status: "done",
    videoPath,
    audioPath,
    transcriptPath,
    transcriptPreview: (tx.text || fs.readFileSync(transcriptPath, "utf8")).slice(0, 120),
  };
}

function slug(s) {
  return (s || "video")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "video";
}

function collectVideoItems(meta) {
  const items = [];
  const seen = new Set();

  for (const url of meta.videoEmbeds || []) {
    const key = url.split("?")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ url, label: path.basename(key), source: "embed" });
  }

  for (const file of meta.fileLinks || []) {
    if (!isVideoFile(file.href)) continue;
    const key = file.href.split("?")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ url: file.href, label: file.label || path.basename(key), source: "file" });
  }

  return items;
}

async function main() {
  const ytdlp = bin("yt-dlp");
  const ffmpeg = bin("ffmpeg");
  if (!ffmpeg) {
    console.error("ffmpeg required. Install with: brew install ffmpeg");
    process.exit(1);
  }
  if (!ytdlp) {
    console.warn("yt-dlp not found — only direct Notion video files will download.");
    console.warn("Install for YouTube/Loom/Vimeo: brew install yt-dlp\n");
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY required in .env for transcription.");
    process.exit(1);
  }

  const dirs = walkOutputDirs();
  if (!dirs.length) {
    console.error("No scraped pages found. Run: npm run notion:pull");
    process.exit(1);
  }

  let done = 0;
  let failed = 0;
  let consecutive429 = 0;

  for (const pageDir of dirs) {
    const meta = readMeta(pageDir);
    const items = collectVideoItems(meta);
    if (!items.length) continue;

    console.log(`\n${meta.title} — ${items.length} video(s)`);
    meta.transcripts = meta.transcripts || [];

    for (let i = 0; i < items.length; i++) {
      const result = await processVideoItem(pageDir, items[i], i + 1, meta.url);
      meta.transcripts[i] = result;
      if (result.status === "done") {
        done++;
        consecutive429 = 0;
        console.log(`  ✓ ${result.label || result.url}`);
      } else {
        failed++;
        console.log(`  ✗ ${result.label || result.url}: ${result.error}`);
        if (String(result.error || "").includes("Whisper 429")) {
          consecutive429++;
          if (consecutive429 >= 2) {
            writeMeta(pageDir, meta);
            console.error("\nStopped: OpenAI is out of money again. Meet words job left running.");
            process.exitCode = 1;
            return;
          }
        } else {
          consecutive429 = 0;
        }
      }
    }

    writeMeta(pageDir, meta);
  }

  console.log(`\nTranscription complete. ${done} ok, ${failed} failed.`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

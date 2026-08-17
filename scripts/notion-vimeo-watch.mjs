#!/usr/bin/env node
/**
 * Retry failed Vimeo embeds by playing them in Notion (logged-in browser)
 * and capturing the media stream. No Vimeo account needed — Notion already plays them.
 *
 *   npm run notion:vimeo
 *
 * Run after notion:transcribe when Vimeo items failed with 401.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { loadEnv } from "./load-env.mjs";
import {
  PROFILE_DIR,
  OUTPUT_DIR,
  walkOutputDirs,
  readMeta,
  writeMeta,
} from "./notion-scrape/lib.mjs";

loadEnv();

const NAV_OPTS = { waitUntil: "commit", timeout: 120_000 };

function bin(name) {
  const r = spawnSync("which", [name], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", stdio: "pipe" });
  return { ok: r.status === 0, stderr: r.stderr || "", stdout: r.stdout || "" };
}

function isVimeoFailure(entry) {
  return (
    entry?.url?.includes("vimeo") &&
    entry?.status &&
    entry.status !== "done"
  );
}

function vimeoId(url) {
  const m = url.match(/vimeo\.com\/video\/(\d+)/i) || url.match(/vimeo\.com\/(\d+)/i);
  return m ? m[1] : null;
}

async function captureVimeoFromNotion(page, notionUrl, vimeoEmbedUrl) {
  const mediaUrls = [];

  const onResponse = (resp) => {
    const u = resp.url();
    const type = resp.headers()["content-type"] || "";
    if (
      /vimeocdn|akamaized|cloudfront|googlevideo/i.test(u) &&
      (/video|mpegurl|mp4|octet-stream/i.test(type) || /\.mp4|\.m3u8|\/range\//i.test(u))
    ) {
      mediaUrls.push({ url: u, type });
    }
  };

  page.on("response", onResponse);

  try {
    await page.goto(notionUrl, NAV_OPTS);
    await page.waitForTimeout(4000);

    const iframeSel = `iframe[src*="vimeo"]`;
    await page.waitForSelector(iframeSel, { timeout: 30_000 }).catch(() => null);

    const frame = page.frameLocator(iframeSel).first();
    await frame.locator("button, [data-play-button], .vp-play").first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(12_000);

    // Scroll into view and retry play on main page click target
    await page.locator(iframeSel).first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(8000);
  } finally {
    page.off("response", onResponse);
  }

  // Prefer mp4 over m3u8
  const mp4 = mediaUrls.find((m) => /\.mp4/i.test(m.url) || m.type.includes("mp4"));
  const m3u8 = mediaUrls.find((m) => /\.m3u8/i.test(m.url) || m.type.includes("mpegurl"));
  return mp4?.url || m3u8?.url || null;
}

async function downloadMedia(page, mediaUrl, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  if (/\.m3u8/i.test(mediaUrl)) {
    const ffmpeg = bin("ffmpeg");
    if (!ffmpeg) return { ok: false, error: "ffmpeg required for m3u8" };
    const r = run(ffmpeg, ["-y", "-i", mediaUrl, "-c", "copy", outPath]);
    return r.ok ? { ok: true } : { ok: false, error: r.stderr.slice(-400) };
  }

  const res = await page.request.get(mediaUrl);
  if (!res.ok()) return { ok: false, error: `HTTP ${res.status()}` };
  fs.writeFileSync(outPath, Buffer.from(await res.body()));
  return { ok: true };
}

function toMp3(videoPath, audioPath) {
  const ffmpeg = bin("ffmpeg");
  if (!ffmpeg) return { ok: false, error: "ffmpeg not found" };
  const r = run(ffmpeg, ["-y", "-i", videoPath, "-vn", "-acodec", "libmp3lame", "-q:a", "4", audioPath]);
  return r.ok ? { ok: true } : { ok: false, error: r.stderr.slice(-400) };
}

async function whisper(audioPath, outTxt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, error: "OPENAI_API_KEY missing" };

  const blob = new Blob([fs.readFileSync(audioPath)]);
  const form = new FormData();
  form.append("file", blob, path.basename(audioPath));
  form.append("model", "whisper-1");
  form.append("response_format", "text");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) return { ok: false, error: `Whisper ${res.status}` };
  const text = await res.text();
  fs.writeFileSync(outTxt, text.trim() + "\n");
  return { ok: true, text: text.trim() };
}

async function tryYtDlpVimeo(url, outPath, referer) {
  const ytdlp = bin("yt-dlp");
  if (!ytdlp) return { ok: false, error: "no yt-dlp" };

  const id = vimeoId(url);
  const normalized = id ? `https://vimeo.com/${id}` : url;

  const args = [
    normalized,
    "-o",
    outPath,
    "--no-playlist",
    "--referer",
    referer || "https://app.notion.com/",
    "--add-header",
    "Referer:https://app.notion.com/",
  ];

  // Use same browser cookies if available
  const browserCookie = process.env.NOTION_VIMEO_BROWSER || "chromium";
  args.push("--cookies-from-browser", browserCookie);

  const r = run(ytdlp, args);
  return r.ok ? { ok: true } : { ok: false, error: r.stderr.slice(-500) };
}

async function main() {
  const failures = [];
  for (const dir of walkOutputDirs()) {
    const meta = readMeta(dir);
    for (let i = 0; i < (meta.transcripts || []).length; i++) {
      const t = meta.transcripts[i];
      if (isVimeoFailure(t)) {
        failures.push({ dir, meta, index: i, item: t });
      }
    }
  }

  if (!failures.length) {
    console.log("No failed Vimeo items. Nothing to watch.");
    return;
  }

  console.log(`Vimeo watcher: ${failures.length} failed embed(s) to retry.\n`);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1440, height: 900 },
  });
  const page = context.pages()[0] || (await context.newPage());

  let ok = 0;
  let stillFailed = 0;

  for (const { dir, meta, index, item } of failures) {
    const label = path.basename(item.url).slice(0, 40);
    const videosDir = path.join(dir, "videos");
    const transcriptsDir = path.join(dir, "transcripts");
    fs.mkdirSync(videosDir, { recursive: true });
    fs.mkdirSync(transcriptsDir, { recursive: true });

    const base = `vimeo-${vimeoId(item.url) || index}`;
    const videoPath = path.join(videosDir, `${base}.mp4`);
    const audioPath = path.join(videosDir, `${base}.mp3`);
    const transcriptPath = path.join(transcriptsDir, `${base}.txt`);

    console.log(`\n${meta.title} — ${label}`);

    let result = { ...item, status: "download_failed" };

    // 1) yt-dlp with referer + browser cookies
    let dl = await tryYtDlpVimeo(item.url, videoPath, meta.url);
    if (!dl.ok) {
      console.log(`  yt-dlp: ${dl.error.slice(0, 80)}…`);
      // 2) Play in Notion, capture stream
      const mediaUrl = await captureVimeoFromNotion(page, meta.url, item.url);
      if (mediaUrl) {
        console.log(`  captured stream`);
        dl = await downloadMedia(page, mediaUrl, videoPath);
      } else {
        dl = { ok: false, error: "no stream captured from Notion embed" };
      }
    }

    if (!dl.ok) {
      result = { ...item, status: "download_failed", error: dl.error, method: "vimeo-watcher" };
      stillFailed++;
      console.log(`  ✗ ${dl.error.slice(0, 100)}`);
    } else {
      const audio = toMp3(videoPath, audioPath);
      if (!audio.ok) {
        result = { ...item, status: "audio_failed", error: audio.error, videoPath };
        stillFailed++;
        console.log(`  ✗ audio: ${audio.error.slice(0, 80)}`);
      } else {
        const tx = await whisper(audioPath, transcriptPath);
        if (!tx.ok) {
          result = { ...item, status: "transcribe_failed", error: tx.error, videoPath, audioPath };
          stillFailed++;
          console.log(`  ✗ whisper: ${tx.error}`);
        } else {
          result = {
            ...item,
            status: "done",
            method: "vimeo-watcher",
            videoPath,
            audioPath,
            transcriptPath,
          };
          ok++;
          console.log(`  ✓ transcribed`);
        }
      }
    }

    meta.transcripts[index] = result;
    writeMeta(dir, meta);
  }

  await context.close();
  console.log(`\nVimeo watcher done. ${ok} ok, ${stillFailed} still failed.`);
  if (stillFailed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

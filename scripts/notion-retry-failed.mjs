#!/usr/bin/env node
/**
 * Retry ALL failed video transcripts.
 * Vimeo: intercept /config JSON while Notion page plays (bypasses 401).
 * YouTube: yt-dlp with Notion referer.
 * Long audio: split into chunks for Whisper.
 *
 *   npm run notion:retry
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { loadEnv } from "./load-env.mjs";
import {
  PROFILE_DIR,
  walkOutputDirs,
  readMeta,
  writeMeta,
} from "./notion-scrape/lib.mjs";
import {
  bin,
  run,
  toMp3,
  transcribeAudio,
  vimeoId,
  isBadVideoUrl,
  urlsFromVimeoConfig,
} from "./notion-scrape/transcribe.mjs";

loadEnv();

const NAV_OPTS = { waitUntil: "commit", timeout: 120_000 };

function isFailed(entry) {
  return entry?.status && entry.status !== "done" && !isBadVideoUrl(entry.url);
}

async function downloadWithContext(page, url, outPath, referer) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const res = await page.request.get(url, {
    headers: { Referer: referer || "https://app.notion.com/" },
  });
  if (!res.ok()) return { ok: false, error: `HTTP ${res.status()}` };
  fs.writeFileSync(outPath, Buffer.from(await res.body()));
  return { ok: true };
}

async function downloadWithYtDlp(url, outPath, referer) {
  const ytdlp = bin("yt-dlp");
  if (!ytdlp) return { ok: false, error: "yt-dlp missing" };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const args = [
    url,
    "-o", outPath,
    "--no-playlist",
    "--referer", referer || "https://app.notion.com/",
    "--add-header", `Referer:${referer || "https://app.notion.com/"}`,
  ];

  if (/youtube|youtu\.be/i.test(url)) {
    args.push("--extractor-args", "youtube:player_client=android,web");
  }

  const r = run(ytdlp, args);
  return r.ok ? { ok: true } : { ok: false, error: r.stderr.slice(-600) };
}

async function downloadWithFfmpeg(url, outPath, referer) {
  const ffmpeg = bin("ffmpeg");
  if (!ffmpeg) return { ok: false, error: "ffmpeg missing" };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const r = run(ffmpeg, [
    "-y",
    "-headers", `Referer: ${referer || "https://app.notion.com/"}\r\n`,
    "-i", url,
    "-c", "copy",
    outPath,
  ]);
  return r.ok ? { ok: true } : { ok: false, error: r.stderr.slice(-600) };
}

/** Open Notion page, nudge Vimeo iframe, steal /config JSON from network. */
async function vimeoUrlsFromNotion(page, notionUrl, embedUrl) {
  const configs = [];

  const onResponse = async (resp) => {
    const u = resp.url();
    if (!u.includes("player.vimeo.com") || !u.includes("/config")) return;
    try {
      configs.push(await resp.json());
    } catch { /* ignore */ }
  };

  page.on("response", onResponse);

  try {
    await page.goto(notionUrl, NAV_OPTS);
    await page.waitForTimeout(1500);

    const id = vimeoId(embedUrl);
    const iframeSel = id
      ? `iframe[src*="vimeo.com/video/${id}"], iframe[src*="${id}"]`
      : `iframe[src*="vimeo"]`;

    await page.waitForSelector(iframeSel, { timeout: 20_000 }).catch(() => null);
    await page.locator(iframeSel).first().scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(800);

    const frame = page.frameLocator(iframeSel).first();
    await frame.locator('[data-play-button], button[aria-label*="Play"], .vp-play, .play').first()
      .click({ timeout: 5000 }).catch(() => {});
    await page.locator(iframeSel).first().click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(4000);
  } finally {
    page.off("response", onResponse);
  }

  const urls = [];
  for (const cfg of configs) {
    urls.push(...urlsFromVimeoConfig(cfg));
  }
  return [...new Set(urls)];
}

async function downloadVideo(page, item, notionUrl, outPath) {
  const url = item.url;

  if (/vimeo/i.test(url)) {
    const id = vimeoId(url);
    if (id) {
      const ytdlp = await downloadWithYtDlp(`https://vimeo.com/${id}`, outPath, notionUrl);
      if (ytdlp.ok) return { ok: true, method: "vimeo-ytdlp" };
    }
    try {
      const mediaUrls = await vimeoUrlsFromNotion(page, notionUrl, url);
      for (const mediaUrl of mediaUrls) {
        let dl = await downloadWithContext(page, mediaUrl, outPath, notionUrl);
        if (dl.ok) return { ok: true, method: "vimeo-config" };
        dl = await downloadWithFfmpeg(mediaUrl, outPath, notionUrl);
        if (dl.ok) return { ok: true, method: "vimeo-ffmpeg" };
      }
    } catch (err) {
      if (id) {
        const ytdlp = await downloadWithYtDlp(`https://vimeo.com/${id}`, outPath, notionUrl);
        if (ytdlp.ok) return { ok: true, method: "vimeo-ytdlp-retry" };
      }
      return { ok: false, error: err?.message || "vimeo browser failed" };
    }
    if (id) {
      const dl = await downloadWithYtDlp(`https://vimeo.com/${id}`, outPath, notionUrl);
      if (dl.ok) return { ok: true, method: "vimeo-ytdlp" };
    }
    return { ok: false, error: "vimeo: no config URL captured" };
  }

  let ytUrl = url;
  if (/youtube\.com\/embed\//i.test(url)) {
    const id = url.match(/embed\/([^?&]+)/)?.[1];
    if (id) ytUrl = `https://www.youtube.com/watch?v=${id}`;
  }

  let dl = await downloadWithYtDlp(ytUrl, outPath, notionUrl);
  if (dl.ok) return { ok: true, method: "ytdlp" };
  return dl;
}

async function main() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.error("OPENAI_API_KEY required");
    process.exit(1);
  }

  const failures = [];
  for (const dir of walkOutputDirs()) {
    const meta = readMeta(dir);
    for (let i = 0; i < (meta.transcripts || []).length; i++) {
      const t = meta.transcripts[i];
      if (isFailed(t)) failures.push({ dir, meta, index: i, item: t });
    }
  }

  if (!failures.length) {
    console.log("Nothing failed. All good.");
    return;
  }

  console.log(`Retrying ${failures.length} failed video(s)…`);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    viewport: { width: 1280, height: 720 },
  });
  let page = context.pages()[0] || (await context.newPage());

  let ok = 0;
  let fail = 0;

  for (const { dir, meta, index, item } of failures) {
    try {
      if (page.isClosed()) page = await context.newPage();
      const slug = path.basename(item.url).replace(/[^a-z0-9]+/gi, "-").slice(0, 30);
      const videosDir = path.join(dir, "videos");
      const transcriptsDir = path.join(dir, "transcripts");
      fs.mkdirSync(videosDir, { recursive: true });
      fs.mkdirSync(transcriptsDir, { recursive: true });

      const videoPath = path.join(videosDir, `retry-${slug}.mp4`);
      const audioPath = path.join(videosDir, `retry-${slug}.mp3`);
      const transcriptPath = path.join(transcriptsDir, `retry-${slug}.txt`);

      const dl = await downloadVideo(page, item, meta.url, videoPath);
      if (!dl.ok) {
        meta.transcripts[index] = { ...item, status: "download_failed", error: dl.error, retryAt: new Date().toISOString() };
        writeMeta(dir, meta);
        fail++;
        continue;
      }

      const audio = toMp3(videoPath, audioPath);
      if (!audio.ok) {
        meta.transcripts[index] = { ...item, status: "audio_failed", error: audio.error, videoPath };
        writeMeta(dir, meta);
        fail++;
        continue;
      }

      const tx = await transcribeAudio(audioPath, transcriptPath, key);
      if (!tx.ok) {
        meta.transcripts[index] = { ...item, status: "transcribe_failed", error: tx.error, videoPath, audioPath };
        writeMeta(dir, meta);
        fail++;
        continue;
      }

      meta.transcripts[index] = {
        ...item,
        status: "done",
        method: dl.method || "retry",
        videoPath,
        audioPath,
        transcriptPath,
        retryAt: new Date().toISOString(),
      };
      writeMeta(dir, meta);
      ok++;
    } catch (err) {
      if (page.isClosed()) page = await context.newPage();
      meta.transcripts[index] = {
        ...item,
        status: "download_failed",
        error: err?.message || "retry_crash",
        retryAt: new Date().toISOString(),
      };
      writeMeta(dir, meta);
      fail++;
    }
  }

  await context.close();
  console.log(`\nRetry complete. ${ok} ok, ${fail} failed.`);
  if (fail) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

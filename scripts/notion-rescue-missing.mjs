#!/usr/bin/env node
/**
 * Rescue course videos that failed on dead Vimeo/Notion links.
 * Uses logged-in Notion Chrome profile — plays embeds on the page, not public Vimeo URLs.
 *
 *   node scripts/notion-rescue-missing.mjs
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
  urlsFromVimeoConfig,
  isBadVideoUrl,
} from "./notion-scrape/transcribe.mjs";

loadEnv();

const NAV_OPTS = { waitUntil: "commit", timeout: 120_000 };

function isMissing(entry) {
  return entry?.status && entry.status !== "done" && !isBadVideoUrl(entry.url);
}

async function launchChrome() {
  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: "chrome",
    viewport: { width: 1280, height: 720 },
    ignoreDefaultArgs: ["--enable-automation"],
    args: ["--disable-blink-features=AutomationControlled"],
  });
}

async function grabVimeoCaptions(page, notionUrl, embedUrl) {
  const id = vimeoId(embedUrl);
  if (!id) return { ok: false, error: "no vimeo id" };

  await page.goto(notionUrl, NAV_OPTS);
  await page.waitForSelector(`iframe[src*="${id}"]`, { timeout: 45_000 });
  await page.waitForTimeout(1500);

  const frame = page.frameLocator(`iframe[src*="${id}"]`);
  await frame.getByRole("button", { name: /play/i }).click({ timeout: 8000 }).catch(() =>
    frame.locator(".vp-play, [data-play-button]").first().click({ timeout: 4000 }).catch(() => {}),
  );
  await page.waitForTimeout(1500);
  await frame.getByRole("button", { name: /transcript/i }).click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(1000);

  const vimeoFrame = page.frames().find((f) => f.url().includes(id));
  if (!vimeoFrame) return { ok: false, error: "vimeo iframe lost" };

  const data = await vimeoFrame.evaluate(async () => {
    const v = document.querySelector("video");
    if (!v) return { ok: false, error: "no video element" };
    v.muted = true;
    try { await v.play(); } catch { /* need click */ }
    await new Promise((r) => setTimeout(r, 3000));

    const parts = [];
    for (const t of v.textTracks || []) {
      t.mode = "showing";
      await new Promise((r) => setTimeout(r, 400));
      const cues = [];
      for (const c of t.cues || []) cues.push(c.text);
      if (cues.length) parts.push({ label: t.label || t.language, text: cues.join(" ") });
    }
    if (!parts.length) {
      const panel = document.querySelector('[class*="transcript" i]');
      const panelText = panel?.innerText?.replace(/\d{2}:\d{2}\n/g, " ").trim();
      if (panelText && panelText.length > 80) parts.push({ label: "panel", text: panelText });
    }
    return { ok: parts.length > 0, parts };
  });

  if (!data.ok || !data.parts?.length) return { ok: false, error: data.error || "no captions" };
  const best = data.parts.find((p) => /english/i.test(p.label)) || data.parts[0];
  return { ok: true, text: best.text, method: "vimeo-captions" };
}

async function vimeoConfigUrls(page, notionUrl, embedUrl) {
  const configs = [];
  const onResponse = async (resp) => {
    const u = resp.url();
    if (!u.includes("player.vimeo.com") || !u.includes("/config")) return;
    try { configs.push(await resp.json()); } catch { /* ignore */ }
  };
  page.on("response", onResponse);
  try {
    const id = vimeoId(embedUrl);
    await page.goto(notionUrl, NAV_OPTS);
    await page.waitForTimeout(1500);
    const iframeSel = id
      ? `iframe[src*="vimeo.com/video/${id}"], iframe[src*="${id}"]`
      : `iframe[src*="vimeo"]`;
    await page.waitForSelector(iframeSel, { timeout: 30_000 }).catch(() => null);
    await page.locator(iframeSel).first().scrollIntoViewIfNeeded().catch(() => {});
    const frame = page.frameLocator(iframeSel).first();
    await frame.locator('[data-play-button], .vp-play, button[aria-label*="Play"]').first()
      .click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(5000);
  } finally {
    page.off("response", onResponse);
  }
  const urls = [];
  for (const cfg of configs) urls.push(...urlsFromVimeoConfig(cfg));
  return [...new Set(urls)];
}

async function downloadWithPage(page, url, outPath, referer) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  try {
    const res = await page.request.get(url, { headers: { Referer: referer || "https://app.notion.com/" } });
    if (!res.ok()) return { ok: false, error: `HTTP ${res.status()}` };
    fs.writeFileSync(outPath, Buffer.from(await res.body()));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || "download failed" };
  }
}

async function freshFileUrl(page, notionUrl, hint) {
  await page.goto(notionUrl, NAV_OPTS);
  await page.waitForTimeout(2000);
  return page.evaluate((nameHint) => {
    const hint = (nameHint || "").toLowerCase();
    for (const el of document.querySelectorAll("video[src], video source[src], a[href]")) {
      const u = el.src || el.href || el.getAttribute?.("src");
      if (!u || !/^https?:/i.test(u)) continue;
      if (!/file\.notion|amazonaws|prod-files|notion\.so\/file/i.test(u)) continue;
      if (hint && !u.toLowerCase().includes(hint.replace(/[^a-z0-9]/g, ""))) {
        const text = (el.textContent || "").toLowerCase();
        if (!text.includes(hint.slice(0, 12))) continue;
      }
      return u;
    }
    for (const iframe of document.querySelectorAll("iframe[src*='loom.com']")) {
      if (iframe.src && !/loom\.com\/?$/i.test(iframe.src)) return iframe.src;
    }
    return null;
  }, hint);
}

async function rescueVimeo(page, { dir, meta, index, item }, key) {
  const id = vimeoId(item.url);
  const transcriptsDir = path.join(dir, "transcripts");
  const videosDir = path.join(dir, "videos");
  fs.mkdirSync(transcriptsDir, { recursive: true });
  fs.mkdirSync(videosDir, { recursive: true });
  const transcriptPath = path.join(transcriptsDir, `rescue-vimeo-${id || index}.txt`);
  const videoPath = path.join(videosDir, `rescue-vimeo-${id || index}.mp4`);
  const audioPath = path.join(videosDir, `rescue-vimeo-${id || index}.mp3`);

  const caps = await grabVimeoCaptions(page, meta.url, item.url);
  if (caps.ok && caps.text?.trim()) {
    fs.writeFileSync(transcriptPath, caps.text.trim() + "\n");
    return { status: "done", method: caps.method, transcriptPath };
  }

  const mediaUrls = await vimeoConfigUrls(page, meta.url, item.url);
  let dl = { ok: false };
  for (const mediaUrl of mediaUrls) {
    dl = await downloadWithPage(page, mediaUrl, videoPath, meta.url);
    if (dl.ok) break;
    const ffmpeg = bin("ffmpeg");
    if (ffmpeg) {
      fs.mkdirSync(path.dirname(videoPath), { recursive: true });
      const r = run(ffmpeg, ["-y", "-headers", `Referer: ${meta.url}\r\n`, "-i", mediaUrl, "-c", "copy", videoPath]);
      if (r.ok) { dl = { ok: true }; break; }
    }
  }

  if (!dl.ok) return { status: "download_failed", error: dl.error || caps.error || "vimeo rescue failed" };

  const audio = toMp3(videoPath, audioPath);
  if (!audio.ok) return { status: "audio_failed", error: audio.error, videoPath };

  const tx = await transcribeAudio(audioPath, transcriptPath, key);
  if (!tx.ok) return { status: "transcribe_failed", error: tx.error, videoPath, audioPath };

  return { status: "done", method: "vimeo-rescue", videoPath, audioPath, transcriptPath };
}

async function rescueYouTube(page, { dir, meta, index, item }, key) {
  const transcriptsDir = path.join(dir, "transcripts");
  const videosDir = path.join(dir, "videos");
  fs.mkdirSync(transcriptsDir, { recursive: true });
  fs.mkdirSync(videosDir, { recursive: true });
  const id = item.url.match(/embed\/([^?&]+)/)?.[1] || item.url.match(/[?&]v=([^&]+)/)?.[1];
  const slug = id || `yt-${index}`;
  const transcriptPath = path.join(transcriptsDir, `rescue-yt-${slug}.txt`);
  const videoPath = path.join(videosDir, `rescue-yt-${slug}.mp4`);
  const audioPath = path.join(videosDir, `rescue-yt-${slug}.mp3`);

  const ytdlp = bin("yt-dlp");
  let ytUrl = item.url;
  if (id) ytUrl = `https://www.youtube.com/watch?v=${id}`;

  if (ytdlp) {
    fs.mkdirSync(path.dirname(videoPath), { recursive: true });
    const r = run(ytdlp, [
      ytUrl,
      "-o", videoPath,
      "--no-playlist",
      "--referer", meta.url,
      "--add-header", `Referer:${meta.url}`,
      "--extractor-args", "youtube:player_client=android,web",
    ]);
    if (r.ok && fs.existsSync(videoPath)) {
      const audio = toMp3(videoPath, audioPath);
      if (!audio.ok) return { status: "audio_failed", error: audio.error, videoPath };
      const tx = await transcribeAudio(audioPath, transcriptPath, key);
      if (!tx.ok) return { status: "transcribe_failed", error: tx.error, videoPath, audioPath };
      return { status: "done", method: "youtube-ytdlp", videoPath, audioPath, transcriptPath };
    }
  }

  await page.goto(meta.url, NAV_OPTS);
  await page.waitForTimeout(2000);
  const iframeSrc = await page.locator('iframe[src*="youtube"]').first().getAttribute("src").catch(() => null);
  if (iframeSrc && ytdlp) {
    const r = run(ytdlp, [
      iframeSrc,
      "-o", videoPath,
      "--no-playlist",
      "--referer", meta.url,
      "--add-header", `Referer:${meta.url}`,
      "--extractor-args", "youtube:player_client=android,web",
    ]);
    if (r.ok && fs.existsSync(videoPath)) {
      const audio = toMp3(videoPath, audioPath);
      if (!audio.ok) return { status: "audio_failed", error: audio.error, videoPath };
      const tx = await transcribeAudio(audioPath, transcriptPath, key);
      if (!tx.ok) return { status: "transcribe_failed", error: tx.error, videoPath, audioPath };
      return { status: "done", method: "youtube-embed-ytdlp", videoPath, audioPath, transcriptPath };
    }
  }

  return { status: "download_failed", error: "youtube blocked or unavailable" };
}

async function rescueNotionFile(page, { dir, meta, index, item }, key) {
  const transcriptsDir = path.join(dir, "transcripts");
  const videosDir = path.join(dir, "videos");
  fs.mkdirSync(transcriptsDir, { recursive: true });
  fs.mkdirSync(videosDir, { recursive: true });
  const slug = (item.label || `file-${index}`).replace(/[^a-z0-9]+/gi, "-").slice(0, 40);
  const transcriptPath = path.join(transcriptsDir, `rescue-${slug}.txt`);
  const videoPath = path.join(videosDir, `rescue-${slug}.mp4`);
  const audioPath = path.join(videosDir, `rescue-${slug}.mp3`);

  let dl = await downloadWithPage(page, item.url, videoPath, meta.url);
  if (!dl.ok) {
    const fresh = await freshFileUrl(page, meta.url, item.label || path.basename(item.url || ""));
    if (fresh) dl = await downloadWithPage(page, fresh, videoPath, meta.url);
  }
  if (!dl.ok) return { status: "download_failed", error: dl.error || "notion file download failed" };

  const audio = toMp3(videoPath, audioPath);
  if (!audio.ok) return { status: "audio_failed", error: audio.error, videoPath };

  const tx = await transcribeAudio(audioPath, transcriptPath, key);
  if (!tx.ok) return { status: "transcribe_failed", error: tx.error, videoPath, audioPath };

  return { status: "done", method: "notion-file-rescue", videoPath, audioPath, transcriptPath };
}

async function rescueLoom(page, { dir, meta, index, item }, key) {
  const transcriptsDir = path.join(dir, "transcripts");
  const videosDir = path.join(dir, "videos");
  fs.mkdirSync(transcriptsDir, { recursive: true });
  fs.mkdirSync(videosDir, { recursive: true });
  const id = item.url.match(/loom\.com\/embed\/([a-f0-9]+)/i)?.[1] || `loom-${index}`;
  const transcriptPath = path.join(transcriptsDir, `rescue-loom-${id}.txt`);
  const videoPath = path.join(videosDir, `rescue-loom-${id}.mp4`);
  const audioPath = path.join(videosDir, `rescue-loom-${id}.mp3`);

  const ytdlp = bin("yt-dlp");
  if (ytdlp) {
    const loomUrl = id ? `https://www.loom.com/share/${id}` : item.url;
    fs.mkdirSync(path.dirname(videoPath), { recursive: true });
    const r = run(ytdlp, [
      loomUrl,
      "-o", videoPath,
      "--no-playlist",
      "--referer", meta.url,
      "--add-header", `Referer:${meta.url}`,
    ]);
    if (r.ok && fs.existsSync(videoPath)) {
      const audio = toMp3(videoPath, audioPath);
      if (!audio.ok) return { status: "audio_failed", error: audio.error, videoPath };
      const tx = await transcribeAudio(audioPath, transcriptPath, key);
      if (!tx.ok) return { status: "transcribe_failed", error: tx.error, videoPath, audioPath };
      return { status: "done", method: "loom-ytdlp", videoPath, audioPath, transcriptPath };
    }
  }

  return { status: "download_failed", error: "loom download failed" };
}

async function main() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.error("OPENAI_API_KEY required");
    process.exit(1);
  }

  const missing = [];
  for (const dir of walkOutputDirs()) {
    const meta = readMeta(dir);
    for (let i = 0; i < (meta.transcripts || []).length; i++) {
      const t = meta.transcripts[i];
      if (isMissing(t)) missing.push({ dir, meta, index: i, item: t });
    }
  }

  if (!missing.length) {
    console.log("Nothing missing.");
    return;
  }

  console.log(`Rescuing ${missing.length} missing video(s)…`);

  const context = await launchChrome();
  let page = context.pages()[0] || (await context.newPage());
  let ok = 0;
  let fail = 0;

  for (const row of missing) {
    const { dir, meta, index, item } = row;
    try {
      if (page.isClosed()) page = await context.newPage();
      console.log(meta.title);

      let result;
      const url = item.url || "";
      if (isBadVideoUrl(url)) {
        meta.transcripts[index] = { ...item, status: "skipped", error: "bogus embed url" };
        writeMeta(dir, meta);
        continue;
      }
      if (/vimeo/i.test(url)) result = await rescueVimeo(page, row, key);
      else if (/youtube|youtu\.be/i.test(url)) result = await rescueYouTube(page, row, key);
      else if (/loom/i.test(url)) result = await rescueLoom(page, row, key);
      else if (/file\.notion|prod-files|amazonaws/i.test(url)) result = await rescueNotionFile(page, row, key);
      else result = await rescueNotionFile(page, row, key);

      meta.transcripts[index] = {
        ...item,
        ...result,
        retryAt: new Date().toISOString(),
      };
      writeMeta(dir, meta);
      if (result.status === "done") ok += 1;
      else fail += 1;
    } catch (err) {
      if (page.isClosed()) page = await context.newPage();
      meta.transcripts[index] = {
        ...item,
        status: "download_failed",
        error: err?.message || "rescue_crash",
        retryAt: new Date().toISOString(),
      };
      writeMeta(dir, meta);
      fail += 1;
    }
  }

  await context.close();
  console.log(`Rescue complete. ${ok} ok, ${fail} failed.`);
  if (fail) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

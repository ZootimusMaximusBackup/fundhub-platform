#!/usr/bin/env node
/**
 * Grab Vimeo transcripts via built-in CC/transcript (auto-generated captions).
 * Uses real Chrome — Chromium gets Cloudflare blocked.
 *
 *   npm run notion:captions
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import {
  PROFILE_DIR,
  walkOutputDirs,
  readMeta,
  writeMeta,
} from "./notion-scrape/lib.mjs";
import { vimeoId } from "./notion-scrape/transcribe.mjs";

const NAV_OPTS = { waitUntil: "commit", timeout: 120_000 };

async function launchChrome() {
  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: "chrome",
    viewport: { width: 1440, height: 900 },
    ignoreDefaultArgs: ["--enable-automation"],
    args: ["--disable-blink-features=AutomationControlled"],
  });
}

function isVimeoFailure(entry) {
  return entry?.url?.includes("vimeo") && entry?.status && entry.status !== "done";
}

async function grabVimeoTranscript(page, notionUrl, embedUrl) {
  const id = vimeoId(embedUrl);
  if (!id) return { ok: false, error: "no vimeo id" };

  await page.goto(notionUrl, NAV_OPTS);
  await page.waitForSelector(`iframe[src*="${id}"]`, { timeout: 45_000 });
  await page.waitForTimeout(2000);

  const frame = page.frameLocator(`iframe[src*="${id}"]`);

  await frame.getByRole("button", { name: /play/i }).click({ timeout: 10_000 }).catch(() =>
    frame.locator(".vp-play, [data-play-button]").first().click({ timeout: 5000 }).catch(() => {}),
  );
  await page.waitForTimeout(2000);

  // Open transcript panel if available (helps populate cues)
  await frame.getByRole("button", { name: /transcript/i }).click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const vimeoFrame = page.frames().find((f) => f.url().includes(id));
  if (!vimeoFrame) return { ok: false, error: "vimeo iframe lost" };

  const data = await vimeoFrame.evaluate(async () => {
    const v = document.querySelector("video");
    if (!v) return { ok: false, error: "no video element" };
    v.muted = true;
    try {
      await v.play();
    } catch {
      /* may need interaction */
    }
    await new Promise((r) => setTimeout(r, 4000));

    const parts = [];
    for (const t of v.textTracks || []) {
      t.mode = "showing";
      await new Promise((r) => setTimeout(r, 500));
      const cues = [];
      for (const c of t.cues || []) cues.push(c.text);
      if (cues.length) {
        parts.push({ label: t.label || t.language, text: cues.join(" ") });
      }
    }

    if (!parts.length) {
      const panel = document.querySelector('[class*="transcript" i]');
      const panelText = panel?.innerText?.replace(/\d{2}:\d{2}\n/g, " ").trim();
      if (panelText && panelText.length > 80) {
        parts.push({ label: "panel", text: panelText });
      }
    }

    return { ok: parts.length > 0, parts, duration: v.duration };
  });

  if (!data.ok || !data.parts?.length) {
    return { ok: false, error: data.error || "no captions on video" };
  }

  const best = data.parts.find((p) => p.label.includes("English")) || data.parts[0];
  return { ok: true, text: best.text, label: best.label, duration: data.duration };
}

async function main() {
  const failures = [];
  for (const dir of walkOutputDirs()) {
    const meta = readMeta(dir);
    for (let i = 0; i < (meta.transcripts || []).length; i++) {
      const t = meta.transcripts[i];
      if (isVimeoFailure(t)) failures.push({ dir, meta, index: i, item: t });
    }
  }

  if (!failures.length) {
    console.log("No failed Vimeo items.");
    return;
  }

  console.log(`Vimeo captions: ${failures.length} video(s)\n`);

  const context = await launchChrome();
  const page = context.pages()[0] || (await context.newPage());

  let ok = 0;
  let fail = 0;

  for (const { dir, meta, index, item } of failures) {
    const id = vimeoId(item.url);
    const transcriptsDir = path.join(dir, "transcripts");
    fs.mkdirSync(transcriptsDir, { recursive: true });
    const transcriptPath = path.join(transcriptsDir, `vimeo-${id}.txt`);

    console.log(`\n${meta.title} (vimeo ${id})`);

    if (fs.existsSync(transcriptPath) && fs.statSync(transcriptPath).size > 50) {
      console.log("  ✓ already have transcript");
      meta.transcripts[index] = { ...item, status: "done", method: "vimeo-captions", transcriptPath };
      writeMeta(dir, meta);
      ok++;
      continue;
    }

    const result = await grabVimeoTranscript(page, meta.url, item.url);
    if (!result.ok) {
      console.log(`  ✗ ${result.error}`);
      meta.transcripts[index] = { ...item, status: "download_failed", error: result.error, method: "vimeo-captions" };
      writeMeta(dir, meta);
      fail++;
      continue;
    }

    fs.writeFileSync(transcriptPath, result.text.trim() + "\n");
    meta.transcripts[index] = {
      ...item,
      status: "done",
      method: "vimeo-captions",
      captionLabel: result.label,
      transcriptPath,
      duration: result.duration,
    };
    writeMeta(dir, meta);
    ok++;
    console.log(`  ✓ captions (${result.label}, ${Math.round(result.duration || 0)}s)`);
  }

  await context.close();
  console.log(`\nCaptions done. ${ok} ok, ${fail} failed.`);
  if (fail) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

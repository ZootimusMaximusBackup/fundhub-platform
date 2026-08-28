import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const WHISPER_MAX_BYTES = 24 * 1024 * 1024; // 24MB safe under 25MB limit

export function bin(name) {
  const r = spawnSync("which", [name], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", stdio: "pipe", ...opts });
  return { ok: r.status === 0, stdout: r.stdout || "", stderr: r.stderr || "" };
}

export function toMp3(videoPath, audioPath) {
  const ffmpeg = bin("ffmpeg");
  if (!ffmpeg) return { ok: false, error: "ffmpeg not found" };
  const r = run(ffmpeg, [
    "-y", "-i", videoPath, "-vn", "-acodec", "libmp3lame", "-q:a", "4", audioPath,
  ]);
  return r.ok ? { ok: true } : { ok: false, error: r.stderr.slice(-500) };
}

/** Split long audio into ~10 min mp3 chunks under Whisper size limit. */
export function splitAudioIfNeeded(audioPath, workDir) {
  const stat = fs.statSync(audioPath);
  if (stat.size <= WHISPER_MAX_BYTES) return [audioPath];

  fs.mkdirSync(workDir, { recursive: true });
  const ffmpeg = bin("ffmpeg");
  if (!ffmpeg) return [audioPath];

  const pattern = path.join(workDir, "chunk-%03d.mp3");
  run(ffmpeg, [
    "-y", "-i", audioPath, "-f", "segment", "-segment_time", "600",
    "-acodec", "libmp3lame", "-q:a", "5", pattern,
  ]);

  const chunks = fs.readdirSync(workDir)
    .filter((f) => f.startsWith("chunk-") && f.endsWith(".mp3"))
    .sort()
    .map((f) => path.join(workDir, f));

  return chunks.length ? chunks : [audioPath];
}

export async function whisperFile(audioPath, apiKey) {
  const blob = new Blob([fs.readFileSync(audioPath)]);
  const form = new FormData();
  form.append("file", blob, path.basename(audioPath));
  form.append("model", "whisper-1");
  form.append("response_format", "text");

  try {
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: `Whisper ${res.status}: ${err.slice(0, 200)}` };
    }
    return { ok: true, text: (await res.text()).trim() };
  } catch (err) {
    const msg = err?.cause?.code || err?.code || err?.message || "network_error";
    return { ok: false, error: `Whisper fetch failed: ${msg}` };
  }
}

export async function transcribeAudio(audioPath, outTxt, apiKey) {
  const chunkDir = path.join(path.dirname(audioPath), "whisper-chunks");
  const chunks = splitAudioIfNeeded(audioPath, chunkDir);
  const parts = [];

  for (const chunk of chunks) {
    const r = await whisperFile(chunk, apiKey);
    if (!r.ok) return r;
    if (r.text) parts.push(r.text);
  }

  const text = parts.join("\n\n");
  fs.writeFileSync(outTxt, text + (text ? "\n" : ""));
  return { ok: true, text };
}

export function vimeoId(url) {
  const m = url.match(/vimeo\.com\/video\/(\d+)/i) || url.match(/vimeo\.com\/(\d+)/i);
  return m ? m[1] : null;
}

export function isBadVideoUrl(url) {
  if (!url || url === "http://loom.com/" || url === "https://loom.com/") return true;
  if (/loom\.com\/?$/i.test(url)) return true;
  return false;
}

/** Pick best progressive/mp4 URL from Vimeo /config JSON. */
export function urlsFromVimeoConfig(json) {
  const urls = [];
  const prog = json?.request?.files?.progressive;
  if (Array.isArray(prog)) {
    for (const p of prog.sort((a, b) => (b.height || 0) - (a.height || 0))) {
      if (p?.url) urls.push(p.url);
    }
  }
  const hls = json?.request?.files?.hls;
  if (hls?.cdns) {
    for (const cdn of Object.values(hls.cdns)) {
      if (cdn?.url) urls.push(cdn.url);
    }
  }
  return urls;
}

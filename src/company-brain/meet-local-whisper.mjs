// Local-only: strip Meet audio with ffmpeg, then Whisper.
// Live Netlify sweeper never imports this — it skips files over 24MB.
// Outbound Whisper still goes through whisperBytes (fenced).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { applyMeetWords, pairMeetTranscripts } from "./meet-transcript.mjs";
import { looksLikeMeetRecordingName } from "./meet-title.mjs";
import {
  whisperBytes,
  whisperConfigFromEnv,
  WHISPER_MAX_BYTES,
  WHISPER_CREDITS_ERROR,
  WHISPER_RATE_LIMIT_ERROR
} from "./transcribe.mjs";

export const DEFAULT_LOCAL_LIMIT = 1;
export const LOCAL_CANDIDATE_LIMIT = 40;

function shouldBackoff(spoken) {
  const code = spoken?.error || spoken?.reason;
  return code === WHISPER_CREDITS_ERROR || code === WHISPER_RATE_LIMIT_ERROR;
}

export function whichBin(name, spawn = spawnSync) {
  const r = spawn("which", [name], { encoding: "utf8" });
  return r.status === 0 ? String(r.stdout || "").trim() : null;
}

export function stripToMp3(videoPath, audioPath, { spawn = spawnSync } = {}) {
  const ffmpeg = whichBin("ffmpeg", spawn);
  if (!ffmpeg) return { ok: false, error: "ffmpeg_missing" };
  const r = spawn(ffmpeg, [
    "-y", "-i", videoPath,
    "-vn", "-ac", "1", "-ar", "16000",
    "-acodec", "libmp3lame", "-q:a", "5",
    audioPath
  ], { encoding: "utf8", stdio: "pipe" });
  return r.status === 0 ? { ok: true } : { ok: false, error: "ffmpeg_failed" };
}

export function makeSilenceMp3(audioPath, { spawn = spawnSync } = {}) {
  const ffmpeg = whichBin("ffmpeg", spawn);
  if (!ffmpeg) return { ok: false, error: "ffmpeg_missing" };
  const r = spawn(ffmpeg, [
    "-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono",
    "-t", "1", "-acodec", "libmp3lame", "-q:a", "9",
    audioPath
  ], { encoding: "utf8", stdio: "pipe" });
  return r.status === 0 ? { ok: true } : { ok: false, error: "ffmpeg_failed" };
}

export function splitMp3Chunks(audioPath, workDir, {
  spawn = spawnSync,
  maxBytes = WHISPER_MAX_BYTES
} = {}) {
  const stat = fs.statSync(audioPath);
  if (stat.size <= maxBytes) return [audioPath];
  fs.mkdirSync(workDir, { recursive: true });
  const ffmpeg = whichBin("ffmpeg", spawn);
  if (!ffmpeg) return [audioPath];
  const pattern = path.join(workDir, "chunk-%03d.mp3");
  spawn(ffmpeg, [
    "-y", "-i", audioPath, "-f", "segment", "-segment_time", "600",
    "-ac", "1", "-ar", "16000", "-acodec", "libmp3lame", "-q:a", "5",
    pattern
  ], { encoding: "utf8", stdio: "pipe" });
  const chunks = fs.readdirSync(workDir)
    .filter((f) => f.startsWith("chunk-") && f.endsWith(".mp3"))
    .sort()
    .map((f) => path.join(workDir, f));
  return chunks.length ? chunks : [audioPath];
}

export async function probeWhisperWallet({
  env = process.env,
  fetchImpl,
  whisper = whisperBytes,
  spawn = spawnSync,
  workDir
} = {}) {
  const dir = workDir || fs.mkdtempSync(path.join(os.tmpdir(), "fh-whisper-probe-"));
  const audioPath = path.join(dir, "silence.mp3");
  try {
    const made = makeSilenceMp3(audioPath, { spawn });
    const bytes = made.ok && fs.existsSync(audioPath)
      ? fs.readFileSync(audioPath)
      : Buffer.from("ID3fake");
    const spoken = await whisper(bytes, {
      fileName: "silence.mp3",
      env,
      fetchImpl
    });
    if (shouldBackoff(spoken)) return { ok: false, reason: spoken.error };
    return { ok: true, reason: spoken.ok ? null : spoken.error || null };
  } finally {
    if (!workDir) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* tmp */ }
    }
  }
}

async function whisperAudioPath(audioPath, { env, fetchImpl, whisper, spawn }) {
  const chunkDir = path.join(path.dirname(audioPath), "chunks");
  const chunks = splitMp3Chunks(audioPath, chunkDir, { spawn });
  const parts = [];
  for (const chunk of chunks) {
    const bytes = fs.readFileSync(chunk);
    if (bytes.length > WHISPER_MAX_BYTES) {
      return { ok: false, text: "", error: "too_large", retryable: false };
    }
    const spoken = await whisper(bytes, {
      fileName: path.basename(chunk),
      env,
      fetchImpl
    });
    if (!spoken.ok) return spoken;
    if (spoken.text) parts.push(spoken.text);
  }
  const text = parts.join("\n\n").trim();
  if (!text) return { ok: false, text: "", error: "empty_transcript" };
  return { ok: true, text };
}

/**
 * One local pass: pair sibling docs, probe the wallet, Whisper at most
 * `limit` long leftover files (newest first). Short files stay for the
 * live sweeper. 429 / no credits leaves rows pending and stops the pass.
 */
export async function processLongPendingMeets(db, {
  orgId,
  env = process.env,
  fetchImpl,
  client,
  upsert,
  limit = DEFAULT_LOCAL_LIMIT,
  candidateLimit = LOCAL_CANDIDATE_LIMIT,
  spawn = spawnSync,
  pair = pairMeetTranscripts,
  apply = applyMeetWords,
  whisper = whisperBytes,
  probe = true
} = {}) {
  const empty = {
    ok: false, paired: 0, whispered: 0, skipped: 0, skipped_short: 0, reason: null
  };
  if (!orgId) return { ...empty, reason: "org_id_required" };

  const whisperCfg = whisperConfigFromEnv(env);
  if (!whisperCfg.ready) {
    return { ...empty, reason: `not_configured:${whisperCfg.missing.join(",")}` };
  }
  if (!whichBin("ffmpeg", spawn)) {
    return { ...empty, ok: true, reason: "ffmpeg_missing" };
  }
  if (!client) {
    return { ...empty, reason: "drive_client_required" };
  }

  const pairedOut = await pair(db, { orgId, env, fetchImpl, upsert });
  const paired = pairedOut.applied || 0;

  if (probe) {
    const wallet = await probeWhisperWallet({ env, fetchImpl, whisper, spawn });
    if (!wallet.ok && wallet.reason) {
      return {
        ok: true, paired, whispered: 0, skipped: 0, skipped_short: 0, reason: wallet.reason
      };
    }
  }

  const cap = Math.max(1, Number(limit) || DEFAULT_LOCAL_LIMIT);
  const window = Math.max(cap, Number(candidateLimit) || LOCAL_CANDIDATE_LIMIT);
  const pendingRes = await db.query(
    `SELECT id, drive_file_id, name, mime_type, web_view_link, client_id
       FROM brain_files
      WHERE org_id = $1
        AND needs_transcription = true
        AND (
          mime_type LIKE 'video/%'
          OR mime_type LIKE 'audio/%'
        )
      ORDER BY indexed_at DESC NULLS LAST
      LIMIT $2`,
    [orgId, window]
  );

  let whispered = 0;
  let skipped = 0;
  let skipped_short = 0;

  for (const rec of pendingRes.rows || []) {
    if (whispered >= cap) break;
    if (!looksLikeMeetRecordingName(rec.name)) {
      skipped += 1;
      continue;
    }

    let size = null;
    try {
      const meta = await client.getFile(rec.drive_file_id);
      size = Number(meta.size || 0) || null;
    } catch {
      skipped += 1;
      continue;
    }
    if (size && size <= WHISPER_MAX_BYTES) {
      skipped_short += 1;
      continue;
    }

    const work = fs.mkdtempSync(path.join(os.tmpdir(), "fh-meet-local-"));
    try {
      let bytes;
      try {
        bytes = await client.downloadMedia(rec.drive_file_id);
      } catch {
        skipped += 1;
        continue;
      }
      const videoPath = path.join(work, "call.bin");
      const audioPath = path.join(work, "call.mp3");
      fs.writeFileSync(videoPath, bytes);
      const mp3 = stripToMp3(videoPath, audioPath, { spawn });
      if (!mp3.ok) {
        skipped += 1;
        continue;
      }
      const spoken = await whisperAudioPath(audioPath, {
        env, fetchImpl, whisper, spawn
      });
      if (!spoken.ok) {
        skipped += 1;
        if (shouldBackoff(spoken)) {
          return {
            ok: true, paired, whispered, skipped, skipped_short, reason: spoken.error
          };
        }
        continue;
      }
      const out = await apply(db, {
        orgId,
        extracted: {
          fileId: rec.drive_file_id,
          name: rec.name,
          mimeType: rec.mime_type,
          webViewLink: rec.web_view_link,
          clientId: rec.client_id || null,
          unattached: !rec.client_id
        },
        text: spoken.text,
        env,
        fetchImpl,
        upsert
      });
      if (out.ok) whispered += 1;
      else skipped += 1;
    } finally {
      try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* tmp */ }
    }
  }

  return { ok: true, paired, whispered, skipped, skipped_short, reason: null };
}

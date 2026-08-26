// Local keep-alive: ffmpeg long Meet files, Whisper, stamp words.
// Backs off on 429 / no credits. Files stay pending. Counts only. No names.
//
// Owner 2026-08-24: the current Drive A/V pile is a COURSE, not Meet recordings.
// Do not start this loop again until real Meet files exist.
import "./load-env.mjs";
import { db } from "../src/db.mjs";
import { driveConfigFromEnv } from "../src/company-brain/config.mjs";
import { createDriveClientFromConfig } from "../src/company-brain/drive-client.mjs";
import { processLongPendingMeets } from "../src/company-brain/meet-local-whisper.mjs";
import { whisperKeepAliveSleepMs } from "../src/company-brain/transcribe.mjs";

delete process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;

console.log(JSON.stringify({ ok: false, reason: "stopped:course_not_meet_recordings" }));
process.exit(0);

const orgId = process.env.ORG_ID || "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const LIMIT = Math.max(1, Number(process.env.MEET_TRANSCRIBE_LIMIT || 1) || 1);
const LOOP = process.env.MEET_TRANSCRIBE_LOOP !== "0";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function counts() {
  const pending = await db.query(
    `SELECT count(*)::int AS n FROM brain_files
      WHERE org_id = $1 AND needs_transcription = true`,
    [orgId]
  );
  const words = await db.query(
    `SELECT count(*)::int AS n FROM call_outcomes
      WHERE org_id = $1 AND transcript IS NOT NULL AND btrim(transcript) <> ''`,
    [orgId]
  );
  return {
    still_pending: pending.rows?.[0]?.n ?? null,
    calls_with_words: words.rows?.[0]?.n ?? null
  };
}

let attempt = 0;
for (;;) {
  const cfg = driveConfigFromEnv(process.env);
  let pass;
  if (!process.env.OPENAI_API_KEY && !process.env.COMPANY_BRAIN_OPENAI_API_KEY) {
    pass = { ok: false, reason: "not_configured:OPENAI_API_KEY" };
  } else if (!cfg.ready) {
    pass = { ok: false, reason: "drive_not_ready" };
  } else {
    const client = createDriveClientFromConfig(cfg);
    pass = await processLongPendingMeets(db, {
      orgId,
      env: process.env,
      client,
      limit: LIMIT
    });
  }

  let c = { still_pending: null, calls_with_words: null };
  try { c = await counts(); } catch { /* counts are optional */ }
  console.log(JSON.stringify({ pass, ...c }));

  if (!LOOP) process.exit(0);

  const reason = pass.reason || (pass.whispered ? null : "idle");
  if (reason === "credits_exhausted" || reason === "rate_limited") attempt += 1;
  else attempt = 0;
  const waitMs = whisperKeepAliveSleepMs(reason, attempt);
  console.log(JSON.stringify({ wait_ms: waitMs, reason }));
  await sleep(waitMs);
}

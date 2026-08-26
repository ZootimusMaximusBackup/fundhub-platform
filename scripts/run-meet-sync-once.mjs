// Targeted Meet pull: video/audio only, then one words pass. Counts, no names.
import "./load-env.mjs";
delete process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;

import { db } from "../src/db.mjs";
import { driveConfigFromEnv } from "../src/company-brain/config.mjs";
import { createDriveClientFromConfig } from "../src/company-brain/drive-client.mjs";
import { extractFromDriveFile } from "../src/company-brain/extract.mjs";
import { upsertExtractedFile } from "../src/company-brain/store.mjs";
import { saveSyncState } from "../src/company-brain/sync.mjs";
import { processOrgMeetWords } from "../src/company-brain/meet-transcript.mjs";

const orgId = process.env.ORG_ID || "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const MEET_Q = "trashed = false and (mimeType contains 'video/' or mimeType contains 'audio/')";

const cfg = driveConfigFromEnv(process.env);
if (!cfg.ready || cfg.authMode !== "oauth") {
  console.log(JSON.stringify({ ok: false, reason: "oauth_not_ready", auth: cfg.authMode || null }));
  process.exit(1);
}

const client = createDriveClientFromConfig(cfg);
let seen = 0;
let upserted = 0;
const t0 = Date.now();
for await (const meta of client.listAllFiles({ q: MEET_Q, pageSize: 100 })) {
  seen += 1;
  const extracted = await extractFromDriveFile(meta);
  const up = await upsertExtractedFile(db, { orgId, extracted, env: process.env, classify: false });
  if (up.ok) upserted += 1;
  if (seen % 10 === 0) {
    console.log(JSON.stringify({ listed: seen, upserted, ms: Date.now() - t0 }));
  }
}
console.log(JSON.stringify({ listed: seen, upserted, list_ms: Date.now() - t0 }));

const token = await client.getStartPageToken();
await saveSyncState(db, { orgId, pageToken: token, lastError: null });
const words = await processOrgMeetWords(db, { orgId, env: process.env });

const after = await db.query(
  `SELECT
     count(*) FILTER (WHERE needs_transcription)::int AS pending,
     count(*) FILTER (WHERE mime_type LIKE 'video/%' OR mime_type LIKE 'audio/%')::int AS av
     FROM brain_files WHERE org_id = $1`,
  [orgId]
);
const callWords = await db.query(
  `SELECT count(*)::int AS n FROM call_outcomes
    WHERE org_id = $1 AND transcript IS NOT NULL AND btrim(transcript) <> ''`,
  [orgId]
);
console.log(JSON.stringify({
  ok: true,
  words,
  files_after: after.rows?.[0] || null,
  calls_with_words: callWords.rows?.[0]?.n ?? null
}));
process.exit(0);

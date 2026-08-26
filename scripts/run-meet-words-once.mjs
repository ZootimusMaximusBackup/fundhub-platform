// One-shot: pull words for pending Meet files. Prints counts only. No names.
import { db } from "../src/db.mjs";
import { processOrgMeetWords } from "../src/company-brain/meet-transcript.mjs";

const orgId = process.env.ORG_ID || "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";

const pending = await db.query(
  `SELECT count(*)::int AS n
     FROM brain_files
    WHERE org_id = $1 AND needs_transcription = true`,
  [orgId]
);
const words = await db.query(
  `SELECT count(*)::int AS n
     FROM call_outcomes
    WHERE org_id = $1 AND transcript IS NOT NULL AND btrim(transcript) <> ''`,
  [orgId]
);

console.log(JSON.stringify({
  pending_before: pending.rows?.[0]?.n ?? null,
  calls_with_words_before: words.rows?.[0]?.n ?? null
}));

const out = await processOrgMeetWords(db, { orgId, env: process.env });
console.log(JSON.stringify({ pass: out }));

const pendingAfter = await db.query(
  `SELECT count(*)::int AS n
     FROM brain_files
    WHERE org_id = $1 AND needs_transcription = true`,
  [orgId]
);
const wordsAfter = await db.query(
  `SELECT count(*)::int AS n
     FROM call_outcomes
    WHERE org_id = $1 AND transcript IS NOT NULL AND btrim(transcript) <> ''`,
  [orgId]
);
console.log(JSON.stringify({
  pending_after: pendingAfter.rows?.[0]?.n ?? null,
  calls_with_words_after: wordsAfter.rows?.[0]?.n ?? null
}));
process.exit(0);

import { db } from "../../src/db.mjs";
import { pollAndMergeHubstaff } from "../../src/shifts/hubstaff-ingest.mjs";

export const SWEEP_CRON = "*/10 * * * *";

export async function sweepHubstaffPoll(dbConn, options = {}) {
  try {
    const out = await pollAndMergeHubstaff(dbConn, options);
    return { ok: true, ...out };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err).slice(0, 300) };
  }
}

export async function handler() {
  const result = await sweepHubstaffPoll(db);
  if (!result.ok) console.error(`[hubstaff-poll-sweeper] pass failed: ${result.error}`);
  else if (result.skipped && result.reason === "not_configured") { /* quiet */ }
  else if (result.merged > 0 || (result.fetch_errors && result.fetch_errors.length)) {
    console.log(`[hubstaff-poll-sweeper] merged=${result.merged} candidates=${result.candidates ?? 0}`);
  }
  return { statusCode: 200, body: JSON.stringify(result) };
}

export default handler;

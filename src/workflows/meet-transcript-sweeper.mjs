// Pull words off Meet recordings already in Drive.
// Pair a sibling Transcript / Gemini-notes doc. Do not invent a tape.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { sweepMeetTranscripts } from "../company-brain/meet-transcript.mjs";

export const SWEEP_CRON = "*/10 * * * *";

export async function handle({ db: database = db, step, env = process.env } = {}) {
  const run = step?.run
    ? (name, fn) => step.run(name, fn)
    : (_n, fn) => fn();
  return run("sweep-meet-words", () => sweepMeetTranscripts(database, { env }));
}

export const meetTranscriptSweeper = inngest.createFunction(
  { id: "meet-transcript-sweeper", name: "Meet transcript sweeper (Drive transcript words)" },
  { cron: SWEEP_CRON },
  async ({ step }) => handle({ db, step })
);

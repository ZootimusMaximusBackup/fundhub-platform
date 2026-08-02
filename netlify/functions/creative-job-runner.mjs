// Claims and runs queued creative generation_jobs on a clock.
// POST /api/creative/generate only enqueues; without this, jobs sit forever.

import { db } from "../../src/db.mjs";
import { runDue } from "../../src/creative/runner.mjs";

export const SWEEP_CRON = "*/2 * * * *";

export async function sweepCreativeJobs(dbConn, options = {}) {
  try {
    const out = await runDue(dbConn, options);
    const succeeded = (out.jobs || []).filter((j) => j.status === "succeeded").length;
    const failed = (out.jobs || []).filter((j) => j.status === "failed").length;
    const queued = (out.jobs || []).filter((j) => j.status === "queued").length;
    return {
      ok: true,
      partners: out.partners,
      ran: (out.jobs || []).length,
      succeeded,
      failed,
      requeued: queued
    };
  } catch (err) {
    return {
      ok: false,
      error: String((err && err.message) || err).slice(0, 300)
    };
  }
}

export async function handler() {
  const result = await sweepCreativeJobs(db);
  if (!result.ok) {
    console.error(`[creative-job-runner] pass failed: ${result.error}`);
  } else if (result.ran > 0) {
    console.log(
      `[creative-job-runner] partners=${result.partners} ran=${result.ran} ` +
        `ok=${result.succeeded} fail=${result.failed} requeue=${result.requeued}`
    );
  }
  return { statusCode: 200, body: JSON.stringify(result) };
}

export default handler;

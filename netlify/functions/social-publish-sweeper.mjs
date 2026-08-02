// The thing that actually publishes due social_posts once scheduled_for arrives.
//
// POST /api/social/schedule only queues. Without this cron, a queued post sits
// forever — the same hole staff-message-sweeper closed for held SMS. Adapters
// register via src/social/adapters.mjs; live Graph calls need channel tokens,
// otherwise SOCIAL_PUBLISH_DRY_RUN=1 marks posted with a dryrun: id for tests.

import { db } from "../../src/db.mjs";
import { publishDueAll } from "../../src/social/publish-all.mjs";

export const SWEEP_CRON = "*/5 * * * *";

export async function sweepSocialPublish(dbConn, options = {}) {
  try {
    const out = await publishDueAll(dbConn, options);
    let posted = 0;
    let failed = 0;
    for (const batch of out.batches || []) {
      for (const r of batch.results || []) {
        if (r.ok) posted += 1;
        else if (r.ok === false) failed += 1;
      }
    }
    return { ok: true, partners: out.partners, posted, failed, batches: out.batches };
  } catch (err) {
    return {
      ok: false,
      error: String((err && err.message) || err).slice(0, 300)
    };
  }
}

export async function handler() {
  const result = await sweepSocialPublish(db);
  if (!result.ok) {
    console.error(`[social-publish-sweeper] pass failed: ${result.error}`);
  } else if (result.posted > 0 || result.failed > 0) {
    console.log(
      `[social-publish-sweeper] partners=${result.partners} posted=${result.posted} failed=${result.failed}`
    );
  }
  return { statusCode: 200, body: JSON.stringify(result) };
}

export default handler;

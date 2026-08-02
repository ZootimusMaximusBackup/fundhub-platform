// publishDueAll — walk every partner with due queued posts and publish them.
// Used by the Netlify social-publish-sweeper cron and POST /api/social/publish.

import { publishDue, registerAdapter } from "./scheduler.mjs";
import { registerDefaultAdapters } from "./adapters.mjs";

let wired = false;
export function ensureSocialAdapters() {
  if (wired) return;
  registerDefaultAdapters(registerAdapter);
  wired = true;
}

/**
 * publishDueAll(db, { now, limitPartners }) → { partners, batches }
 */
export async function publishDueAll(db, { now = null, limitPartners = 50 } = {}) {
  ensureSocialAdapters();

  const partners = await db.query(
    `SELECT DISTINCT p.partner_id, p.org_id
       FROM social_posts p
      WHERE p.status = 'queued'
        AND p.scheduled_for IS NOT NULL
        AND p.scheduled_for <= COALESCE($1::timestamptz, now())
      LIMIT $2`,
    [now, limitPartners]
  );

  const batches = [];
  for (const row of partners.rows) {
    const results = await publishDue(db, {
      orgId: row.org_id,
      partnerId: row.partner_id,
      now
    });
    batches.push({ partner_id: row.partner_id, results });
  }
  return { partners: partners.rows.length, batches };
}

export default { publishDueAll, ensureSocialAdapters };

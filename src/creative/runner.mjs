// Creative job runner — claim + run queued generation_jobs.
// Called by the Netlify creative-job-runner cron and POST /api/creative/run.

import { withPartnerScope } from "../partners/rls.mjs";
import { claim, run } from "./generate.mjs";

/**
 * runDue(db, { limitPartners, maxJobsPerPartner }) → { partners, jobs }
 */
export async function runDue(db, { limitPartners = 25, maxJobsPerPartner = 3 } = {}) {
  const partners = await db.query(
    `SELECT partner_id, org_id FROM (
       SELECT DISTINCT ON (partner_id) partner_id, org_id, created_at
         FROM generation_jobs
        WHERE status = 'queued'
        ORDER BY partner_id, created_at
     ) q
     ORDER BY created_at
     LIMIT $1`,
    [limitPartners]
  );

  const jobs = [];
  for (const row of partners.rows) {
    const batch = await withPartnerScope(
      { kind: "partner", partnerId: row.partner_id },
      async (tx) => {
        const out = [];
        for (let i = 0; i < maxJobsPerPartner; i++) {
          const job = await claim(tx, { partnerId: row.partner_id });
          if (!job) break;
          out.push(await run(tx, job));
        }
        return out;
      }
    );
    for (const r of batch) jobs.push({ partner_id: row.partner_id, ...r });
  }
  return { partners: partners.rows.length, jobs };
}

export default { runDue };

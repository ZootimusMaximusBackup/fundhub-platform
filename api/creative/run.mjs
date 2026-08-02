// POST /api/creative/run — claim and run queued generation jobs for a partner
// (or all partners with due work when staff omits partner_id and passes all=1).
// The Netlify creative-job-runner cron calls the same runDue path on a schedule.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { withPartnerScope } from "../../src/partners/rls.mjs";
import { resolvePartnerId } from "../../src/http/partner-read-api.mjs";
import { claim, run } from "../../src/creative/generate.mjs";
import { runDue } from "../../src/creative/runner.mjs";
import { safeError } from "../../src/http/health.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const principal = await requirePrincipal(req, res, ["partner", "staff"], { db });
  if (!principal) return;

  const body = req.body || {};
  const maxJobs = Math.min(10, Math.max(1, Number(body.max_jobs) || 3));

  try {
    if (body.all === true || body.all === 1 || body.all === "1") {
      if (principal.kind !== "staff") {
        return res.status(403).json({ ok: false, error: "staff_only_for_all" });
      }
      const out = await runDue(db, { maxJobsPerPartner: maxJobs });
      return res.status(200).json({ ok: true, ...out });
    }

    const partnerId = resolvePartnerId(principal, {
      partner_id: body.partner_id || (req.query || {}).partner_id
    });
    if (!partnerId) {
      return res.status(400).json({ ok: false, error: "partner_id_required" });
    }

    const jobs = await withPartnerScope({ kind: "partner", partnerId }, async (tx) => {
      const out = [];
      for (let i = 0; i < maxJobs; i++) {
        const job = await claim(tx, { partnerId });
        if (!job) break;
        out.push({ job_id: job.id, ...(await run(tx, job)) });
      }
      return out;
    });

    return res.status(200).json({
      ok: true,
      ran: jobs.length,
      jobs,
      note: jobs.length
        ? undefined
        : "no queued jobs (or concurrency cap reached) — enqueue first, then run"
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}

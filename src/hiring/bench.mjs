// The always-on bench monitor.
//
// This is the module that makes the pipeline "always-on" rather than reactive, and
// it exists because doc 10 names the failure directly:
//
//   "If you only recruit when you're in NEED you're more likely to 1) have lower
//    standards thus get less quality recruits 2) have higher neediness and
//    tolerate less than acceptable performance from salespeople (because YOU need
//    THEM)."
//
//   "You should always be recruiting and filling your sales hiring pipeline…
//    Ideally have 4-5 potential reps on your bench. This allows you to easily
//    remove & replace underperformers without getting emotionally involved or
//    having sunk cost."
//
// So the bench target is a first-class configured number per role
// (hiring_roles.bench_target, default 4), and falling below it opens a task. The
// alternative — noticing you are short when someone quits — is precisely the
// neediness the doc warns about.
//
// WHAT COUNTS AS BENCH. Only candidates past the group interview: at 1:1 or offer.
// Counting everyone who applied would report a healthy bench built from unscreened
// applications, which is the same as having no bench and believing you do.
// v_hiring_bench in 051 is where that definition lives, once.

import { createTask } from "../lib/create-task.mjs";

/* checkBench(tx, { orgId }) → { roles[], shortfalls[] }

   Idempotent per role per day: the task dedupe key includes the date, so running
   this hourly does not produce twenty tasks. */
export async function checkBench(tx, { orgId, today = null } = {}) {
  if (!orgId) throw new Error("checkBench: orgId is required");

  const { rows } = await tx.query(
    `SELECT role_id, role_key, role_name, bench_target, bench_count, bench_shortfall,
            open_applications, hiring_manager_staff_id
       FROM v_hiring_bench WHERE org_id = $1 ORDER BY role_key`, [orgId]);

  const shortfalls = [];
  for (const r of rows) {
    if (r.bench_shortfall <= 0) continue;

    // The date is in the dedupe key so a re-run today is a no-op and tomorrow's
    // run raises it again if still short.
    const day = (today ? new Date(today) : new Date()).toISOString().slice(0, 10);

    const task = await safeTask(tx, {
      orgId,
      title: `Bench short for ${r.role_name}: ${r.bench_count} of ${r.bench_target}`,
      body: `hiring:bench:${r.role_key}:${day}`,
      sourceWorkflow: "hiring-bench-monitor",
      // Routed to the role's hiring manager when there is one; the assigneeRole is
      // still required by createTask, so admin is the queue and the staff id is
      // the claim.
      assigneeRole: "admin",
      assigneeStaffId: r.hiring_manager_staff_id || null
    });

    shortfalls.push({
      role_key: r.role_key,
      bench_count: r.bench_count,
      bench_target: r.bench_target,
      shortfall: r.bench_shortfall,
      open_applications: r.open_applications,
      task_created: task.created === true,
      // Surfaced rather than swallowed: a bench alert with nobody to route to is
      // the gap v_hiring_config_gaps also reports.
      unrouted: !r.hiring_manager_staff_id
    });
  }

  return { roles: rows, shortfalls };
}

/* rampReview(tx, { orgId }) → due[]

   Doc 14 (Ramp Up & When To Fire) and doc 10's funnel both put a 60-day trial
   after onboarding. This finds applications sitting in `ramp` past the window and
   queues the review.

   It does NOT decide anything. "When to fire" is a human judgement about a person
   already employed, and the same rule that stops software rejecting a candidate
   applies with more force to someone on the payroll. */
export async function rampReview(tx, { orgId, trialDays = 60, today = null } = {}) {
  const { rows } = await tx.query(
    `SELECT a.id AS application_id, a.entered_stage_at, c.full_name, r.key AS role_key,
            r.hiring_manager_staff_id,
            (COALESCE($3::date, CURRENT_DATE) - a.entered_stage_at::date) AS days_in_ramp
       FROM candidate_applications a
       JOIN candidates c ON c.id = a.candidate_id
       JOIN hiring_roles r ON r.id = a.role_id
       JOIN pipeline_stages s ON s.id = a.stage_id
      WHERE a.org_id = $1 AND a.status = 'open' AND s.key = 'ramp'
        AND (COALESCE($3::date, CURRENT_DATE) - a.entered_stage_at::date) >= $2`,
    [orgId, trialDays, today]);

  const due = [];
  for (const r of rows) {
    const task = await safeTask(tx, {
      orgId,
      title: `${trialDays}-day trial review due: ${r.full_name} (${r.role_key})`,
      body: `hiring:ramp-review:${r.application_id}`,
      sourceWorkflow: "hiring-ramp-review",
      assigneeRole: "admin",
      assigneeStaffId: r.hiring_manager_staff_id || null
    });
    due.push({
      application_id: r.application_id,
      days_in_ramp: Number(r.days_in_ramp),
      task_created: task.created === true
    });
  }
  return due;
}

/* safeTask — a monitor must never be the reason a transaction fails.
   body is passed explicitly because createTask dedupes on it, and the date-scoped
   key is what makes these jobs safe to run on a short interval. */
async function safeTask(tx, spec) {
  try {
    return await createTask(tx, { clientId: null, ...spec });
  } catch (err) {
    return { created: false, reason: `task_failed: ${String(err.message).slice(0, 120)}` };
  }
}

export default { checkBench, rampReview };

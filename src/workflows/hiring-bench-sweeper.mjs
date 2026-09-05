// The hiring bench sweeper — the clock behind "we need to be hiring someone".
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS FILE EXISTS AT ALL
//
// Two mechanisms in this repo answer the question "should we be recruiting right
// now", and until this file neither of them was ever asked. Not "asked and said
// no" — never asked. Both were written, both were tested, and nothing ran either
// one on a schedule:
//
//   1. src/hiring/bench.mjs  checkBench()   — the bench is below target.
//      Registered nowhere. Reachable only through GET /api/hiring/bench, a
//      read-only screen that docs/WIRING-AUDIT.md records as never called by any
//      front end (line L1: "zero fetch calls anywhere in the file").
//
//   2. src/ops/hire-closer.mjs  actOnPacked() — the closer calendar is packed.
//      Reachable only through POST /api/ops/hire-closer, i.e. a human deciding to
//      press a button, which is the one situation in which nobody needs telling.
//
// So the always-on recruiting pipeline that src/hiring/bench.mjs's own header
// argues for was, in practice, entirely on-demand.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY checkBench GETS THE CLOCK AND actOnPacked DOES NOT
//
// They are not two implementations of one idea, and they do not compose into one
// scheduled job. They answer different questions from different sides:
//
//   checkBench   asks about SUPPLY  — how many screened people are on the bench.
//   actOnPacked  asks about DEMAND  — how full the closers' calendar is.
//
// Four reasons the supply question is the one that belongs on a timer, and the
// demand one does not:
//
//   * ABSENCE NEVER FIRES. A thin bench is not an event. Nobody does anything and
//     the number quietly sits below target — which is exactly the failure doc 10
//     names and bench.mjs quotes at length: you notice you are short when someone
//     quits, and then you hire needy. Something has to come back and look. This is
//     the same argument message-dispatch-sweeper.mjs makes for a deferred text and
//     partner-production-floor.mjs makes for a partner who stops producing.
//
//   * checkBench COVERS EVERY ROLE. It reads v_hiring_bench, which is every active
//     row in hiring_roles. actOnPacked is hardcoded to the closer seat and to the
//     closer seat only, so scheduling it would leave every other req unwatched.
//
//   * ROUTING. checkBench sends each alert through src/hiring/owner.mjs
//     assigneeFor(), which is where the owner's actual rule lives after migration
//     294 — sales seats to the sales manager, everything else to the owner.
//     actOnPacked routes through createCsuiteTask(), which is a fixed destination.
//     A scheduled job that bypasses the routing resolver would put us straight
//     back in the one-queue-for-everything state 294 was written to end.
//
//   * actOnPacked TRANSMITS. Every packed run also calls postCloserLinkedIn(),
//     which writes a hiring_job_postings row and hands it to src/hiring/linkedin.mjs
//     postJob(). There is no LinkedIn partner access, so that call cannot succeed;
//     putting it on a clock would mean a job that fails a little every day, and a
//     scheduled job whose failure is expected is a scheduled job nobody reads. It
//     also crosses the owner's line for automated work — the brain writes tasks,
//     humans act — because posting a job advert is an act, not a note.
//
// So actOnPacked stays exactly where it is: behind the button, human-initiated,
// unchanged by this file. This sweeper does not call it, import it, or depend on
// anything it does. If the packed signal should ever also be on a clock, the
// honest version of that change is to split the LinkedIn half out of it first —
// that is a separate piece of work and is written down rather than done here.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT ONE PASS ACTUALLY DOES, AND WHAT IT CANNOT DO
//
// It reads the bench per role per company and opens a task when a role is short.
// That is the whole of it. It:
//
//   * WRITES TASKS AND NOTHING ELSE. No candidate is contacted, advanced, ranked,
//     scored or rejected — 051's CHECK and trigger forbid a software rejection
//     outright, and nothing here goes near a candidate row in any case. No job is
//     posted anywhere. Nothing is emailed or texted: this file imports nothing
//     from src/messaging.
//   * CANNOT DOUBLE UP. checkBench puts the calendar date in the task's dedupe key
//     and createTask dedupes on (client_id, source_workflow, body) against 006's
//     unique index, so a re-run, a retry, or a manual run on the same day is a
//     no-op. One task per role per day is the ceiling, whatever the schedule.
//   * NEVER THROWS. One company's failure must not take the pass down: the other
//     companies are still worked and the error is recorded against the org that
//     produced it. The next day's run is the recovery — the shortfall is still
//     there and still unreported.
//
// The daily cadence is the point rather than an interval that happened to be
// picked. A bench moves at the speed of interviews, so asking more often finds the
// same answer and (because of the date key) writes nothing extra; asking less
// often means a role can sit short for a week with nobody told.
//
// 13:30 UTC is 07:30 in America/Denver during MDT and 06:30 during MST, so the
// run lands on the same calendar day in both zones AND is comfortably inside the
// UTC day. That matters more than it looks: checkBench's dedupe key is the UTC
// date, so a job scheduled near midnight UTC would drift across the date boundary
// twice a year and quietly write two tasks for one working day.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { checkBench } from "../hiring/bench.mjs";

/** Once a day, 13:30 UTC. See the header for why daily and why this hour. */
export const SWEEP_CRON = "30 13 * * *";

export const SOURCE_WORKFLOW = "hiring-bench-sweeper";

/* The task rows this job produces carry checkBench's source_workflow, not this
   file's. They are the bench monitor's tasks — this file is the clock. Exported
   so a reader looking for "what does the sweeper create" is not left guessing,
   and so the test can assert the two are deliberately different. */
export const TASK_SOURCE_WORKFLOW = "hiring-bench-monitor";

/* orgsWithHiringRoles — every company with at least one live req.
   Matched to v_hiring_bench's own WHERE clause (r.active), so the enumeration and
   the view cannot disagree about which companies are in scope. A company with no
   active req is not "healthy" or "unhealthy", it is simply not hiring, and it
   should cost nothing. */
export async function orgsWithHiringRoles(conn) {
  const { rows } = await conn.query(
    `SELECT DISTINCT org_id FROM hiring_roles WHERE active ORDER BY org_id`);
  return rows.map((r) => r.org_id);
}

/**
 * sweep — one pass.
 *
 * `db`, the clock and the org filter are all arguments, so the tests drive it
 * without Inngest and without a scheduler — the same shape as
 * message-dispatch-sweeper and partner-production-floor.
 *
 * @param {{query: Function}} conn
 * @param {{orgId?: string|null, now?: Date|string|null}} [options]
 * @returns {Promise<{ok: boolean, orgs: number, roles: number, short: number,
 *   tasks_created: number, unrouted: number, failed: number, per: Array, error?: string}>}
 */
export async function sweep(conn, options = {}) {
  const { orgId = null, now = null } = options;

  /* checkBench takes `today` as a date it will slice to YYYY-MM-DD. Resolving it
     once here rather than letting each org call new Date() means every company in
     one pass is keyed to the same day, even if the pass straddles midnight. */
  const today = (now ? new Date(now) : new Date()).toISOString().slice(0, 10);

  const tally = {
    ok: true, orgs: 0, roles: 0, short: 0, tasks_created: 0, unrouted: 0,
    failed: 0, per: []
  };

  let orgs;
  try {
    orgs = orgId ? [orgId] : await orgsWithHiringRoles(conn);
  } catch (err) {
    return { ...tally, ok: false, error: String((err && err.message) || err).slice(0, 300) };
  }

  tally.orgs = orgs.length;

  for (const org of orgs) {
    let result;
    try {
      result = await checkBench(conn, { orgId: org, today });
    } catch (err) {
      tally.failed += 1;
      tally.per.push({
        orgId: org, ok: false, roles: 0, short: 0, tasks_created: 0, unrouted: 0,
        error: String((err && err.message) || err).slice(0, 300)
      });
      continue;
    }

    const short = result.shortfalls || [];
    const created = short.filter((s) => s.task_created).length;
    const unrouted = short.filter((s) => s.unrouted).length;

    tally.roles += (result.roles || []).length;
    tally.short += short.length;
    tally.tasks_created += created;
    tally.unrouted += unrouted;
    tally.per.push({
      orgId: org,
      ok: true,
      roles: (result.roles || []).length,
      short: short.length,
      tasks_created: created,
      /* "unrouted" means no PERSON owns it — a role queue did pick it up. It is
         reported because a req nobody is individually accountable for is the one
         that sits, not because the alert went nowhere. src/hiring/owner.mjs's
         header carries the full distinction. */
      unrouted,
      shortfalls: short
    });
  }

  return tally;
}

/* handle — the shape src/journeys/runner/registry.mjs expects of every registered
   workflow, so "every registered workflow is callable" stays true rather than this
   one becoming the exception that softens the rule.

   It has no event trigger (it is a cron), so no journey reaches it and it will
   always appear in the runner's neverFired list. That is the correct outcome for a
   scheduled job, not a coverage hole. */
export async function handle({ db: handleDb, step } = {}) {
  const run = () => sweep(handleDb || db);
  return step && typeof step.run === "function" ? step.run("sweep", run) : run();
}

export const hiringBenchSweeper = inngest.createFunction(
  { id: "hiring-bench-sweeper", name: "Hiring bench sweeper" },
  { cron: SWEEP_CRON },
  () => sweep(db)
);

export default sweep;

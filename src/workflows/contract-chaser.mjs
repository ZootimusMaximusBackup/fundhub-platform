// The contract chaser — remind the person holding up a contract, and put it on
// somebody's list.
//
// ═══════════════════════════════════════════════════════════════════════════
// THIS ONE IS REGISTERED, UNLIKE THE DISPATCH SWEEPER NEXT DOOR — and the
// difference is worth stating, because that file's header argues at length that
// defining an Inngest function must not be the same act as switching sending on.
//
// It still is not. Two things are true at once:
//
//   * Registering this function does NOT make it run. Inngest invokes nothing
//     until INNGEST_EVENT_KEY is set, which CLAUDE.md §11 reserves to the owner.
//     The registry is a declaration of what exists, not a switch.
//   * The sweeper stays out of the registry because it drains the WHOLE queue —
//     every message from all 47 workflows. This one touches contracts and
//     nothing else. Different blast radius, different decision.
//
// AND IT DOES NOT NEED INNGEST TO BE USEFUL TODAY. `runChase()` below is a plain
// function. /api/contracts { action: "run_reminders" } calls it, so an owner can
// press a button, or point any external scheduler at that endpoint, right now.
// When the Inngest key is eventually set, the same function starts running on
// its own with nothing else to change.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT IT ACTUALLY DOES
//
//   1. Finds contracts that were SENT, are still unsigned, and have had no
//      activity for FIRST_CHASE_DAYS.
//   2. Mints a FRESH link for whoever's turn it is — a reminder carrying a link
//      that is about to expire is worse than no reminder.
//   3. Queues the reminder email and hands it to the dispatcher.
//   4. Creates a TASK for the staff member who sent it.
//
// Step 4 is the one that matters most and is the easiest to leave out. An
// automated nudge nobody on the team ever sees is how a deal quietly dies; the
// task is what eventually puts a person on the phone.
//
// IT STOPS. MAX_CHASES reminders, then it leaves them alone and the task is the
// only thing left. A system that emails somebody forever is a system people
// filter, and the filter costs more than the deal.

import { inngest } from "./client.mjs";
import { db as defaultDb } from "../db.mjs";
import { chaseContracts, FIRST_CHASE_DAYS, CHASE_EVERY_DAYS, MAX_CHASES } from "../contracts/notify.mjs";
import { listSigners } from "../contracts/signers.mjs";
import { mintLinks } from "../contracts/send.mjs";

/* Once a day, mid-morning UTC. Not hourly: nothing about an unsigned contract
   changes fast enough to be worth a check every hour, and a reminder that can
   arrive at 3am is a reminder somebody resents. The dispatcher's own quiet-hours
   rule applies underneath this as well. */
export const CHASE_CRON = "0 10 * * *";

/**
 * runChase — the whole sweep, for one org. Plain function, no Inngest.
 *
 * Exported so the endpoint, the tests and the scheduled function all drive the
 * SAME code. A scheduled job whose logic exists only inside the scheduler is a
 * job nobody can test or run by hand.
 */
export async function runChase(db, {
  orgId, afterDays = FIRST_CHASE_DAYS, everyDays = CHASE_EVERY_DAYS,
  maxChases = MAX_CHASES, limit = 100, now = null, baseUrl = null, secret = undefined
} = {}) {
  if (!orgId) throw new Error("runChase: orgId is required");
  return chaseContracts(db, {
    orgId, listSigners, mintLinks,
    afterDays, everyDays, maxChases, limit, now, baseUrl, secret
  });
}

/** Every org with a contract outstanding. The scheduled run has no session to
    take an org from, so it finds them rather than assuming the default one. */
export async function orgsWithOutstandingContracts(db) {
  const { rows } = await db.query(
    `SELECT DISTINCT org_id FROM contracts WHERE status IN ('sent', 'viewed')`);
  return rows.map((r) => r.org_id);
}

export async function handle({ db, step }) {
  const orgs = await step.run("find-orgs", () => orgsWithOutstandingContracts(db));
  const results = [];
  for (const orgId of orgs) {
    // One step per org, so a failure on one company's contracts does not stop
    // the sweep for the rest — and so a retry replays only what failed.
    results.push(await step.run(`chase-${orgId}`, () => runChase(db, { orgId })));
  }
  return {
    orgs: orgs.length,
    reminded: results.reduce((a, r) => a + (r.reminded || 0), 0),
    tasked: results.reduce((a, r) => a + (r.tasked || 0), 0)
  };
}

export const contractChaser = inngest.createFunction(
  { id: "contract-chaser", name: "Contracts — chase unsigned" },
  { cron: CHASE_CRON },
  ({ step }) => handle({ db: defaultDb, step })
);

export default contractChaser;

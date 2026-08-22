// BS-01 — Pre-Call Backend Launcher.
// Source: GHL-System-Map.md BACK-END SELLING section.
// Merges in BS-EMAIL-FUNDING-72HR (live) and BS-EMAIL-REPAIR-72HR (live): both are
// "Add to workflow" targets BS-01 enrolls into, not independently-triggered
// workflows, so they're one continuous flow here rather than three separate files.
// The [AGENT DRAFT] BS-EMAIL-FUNDING-72HR duplicate (identical subjects, same
// sequence) is RETIRED per spec §6's explicit note — this ports the "(live)" copy.
//
// CADENCE — the source is a DAY × SLOT grid, not a flat interval.
// The first port spaced every send 4h apart, which collapsed a three-day sequence
// into a 16-hour burst. Corrected here to the source shape:
//
//   D1-E1 Kickoff → wait → RECHECK (exit gate) → then, per day, four sends at
//   named slots: morning (E2), midday (E3), afternoon (E4), evening (E5),
//   repeating across D1, D2, D3.
//
// That is the D1-D3 × E1-E6 grid the docs repo keys against: three day rows, six
// slot columns = 18 cells. E1 is the kickoff column (only D1's is written), E2-E5
// are the four daily sends, E6 is spare. The docs currently carry copy for 11 of
// the 18; the other 7 — including D2-E1 and D3-E1 — are empty cells, not absent ones.
//
// The 7 empty cells are NOT filled in here. Copy is never invented (the same rule
// sendTemplated already holds). The grid is addressed in full and each cell is
// resolved against message_templates at send time — a cell with no row is skipped
// and reported in `gaps`, so the missing 7 surface as data rather than being
// silently baked into a shorter array.
//
// KEY NAMING: `BS-FUND-{day}-{slot}-{name}` / `BS-REPAIR-{day}-{slot}-{name}`
// (Darwin, from the docs repo — e.g. BS-FUND-D1-E1-morning). The trailing `-{name}`
// word varies per cell and is NOT reconstructable from the grid position, so cells
// are resolved by `{prefix}-{day}-{slot}-%` prefix match rather than by guessing
// the suffix. parse-email.mjs seeds template_key from the docs header verbatim, so
// these match exactly as the docs spell them — with no "EMAIL-" prefix, which the
// previous port invented and which never existed in the source.
//
// TIMING: booking.created carries no local-time anchor, so slot times are relative
// offsets, not wall-clock. Each day row totals 24h (12+1+3+3+4+1), so the whole
// sequence lands inside the source's 72-hour window — kickoff at t=0, last cell at
// t=+71h. A timing choice, logged in workflow-migration-table.md, not a business rule.
//
// RECHECK: the source's Gate 2 is an Exit, not a branch. BS-01 is pre-call material
// ("watch these before our call"), so once the call has been HELD the remaining
// content is stale and sending it is worse than sending nothing. The gate therefore
// tests call-held — DPC-02's `callHappened` (a `call.completed` event for this
// client), single-sourced from the workflow that owns the concept — and NOT
// cf_analyzer_recommendation, which is only written DURING the call and would
// therefore pass on exactly the wrong side. Checked at every wake, not only after
// the kickoff, because the sequence spans ~71 hours and the call normally lands
// inside it; a gate that fired once at t=+12h would still send 14 stale touches.
//
// Trigger: booking.created. Gate: product path decides which EMAIL drip runs
// (Funding vs Repair) — Rule 4-compliant (categorical path, not a dollar amount).
// SMS companion (owner 2026-08-15): three texts for every booking, no video links,
// parallel with the email drip, same call-held exit.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { clientOutcomeTier, isFundingPath, isRepairOnlyPath } from "../config/product-path.mjs";
import { callHappened } from "./dpc-02-call-outcome-enforcement.mjs";
import { sendTemplated } from "./messaging.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { addTags } from "./tags.mjs";

export const FUNDING_PREFIX = "BS-FUND";
export const REPAIR_PREFIX = "BS-REPAIR";

// Thin SMS companion (owner 2026-08-15): pre-call touches, no video links, not the
// email 18-cell grid. One set for every booked contact — path split is email-only.
// 2026-08-22: the immediate booked text moved to S-04B (see runSmsDrip).
// RETIRED 2026-08-22 — S-04B owns the immediate booked text. Kept for the
// seed/audit trail; no send site references it.
export const SMS_BS01_BOOKED = "SMS-BS01-01-BOOKED";
export const SMS_BS01_PRECALL = "SMS-BS01-02-PRECALL";
// RETIRED 2026-08-22 — S-04B's SMS-S04-03-REMIND-2H owns the T-2h slot (same
// sleepUntil target). Kept for the seed/audit trail; no send site references it.
export const SMS_BS01_DAYOF = "SMS-BS01-03-DAYOF";
export const SMS_PRECALL_WAIT = "24h";
export const SMS_DAYOF_OFFSET_MS = 2 * 60 * 60 * 1000;

export const DAYS = ["D1", "D2", "D3"];

// The kickoff column. In practice the docs only carry copy for D1-E1 — the
// enrollment touch — but D2-E1 and D3-E1 are real cells of the grid and are
// addressed like any other; they are simply two of the seven that are empty today.
export const KICKOFF_SLOT = "E1";

// Wait between the kickoff and the first recheck + morning send. Puts D1's morning
// touch on the morning after enrollment for a same-day booking.
export const KICKOFF_WAIT = "12h";

// The six slot columns. `after` is the wait BEFORE that cell, measured from the
// previous cell in the sequence. 12+1+3+3+4+1 = 24h, so each day row starts exactly
// one day after the last and the E6→E1 gap is the overnight roll. D1 is the one
// exception: its E1 fires immediately on enrollment and its E2 is preceded by
// KICKOFF_WAIT rather than the 1h intra-day step.
export const SLOT_COLUMNS = [
  { slot: "E1", name: "kickoff", after: "12h" },
  { slot: "E2", name: "morning", after: "1h" },
  { slot: "E3", name: "midday", after: "3h" },
  { slot: "E4", name: "afternoon", after: "3h" },
  { slot: "E5", name: "evening", after: "4h" },
  { slot: "E6", name: "spare", after: "1h" }
];

// The four named daily sends — the "four sends per day" the source describes.
export const DAILY_SLOTS = ["E2", "E3", "E4", "E5"];

export const SLOTS = SLOT_COLUMNS.map((s) => s.slot);

/**
 * Every cell of the 3x6 grid, in send order, each with the wait that precedes it.
 *
 * `gate` marks the cells whose wake re-tests call-held: everything except the
 * kickoff itself, which fires on enrollment before any gate exists.
 */
export function gridCells(prefix) {
  const cells = [];
  for (const day of DAYS) {
    for (const s of SLOT_COLUMNS) {
      let after = s.after;
      // D1 is anchored to enrollment: E1 fires at once, E2 waits out KICKOFF_WAIT.
      if (day === "D1" && s.slot === "E1") after = null;
      else if (day === "D1" && s.slot === "E2") after = KICKOFF_WAIT;

      cells.push({
        day, slot: s.slot, name: s.name, after,
        gate: !(day === "D1" && s.slot === "E1"),
        keyPrefix: `${prefix}-${day}-${s.slot}`
      });
    }
  }
  return cells;
}

/**
 * Resolve a grid cell to the exact template_key the docs seeded for it.
 *
 * Matched on `{prefix}-{day}-{slot}-%` because the trailing name word is the docs'
 * own and is not derivable from the grid position. Returns null when the cell has
 * no copy — the expected state for 7 of the 18 cells, reported and never filled in.
 */
export async function resolveCellKey(db, orgId, keyPrefix) {
  const r = await db.query(
    `SELECT template_key FROM message_templates
      WHERE org_id = $1 AND template_key LIKE $2 AND compliance_passed = true
      ORDER BY template_key LIMIT 1`,
    [orgId, `${keyPrefix}-%`]
  );
  return r.rows[0]?.template_key || null;
}

async function runDrip({ db, step, orgId, clientId, eventId, prefix }) {
  const sent = [];
  const gaps = [];

  for (const cell of gridCells(prefix)) {
    if (cell.after) await step.sleep(`wait-${cell.day}-${cell.slot}`, cell.after);

    if (cell.gate) {
      const held = await step.run(`recheck-${cell.day}-${cell.slot}`, () => callHappened(db, clientId));
      if (held) return { sent, gaps, stoppedAt: `${cell.day}-${cell.slot}`, stoppedBecause: "call_held" };
    }

    const key = await step.run(`resolve-${cell.day}-${cell.slot}`, () => resolveCellKey(db, orgId, cell.keyPrefix));
    if (!key) {
      gaps.push({ day: cell.day, slot: cell.slot, name: cell.name, keyPrefix: cell.keyPrefix });
      continue;
    }

    const res = await step.run(`send-${cell.day}-${cell.slot}`, () =>
      sendTemplated(db, { orgId, clientId, channel: "email", templateKey: key, eventId: `${eventId}:${cell.day}:${cell.slot}` }));
    sent.push({ day: cell.day, slot: cell.slot, templateKey: key, ...res });
    await step.run(`stamp-last-sent-${cell.day}-${cell.slot}`, () =>
      mergeCustomFields(db, clientId, { bs_email_last_sent_ts: new Date().toISOString() }));
  }

  return { sent, gaps, stoppedAt: null, stoppedBecause: null };
}

/**
 * Pre-call SMS touches for every booked contact. Independent of funding/repair
 * email path. Stops when the call is held (same gate as the email drip).
 */
async function runSmsDrip({ db, step, orgId, clientId, eventId, startTime }) {
  const sent = [];

  // Owner decision 2026-08-22: the immediate "you're booked" text is S-04B's
  // (SMS-S04-01-CONFIRM) alone. Both workflows listen to booking.created, so
  // sending SMS-BS01-01-BOOKED here double-texted every booking. BS-01 now owns
  // only the later pre-call and day-of touches. The key stays exported and the
  // template stays seeded — nothing sends it.
  await step.sleep("wait-sms-precall", SMS_PRECALL_WAIT);
  const heldPrecall = await step.run("recheck-sms-precall", () => callHappened(db, clientId));
  if (heldPrecall) {
    return { sent, stoppedAt: "sms-precall", stoppedBecause: "call_held", skippedDayOf: null };
  }

  const precall = await step.run("send-sms-precall", () =>
    sendTemplated(db, {
      orgId, clientId, channel: "sms", templateKey: SMS_BS01_PRECALL,
      eventId: `${eventId}:sms:precall`
    }));
  sent.push({ templateKey: SMS_BS01_PRECALL, ...precall });
  if (precall.sent) {
    await step.run("stamp-sms-precall", () =>
      mergeCustomFields(db, clientId, { bs_sms_last_sent_ts: new Date().toISOString() }));
  }

  // Owner decision 2026-08-22 (confirmed against the 2026-08-20 live template
  // dump): the T-2h day-of text is S-04B's alone (SMS-S04-03-REMIND-2H,
  // s-04b-booking-reminders.mjs). Both workflows target the identical
  // sleepUntil(startTime - 2h) moment, so every booking with a start time was
  // getting two near-identical "your call is coming up" texts back to back.
  // BS-01 now stops after the +24h precall touch. SMS_BS01_DAYOF stays exported
  // and the template stays seeded; nothing sends it.
  return { sent, stoppedAt: null, stoppedBecause: null, skippedDayOf: startTime ? "owned_by_s04b" : "no_start_time" };
}

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const orgId = event.orgId;
  const eventId = event.id;
  await step.run("tag-precall", () => addTags(db, clientId, ["bs:precall"]));
  await step.run("set-precall-start", () => mergeCustomFields(db, clientId, { bs_precall_start_ts: new Date().toISOString() }));

  const outcomeTier = await step.run("check-product-path", () => clientOutcomeTier(db, clientId));

  // SMS for every booking. Start before (or beside) the email drip so the
  // email kickoff is not delayed by SMS sleeps.
  const smsPromise = runSmsDrip({
    db, step, orgId, clientId, eventId,
    startTime: event.payload?.startTime || null
  });

  let prefix;
  let drip;
  if (isFundingPath(outcomeTier)) { prefix = FUNDING_PREFIX; drip = "funding"; }
  else if (isRepairOnlyPath(outcomeTier)) { prefix = REPAIR_PREFIX; drip = "repair"; }
  else {
    const sms = await smsPromise;
    return { done: true, drip: "none", reason: `no_matching_path:${outcomeTier}`, sms };
  }

  const [sms, { sent, gaps, stoppedAt, stoppedBecause }] = await Promise.all([
    smsPromise,
    runDrip({ db, step, orgId, clientId, eventId, prefix })
  ]);

  // Only tag the full run — a drip cut short by the call already happening did not
  // complete the pre-call sequence, and DPC-02 owns the held/no-show outcome.
  if (!stoppedAt) await step.run("tag-call-booked", () => addTags(db, clientId, ["call:booked"]));

  return { done: true, drip, sent, gaps, stoppedAt, stoppedBecause, sms };
}

export const bs01PrecallLauncher = inngest.createFunction(
  {
    id: "bs-01-precall-launcher",
    name: "BS-01 — Pre-Call Backend Launcher",
    cancelOn: [
      {
        event: "booking.rescheduled",
        if: "event.data.payload.email != null && event.data.payload.email == async.data.payload.email"
      },
      {
        event: "booking.rescheduled",
        if: "event.data.payload.bookingUid != null && event.data.payload.bookingUid == async.data.payload.bookingUid"
      }
    ]
  },
  [{ event: "booking.created" }, { event: "booking.rescheduled" }],
  ({ event, step }) => handle({ event: event.data, db, step })
);

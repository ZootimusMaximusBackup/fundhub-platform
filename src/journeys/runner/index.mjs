/* The journey runner — walk every branch, fire the real events, record what
 * actually happened.
 *
 * Two halves of the same idea already existed in this repository and nothing
 * joined them. The `journeys` table and public/app/journeys.html hold INTENT:
 * six hand-authored trees, ten step types. docs/journeys/*-actual.md holds
 * REALITY: who can reach which of the 73 routes, read out of the code. The
 * README of that directory states the gap against itself — "these pages are a
 * mirror, not a test". This is the join.
 *
 * THE JOIN IS INCOMPLETE. The INTENT side's six keys (client, setter, closer,
 * advisor, affiliate, partner — src/journeys/seed-journeys.mjs) were never
 * reconciled against the REALITY side's eight (client, role-owner,
 * role-sales-manager, role-closer, role-funding-advisor,
 * role-inquiry-remover, affiliate, white-label — docs/journeys/README.md).
 * role-owner and role-inquiry-remover have no tree here at all. Recorded, not
 * fixed here — see seed-journeys.mjs's header for why a rename or new trees
 * are not this file's call to make unasked.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IS REAL HERE AND WHAT IS NOT
 *
 * REAL: the workflow bodies (each module's own exported `handle`), the event
 * bus (`emit`, which dispatches to the registered local handlers), the
 * dispatcher, the routing lookup, the live-mode fence, sendTemplated, the
 * templates gate, the opt-out suppression. Nothing in that list is stubbed.
 *
 * NOT REAL: time (a virtual clock — see fake-step.mjs) and the last inch of a
 * send (the memory provider). Those are the only two.
 *
 * DELIBERATELY SUPPRESSED, and it is a third thing: the Inngest fan-out for
 * the events THIS FILE fires. fireEvent()'s emit() passes skipInngest: true —
 * see the long note there for why. In short: that fan-out is a network call, a
 * network call cannot be rolled back, and every event this runner fires is a
 * real workflow trigger with up to eight listeners. It costs no coverage,
 * because the runner already calls every triggered workflow body directly.
 *
 * ONE DERIVED EVENT STILL ESCAPES, AND IT IS NAMED HERE RATHER THAN GLOSSED.
 * The workflow bodies this runner invokes call sendTemplated, and
 * src/workflows/messaging.mjs:165 emits "message.queued" without skipInngest.
 * That file is not this thread's to change. The exposure is bounded and was
 * measured, not assumed: "message.queued" is not a trigger for ANY registered
 * workflow, so the leaked event reaches Inngest's log and starts nothing. It
 * is bookkeeping noise, not a live automation. Do not let that shrink into
 * "nothing escapes" — if messaging.mjs ever emits a real trigger, this comment
 * is the thing that was wrong. The fix belongs in messaging.mjs (T5) or in
 * src/events/bus.mjs (T16); it is on the fix board.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE PART THAT IS A MAPPING DECISION, STATED OUT LOUD
 *
 * A journey node is a description of intent — "text them the survey link",
 * "take the $32". It is not an event, and there is no recorded mapping in this
 * repository from one to the other. So START_EVENT and the payment mapping
 * below are the runner's own reading of the six authored journeys, not
 * something derived from the code, and they are the one place this file could
 * be wrong in a way the code cannot contradict.
 *
 * They are therefore kept small, explicit, and marked: a journey with no
 * canonical start event is walked with `startEvent: null` and every workflow
 * finding on it is reported UNVERIFIED rather than assumed absent. The runner
 * never invents an event to make a journey look connected.
 */

import { emit } from "../../events/bus.mjs";
import { ensureRegistered } from "../../register-all.mjs";
import { createClock, fakeStep, parseDuration } from "./fake-step.mjs";
import { load as loadRegistry, neverFired } from "./registry.mjs";
import { queryOrNull } from "./facts.mjs";
import { mint } from "./synthetic.mjs";
import { dispatchDue, DEFAULT_BATCH } from "../../messaging/dispatch.mjs";
import { preflight } from "../../messaging/live-fence.mjs";
import * as memory from "../../messaging/providers/memory.mjs";

/* Which canonical event opens each journey.
 *
 * `null` is a real answer, not a gap to fill. The white-label partner journey
 * describes signing an agreement and provisioning a tenant; there is no
 * canonical event for that in src/events/canonical.mjs, and inventing one
 * would make a disconnected journey look wired. */
export const START_EVENT = {
  client: "entry.captured",
  setter: "entry.captured",
  closer: "booking.created",
  advisor: "round.started",
  affiliate: "entry.captured",
  partner: null
};

/* Node types that fire a canonical event when walked. Everything else is
   recorded as intent and checked by the diff — a `stage` node has no event,
   and pretending otherwise would inflate workflow coverage. */
function eventForNode(node) {
  if (node.type === "payment") {
    return {
      name: "payment.received",
      payload: {
        productName: node.cfg?.product || "",
        amount: Number(node.cfg?.amount || 0) || 0,
        source: "journey-runner"
      }
    };
  }
  return null;
}

/* Every root-to-leaf path through a tree.
 *
 * A condition node has two labelled lanes and the runner runs BOTH, forking
 * the synthetic client. The nodes after the condition are shared by both
 * lanes, so a journey with N conditions yields 2^N paths. */
export function enumeratePaths(nodes) {
  if (!nodes || nodes.length === 0) return [[]];
  const [head, ...rest] = nodes;
  const restPaths = enumeratePaths(rest);

  if (head.type !== "condition") {
    return restPaths.map((r) => [{ node: head }, ...r]);
  }

  const out = [];
  (head.branches || []).forEach((branch, laneIndex) => {
    for (const inner of enumeratePaths(branch.nodes)) {
      for (const tail of restPaths) {
        out.push([{ node: head, lane: branch.label, laneIndex }, ...inner, ...tail]);
      }
    }
  });
  return out;
}

const WAIT_UNIT = { minutes: "m", hours: "h", days: "d" };

function waitMs(cfg = {}) {
  const unit = WAIT_UNIT[cfg.unit];
  if (!unit) return null; // unknown unit — reported, never guessed at
  try {
    return parseDuration(`${Number(cfg.amount) || 0}${unit}`);
  } catch {
    return null;
  }
}

/* Fire one event: through the real bus (local handlers), then into every
   workflow the registry says is triggered by it, each with the fake step so
   its sleeps cost no wall time. */
async function fireEvent(db, { name, payload, orgId, clientId, registry, step, clock }) {
  const fired = [];
  let eventId = null;

  /* skipInngest: true IS A SAFETY REQUIREMENT, NOT AN OPTIMISATION.
   *
   * src/events/bus.mjs ends emit() with, in effect:
   *     if (process.env.INNGEST_EVENT_KEY && opts.skipInngest !== true)
   *       void inngest.send({ name, data: {...} });
   *
   * That send is an HTTP call to the Inngest job cloud. It leaves the process,
   * so it is OUTSIDE the transaction api/journeys/run.mjs opens — and a
   * ROLLBACK cannot recall a packet that has already left the machine. The
   * screen tells the owner "Nothing was saved — the run was undone when it
   * finished", and without this flag that sentence was false: every event this
   * harness fired was also handed to the live job cloud, which then ran the
   * real workflows against the real database, outside the run's transaction
   * entirely.
   *
   * This was safe once and stopped being safe without anyone editing this file.
   * The header above still says the only unreal things here are time and the
   * last inch of a send. That was written when INNGEST_EVENT_KEY was unset, so
   * the branch above could never be taken. The key was turned on in production
   * later (both INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY are set on Netlify,
   * verified 2026-08-19) and this harness silently became live. Stale comments
   * elsewhere in the repo still claim the key is unset; do not trust them.
   *
   * Nothing is lost by skipping it. The loop directly below invokes every
   * workflow the registry says is triggered by this event, through each
   * module's own `handle`, against the caller's transaction-scoped db. The
   * Inngest fan-out would run the SAME workflow bodies a second time, against
   * the real pool, with no fake clock — so it adds no coverage and only
   * real-world side effects. */
  const res = await emit(db, name, { ...payload }, { orgId, clientId, skipInngest: true });
  eventId = res?.id ?? null;

  const targets = registry.byEvent.get(name) || [];
  for (const wf of targets) {
    const before = clock.now();
    try {
      const result = await wf.handle({
        event: { id: eventId, payload: { ...payload }, orgId, clientId },
        db,
        step
      });
      fired.push({ id: wf.id, ok: true, result: summarize(result), sleptMs: clock.now() - before });
    } catch (err) {
      // Recorded, never swallowed and never retried. A workflow that throws on
      // a path is a finding about that path.
      fired.push({ id: wf.id, ok: false, error: String(err?.message || err), sleptMs: clock.now() - before });
    }
  }
  return { eventId, fired };
}

/* Workflow return values vary a lot and some carry rendered copy. Keep the
   shape, drop anything long — a report is an index over what happened, not a
   second outbox. */
function summarize(value) {
  if (value == null || typeof value !== "object") return value ?? null;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (v == null || typeof v !== "object") out[k] = typeof v === "string" && v.length > 120 ? `${v.slice(0, 120)}…` : v;
    else out[k] = summarize(v);
  }
  return out;
}

/* How many dispatch passes one path is allowed. The dispatcher claims a bounded
   batch per pass (DEFAULT_BATCH), so draining means looping — but a bug that
   requeues rows must not spin forever. Hitting the cap is reported, never
   swallowed. */
const MAX_DISPATCH_PASSES = 40;

/* drain — hand everything this path queued to the real dispatcher.
 *
 * THE FENCE RUNS FIRST AND CAN STOP THE WHOLE THING. src/messaging/live-fence.mjs
 * refuses if the org's routing names a provider that can reach the outside
 * world. A refused drain claims nothing, so a misconfigured run sends nothing at
 * all rather than stopping half way. See that file's header for why the check
 * moved here from the dispatcher at the five-branch merge.
 *
 * MERGE NOTE. This used to call `dispatchQueued` from the journey-runner
 * branch's own dispatcher. That dispatcher is gone — the cutover branch's is the
 * one that ships, because it treats quiet hours as a deferral instead of a
 * permanent block. Its unit of work is one bounded batch (`dispatchDue`), so the
 * drain loop lives here. */
async function drain(db, { orgId, clock, env }) {
  const fence = await preflight(db, { orgId });
  if (!fence.allowed) {
    return { results: [], truncated: false, refused: { reason: fence.reason, routes: fence.transmitting } };
  }

  const results = [];
  for (let pass = 0; pass < MAX_DISPATCH_PASSES; pass++) {
    const batch = await dispatchDue(db, {
      orgId,
      now: () => clock.now(),
      env,
      limit: DEFAULT_BATCH
    });
    results.push(...batch.results);
    if (batch.claimed === 0) return { results, truncated: false, refused: null };
  }
  return { results, truncated: true, refused: null };
}

/* readMessageLedger — what this path actually WROTE, read from the messages
 * table, not from the provider.
 *
 * THIS EXISTS BECAUSE THE OLD ANSWER WAS FALSE. The run used to describe a
 * path's messages purely from memory.recorded() — the in-memory PROVIDER's log,
 * which only ever sees a message that survived every stage before it. Anything
 * stopped short of the provider was invisible: a quiet-hours deferral, a
 * compliance-gate block, a draft hold, and above all a whole-path refusal by
 * the live-mode fence, which claims nothing at all. Every one of those is a
 * message that WAS correctly queued, and the report told the owner "no message
 * row was written". That is not a smaller version of the truth, it is the
 * opposite of it, and it points the owner at the wrong team.
 *
 * So the count of rows comes from the rows. Returns null — never zero — when
 * the table could not be read, because "nothing was queued" and "I could not
 * look" are different findings and collapsing them is the false green this
 * whole harness exists to prevent.
 *
 * queryOrNull is borrowed from facts.mjs on purpose: this runs inside
 * api/journeys/run.mjs's open transaction, where one failed statement aborts
 * every statement after it. That helper wraps each read in its own SAVEPOINT,
 * which is the only reason a missing column here cannot take the whole run
 * down with it. */
async function readMessageLedger(db, { orgId, clientId, dispatched, refused, truncated }) {
  const rows = await queryOrNull(
    db,
    `SELECT status, channel, template_key, blocked_reason
       FROM messages
      WHERE org_id = $1 AND client_id = $2 AND direction = 'outbound'`,
    [orgId, clientId]
  );
  if (rows === null) return null;

  const sent = rows.filter((r) => r.status === "sent");
  const holds = [];

  /* The fence is a whole-path refusal, so it explains every row that is still
     sitting at 'queued' after the drain, and there is no per-message record of
     it anywhere else. */
  if (refused) {
    holds.push({ reason: "the safety fence stopped this whole path before anything was handed over", detail: refused.reason });
  }
  if (truncated) {
    holds.push({ reason: "the run hit its limit on dispatch passes and stopped draining", detail: null });
  }
  for (const d of dispatched || []) {
    if (d.outcome === "sent") continue;
    holds.push({ reason: d.outcome, detail: d.detail ?? null });
  }
  for (const r of rows) {
    if (r.status === "blocked" && r.blocked_reason) {
      holds.push({ reason: "held by the compliance gate", detail: r.blocked_reason });
    }
  }

  return {
    queued: rows.length,
    sent: sent.length,
    held: Math.max(0, rows.length - sent.length),
    holdReasons: holds,
    byStatus: rows.reduce((acc, r) => {
      const k = r.status || "unknown";
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {})
  };
}

/* Walk one path with one throwaway client. */
async function walkPath(db, ctx, { journeyKey, journey, path, pathId, index }) {
  const { orgId, runId, registry, startAt, env } = ctx;
  const clock = createClock(startAt);
  const step = fakeStep(clock);

  const client = await mint(db, { orgId, runId, index, journeyKey, pathId });
  const steps = [];
  const events = [];
  const firedIds = new Set();
  const branches = [];
  const notes = [];
  let failure = null;
  let startEventName = null;
  let startEventStatus = "fired";

  const recordFire = (name, out) => {
    events.push({ name, eventId: out.eventId, at: clock.now(), workflows: out.fired });
    out.fired.forEach((f) => firedIds.add(f.id));
  };

  try {
    // The journey's opening event, if it has one.
    const known = Object.prototype.hasOwnProperty.call(START_EVENT, journeyKey);
    const startEvent = known ? START_EVENT[journeyKey] : undefined;
    startEventName = startEvent ?? null;

    /* A KEY THE RUNNER HAS NEVER HEARD OF USED TO BE SILENT, AND THAT SILENCE
     * IS WHAT MADE "0 of 51 automations reached" UNREADABLE.
     *
     * START_EVENT is the runner's own reading of the six authored journeys —
     * see the header. A journey key that is not in it (a demo row, a key
     * somebody added straight into the table, a rename) fell through the
     * `if (startEvent)` below firing nothing and saying nothing. The run then
     * reported an honest-looking zero, and the owner had no way to tell "the
     * automations are broken" from "the runner does not know how this journey
     * begins".
     *
     * Recorded, never repaired. Inventing a start event for an unknown key is
     * exactly the thing this file promises not to do: it would make a
     * disconnected journey look wired. */
    if (!known) {
      startEventStatus = "unknown-journey";
      notes.push({
        kind: "no-start-event",
        journey: journeyKey,
        note: `nothing in the code can start the ${journeyKey} journey, so no automation could run on it`
      });
    } else if (!startEvent) {
      startEventStatus = "no-canonical-event";
      notes.push({
        kind: "no-start-event",
        journey: journeyKey,
        note: `the ${journeyKey} journey has no canonical opening event, so no automation could run on it`
      });
    }

    if (startEvent) {
      const out = await fireEvent(db, {
        name: startEvent,
        payload: { email: client.email, name: `${client.first_name} ${client.last_name}`, phone: client.phone, source: "journey-runner" },
        orgId,
        clientId: client.id,
        registry,
        step,
        clock
      });
      recordFire(startEvent, out);
    }

    for (const entry of path) {
      const node = entry.node;
      const at = clock.now();

      if (entry.lane !== undefined) {
        branches.push({ nodeId: node.id, title: node.title, field: node.cfg?.field ?? null, op: node.cfg?.op ?? null, lane: entry.lane, laneIndex: entry.laneIndex });
      }

      if (node.type === "wait") {
        const ms = waitMs(node.cfg);
        if (ms == null) {
          steps.push({ nodeId: node.id, type: node.type, title: node.title, at, note: "UNVERIFIED — wait config not parseable" });
          continue;
        }
        clock.advanceBy(ms);
        steps.push({ nodeId: node.id, type: node.type, title: node.title, at, waitedMs: ms });
        continue;
      }

      const ev = eventForNode(node);
      if (ev) {
        const out = await fireEvent(db, { ...ev, orgId, clientId: client.id, registry, step, clock });
        recordFire(ev.name, out);
        steps.push({ nodeId: node.id, type: node.type, title: node.title, at, emitted: ev.name });
        continue;
      }

      steps.push({ nodeId: node.id, type: node.type, title: node.title, at });
    }
  } catch (err) {
    failure = String(err?.message || err);
  }

  // Drain whatever the walk queued. Messages are written by workflows during
  // the walk, so this runs once at the end rather than per node.
  const before = memory.recorded().length;
  const { results: dispatched, truncated, refused } = await drain(db, { orgId, clock, env });
  const recordedNow = memory.recorded().slice(before);

  /* Read AFTER the drain on purpose: by now every row this path queued carries
     its final status, so one read tells the whole story instead of two. */
  const messageLedger = await readMessageLedger(db, {
    orgId,
    clientId: client.id,
    dispatched,
    refused,
    truncated
  });

  return {
    pathId,
    journeyKey,
    clientId: client.id,
    clientEmail: client.email,
    startEvent: startEventName,
    startEventStatus,
    notes,
    branches,
    steps,
    events,
    workflowsFired: [...firedIds].sort(),
    messages: recordedNow.map((m) => ({
      channel: m.channel,
      templateKey: m.templateKey,
      to: m.to,
      body: m.body,
      gates: m.gates,
      at: m.at
    })),
    /* messages[] is the PROVIDER's log — what got the whole way out. It is not
       the same number as messageLedger.queued and the two must never be used
       interchangeably again; see readMessageLedger's header. */
    messageLedger,
    dispatched: dispatched.map((d) => ({ id: d.id, outcome: d.outcome, detail: d.detail ?? null })),
    dispatchTruncated: truncated,
    dispatchRefused: refused,
    virtualElapsedMs: clock.elapsed(),
    stepRecord: step.record,
    terminal: failure ? "error" : "complete",
    failure
  };
}

/* run(db, opts) → report
 *
 * `journeys` is { key: { name, start, end, desc, nodes } } — from the journeys
 * table when it has rows, from src/journeys/seed-journeys.mjs when it does
 * not. The caller decides which; the runner just walks what it is handed. */
export async function run(db, {
  journeys,
  orgId,
  runId = "run",
  startAt = Date.UTC(2026, 0, 1),
  env = process.env,
  only = null
} = {}) {
  if (!orgId) throw new Error("run: orgId is required");
  if (!journeys || typeof journeys !== "object") throw new Error("run: journeys is required");

  ensureRegistered();
  memory.reset();

  const registry = await loadRegistry();
  const ctx = { orgId, runId, registry, startAt, env };

  const walked = [];
  let index = 0;

  for (const [journeyKey, journey] of Object.entries(journeys)) {
    if (only && only !== journeyKey) continue;
    const paths = enumeratePaths(journey.nodes || []);
    for (let p = 0; p < paths.length; p++) {
      const pathId = `${journeyKey}#${p + 1}`;
      walked.push(
        await walkPath(db, ctx, { journeyKey, journey, path: paths[p], pathId, index: index++ })
      );
    }
  }

  const firedIds = new Set(walked.flatMap((w) => w.workflowsFired));

  /* One row per journey key, not per path — the same key walks several paths
     and repeating the finding nine times would bury it. */
  const startEventFindings = [];
  const seenKey = new Set();
  for (const w of walked) {
    for (const n of w.notes || []) {
      if (n.kind !== "no-start-event" || seenKey.has(n.journey)) continue;
      seenKey.add(n.journey);
      startEventFindings.push({ journey: n.journey, status: w.startEventStatus, note: n.note });
    }
  }

  return {
    runId,
    orgId,
    startAt,
    journeys: Object.keys(journeys).filter((k) => !only || k === only),
    paths: walked,
    workflowCoverage: {
      registered: registry.registered,
      runnable: registry.workflows.length,
      unrunnable: registry.unrunnable,
      fired: [...firedIds].sort(),
      neverFired: neverFired(registry, firedIds)
    },
    journeysWithoutStartEvent: Object.keys(journeys).filter(
      (k) => (!only || k === only) && !START_EVENT[k]
    ),
    /* Same set as journeysWithoutStartEvent, but it says WHICH of the two
       reasons applies and in words a person can act on. "partner has no
       canonical event" is a known, recorded gap; "the runner has never heard of
       this key" is somebody's row that nothing can ever start. */
    startEventFindings
  };
}

export default run;

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

  const res = await emit(db, name, { ...payload }, { orgId, clientId });
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
  let failure = null;

  const recordFire = (name, out) => {
    events.push({ name, eventId: out.eventId, at: clock.now(), workflows: out.fired });
    out.fired.forEach((f) => firedIds.add(f.id));
  };

  try {
    // The journey's opening event, if it has one.
    const startEvent = Object.prototype.hasOwnProperty.call(START_EVENT, journeyKey)
      ? START_EVENT[journeyKey]
      : undefined;

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

  return {
    pathId,
    clientId: client.id,
    clientEmail: client.email,
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
    )
  };
}

export default run;

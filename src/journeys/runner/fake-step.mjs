/* The virtual clock, and the `step` object the runner hands to real workflows.
 *
 * 47 workflows live in src/workflows/, and the long ones are long on purpose:
 * s-02 sleeps 20 minutes, dpc-05 sleeps 72 hours, bc-01 sleeps 24 then 48,
 * n-06 sleeps 180 days. A runner that respects real time tests nothing.
 *
 * Every workflow exports `handle({ event, db, step })` and reaches the outside
 * only through `step`. Supply a different `step` and the whole schedule
 * collapses to nothing — while THE REAL WORKFLOW BODY STILL RUNS. That is the
 * point, and it is why nothing here stubs a workflow: `run` executes the
 * callback immediately and returns its value, exactly as Inngest would.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE CLOCK GENUINELY MOVES
 *
 * `sleep` does not merely return — it advances a virtual clock by the full
 * duration. After n-06's `step.sleep("wait-6-months", "180d")` the clock reads
 * 180 days later, in microseconds of wall time. That is what makes it possible
 * to record an opt-out at virtual day 90 and then assert the day-180 message
 * is suppressed, which is the only way to test a six-month cadence at all.
 *
 * The clock is passed to anything that reads time — the dispatcher, and the
 * compliance gate when Ticket 1 builds it clock-injected. Nothing here calls
 * Date.now().
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RELATIONSHIP TO src/workflows/test-support.mjs
 *
 * `fakeStep()` already exists there and 20+ test files depend on its exact
 * behaviour: sleeps are no-ops and nothing is recorded. It is deliberately
 * left alone. This module is the clock-aware version — same three-method
 * shape, but every sleep is measured and every step is logged, because the
 * runner's whole output is "what happened, in what order, at what time".
 */

const UNITS = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000
};

export class DurationError extends Error {}

/* Inngest ms-style durations: "20m", "3h", "2d", "180d". Also accepts a plain
 * number (milliseconds) and a Date.
 *
 * REFUSES WHAT IT DOES NOT UNDERSTAND. An unparseable duration returning 0
 * would make a sleep silently vanish, and a vanished sleep turns "this
 * workflow waits three days" into "this workflow does not wait" without
 * anything going red — the exact class of false green this runner exists to
 * catch. */
export function parseDuration(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value ?? "").trim().toLowerCase();
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)$/.exec(raw);
  if (!m) throw new DurationError(`cannot parse duration: ${JSON.stringify(value)}`);
  return Number(m[1]) * UNITS[m[2]];
}

/* A virtual clock. `start` is supplied by the caller rather than defaulted to
   Date.now() so that two runs of the same journey produce identical
   timestamps — a report you cannot diff against yesterday's is worth much
   less than one you can. */
export function createClock(start = 0) {
  let ms = typeof start === "number" ? start : new Date(start).getTime();
  const startedAt = ms;
  return {
    now: () => ms,
    date: () => new Date(ms),
    elapsed: () => ms - startedAt,
    advanceBy(delta) {
      if (delta > 0) ms += delta;
      return ms;
    },
    /* NEVER GOES BACKWARD. `step.sleepUntil` is called with an absolute Date
       computed from event data — ai-set-04 wakes 15 minutes before a booking
       start, dpc-02 wakes 5 minutes after a call ends. Either can already be
       in the past relative to virtual now, and a clock that rewound would let
       a later step observe an earlier time than an earlier step did. */
    advanceTo(target) {
      const t = target instanceof Date ? target.getTime() : Number(target);
      if (Number.isFinite(t) && t > ms) ms = t;
      return ms;
    }
  };
}

/* fakeStep(clock, { onStep } = {}) → step
 *
 * The Inngest `step` contract, in full: run(id, fn), sleep(id, duration),
 * sleepUntil(id, dateOrString). `run` returns the awaited value of fn()
 * because every workflow in the tree consumes it.
 *
 * The returned object also carries `record` — the ordered log of everything
 * that happened, which is what the diff reads to answer "does the workflow
 * actually sleep as long as the journey says it waits". */
export function fakeStep(clock, { onStep } = {}) {
  const record = [];
  const note = (entry) => {
    record.push(entry);
    if (onStep) onStep(entry);
    return entry;
  };

  return {
    record,

    async run(id, fn) {
      const at = clock.now();
      try {
        const value = await fn();
        note({ kind: "run", id, at, ok: true });
        return value;
      } catch (err) {
        // Logged, then rethrown. The runner catches it at the path level and
        // records a failed path; swallowing it here would turn a workflow that
        // throws into a workflow that appears to have done nothing.
        note({ kind: "run", id, at, ok: false, error: String(err?.message || err) });
        throw err;
      }
    },

    async sleep(id, duration) {
      const from = clock.now();
      const ms = parseDuration(duration);
      clock.advanceBy(ms);
      note({ kind: "sleep", id, at: from, until: clock.now(), ms, requested: String(duration) });
    },

    async sleepUntil(id, target) {
      const from = clock.now();
      clock.advanceTo(target);
      note({
        kind: "sleepUntil",
        id,
        at: from,
        until: clock.now(),
        ms: clock.now() - from,
        requested: target instanceof Date ? target.toISOString() : String(target)
      });
    }
  };
}

/* Total virtual milliseconds a step record spent asleep. The diff compares
   this against the `wait` nodes the journey declares. */
export function sleptMs(record = []) {
  return record
    .filter((e) => e.kind === "sleep" || e.kind === "sleepUntil")
    .reduce((sum, e) => sum + (e.ms || 0), 0);
}

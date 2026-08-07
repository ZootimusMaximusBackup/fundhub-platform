// The dry-run fence — the decision half. src/lib/outbound-fetch.mjs is the
// enforcement half, and it is the only thing that should call this.
//
// WHY THIS FILE EXISTS. There was a fence before this one. It lived in
// src/handlers/client-lifecycle.mjs, compared against the literal string "1",
// and was the only place either flag was ever read. Two things were wrong with
// it, and both were invisible:
//
//   1. The owner set MESSAGING_DRY_RUN=true in production. `"true" === "1"` is
//      false, so the fence was down while the dashboard said it was up. A flag
//      that silently means nothing unless you guess its spelling is worse than
//      no flag, because it buys confidence it has not earned.
//   2. Even spelled "1" it was unreachable. It sat below an `if (cfg.ok)` that
//      returns whenever GHL_API_KEY is set — which it is, in production. The
//      one dry-run branch in the codebase could not execute on the one machine
//      that mattered.
//
// Neither had a test. That is the root cause, and it is why this module ships
// with dry-run.test.mjs for the grammar and no-unfenced-transmit.test.mjs for
// the structure.
//
// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT IS BLOCKED. THE ONLY WAY OUT IS AN EXPLICIT OFF VALUE.
//
// Unset is blocked. Empty is blocked. Misspelled, garbled, or a value nobody
// planned for is blocked. `MESSAGING_DRY_RUN=0` — or false / no / off — is the
// single thing that permits transmission, and it has to be said out loud.
//
// This is the opposite of how these flags usually work, and the asymmetry is
// the point. The two mistakes do not cost the same:
//
//   Fence up when you wanted it down  → a queued message. Flip one variable
//                                       and it goes out. Recoverable in a
//                                       minute, and visible: the queue grows.
//   Fence down when you wanted it up  → a real message to a real client.
//                                       Cannot be recalled, may be a
//                                       compliance event, and is silent until
//                                       somebody replies.
//
// So every ambiguous reading resolves to "hold". A deploy that forgets the
// variable entirely sends nothing, which is the correct behaviour for a deploy
// that nobody has thought about. Going live is a deliberate act.
//
// The cost is real and worth naming: production cannot send until someone sets
// these to an off value. That is intended. Turning sending on should be a
// decision somebody made on purpose, not the state you drift into by leaving
// configuration blank.
// ═══════════════════════════════════════════════════════════════════════════

/** Env var names, exported so nothing has to spell them by hand. */
export const MESSAGING_DRY_RUN = "MESSAGING_DRY_RUN";
export const ADAPTERS_DRY_RUN = "ADAPTERS_DRY_RUN";

/* The complete set of values that permit transmission. Everything else — every
   other string, and absence itself — holds. Listed rather than pattern-matched
   so widening it is a visible edit to this line that a reviewer will see. */
const MEANS_TRANSMIT = new Set(["0", "false", "no", "off"]);

/**
 * May this class of traffic leave the building?
 *
 * @param {string} name           MESSAGING_DRY_RUN or ADAPTERS_DRY_RUN.
 * @param {object} [env]          Environment to read. Defaults to process.env.
 * @returns {{ allowed: boolean, reason: string|null, value: string|null }}
 *          `reason` is operator-facing text, present only when blocked.
 */
export function fenceVerdict(name, env) {
  const source = env || process.env;
  const raw = source?.[name];

  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return {
      allowed: false,
      value: null,
      reason:
        `${name} is not set. The dry-run fence defaults to BLOCKED, so nothing ` +
        `transmits until it is set to an explicit off value (0, false, no, or off).`
    };
  }

  const value = String(raw).trim().toLowerCase();
  if (MEANS_TRANSMIT.has(value)) return { allowed: true, reason: null, value };

  return {
    allowed: false,
    value,
    reason:
      `${name} is set to "${value}", which is not an explicit off value ` +
      `(0, false, no, off). Treating it as fence UP and holding.`
  };
}

/** Convenience readers. Both answer "is the fence up?", i.e. blocked. */
export const messagingBlocked = (env) => !fenceVerdict(MESSAGING_DRY_RUN, env).allowed;
export const adaptersBlocked = (env) => !fenceVerdict(ADAPTERS_DRY_RUN, env).allowed;

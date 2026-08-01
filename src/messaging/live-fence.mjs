/* The live-mode fence.
 *
 * A journey run mints synthetic clients and drives them through the real send
 * path. Against the memory provider that is harmless. Against Twilio it texts
 * whoever the synthetic client happens to look like. This module is what stops
 * the second thing, and it is written to hold even when the runner is not
 * involved at all.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT "LIVE MODE" MEANS HERE
 *
 * Not an environment variable, and not a flag anyone passes in. Live mode is
 * `provider.transmits === true` — the resolved provider can reach the outside
 * world. That definition is deliberate: it cannot drift out of sync with
 * reality, because it IS the property that makes a send dangerous. A new
 * provider that transmits is fenced the moment it is added, with no second
 * place to remember to update.
 *
 * Today nothing in the tree sets `transmits` true (memory and internal are the
 * only two providers, and src/messaging/no-transmit.test.mjs asserts the whole
 * set), so the fence's refusal paths are exercised only by tests that stand up
 * a transmitting provider by hand. That is the point: the fence ships BEFORE
 * live mode, not after it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE THREE LAYERS, AND WHY ALL THREE
 *
 * 1. THE SYNTHETIC MARKER IS MANDATORY, NOT ADVISORY. In live mode a message
 *    whose client is not marked synthetic is refused. The marker is
 *    `custom_fields.synthetic === true` — strict, so a string "true", a 1, or
 *    a truthy accident does not pass.
 *
 * 2. THE REFUSAL LIVES IN THE DISPATCHER. This module is called from
 *    src/messaging/dispatch.mjs at the claim step, not from the runner. If the
 *    check sat in the runner, anything that bypassed the runner would bypass
 *    the check — and `messages` rows are written by 27 workflow files, none of
 *    which know the runner exists.
 *
 * 3. RECIPIENT ALLOWLIST. Live mode additionally requires the recipient to be
 *    on an explicit list. This catches the case the marker cannot: a synthetic
 *    client accidentally minted carrying a real client's phone or email. Layer
 *    1 asks "is this a test record"; layer 3 asks "is this a test person".
 *    Both have to be true.
 *
 * NO FORCE, NO OVERRIDE, NO "JUST THIS ONCE". Same rule as the compliance
 * gate. There is no argument, env var or config row that turns a refusal into
 * a send. If live mode refuses something it should not, fix the marker or fix
 * the allowlist.
 */

/* The marker. One place, imported by both the minting side
   (src/journeys/runner/synthetic.mjs) and the refusing side, so the two can
   never disagree about what a synthetic client looks like. */
export const SYNTHETIC_FIELD = "synthetic";

/* Where the allowlist comes from. Comma-separated phone numbers and email
   addresses. Unset means empty, which in live mode means everything is
   refused — an unconfigured fence is a closed fence. */
export const ALLOWLIST_ENV = "LIVE_MODE_RECIPIENT_ALLOWLIST";

/* Strict. A client whose custom_fields.synthetic is the STRING "true", or 1,
   or "yes", is not synthetic — it is a real client with a confusing field, and
   guessing in its favour is how the fence gets breached. */
export function isSynthetic(client) {
  const cf = client && client.custom_fields;
  if (!cf || typeof cf !== "object") return false;
  return cf[SYNTHETIC_FIELD] === true;
}

/* Phone numbers keep digits only (so +1 555 000 0001, +15550000001 and
   1-555-000-0001 are one entry); emails lower-case and trim. Anything else
   normalises to a trimmed lower-case string and will simply never match. */
export function normalizeRecipient(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.includes("@")) return raw.toLowerCase();
  const digits = raw.replace(/\D+/g, "");
  return digits || raw.toLowerCase();
}

export function parseAllowlist(env = {}) {
  const raw = env[ALLOWLIST_ENV];
  if (!raw) return new Set();
  return new Set(
    String(raw)
      .split(",")
      .map((entry) => normalizeRecipient(entry))
      .filter(Boolean)
  );
}

/* check({ provider, client, to, env }) → { allowed, reason, gates }
 *
 * `gates` is the audit trail — every decision this message passed, in order.
 * It is stamped onto the memory provider's record so a run report can show not
 * just what would have gone out but what it got past on the way.
 *
 * A refusal carries a `reason` that is written to messages.last_error, so the
 * refusal is legible in the database and not only in a log line. */
export function check({ provider, client, to, env = {} } = {}) {
  const gates = [];

  // Non-transmitting provider: nothing can escape, so the marker and the
  // allowlist are not load-bearing and are not applied. Recording the decision
  // keeps the report honest about WHY a message was let through.
  if (!provider || provider.transmits !== true) {
    gates.push("provider-cannot-transmit");
    return { allowed: true, reason: null, gates };
  }

  gates.push("live-mode");

  // Layer 1 — the marker.
  if (!isSynthetic(client)) {
    return {
      allowed: false,
      reason: "live_mode_refused_unmarked_client",
      gates
    };
  }
  gates.push("synthetic-marker");

  // Layer 3 — the allowlist. (Layer 2 is structural: this function is called
  // from the dispatcher, which is what makes layers 1 and 3 unbypassable.)
  const allowlist = parseAllowlist(env);
  const recipient = normalizeRecipient(to);
  if (!recipient) {
    return { allowed: false, reason: "live_mode_refused_no_recipient", gates };
  }
  if (!allowlist.has(recipient)) {
    return { allowed: false, reason: "live_mode_refused_recipient_not_allowlisted", gates };
  }
  gates.push("recipient-allowlist");

  return { allowed: true, reason: null, gates };
}

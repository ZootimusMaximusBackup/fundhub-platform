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
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT CHANGED AT THE FIVE-BRANCH MERGE, 2026-08-01 — READ THIS
 *
 * This module was written when `memory` and `internal` were the only two
 * providers in the tree and NEITHER transmitted. On that tree, "the provider
 * can transmit" and "we are in a dangerous test configuration" were the same
 * statement, so the fence was called from src/messaging/dispatch.mjs on every
 * message and refused any client that was not marked synthetic.
 *
 * The cutover branches merged in alongside it bring three providers that DO
 * transmit — mailgun, ghl_relay and twilio — and those are the production send
 * path, for real clients who are correctly not marked synthetic. Left wired
 * into the dispatcher unchanged, this fence would refuse every real message the
 * moment sending is switched on. So it is NOT called from the dispatcher any
 * more. It is called from the journey runner, before the runner dispatches
 * anything: `preflight()` refuses the whole run if the org's routing resolves
 * to a provider that can leave the building.
 *
 * WHAT THAT COSTS, STATED PLAINLY. Layer 2 below used to be structural — the
 * check sat below anything that could bypass it. It is now positional: code
 * that dispatches without going through the runner does not consult this file.
 * Nothing does that today (nothing schedules the dispatcher at all — see W5 on
 * docs/workflows/ghl-cutover-2026-08-01.md), so there is no live hole. But when
 * W5 plugs sending in, somebody has to decide what the per-message rule is for
 * a REAL client, and `check()` below is not it. That decision is an owner call
 * and it is recorded as an open question on the cutover board, not guessed at
 * here.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE THREE LAYERS, AND WHY ALL THREE
 *
 * 1. THE SYNTHETIC MARKER IS MANDATORY, NOT ADVISORY. In live mode a message
 *    whose client is not marked synthetic is refused. The marker is
 *    `custom_fields.synthetic === true` — strict, so a string "true", a 1, or
 *    a truthy accident does not pass.
 *
 * 2. THE REFUSAL SITS AHEAD OF THE SEND, NOT INSIDE THE RUN. `preflight()` runs
 *    before a single message is claimed, so a run against a transmitting
 *    provider stops with nothing sent rather than part-way through.
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
  if (!provider || provider.TRANSMITS !== true) {
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

/* preflight(db, { orgId }) → { allowed, reason, transmitting, gates }
 *
 * Layer 2, as it stands after the five-branch merge. Read every routing row for
 * the org, resolve each named provider through the registry, and refuse if ANY
 * of them can reach the outside world.
 *
 * WHY THE WHOLE RUN AND NOT PER MESSAGE. A run walks every branch of every
 * journey and queues messages on several channels. If sms is routed to a real
 * relay, that is a misconfiguration for the run as a whole; stopping at the
 * first text after the emails have already gone would be the worst of both.
 * Refusing before anything is claimed means a refused run sends nothing at all.
 *
 * FAILS CLOSED ON EVERY UNCERTAINTY. A provider name the registry does not
 * know is treated as transmitting, because an unknown provider is exactly the
 * case where "probably harmless" is a guess. A database error propagates; it is
 * not swallowed into an allow. */
export async function preflight(db, { orgId, resolveProvider } = {}) {
  if (!orgId) return { allowed: false, reason: "live_mode_preflight_no_org", transmitting: [], gates: [] };

  const resolveOne = resolveProvider || (await import("./providers/index.mjs")).resolve;
  const { rows } = await db.query(
    `SELECT channel, provider FROM message_channel_routing WHERE org_id = $1`,
    [orgId]
  );

  const transmitting = [];
  for (const row of rows) {
    const mod = resolveOne(row.provider);
    // Unknown provider → assume the worst. See the header.
    if (!mod || mod.TRANSMITS !== false) transmitting.push(`${row.channel}:${row.provider}`);
  }

  if (transmitting.length) {
    return {
      allowed: false,
      reason: "live_mode_refused_transmitting_route",
      transmitting,
      gates: ["live-mode"]
    };
  }
  return { allowed: true, reason: null, transmitting: [], gates: ["provider-cannot-transmit"] };
}

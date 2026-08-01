// The provider registry — the one place a `provider` string from
// message_channel_routing becomes code.
//
// EXPLICIT MAP, NOT A DIRECTORY SCAN. A registry that globs *.mjs would pick up
// a half-finished provider the moment someone saved the file, and the failure
// would be a live send through untested code rather than a build error. Adding
// a provider is a deliberate line in this file.
//
// AN UNKNOWN PROVIDER IS A HOLD, NEVER A DEFAULT. resolve() returns null and the
// dispatcher stops. Falling back to "whatever we have" would mean a typo in a
// routing row silently sends a client's SMS through the email provider, or —
// worse — sends production traffic through a provider nobody chose.

// RESOLVE DOES NOT FILTER ON `ENABLED`, AND THAT IS THE POINT. A provider may
// ship built but unrouted — twilio does, waiting on A2P 10DLC. `ENABLED` records
// which provider the shipped default in migration 110 routes each channel to; it
// is a declaration, checked by a test, not a switch. If resolve() honoured it,
// cutover would need a row flip AND a code edit AND a deploy, and the routing
// table would no longer be the single answer to "what sends". One switch.

// MERGE NOTE (2026-08-01, five-branch merge). `internal` and `memory` arrived
// with the journey-runner branch, which carried its own smaller registry
// (`key`/`transmits`/`resolve(db,{orgId,channel})`). That registry is gone; the
// two providers were rewritten onto this contract and registered here, so there
// is one seam rather than two. Neither is ENABLED, so neither can become a
// channel's default by accident — a run reaches `memory` only by the routing
// flip in api/journeys/run.mjs, inside a transaction that is rolled back.

import * as mailgun from "./mailgun.mjs";
import * as ghlRelay from "./ghl-relay.mjs";
import * as twilio from "./twilio.mjs";
import * as internal from "./internal.mjs";
import * as memory from "./memory.mjs";

const REGISTERED = [mailgun, ghlRelay, twilio, internal, memory];

/* Every provider must expose the same three things. Checked here, once, at
   import time: a provider missing `send` would otherwise fail at the moment of
   a real send, against a real client, in production. */
for (const p of REGISTERED) {
  if (typeof p.PROVIDER !== "string" || !p.PROVIDER) {
    throw new Error("provider registry: a provider is missing its PROVIDER name");
  }
  if (!(p.CHANNELS instanceof Set) || p.CHANNELS.size === 0) {
    throw new Error(`provider registry: ${p.PROVIDER} declares no CHANNELS`);
  }
  if (typeof p.ADDRESS_FIELD !== "string" || !p.ADDRESS_FIELD) {
    throw new Error(`provider registry: ${p.PROVIDER} declares no ADDRESS_FIELD`);
  }
  if (typeof p.send !== "function") {
    throw new Error(`provider registry: ${p.PROVIDER} has no send()`);
  }
  /* Boolean, and required. Left undeclared it would default to undefined, which
     reads as "not routed" — the quiet direction. A provider that forgot to say
     is a provider nobody checked, so it fails here instead. */
  if (typeof p.ENABLED !== "boolean") {
    throw new Error(`provider registry: ${p.PROVIDER} does not declare ENABLED`);
  }
  /* TRANSMITS — can this provider reach the outside world? Boolean, and
     required, for the same reason ENABLED is: undeclared reads as `undefined`,
     which src/messaging/live-fence.mjs would treat as "cannot transmit", and a
     provider that quietly claims it is harmless is the one thing the fence
     exists to prevent. Declaring it is a deliberate, visible act. */
  if (typeof p.TRANSMITS !== "boolean") {
    throw new Error(`provider registry: ${p.PROVIDER} does not declare TRANSMITS`);
  }
}

/** Every provider this build knows about. For the runner's report and for the
    tests that assert the transmit posture of the whole set. */
export function all() {
  return [...REGISTERED];
}

export const PROVIDERS = Object.freeze(
  Object.fromEntries(REGISTERED.map((p) => [p.PROVIDER, p]))
);

/* resolve(name) → the provider module, or null.

   null is a hold. The caller must not substitute anything. */
export function resolve(name) {
  if (!name) return null;
  return PROVIDERS[String(name)] || null;
}

/** The address field a provider needs off the client record — 'email' for
    Mailgun, 'ghl_contact_id' for the GHL relay. The dispatcher uses this rather
    than branching on the provider name, so adding a provider does not mean
    editing the dispatcher. */
export function addressFieldFor(name) {
  return resolve(name)?.ADDRESS_FIELD || null;
}

export default PROVIDERS;

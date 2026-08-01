/* The dispatcher and the live-mode fence.
 *
 * The acceptance criteria this file exists to hold, from Ticket 8:
 *
 *   * a run with provider='memory' completes with ZERO outbound HTTP calls —
 *     asserted on the network, by replacing globalThis.fetch with a spy that
 *     fails the test if it is ever called, not by "no errors were thrown"
 *   * a client without the synthetic marker is refused AT THE DISPATCHER while
 *     live mode is on, with zero provider calls
 *   * a synthetic client whose contact details are off the allowlist is
 *     refused too
 *
 * "Live mode" is not simulated with a flag: these tests stand up a provider
 * whose `transmits` is true — the same thing that will be true of Ticket 1's
 * twilio module — and assert the fence closes around it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { dispatchOne, dispatchQueued } from "./dispatch.mjs";
import * as memory from "./providers/memory.mjs";
import { all as allProviders, resolve, ProviderError } from "./providers/index.mjs";
import { check as fenceCheck, isSynthetic, parseAllowlist, normalizeRecipient } from "./live-fence.mjs";

const ORG = "org-1";

/* A minimal Postgres stand-in covering exactly the four statements
   dispatch.mjs issues. Deliberately not pgFake: that module's regex table is
   shared by 20+ workflow tests and widening it for a new table is a change
   with blast radius, where a purpose-built fake here has none. */
function fakeDb({ messages = [], clients = [], routing = [] } = {}) {
  const db = {
    messages: messages.map((m) => ({
      status: "queued",
      attempts: 0,
      provider: "internal",
      provider_ref: null,
      last_error: null,
      dispatched_at: null,
      org_id: ORG,
      ...m
    })),
    clients,
    routing,
    async query(sql, params = []) {
      if (/UPDATE messages SET status = 'sending'/.test(sql)) {
        const row = db.messages.find((m) => m.org_id === params[0] && m.status === "queued");
        if (!row) return { rows: [] };
        row.status = "sending";
        row.attempts += 1;
        return { rows: [{ ...row }] };
      }
      if (/FROM clients WHERE id/.test(sql)) {
        const c = db.clients.find((x) => x.id === params[0]);
        return { rows: c ? [c] : [] };
      }
      if (/FROM message_channel_routing/.test(sql)) {
        const r = db.routing.find((x) => x.org_id === params[0] && x.channel === params[1]);
        return { rows: r ? [r] : [] };
      }
      if (/UPDATE messages\s+SET status = \$2/.test(sql)) {
        const row = db.messages.find((m) => m.id === params[0]);
        if (row) {
          row.status = params[1];
          if (params[2]) row.provider = params[2];
          if (params[3]) row.provider_ref = params[3];
          row.last_error = params[4];
          row.dispatched_at = params[5];
        }
        return { rows: [] };
      }
      throw new Error(`fakeDb: unhandled SQL: ${sql.slice(0, 80)}`);
    }
  };
  return db;
}

const route = (channel, provider) => ({ org_id: ORG, channel, provider, enabled: true });
const syntheticClient = (over = {}) => ({
  id: "cl-syn",
  email: "runner+1@fundhub.test",
  phone: "+15550000001",
  custom_fields: { synthetic: true },
  ...over
});
const realClient = (over = {}) => ({
  id: "cl-real",
  email: "someone@example.com",
  phone: "+15559998888",
  custom_fields: {},
  ...over
});
const queued = (over = {}) => ({
  id: "m-1",
  client_id: "cl-syn",
  channel: "sms",
  template_key: "SMS-TEST",
  rendered_body: "hello",
  ...over
});

/* A provider that CAN reach the outside world. This is what makes the fence
   tests real — without one, every path takes the "cannot transmit" shortcut
   and the three layers are never exercised. */
function transmittingProvider() {
  const calls = [];
  return {
    key: "test-live",
    transmits: true,
    calls,
    async send(message) {
      calls.push(message);
      return { providerRef: `live:${calls.length}`, status: "sent" };
    }
  };
}

// ── the memory provider ───────────────────────────────────────────────────

test("memory provider records what would have gone out, and sends nothing", async () => {
  memory.reset();
  const db = fakeDb({
    messages: [queued()],
    clients: [syntheticClient()],
    routing: [route("sms", "memory")]
  });

  const out = await dispatchOne(db, { orgId: ORG, now: () => 1_000, env: {} });

  assert.equal(out.status, "sent");
  assert.equal(out.provider, "memory");
  const rec = memory.recorded();
  assert.equal(rec.length, 1);
  assert.equal(rec[0].body, "hello");
  assert.equal(rec[0].to, "+15550000001");
  assert.equal(rec[0].channel, "sms");
  assert.equal(rec[0].templateKey, "SMS-TEST");
  // The clock is the injected one, not the wall clock.
  assert.equal(rec[0].at, new Date(1_000).toISOString());
  assert.equal(db.messages[0].status, "sent");
  assert.equal(db.messages[0].provider_ref, rec[0].providerRef);
});

test("a memory run makes ZERO outbound HTTP calls — asserted on the network", async () => {
  memory.reset();
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = (...args) => {
    calls.push(args[0]);
    throw new Error("outbound fetch attempted during a memory-provider run");
  };
  try {
    const db = fakeDb({
      messages: [queued({ id: "m-1" }), queued({ id: "m-2", channel: "email" })],
      clients: [syntheticClient()],
      routing: [route("sms", "memory"), route("email", "memory")]
    });
    const { results } = await dispatchQueued(db, { orgId: ORG, now: () => 0, env: {} });
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.status === "sent"));
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(calls, [], "no outbound HTTP call may happen on a memory run");
});

test("every provider in this build is non-transmitting", () => {
  // The canary for Ticket 1: the moment a real vendor module lands, this test
  // goes red and whoever added it has to state the transmit posture out loud.
  const transmitting = allProviders().filter((p) => p.transmits === true);
  assert.deepEqual(
    transmitting.map((p) => p.key),
    [],
    "a provider that can transmit has been added — the live-mode fence and its allowlist must be configured before this is allowed"
  );
});

// ── the fence ─────────────────────────────────────────────────────────────

test("LIVE MODE: a client without the synthetic marker is refused, with zero provider calls", async () => {
  const provider = transmittingProvider();
  const db = fakeDb({
    messages: [queued({ client_id: "cl-real" })],
    clients: [realClient()],
    routing: [route("sms", "test-live")]
  });
  const out = await dispatchOne(db, {
    orgId: ORG,
    now: () => 0,
    resolveProvider: async () => provider,
    // Even with the real client's number ON the allowlist, the missing marker
    // alone must refuse it. Layer 1 does not defer to layer 3.
    env: { LIVE_MODE_RECIPIENT_ALLOWLIST: "+15559998888" }
  });

  assert.equal(out.status, "refused");
  assert.equal(out.reason, "live_mode_refused_unmarked_client");
  assert.deepEqual(provider.calls, [], "the provider must never be called for an unmarked client");
  assert.equal(db.messages[0].status, "refused");
  assert.equal(db.messages[0].last_error, "live_mode_refused_unmarked_client");
});

test("LIVE MODE: a synthetic client off the allowlist is refused, with zero provider calls", async () => {
  const provider = transmittingProvider();
  const db = fakeDb({
    // The case this layer exists for: a synthetic client accidentally minted
    // carrying a real person's phone number.
    messages: [queued()],
    clients: [syntheticClient({ phone: "+15551234567" })],
    routing: [route("sms", "test-live")]
  });
  const out = await dispatchOne(db, {
    orgId: ORG,
    now: () => 0,
    resolveProvider: async () => provider,
    env: { LIVE_MODE_RECIPIENT_ALLOWLIST: "+15550000001,runner@fundhub.test" }
  });

  assert.equal(out.status, "refused");
  assert.equal(out.reason, "live_mode_refused_recipient_not_allowlisted");
  assert.deepEqual(provider.calls, []);
});

test("LIVE MODE: a synthetic, allowlisted client goes through", async () => {
  const provider = transmittingProvider();
  const db = fakeDb({
    messages: [queued()],
    clients: [syntheticClient()],
    routing: [route("sms", "test-live")]
  });
  const out = await dispatchOne(db, {
    orgId: ORG,
    now: () => 0,
    resolveProvider: async () => provider,
    // Formatted differently from the stored value on purpose — the allowlist
    // compares digits, so 1-555-000-0001 and +15550000001 are one entry.
    env: { LIVE_MODE_RECIPIENT_ALLOWLIST: "1-555-000-0001" }
  });

  assert.equal(out.status, "sent");
  assert.equal(provider.calls.length, 1);
  assert.deepEqual(out.gates, ["live-mode", "synthetic-marker", "recipient-allowlist"]);
});

test("LIVE MODE with no allowlist configured refuses everything", () => {
  const verdict = fenceCheck({
    provider: { key: "x", transmits: true },
    client: syntheticClient(),
    to: "+15550000001",
    env: {}
  });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.reason, "live_mode_refused_recipient_not_allowlisted");
});

test("the synthetic marker is strict — truthy lookalikes are not synthetic", () => {
  assert.equal(isSynthetic({ custom_fields: { synthetic: true } }), true);
  for (const v of ["true", 1, "yes", {}, [], "1"]) {
    assert.equal(isSynthetic({ custom_fields: { synthetic: v } }), false, `${JSON.stringify(v)} must not pass`);
  }
  assert.equal(isSynthetic({ custom_fields: {} }), false);
  assert.equal(isSynthetic({}), false);
  assert.equal(isSynthetic(null), false);
});

test("there is no override — the fence takes no force argument", () => {
  // Guards the rule rather than the code: if someone adds an escape hatch,
  // this signature check is what notices.
  const verdict = fenceCheck({
    provider: { key: "x", transmits: true },
    client: realClient(),
    to: "+15559998888",
    env: { LIVE_MODE_RECIPIENT_ALLOWLIST: "+15559998888", FORCE: "1", LIVE_MODE_FORCE: "1", override: true }
  });
  assert.equal(verdict.allowed, false, "no environment variable may turn a refusal into a send");
});

test("allowlist parsing folds phone formats and email case", () => {
  const set = parseAllowlist({ LIVE_MODE_RECIPIENT_ALLOWLIST: " +1 (555) 000-0001 , Chris@Fundhub.AI " });
  assert.ok(set.has(normalizeRecipient("+15550000001")));
  assert.ok(set.has("chris@fundhub.ai"));
  assert.equal(parseAllowlist({}).size, 0);
});

// ── routing ───────────────────────────────────────────────────────────────

test("an unrouted channel is refused, not defaulted", async () => {
  const db = fakeDb({ messages: [queued()], clients: [syntheticClient()], routing: [] });
  const out = await dispatchOne(db, { orgId: ORG, now: () => 0, env: {} });
  assert.equal(out.status, "failed");
  assert.equal(out.reason, "channel_not_routed");
  assert.equal(db.messages[0].status, "failed");
});

test("a disabled channel is refused", async () => {
  const db = fakeDb({
    messages: [queued()],
    clients: [syntheticClient()],
    routing: [{ org_id: ORG, channel: "sms", provider: "memory", enabled: false }]
  });
  await assert.rejects(
    () => resolve(db, { orgId: ORG, channel: "sms" }),
    (e) => e instanceof ProviderError && e.code === "channel_disabled"
  );
});

test("the internal provider holds rather than sends, and does not requeue", async () => {
  const db = fakeDb({ messages: [queued()], clients: [syntheticClient()], routing: [route("sms", "internal")] });
  const out = await dispatchOne(db, { orgId: ORG, now: () => 0, env: {} });
  assert.equal(out.status, "held");
  assert.equal(db.messages[0].status, "held");
  // Draining again finds nothing: 'held' is not 'queued'.
  assert.equal(await dispatchOne(db, { orgId: ORG, now: () => 0, env: {} }), null);
});

test("attempts increments at claim, so a crashed send still counts", async () => {
  const db = fakeDb({ messages: [queued()], clients: [syntheticClient()], routing: [route("sms", "memory")] });
  memory.reset();
  await dispatchOne(db, { orgId: ORG, now: () => 0, env: {} });
  assert.equal(db.messages[0].attempts, 1);
});


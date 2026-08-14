/* The live-mode fence.
 *
 * Carried over from the journey-runner branch's dispatch.test.mjs at the
 * five-branch merge (2026-08-01). That branch's dispatcher was dropped in
 * favour of the cutover branch's, so the tests that belonged to the FENCE
 * rather than to that dispatcher live here instead of dying with it.
 *
 * "Live mode" is not simulated with a flag: these tests stand up a provider
 * whose TRANSMITS is true — the same thing that is true of the real mailgun,
 * resend and twilio modules — and assert the fence closes around it.
 * (ghl_relay is a removed stub: TRANSMITS=false.)
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  check as fenceCheck,
  preflight,
  isSynthetic,
  parseAllowlist,
  normalizeRecipient,
  ALLOWLIST_ENV,
  SYNTHETIC_FIELD
} from "./live-fence.mjs";
import { all as allProviders, resolve } from "./providers/index.mjs";

const ORG = "11111111-1111-1111-1111-111111111111";

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

/* A provider that CAN reach the outside world. Without one, every path takes
   the "cannot transmit" shortcut and the three layers are never exercised. */
const transmitting = { PROVIDER: "test-live", TRANSMITS: true };
const dark = { PROVIDER: "test-dark", TRANSMITS: false };

// ── the marker, layer 1 ──────────────────────────────────────────────────────

test("LIVE MODE: a client without the synthetic marker is refused", () => {
  const r = fenceCheck({
    provider: transmitting,
    client: realClient(),
    to: "+15559998888",
    env: { [ALLOWLIST_ENV]: "+15559998888" }
  });
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.reason, "live_mode_refused_unmarked_client");
  // Refused before the allowlist was even consulted.
  assert.deepStrictEqual(r.gates, ["live-mode"]);
});

test("the synthetic marker is strict — truthy lookalikes are not synthetic", () => {
  for (const value of ["true", 1, "yes", {}, [], "synthetic"]) {
    assert.strictEqual(
      isSynthetic({ custom_fields: { [SYNTHETIC_FIELD]: value } }),
      false,
      `${JSON.stringify(value)} must not count as synthetic`
    );
  }
  assert.strictEqual(isSynthetic({ custom_fields: { [SYNTHETIC_FIELD]: true } }), true);
  assert.strictEqual(isSynthetic(null), false);
  assert.strictEqual(isSynthetic({}), false);
  assert.strictEqual(isSynthetic({ custom_fields: "synthetic" }), false);
});

// ── the allowlist, layer 3 ───────────────────────────────────────────────────

test("LIVE MODE: a synthetic client off the allowlist is refused", () => {
  const r = fenceCheck({
    provider: transmitting,
    client: syntheticClient(),
    to: "+15557776666",
    env: { [ALLOWLIST_ENV]: "+15550000001" }
  });
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.reason, "live_mode_refused_recipient_not_allowlisted");
  assert.deepStrictEqual(r.gates, ["live-mode", "synthetic-marker"]);
});

test("LIVE MODE: a synthetic, allowlisted client goes through", () => {
  const r = fenceCheck({
    provider: transmitting,
    client: syntheticClient(),
    to: "+1 555 000 0001",
    env: { [ALLOWLIST_ENV]: "+15550000001" }
  });
  assert.strictEqual(r.allowed, true);
  assert.strictEqual(r.reason, null);
  assert.deepStrictEqual(r.gates, ["live-mode", "synthetic-marker", "recipient-allowlist"]);
});

test("LIVE MODE with no allowlist configured refuses everything", () => {
  assert.strictEqual(parseAllowlist({}).size, 0);
  const r = fenceCheck({ provider: transmitting, client: syntheticClient(), to: "+15550000001", env: {} });
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.reason, "live_mode_refused_recipient_not_allowlisted");
});

test("LIVE MODE: no recipient at all is refused", () => {
  const r = fenceCheck({
    provider: transmitting,
    client: syntheticClient(),
    to: "",
    env: { [ALLOWLIST_ENV]: "+15550000001" }
  });
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.reason, "live_mode_refused_no_recipient");
});

test("allowlist parsing folds phone formats and email case", () => {
  const set = parseAllowlist({ [ALLOWLIST_ENV]: "+1 (555) 000-0001, Runner+1@FundHub.Test " });
  assert.ok(set.has(normalizeRecipient("+15550000001")));
  assert.ok(set.has(normalizeRecipient("1-555-000-0001")));
  assert.ok(set.has(normalizeRecipient("RUNNER+1@fundhub.test")));
});

// ── the shortcut, and the absence of an override ─────────────────────────────

test("a provider that cannot transmit takes the shortcut and records why", () => {
  const r = fenceCheck({ provider: dark, client: realClient(), to: "someone@example.com", env: {} });
  assert.strictEqual(r.allowed, true);
  assert.deepStrictEqual(r.gates, ["provider-cannot-transmit"]);
});

test("a missing provider is treated as unable to transmit, not as permission", () => {
  const r = fenceCheck({ client: realClient(), to: "x@example.com" });
  assert.strictEqual(r.allowed, true);
  assert.deepStrictEqual(r.gates, ["provider-cannot-transmit"]);
});

test("there is no override — the fence takes no force argument", () => {
  const refused = fenceCheck({
    provider: transmitting,
    client: realClient(),
    to: "someone@example.com",
    env: { [ALLOWLIST_ENV]: "someone@example.com" },
    // Every shape somebody would reach for. None of them may change the answer.
    force: true,
    override: true,
    allowUnmarked: true
  });
  assert.strictEqual(refused.allowed, false);
});

// ── the pre-flight, layer 2 ──────────────────────────────────────────────────

function routingDb(rows) {
  return {
    async query(sql, params = []) {
      assert.match(sql, /FROM message_channel_routing/);
      assert.strictEqual(params[0], ORG);
      return { rows };
    }
  };
}

test("preflight allows a run whose every route is a non-transmitting provider", async () => {
  const r = await preflight(routingDb([
    { channel: "email", provider: "memory" },
    { channel: "sms", provider: "memory" }
  ]), { orgId: ORG });
  assert.strictEqual(r.allowed, true);
  assert.deepStrictEqual(r.transmitting, []);
});

test("preflight refuses a run routed at a provider that can transmit", async () => {
  const r = await preflight(routingDb([
    { channel: "email", provider: "memory" },
    { channel: "sms", provider: "twilio" }
  ]), { orgId: ORG });
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.reason, "live_mode_refused_transmitting_route");
  assert.deepStrictEqual(r.transmitting, ["sms:twilio"]);
});

test("preflight treats an unknown provider as transmitting — it fails closed", async () => {
  const r = await preflight(routingDb([{ channel: "sms", provider: "not_a_provider" }]), { orgId: ORG });
  assert.strictEqual(r.allowed, false);
  assert.deepStrictEqual(r.transmitting, ["sms:not_a_provider"]);
});

test("preflight refuses with no org rather than defaulting to allow", async () => {
  const r = await preflight(routingDb([]), {});
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.reason, "live_mode_preflight_no_org");
});

// ── the posture of the whole provider set ────────────────────────────────────

test("every provider declares TRANSMITS as a boolean", () => {
  for (const p of allProviders()) {
    assert.strictEqual(typeof p.TRANSMITS, "boolean", `${p.PROVIDER} TRANSMITS`);
  }
});

/* The two providers a journey run is allowed to reach. If either of these ever
   starts transmitting, every run starts texting real people — so this is
   asserted by name rather than by counting the set. */
test("memory and internal cannot transmit", () => {
  assert.strictEqual(resolve("memory").TRANSMITS, false);
  assert.strictEqual(resolve("internal").TRANSMITS, false);
});

/* The mirror of the test above, and the reason the fence exists at all: the
   live vendor providers CAN transmit, so a run must never be routed at one. */
test("the vendor providers declare that they transmit", () => {
  for (const name of ["mailgun", "resend", "twilio"]) {
    assert.strictEqual(resolve(name).TRANSMITS, true, `${name} must declare TRANSMITS = true`);
  }
  assert.strictEqual(resolve("ghl_relay").TRANSMITS, false, "ghl_relay is a removed stub");
});

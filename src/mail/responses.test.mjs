// Unit tests for src/mail/responses.mjs — the parts that need no database.
//
// WHAT IS DELIBERATELY NOT HERE. There is no in-memory `mail_universe`, no fake
// `mail_responses`, and no stub that returns rows. Everything that touches the
// schema — the happy path, an unknown slug, duplicate-response idempotency,
// attribution's nulls — is in responses.pg.test.mjs and asserted against real
// Postgres. AUDIT-FINDINGS is explicit about why: a fake models the schema you
// wish you had, so it cannot fail when the real schema moves.
//
// WHAT IS HERE. Two things a database could not prove anyway:
//
//   1. The exported vocabularies are closed and are the ones the schema and the
//      seed actually contain.
//   2. INVALID INPUT NEVER REACHES THE DATABASE. Every test below that passes a
//      bad argument passes a `db` whose query() throws on sight. If validation
//      ever slips behind the first statement, that db turns the test red. This
//      is not a fake standing in for Postgres — it is an assertion that Postgres
//      is not called at all.

import { test } from "node:test";
import assert from "node:assert";
import {
  MailResponseError,
  RESPONSE_CHANNELS,
  MAIL_OUTCOME_TIERS,
  isResponseChannel,
  isOutcomeTier,
  recordResponse,
  setOutcomeTier,
  attributionByCampaign
} from "./responses.mjs";

/** A db that fails the test if anything asks it to run a statement. */
const noQuery = {
  query() {
    throw new Error("the database was queried — validation did not short-circuit");
  }
};

/* =========================================================================
 * The vocabularies
 * ========================================================================= */

test("RESPONSE_CHANNELS is exactly the set mail_responses_channel_ck allows", () => {
  assert.deepStrictEqual([...RESPONSE_CHANNELS].sort(), ["email", "mail", "sms", "voice", "web"]);
});

test("RESPONSE_CHANNELS is frozen: a caller cannot widen the channel vocabulary at runtime", () => {
  assert.throws(() => RESPONSE_CHANNELS.push("carrier_pigeon"), TypeError);
});

test("isResponseChannel: a plausible-looking channel that is not in the schema is rejected", () => {
  assert.equal(isResponseChannel("web"), true);
  assert.equal(isResponseChannel("phone"), false);   // the schema says 'voice'
  assert.equal(isResponseChannel("text"), false);    // the schema says 'sms'
  assert.equal(isResponseChannel("WEB"), false);     // exact match only
  assert.equal(isResponseChannel(undefined), false);
});

test("MAIL_OUTCOME_TIERS is the sales pipeline stage keys in seed order, not a new vocabulary", () => {
  assert.deepStrictEqual([...MAIL_OUTCOME_TIERS], [
    "new_lead", "survey_complete", "booked", "confirmed", "showed",
    "diagnostic_paid", "decision_rendered", "closed_won", "downsell", "lost"
  ]);
});

test("MAIL_OUTCOME_TIERS deliberately excludes the clients.outcome_tier CRS vocabulary", () => {
  // 065's header: those six are the post-soft-pull decision tier for a client.
  // A mail respondent has not been through a soft pull, so labelling one
  // FULL_FUNDING would assert an underwriting outcome nothing produced.
  for (const crs of ["FRAUD_HOLD", "MANUAL_REVIEW", "REPAIR_ONLY",
                     "FUNDING_PLUS_REPAIR", "FULL_FUNDING", "PREMIUM_STACK"]) {
    assert.equal(isOutcomeTier(crs), false, `${crs} must not be a mail outcome tier`);
  }
});

test("MAIL_OUTCOME_TIERS is frozen: the closed vocabulary cannot be extended at runtime", () => {
  assert.throws(() => MAIL_OUTCOME_TIERS.push("hot_lead"), TypeError);
});

/* =========================================================================
 * recordResponse — validation happens before any statement runs
 * ========================================================================= */

test("recordResponse: a missing db is a typed error, not a TypeError on undefined.query", async () => {
  await assert.rejects(
    () => recordResponse(null, { slug: "ABC", channel: "web", respondedAt: new Date() }),
    (e) => e instanceof MailResponseError && e.code === "db_required"
  );
});

test("recordResponse: a missing slug is refused without touching the database", async () => {
  await assert.rejects(
    () => recordResponse(noQuery, { channel: "web", respondedAt: new Date() }),
    (e) => e instanceof MailResponseError && e.code === "slug_required" && e.status === 400
  );
});

test("recordResponse: a blank slug is refused rather than resolving to nothing", async () => {
  await assert.rejects(
    () => recordResponse(noQuery, { slug: "   ", channel: "web", respondedAt: new Date() }),
    (e) => e instanceof MailResponseError && e.code === "slug_required"
  );
});

test("recordResponse: an unknown channel is refused before the slug is even looked up", async () => {
  await assert.rejects(
    () => recordResponse(noQuery, { slug: "ABC", channel: "carrier_pigeon", respondedAt: new Date() }),
    (e) => e instanceof MailResponseError && e.code === "unknown_channel" && e.status === 400
  );
});

test("recordResponse: respondedAt is required — this module never invents the time a person responded", async () => {
  await assert.rejects(
    () => recordResponse(noQuery, { slug: "ABC", channel: "web" }),
    (e) => e instanceof MailResponseError && e.code === "responded_at_required"
  );
});

test("recordResponse: an unparseable respondedAt is a typed error, not an Invalid Date written to the log", async () => {
  await assert.rejects(
    () => recordResponse(noQuery, { slug: "ABC", channel: "web", respondedAt: "last tuesday" }),
    (e) => e instanceof MailResponseError && e.code === "responded_at_invalid"
  );
});

test("recordResponse: a payload carrying a NUL is refused, not silently stripped of evidence", async () => {
  const nul = String.fromCharCode(0);
  await assert.rejects(
    () => recordResponse(noQuery, {
      slug: "ABC", channel: "web", respondedAt: new Date(),
      payload: { utm: `google${nul}drop` }
    }),
    (e) => e instanceof MailResponseError && e.code === "payload_not_storable"
  );
});

test("recordResponse: a non-object payload is refused rather than coerced into raw", async () => {
  await assert.rejects(
    () => recordResponse(noQuery, {
      slug: "ABC", channel: "web", respondedAt: new Date(), payload: "utm=google"
    }),
    (e) => e instanceof MailResponseError && e.code === "payload_not_an_object"
  );
});

test("recordResponse: a circular payload is a typed error rather than a thrown TypeError", async () => {
  const p = { a: 1 };
  p.self = p;
  await assert.rejects(
    () => recordResponse(noQuery, { slug: "ABC", channel: "web", respondedAt: new Date(), payload: p }),
    (e) => e instanceof MailResponseError && e.code === "payload_not_serialisable"
  );
});

test("recordResponse: a non-uuid clientId is refused before it can reach a foreign key", async () => {
  await assert.rejects(
    () => recordResponse(noQuery, {
      slug: "ABC", channel: "web", respondedAt: new Date(), clientId: "1; DROP TABLE clients"
    }),
    (e) => e instanceof MailResponseError && e.code === "client_id_not_a_uuid"
  );
});

test("recordResponse: a non-uuid trackedNumberId is refused before it can reach a foreign key", async () => {
  await assert.rejects(
    () => recordResponse(noQuery, {
      slug: "ABC", channel: "web", respondedAt: new Date(), trackedNumberId: "not-a-uuid"
    }),
    (e) => e instanceof MailResponseError && e.code === "tracked_number_id_not_a_uuid"
  );
});

test("recordResponse: no error message this module raises before the lookup echoes the caller's slug", async () => {
  const hostile = "<script>alert(1)</script>";
  for (const args of [
    { slug: hostile, channel: "nope", respondedAt: new Date() },
    { slug: hostile, channel: "web" },
    { slug: hostile, channel: "web", respondedAt: "garbage" }
  ]) {
    await assert.rejects(() => recordResponse(noQuery, args), (e) => {
      assert.ok(e instanceof MailResponseError);
      assert.ok(!e.message.includes(hostile), `message reflected the slug: ${e.message}`);
      return true;
    });
  }
});

/* =========================================================================
 * setOutcomeTier — validation happens before any statement runs
 * ========================================================================= */

test("setOutcomeTier: an invented marketing tier is rejected, and the database is never asked", async () => {
  await assert.rejects(
    () => setOutcomeTier(noQuery, { recordId: "11111111-1111-4111-8111-111111111111", tier: "HOT" }),
    (e) => e instanceof MailResponseError && e.code === "unknown_outcome_tier" && e.status === 400
  );
});

test("setOutcomeTier: a CRS tier from clients.outcome_tier is rejected — it is a different vocabulary", async () => {
  await assert.rejects(
    () => setOutcomeTier(noQuery, {
      recordId: "11111111-1111-4111-8111-111111111111", tier: "FULL_FUNDING"
    }),
    (e) => e instanceof MailResponseError && e.code === "unknown_outcome_tier"
  );
});

test("setOutcomeTier: the rejection message names the allowed set and never the rejected value", async () => {
  const hostile = "'; UPDATE mail_universe SET outcome_tier='x'; --";
  await assert.rejects(
    () => setOutcomeTier(noQuery, {
      recordId: "11111111-1111-4111-8111-111111111111", tier: hostile
    }),
    (e) => {
      assert.ok(!e.message.includes(hostile));
      assert.ok(e.message.includes("closed_won"));
      return true;
    }
  );
});

test("setOutcomeTier: a non-uuid recordId is refused without touching the database", async () => {
  await assert.rejects(
    () => setOutcomeTier(noQuery, { recordId: "abc", tier: "booked" }),
    (e) => e instanceof MailResponseError && e.code === "record_id_not_a_uuid"
  );
});

test("setOutcomeTier: a missing db is a typed error", async () => {
  await assert.rejects(
    () => setOutcomeTier(undefined, { recordId: "11111111-1111-4111-8111-111111111111", tier: "lost" }),
    (e) => e instanceof MailResponseError && e.code === "db_required"
  );
});

/* =========================================================================
 * attributionByCampaign — validation happens before any statement runs
 * ========================================================================= */

test("attributionByCampaign: a missing campaignId is refused rather than counting every campaign", async () => {
  await assert.rejects(
    () => attributionByCampaign(noQuery, {}),
    (e) => e instanceof MailResponseError && e.code === "campaign_id_required"
  );
});

test("attributionByCampaign: a blank campaignId is refused", async () => {
  await assert.rejects(
    () => attributionByCampaign(noQuery, { campaignId: "  " }),
    (e) => e instanceof MailResponseError && e.code === "campaign_id_required"
  );
});

test("attributionByCampaign: a non-uuid orgId is refused before it reaches a uuid cast", async () => {
  await assert.rejects(
    () => attributionByCampaign(noQuery, { campaignId: "DROP_1", orgId: "everyone" }),
    (e) => e instanceof MailResponseError && e.code === "org_id_not_a_uuid"
  );
});

/* =========================================================================
 * The error type itself
 * ========================================================================= */

test("MailResponseError carries a snake_case code and an HTTP status for the write-endpoint catch", () => {
  const e = new MailResponseError("boom", { code: "unknown_slug", status: 404 });
  assert.ok(e instanceof Error);
  assert.equal(e.name, "MailResponseError");
  assert.equal(e.code, "unknown_slug");
  assert.equal(e.status, 404);
});

test("MailResponseError defaults to a 400 rather than an accidental 200 or 500", () => {
  const e = new MailResponseError("boom");
  assert.equal(e.code, "mail_response_error");
  assert.equal(e.status, 400);
});

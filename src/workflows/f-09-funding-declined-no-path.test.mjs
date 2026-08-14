import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handle } from "./f-09-funding-declined-no-path.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";
import { resolveClientFromRecipient } from "../adapters/mailgun.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "f-09-funding-declined-no-path.mjs");

async function withFetchTrap(fn) {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls.push({ url: String(args[0]), via: "global.fetch" });
    throw new Error(`F-09 must not fetch (${String(args[0])})`);
  };
  try {
    return await fn({ calls });
  } finally {
    globalThis.fetch = prev;
  }
}

test("happy path: DENIED bank reply on a funding-path client flags ops + holds the round", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING" }],
    fundingRounds: [{ id: "fr-1", client_id: "cl-1", round_number: 2, hold_reason: null }]
  });
  const res = await handle({ event: ev("mail.response", { classification: "DENIED" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(res.round.updated, true);
  assert.equal(db.fundingRounds[0].hold_reason, "Internal Review");
  assert.deepEqual(db.clients[0].tags, ["ops:action-required"]);
  assert.equal(db.tasks.length, 1);
});

test("branch: non-DENIED classification is ignored", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING" }] });
  const res = await handle({ event: ev("mail.response", { classification: "APPROVED" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "not_denied");
});

test("branch: repair-only client (not funding path) is ignored", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "REPAIR_ONLY" }] });
  const res = await handle({ event: ev("mail.response", { classification: "DENIED" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "not_funding_path:REPAIR_ONLY");
});

test("branch: first of several bank denials does NOT flag no-path when other apps are still pending", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING" }],
    fundingRounds: [{ id: "fr-1", client_id: "cl-1", round_number: 1, hold_reason: null }],
    applications: [
      { id: "app-1", funding_round_id: "fr-1", status: "DENIED" },
      { id: "app-2", funding_round_id: "fr-1", status: "PENDING" }
    ]
  });
  const res = await handle({ event: ev("mail.response", { classification: "DENIED" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "pending_applications");
  assert.equal(db.fundingRounds[0].hold_reason, null);
  assert.equal(db.tasks.length, 0);
});

test("branch: all banks denied triggers hold and task", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING" }],
    fundingRounds: [{ id: "fr-1", client_id: "cl-1", round_number: 1, hold_reason: null }],
    applications: [
      { id: "app-1", funding_round_id: "fr-1", status: "DENIED" },
      { id: "app-2", funding_round_id: "fr-1", status: "DENIED" }
    ]
  });
  const res = await handle({ event: ev("mail.response", { classification: "DENIED" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(db.fundingRounds[0].hold_reason, "Internal Review");
  assert.equal(db.tasks.length, 1);
});

// GUARD (revives passively off the mailgun adapter fix): F-09 relies entirely on the
// adapter resolving a clientId from F-10's monitor+<clientId>@ forwarding address. Every
// other test above hands the client in directly via ev()'s clientId shortcut, so none of
// them actually exercise that resolution — a regression in the adapter's plus-address
// parsing would go unnoticed here. This one runs a raw recipient through the real
// resolver and feeds the result through, same shape bus.mjs hands the workflow.
test("GUARD: a raw monitor+<clientId>@ recipient resolves a real client, not no_client", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING" }],
    fundingRounds: [{ id: "fr-1", client_id: "cl-1", round_number: 1, hold_reason: null }]
  });
  const clientId = await resolveClientFromRecipient(db, "monitor+cl-1@fundhub.ai");
  const res = await handle({
    event: { id: "evt-guard-f09", orgId: "org-1", clientId, payload: { classification: "DENIED", to: "monitor+cl-1@fundhub.ai", source: "mailgun" } },
    db, step: fakeStep()
  });
  assert.notEqual(res.reason, "no_client");
  assert.equal(res.done, true);
  assert.equal(db.fundingRounds[0].hold_reason, "Internal Review");
});

test("duplicate delivery: replaying the same event does not double-create the task", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING" }],
    fundingRounds: [{ id: "fr-1", client_id: "cl-1", round_number: 1, hold_reason: null }]
  });
  const event = ev("mail.response", { classification: "DENIED" }, { id: "evt-dup-f09", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.tasks.length, 1);
});

test("smash: missing client → no throw, no task, no CRS", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [], fundingRounds: [{ id: "fr-1", client_id: "cl-missing", round_number: 1, hold_reason: null }] });
    const res = await handle({
      event: ev("mail.response", { classification: "DENIED" }),
      db,
      step: fakeStep()
    });
    assert.equal(res.done, false);
    assert.equal(res.reason, "no_client");
    assert.equal(db.fundingRounds[0].hold_reason, null);
    assert.equal(db.tasks.length, 0);
    assert.equal(db.messages.length, 0);
    assert.equal(db.events.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: empty / non-DENIED payload → not_denied, no throw, no task, no CRS", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({
      clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING" }],
      fundingRounds: [{ id: "fr-1", client_id: "cl-1", round_number: 1, hold_reason: null }]
    });
    for (const payload of [null, {}, { classification: "" }, { classification: null }, { classification: "APPROVED" }]) {
      const res = await handle({
        event: ev("mail.response", payload, { id: `evt-empty-${JSON.stringify(payload)}`, clientId: "cl-1" }),
        db,
        step: fakeStep()
      });
      assert.equal(res.done, false);
      assert.equal(res.reason, "not_denied");
    }
    assert.equal(db.fundingRounds[0].hold_reason, null);
    assert.equal(db.tasks.length, 0);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: null / non-object event → no_event, no throw", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [] });
    for (const event of [null, undefined, "nope", 7]) {
      const res = await handle({ event, db, step: fakeStep() });
      assert.equal(res.done, false);
      assert.equal(res.reason, "no_event");
    }
    assert.equal(db.tasks.length, 0);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("source must not pull CRS, send mail/SMS, or flip CRS_ALLOW_LIVE", () => {
  const code = readFileSync(SRC, "utf8");
  assert.doesNotMatch(code, /\bfetch\s*\(/);
  assert.doesNotMatch(code, /\bfetchImpl\b/);
  assert.doesNotMatch(code, /\bsendTemplated\b/);
  assert.doesNotMatch(code, /\brunCrsPull\b/);
  assert.doesNotMatch(code, /\brequestSoftPull\b/);
  assert.doesNotMatch(code, /\bcrs-pull\b/);
  assert.doesNotMatch(code, /\bCRS_ALLOW_LIVE\b/);
  assert.doesNotMatch(code, /\bsoft_pull\b/);
  assert.doesNotMatch(code, /\bproviders\//);
  assert.doesNotMatch(code, /\bbland\b/i);
  assert.doesNotMatch(code, /\bmailgun\b/i);
  assert.doesNotMatch(code, /\bresend\b/i);
  assert.doesNotMatch(code, /vercel\.app/);
});

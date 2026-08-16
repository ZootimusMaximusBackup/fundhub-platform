import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  handle, isHardDecline, HARD_DECLINE_SIGNALS_DEFERRED,
  DECLINE_EMAIL_TEMPLATE_KEY, DECLINE_SMS_TEMPLATE_KEY
} from "./c-06-crs-results-router.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const C06_SOURCE_PATH = fileURLToPath(new URL("./c-06-crs-results-router.mjs", import.meta.url));
const BANNED_UIQ_URL = "https://underwrite-iq-lite.vercel.app/api/lite/deliver-letters";

function stripCommentLines(source) {
  return source.split("\n").filter((line) => {
    const t = line.trim();
    return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
  }).join("\n");
}

async function withFetchTrap(fn) {
  const prevFetch = globalThis.fetch;
  const prevUrl = process.env.UIQ_DELIVER_LETTERS_URL;
  const prevGhl = process.env.GHL_API_KEY;
  const prevGhlRelay = process.env.GHL_RELAY_API_KEY;
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push({ url: String(args[0]), via: "globalThis.fetch" });
    throw new Error(`C-06 must not fetch (${String(args[0])})`);
  };
  process.env.UIQ_DELIVER_LETTERS_URL = BANNED_UIQ_URL;
  delete process.env.GHL_API_KEY;
  delete process.env.GHL_RELAY_API_KEY;
  const fetchImpl = async (...args) => {
    calls.push({ url: String(args[0]), via: "fetchImpl" });
    throw new Error(`C-06 must not POST via fetchImpl (${String(args[0])})`);
  };
  try {
    return await fn({ calls, fetchImpl });
  } finally {
    globalThis.fetch = prevFetch;
    if (prevUrl === undefined) delete process.env.UIQ_DELIVER_LETTERS_URL;
    else process.env.UIQ_DELIVER_LETTERS_URL = prevUrl;
    if (prevGhl === undefined) delete process.env.GHL_API_KEY;
    else process.env.GHL_API_KEY = prevGhl;
    if (prevGhlRelay === undefined) delete process.env.GHL_RELAY_API_KEY;
    else process.env.GHL_RELAY_API_KEY = prevGhlRelay;
  }
}

test("happy path: funding-path CRS results tag path:funding", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING", custom_fields: {} }] });
  const res = await handle({ event: ev("analysis.completed", { source: "crs", scores: { ex: 650 } }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.branch, "funding");
  assert.deepEqual(db.clients[0].tags, ["path:funding"]);
  assert.equal(db.messages.length, 0);
});

// Regression (Model drift audit): the production shape. The CRS adapter emits
// analysis.completed before decision.rendered writes clients.outcome_tier, so the
// column is null here — the tier has to come off the payload or this routes every
// real pull to "not_funding".
test("routes from the payload tier when clients.outcome_tier is not written yet", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: null, custom_fields: {} }] });
  const res = await handle({
    event: ev("analysis.completed", { source: "crs", outcomeTier: "FULL_FUNDING", scores: { ex: 650 } }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.branch, "funding");
  assert.deepEqual(db.clients[0].tags, ["path:funding"]);
});

test("routes repair from the payload tier with the column still null", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: null }] });
  const res = await handle({
    event: ev("analysis.completed", { source: "crs", outcomeTier: "REPAIR_ONLY", scores: { ex: 600 } }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.branch, "repair");
  assert.deepEqual(db.clients[0].tags, ["path:repair"]);
  assert.equal(db.messages.length, 0);
});

test("a re-pull's payload tier wins over the stale column", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "REPAIR_ONLY", custom_fields: {} }] });
  const res = await handle({
    event: ev("analysis.completed", { source: "crs", outcomeTier: "PREMIUM_STACK", scores: { ex: 780 } }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.branch, "funding");
});

test("branch: missing results holds instead of routing", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const res = await handle({ event: ev("analysis.completed", { source: "crs", scores: {} }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.branch, "missing_results");
  assert.deepEqual(db.clients[0].tags, ["hold:snapshot_missing"]);
  assert.equal(db.messages.length, 0);
});

test("branch: non-CRS source is ignored", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const res = await handle({ event: ev("analysis.completed", { source: "analyzer" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "not_crs_source");
  assert.equal(db.messages.length, 0);
});

// --- DECLINE branch (05/30 Stage 5, doc 84-86 / 4204-4222) -------------------
// The branch is wired end to end but GATE C-06C is DEFERRED (doc 4204: "exact field/tag
// names until CRS onboarding finalizes"). These tests lock in that it NO-OPS rather than
// guessing — the day the signal map lands, flip HARD_DECLINE_SIGNALS_DEFERRED and the
// third test below is what proves the wiring was already correct.

test("DEFERRED: hard-decline detection no-ops — no decline messaging fires on a guess", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: null, custom_fields: {} }] });
  const res = await handle({
    // every shape that might read as a decline to a guessing implementation
    event: ev("analysis.completed", {
      source: "crs", scores: { ex: 480 }, ofac: true, fraudAlert: true,
      publicRecords: ["bankruptcy"], outcomeTier: "FRAUD_HOLD"
    }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.notEqual(res.branch, "decline", "must not decline while the signal map is DEFERRED");
  assert.equal(db.messages.length, 0, "no decline email or SMS may send off an invented threshold");
  assert.ok(!(db.clients[0].tags || []).includes("hold:declined"));
});

test("isHardDecline is the single deferred detector, and it is currently a no-op", () => {
  assert.equal(HARD_DECLINE_SIGNALS_DEFERRED, true);
  assert.equal(isHardDecline({ ofac: true, fraudAlert: true }), false);
});

test("the DECLINE branch is fully wired — it fires the moment the detector returns true", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: null, custom_fields: {} }],
    templates: [
      { org_id: "org-1", template_key: DECLINE_EMAIL_TEMPLATE_KEY, channel: "email", body: "declined", compliance_passed: true },
      { org_id: "org-1", template_key: DECLINE_SMS_TEMPLATE_KEY, channel: "sms", body: "declined", compliance_passed: true }
    ]
  });
  // Exercise the branch directly, standing in for the future real detector.
  const res = await handle({
    event: ev("analysis.completed", { source: "crs", scores: { ex: 480 } }, { clientId: "cl-1" }),
    db, step: fakeStep(), detectDecline: () => true
  });
  assert.equal(res.branch, "decline");
  assert.deepEqual(db.clients[0].tags, ["hold:declined"]);
  assert.equal(db.clients[0].custom_fields.hard_stop_reason, "disqualified");
  assert.equal(db.messages.length, 2, "decline email + SMS");
  assert.equal(db.tasks.length, 1);
});

// The test above exercises the wiring via a totally separate `detectDecline` override —
// it never actually calls isHardDecline, so it wouldn't catch a bug in the flag-gating
// itself. HARD_DECLINE_SIGNALS_DEFERRED is a `const`, so a test can't flip it directly;
// `deferred`/`signalMap` on isHardDecline are the seam that lets this go through the real
// function instead. This proves that the day the flag is off and a signal map exists,
// the branch is verified end to end rather than hoped.
test("flipping HARD_DECLINE_SIGNALS_DEFERRED off (via isHardDecline's own gate, not an unrelated override) reaches the decline branch end to end", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: null, custom_fields: {} }],
    templates: [
      { org_id: "org-1", template_key: DECLINE_EMAIL_TEMPLATE_KEY, channel: "email", body: "declined", compliance_passed: true },
      { org_id: "org-1", template_key: DECLINE_SMS_TEMPLATE_KEY, channel: "sms", body: "declined", compliance_passed: true }
    ]
  });
  const res = await handle({
    event: ev("analysis.completed", { source: "crs", scores: { ex: 480 } }, { clientId: "cl-1" }),
    db, step: fakeStep(),
    // Stands in for "HARD_DECLINE_SIGNALS_DEFERRED flipped to false, signal map landed" —
    // still routes through the real isHardDecline, just with its gate/map overridden.
    detectDecline: (payload) => isHardDecline(payload, { deferred: false, signalMap: () => true })
  });
  assert.equal(res.branch, "decline");
  assert.deepEqual(db.clients[0].tags, ["hold:declined"]);
  assert.equal(db.clients[0].custom_fields.hard_stop_reason, "disqualified");
  assert.equal(db.messages.length, 2, "decline email + SMS");
  assert.equal(db.tasks.length, 1);
});

// Funding letters ship from U-02 (in-repo Claude + Resend). C-06 only tags the path.

test("funding branch tags the path and does not POST a Vercel letter webhook", async () => {
  await withFetchTrap(async ({ fetchImpl, calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING", custom_fields: {} }] });
    const res = await handle({
      event: ev("analysis.completed", { source: "crs", scores: { ex: 650 } }, { id: "evt-c06-funding", clientId: "cl-1" }),
      db, step: fakeStep(), fetchImpl
    });
    assert.equal(res.branch, "funding");
    assert.equal(res.delivery.reason, "letters_ship_from_u-02");
    assert.equal(res.delivery.delivered, false);
    assert.equal(res.delivery.status, undefined);
    assert.deepEqual(db.clients[0].tags, ["path:funding"]);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0, "handle must not call fetch even when UIQ_DELIVER_LETTERS_URL is set");
  });
});

test("source: C-06 has no Vercel / GHL / deliver-letters POST", () => {
  const raw = readFileSync(C06_SOURCE_PATH, "utf8");
  assert.ok(raw.includes("tag-path-funding"), "canary: C-06 source was actually read");
  const code = stripCommentLines(raw);
  assert.doesNotMatch(code, /\bfetch\s*\(/);
  assert.doesNotMatch(code, /\bfetchImpl\b/);
  assert.doesNotMatch(code, /\bglobalThis\.fetch\b/);
  assert.doesNotMatch(code, /\bpostJsonTo\b/);
  assert.doesNotMatch(code, /outbound-fetch/);
  assert.doesNotMatch(code, /DELIVER_LETTERS/);
  assert.doesNotMatch(code, /UIQ_DELIVER/);
  assert.doesNotMatch(code, /vercel\.app/i);
  assert.doesNotMatch(code, /underwrite-iq-lite/);
  assert.doesNotMatch(code, /ds-02-diy-letters/);
  assert.doesNotMatch(code, /\bGHL\b/);
  assert.doesNotMatch(code, /leadconnector/i);
  assert.doesNotMatch(code, /gohighlevel/i);
});

test("MANUAL_REVIEW is not_funding: no path tag, no send, no fetch", async () => {
  await withFetchTrap(async ({ fetchImpl, calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: null, custom_fields: {} }] });
    const res = await handle({
      event: ev("analysis.completed", { source: "crs", outcomeTier: "MANUAL_REVIEW", scores: { ex: 640 } }, { clientId: "cl-1" }),
      db, step: fakeStep(), fetchImpl
    });
    assert.equal(res.branch, "not_funding");
    assert.equal(res.outcomeTier, "MANUAL_REVIEW");
    assert.ok(!(db.clients[0].tags || []).includes("path:funding"));
    assert.ok(!(db.clients[0].tags || []).includes("path:repair"));
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("payload MANUAL_REVIEW beats a stale funding column — no funding tag, no fetch", async () => {
  await withFetchTrap(async ({ fetchImpl, calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING", custom_fields: {} }] });
    const res = await handle({
      event: ev("analysis.completed", { source: "crs", outcomeTier: "MANUAL_REVIEW", scores: { ex: 640 } }, { clientId: "cl-1" }),
      db, step: fakeStep(), fetchImpl
    });
    assert.equal(res.branch, "not_funding");
    assert.ok(!(db.clients[0].tags || []).includes("path:funding"));
    assert.ok(!(db.clients[0].tags || []).includes("path:repair"));
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("FRAUD_HOLD is not_funding: no path tag, no send, no fetch", async () => {
  await withFetchTrap(async ({ fetchImpl, calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: null, custom_fields: {} }] });
    const res = await handle({
      event: ev("analysis.completed", { source: "crs", outcomeTier: "FRAUD_HOLD", scores: { ex: 480 } }, { clientId: "cl-1" }),
      db, step: fakeStep(), fetchImpl
    });
    assert.equal(res.branch, "not_funding");
    assert.equal(res.outcomeTier, "FRAUD_HOLD");
    assert.ok(!(db.clients[0].tags || []).includes("path:funding"));
    assert.ok(!(db.clients[0].tags || []).includes("path:repair"));
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("missing client does not throw and does not send", async () => {
  await withFetchTrap(async ({ fetchImpl, calls }) => {
    const db = pgFake({ clients: [] });
    const res = await handle({
      event: ev("analysis.completed", { source: "crs", scores: { ex: 650 } }),
      db, step: fakeStep(), fetchImpl
    });
    assert.equal(res.done, false);
    assert.equal(res.reason, "no_client");
    assert.equal(db.messages.length, 0);
    assert.equal(db.tasks.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("CRS payload with no scores key holds and does not send or fetch", async () => {
  await withFetchTrap(async ({ fetchImpl, calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
    const res = await handle({
      event: ev("analysis.completed", { source: "crs" }, { clientId: "cl-1" }),
      db, step: fakeStep(), fetchImpl
    });
    assert.equal(res.branch, "missing_results");
    assert.deepEqual(db.clients[0].tags, ["hold:snapshot_missing"]);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("repair branch does not fetch deliver-letters even when UIQ_DELIVER_LETTERS_URL is set", async () => {
  await withFetchTrap(async ({ fetchImpl, calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "REPAIR_ONLY", custom_fields: {} }] });
    const res = await handle({
      event: ev("analysis.completed", { source: "crs", scores: { ex: 600 } }, { clientId: "cl-1" }),
      db, step: fakeStep(), fetchImpl
    });
    assert.equal(res.branch, "repair");
    assert.deepEqual(db.clients[0].tags, ["path:repair"]);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("FUNDING_PLUS_REPAIR tags path:funding and still does not fetch", async () => {
  await withFetchTrap(async ({ fetchImpl, calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: null, custom_fields: {} }] });
    const res = await handle({
      event: ev("analysis.completed", { source: "crs", outcomeTier: "FUNDING_PLUS_REPAIR", scores: { ex: 700, eq: 690, tu: 710 } }, { clientId: "cl-1" }),
      db, step: fakeStep(), fetchImpl
    });
    assert.equal(res.branch, "funding");
    assert.equal(res.delivery.delivered, false);
    assert.equal(res.delivery.reason, "letters_ship_from_u-02");
    assert.deepEqual(db.clients[0].tags, ["path:funding"]);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

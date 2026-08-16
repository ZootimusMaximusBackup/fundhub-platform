// Adversarial tests for the outbound messaging gate.
//
// Written to BREAK the gate, not to confirm it works. Every rule gets both
// directions, because both directions are bugs:
//
//   a BLOCKED case   — a message that must not reach a provider
//   a NEAR-MISS case — a message deliberately close to the blocked one that
//                      must still be ALLOWED
//
// The near-misses carry the weight. A quiet-hours rule that holds everything is
// as broken as one that holds nothing; it just fails in the direction where
// somebody turns the gate off instead of filing a bug.
//
// NO BYPASS IS USED ANYWHERE IN THIS FILE. Every case drives gate() with real
// inputs, and one test asserts that an options object carrying a bypass is
// rejected. If a future edit finds these tests inconvenient, the gate is what
// is right and the test is what changes — never the other way round.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  gate, gateAndRecord, inQuietHours, easternHour,
  QUIET_START_HOUR, QUIET_END_HOUR, QUIET_HOURS_TZ, GATE_SOURCE
} from "./gate.mjs";
import { clearRuleCache } from "../compliance/screen.mjs";
import { TASK_ROLES } from "../lib/create-task.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.join(HERE, "../../db/migrations/047_compliance_rules.sql");

const ORG = "00000000-0000-4000-8000-000000000001";
const CLIENT = "00000000-0000-4000-8000-000000000003";
const MESSAGE = "00000000-0000-4000-8000-000000000004";

/* The rules, parsed out of the migration's VALUES block — the same approach
   src/compliance/screen.test.mjs takes, for the same reason: reading the real
   SQL means a typo in the migration fails these tests instead of being mirrored
   by a hand-kept copy that was edited alongside it. */
function seededRules() {
  const sql = fs.readFileSync(MIGRATION, "utf8");
  const block = sql.slice(sql.indexOf("CROSS JOIN (VALUES"), sql.indexOf("AS v(rule_set"));
  const rows = [];
  const re = /\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*\)/g;
  let m;
  while ((m = re.exec(block))) {
    const [, rule_set, rule_key, offer_types, platforms, match_type, pattern, severity, message, citation] = m;
    rows.push({
      rule_set, rule_key,
      offer_types: JSON.parse(offer_types),
      platforms: JSON.parse(platforms),
      match_type,
      pattern: pattern.replace(/''/g, "'"),
      severity,
      message: message.replace(/''/g, "'"),
      citation
    });
  }
  return rows;
}

const RULES = seededRules();

/* A db stand-in. `optedOut` is the set of "<client>:<channel>" pairs currently
   opted out. writes[] records every mutation so the tests can assert on what was
   persisted — and, just as importantly, on what was not. */
function fakeDb({ rules = RULES, optedOut = new Set(), failOptOut = false } = {}) {
  const writes = [];
  return {
    writes,
    query: async (sql, params) => {
      if (sql.includes("FROM opt_outs")) {
        if (failOptOut) throw new Error("connection terminated unexpectedly");
        return { rows: optedOut.has(`${params[0]}:${params[1]}`) ? [{ "?column?": 1 }] : [] };
      }
      if (sql.includes("FROM compliance_rules")) return { rows: rules };
      if (sql.includes("UPDATE messages")) { writes.push({ kind: "message", sql, params }); return { rows: [] }; }
      // createTask's dedupe probe: no existing task, so the insert proceeds.
      if (sql.includes("FROM tasks")) return { rows: [] };
      if (sql.includes("INSERT INTO tasks")) {
        writes.push({ kind: "task", sql, params });
        return { rows: [{ id: "00000000-0000-4000-8000-0000000000aa" }] };
      }
      throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
    }
  };
}

// 2026-08-01 is a Saturday in EDT (UTC-4). 16:00Z = 12:00 Eastern — the middle
// of the open window, so it isolates every non-quiet-hours case from the clock.
const MIDDAY = () => new Date("2026-08-01T16:00:00Z");

const base = { orgId: ORG, clientId: CLIENT, channel: "sms", body: "Hello, your file was updated." };
const run = (over = {}, dbOpts = {}) => gate(fakeDb(dbOpts), { ...base, ...over }, { now: MIDDAY });
const codes = (res) => res.reasons.map((x) => x.code);

beforeEach(() => clearRuleCache());

// ---------------------------------------------------------------------------
// The baseline. If this does not pass, every "blocked" below proves nothing —
// a gate that blocks everything would satisfy all of them.
// ---------------------------------------------------------------------------

describe("a clean message", () => {
  test("is allowed", async () => {
    const res = await run();
    assert.strictEqual(res.state, "allowed", `unexpectedly blocked: ${JSON.stringify(codes(res))}`);
    assert.deepStrictEqual(res.reasons, []);
    assert.strictEqual(res.task, null);
  });

  test("is allowed on email too", async () => {
    const res = await run({ channel: "email" });
    assert.strictEqual(res.state, "allowed", `unexpectedly blocked: ${JSON.stringify(codes(res))}`);
  });
});

// ---------------------------------------------------------------------------
// Smash: null / junk bodies are held — never "allowed", never sent.
// ---------------------------------------------------------------------------

describe("smash: null/junk body is held, not sent", () => {
  // Same junk set compose refuses before queueing. The gate is the second fence
  // for rows that somehow still got into messages.
  for (const body of [undefined, null, "", "   ", "\n\t ", 42, {}, []]) {
    test(`holds body=${JSON.stringify(body)}`, async () => {
      const res = await run({ body });
      assert.strictEqual(res.state, "blocked",
        `junk body must be held, not allowed: ${JSON.stringify(body)}`);
      assert.ok(codes(res).includes("empty_body"), JSON.stringify(codes(res)));
      assert.strictEqual(res.task, null, "empty body clears itself when copy is fixed — no task");
    });
  }

  test("holds a null message object without throwing", async () => {
    const res = await gate(fakeDb(), null, { now: MIDDAY });
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("gate_error") || codes(res).includes("empty_body"),
      JSON.stringify(codes(res)));
  });

  // Near-miss: real text next to the junk cases must still go through.
  test("still allows a real non-empty body", async () => {
    const res = await run({ body: "Hello, your file was updated." });
    assert.strictEqual(res.state, "allowed", JSON.stringify(codes(res)));
  });
});

// ---------------------------------------------------------------------------
// 1. Opt-out
// ---------------------------------------------------------------------------

describe("opt-out", () => {
  test("blocks a client who opted out of this channel", async () => {
    const res = await run({}, { optedOut: new Set([`${CLIENT}:sms`]) });
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("opted_out"), JSON.stringify(codes(res)));
  });

  // The near-miss: opt-out is PER CHANNEL. Someone who stopped texts has not
  // stopped emails, and collapsing the two would silently suppress a channel
  // they never objected to.
  test("does not block a different channel from the one opted out of", async () => {
    const res = await run({ channel: "email" }, { optedOut: new Set([`${CLIENT}:sms`]) });
    assert.strictEqual(res.state, "allowed", JSON.stringify(codes(res)));
  });

  test("does not block a different client", async () => {
    const other = "00000000-0000-4000-8000-00000000000f";
    const res = await run({ clientId: other }, { optedOut: new Set([`${CLIENT}:sms`]) });
    assert.strictEqual(res.state, "allowed", JSON.stringify(codes(res)));
  });

  // THE SLEEPING-WORKFLOW CASE. This is the one the whole gate exists for.
  //
  // A workflow queued this on Monday. It slept. It woke on Thursday. The client
  // opted out on Tuesday — after the message was created, before it was sent.
  // The message must be blocked.
  //
  // Every field a caller could use to argue "but it was fine when we queued it"
  // is passed in here deliberately, with values three days stale.
  test("blocks a client who opted out AFTER the message was queued", async () => {
    const db = fakeDb({ optedOut: new Set([`${CLIENT}:sms`]) });
    const res = await gate(db, {
      ...base,
      // All of these are ignored by the gate. They are passed to prove it.
      createdAt: new Date("2026-07-27T16:00:00Z"),   // Monday: queued
      scheduledAt: new Date("2026-07-27T16:00:00Z"),
      queuedAt: new Date("2026-07-27T16:00:00Z"),
      compliancePassedAt: new Date("2026-07-27T16:00:00Z") // "it passed then!"
    }, { now: MIDDAY });                                    // Thursday: sending

    assert.strictEqual(res.state, "blocked",
      "an opt-out recorded after queueing must still block the send");
    assert.ok(codes(res).includes("opted_out"));
  });

  // The structural guarantee behind that test: there is no queue-time field the
  // gate consults at all. If someone adds one, this fails.
  test("reads no queue-time field — the same message blocks with or without them", async () => {
    const withStamps = await gate(fakeDb({ optedOut: new Set([`${CLIENT}:sms`]) }), {
      ...base, createdAt: new Date("2020-01-01T00:00:00Z"), scheduledAt: new Date("2020-01-01T00:00:00Z")
    }, { now: MIDDAY });
    const without = await gate(fakeDb({ optedOut: new Set([`${CLIENT}:sms`]) }), base, { now: MIDDAY });
    assert.deepStrictEqual(codes(withStamps), codes(without));
  });

  // A message with nobody attached has no opt-out record to read. "No record"
  // must never resolve to "nobody objected".
  test("blocks when there is no client to check", async () => {
    const res = await run({ clientId: null });
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("recipient_unknown"), JSON.stringify(codes(res)));
  });
});

// ---------------------------------------------------------------------------
// 2. Quiet hours
// ---------------------------------------------------------------------------

describe("quiet hours", () => {
  // Each case is an exact instant, named in Eastern. EDT is UTC-4 in August.
  const at = (iso) => gate(fakeDb(), base, { now: () => new Date(iso) });

  test("blocks a text at 11:30pm Eastern", async () => {
    const res = await at("2026-08-02T03:30:00Z"); // 23:30 EDT
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("quiet_hours"), JSON.stringify(codes(res)));
  });

  test("blocks a text at 3am Eastern", async () => {
    const res = await at("2026-08-01T07:00:00Z"); // 03:00 EDT
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("quiet_hours"));
  });

  test("blocks a text at 10:59am Eastern — one minute before the window opens", async () => {
    const res = await at("2026-08-01T14:59:00Z"); // 10:59 EDT
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("quiet_hours"));
  });

  // The boundaries, both sides. These are where an off-by-one lives.
  test("allows a text at exactly 11:00am Eastern — the window opens", async () => {
    const res = await at("2026-08-01T15:00:00Z"); // 11:00 EDT
    assert.strictEqual(res.state, "allowed", JSON.stringify(codes(res)));
  });

  test("allows a text at 10:59pm Eastern — one minute before the window closes", async () => {
    const res = await at("2026-08-02T02:59:00Z"); // 22:59 EDT
    assert.strictEqual(res.state, "allowed", JSON.stringify(codes(res)));
  });

  test("blocks a text at exactly 11:00pm Eastern — the window closes", async () => {
    const res = await at("2026-08-02T03:00:00Z"); // 23:00 EDT
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("quiet_hours"));
  });

  // Email is exempt. A gate that held overnight email would stop the drip
  // campaigns for half of every day and be switched off by whoever noticed.
  test("does not block email at 3am Eastern", async () => {
    const res = await gate(fakeDb(), { ...base, channel: "email" },
      { now: () => new Date("2026-08-01T07:00:00Z") });
    assert.strictEqual(res.state, "allowed", JSON.stringify(codes(res)));
  });

  // Daylight saving. The same UTC instant is inside the window in winter and
  // outside it in summer. A hardcoded UTC offset passes one of these and fails
  // the other — which is the entire reason the zone is named rather than offset.
  test("is measured in Eastern across the daylight-saving change", () => {
    // 15:30Z: 11:30 EDT in summer (open) but 10:30 EST in winter (closed).
    assert.strictEqual(inQuietHours(new Date("2026-07-01T15:30:00Z")), false, "July 15:30Z is 11:30 EDT — open");
    assert.strictEqual(inQuietHours(new Date("2026-01-01T15:30:00Z")), true, "January 15:30Z is 10:30 EST — closed");
  });

  test("reads the Eastern hour, not UTC", () => {
    assert.strictEqual(easternHour(new Date("2026-08-01T16:00:00Z")), 12); // EDT, UTC-4
    assert.strictEqual(easternHour(new Date("2026-01-01T16:00:00Z")), 11); // EST, UTC-5
  });

  // Midnight is the value ICU disagrees about — "24" in some builds, "00" in
  // others. Either way it must be inside the window.
  test("treats midnight Eastern as inside the window", () => {
    assert.strictEqual(easternHour(new Date("2026-08-01T04:00:00Z")), 0);
    assert.strictEqual(inQuietHours(new Date("2026-08-01T04:00:00Z")), true);
  });

  // The window wraps midnight, so it is an OR and not a range. Written the
  // obvious way it is never open at all.
  test("the window is open for a contiguous stretch of the day", () => {
    const open = [];
    for (let h = 0; h < 24; h++) {
      // 2026-08-01, EDT: Eastern hour h is UTC hour h+4.
      const d = new Date(Date.UTC(2026, 7, 1 + (h + 4 >= 24 ? 1 : 0), (h + 4) % 24, 30));
      if (!inQuietHours(d)) open.push(h);
    }
    const expected = [];
    for (let h = QUIET_END_HOUR; h < QUIET_START_HOUR; h++) expected.push(h);
    assert.deepStrictEqual(open, expected,
      `expected the open window to be ${QUIET_END_HOUR}:00-${QUIET_START_HOUR}:00 Eastern`);
  });
});

// ---------------------------------------------------------------------------
// 3. Restricted words
// ---------------------------------------------------------------------------

describe("restricted words", () => {
  const blockedBy = async (body, key) => {
    const res = await run({ body });
    assert.strictEqual(res.state, "blocked", `expected a block for: ${body}`);
    assert.ok(codes(res).includes(key),
      `expected rule ${key}, got ${JSON.stringify(codes(res))}`);
  };
  const allowed = async (body) => {
    const res = await run({ body });
    assert.strictEqual(res.state, "allowed",
      `expected this near-miss to survive, blocked by ${JSON.stringify(codes(res))}: ${body}`);
  };

  test("blocks a guaranteed score increase", () =>
    blockedBy("We guarantee a 100 point score increase this month.", "guaranteed-score-increase"));

  test("allows describing what the service does", () =>
    allowed("We dispute items on your report that look inaccurate. Results vary by file."));

  test("blocks promising to remove accurate negative items", () =>
    blockedBy("We will delete negative items from your report.", "promise-to-remove-accurate-info"));

  test("allows describing the dispute process", () =>
    allowed("If an item on your report is inaccurate, we can dispute it for you."));

  test("blocks an advance fee", () =>
    blockedBy("Pay a $99 upfront fee to get started today.", "advance-fee"));

  test("allows describing billing after work is done", () =>
    allowed("You are billed only after the first round of work is complete."));

  test("blocks a CPN offer", () =>
    blockedBy("Ask us about a CPN for a clean start.", "file-segregation-cpn"));

  test("blocks guaranteed approval", () =>
    blockedBy("Guaranteed approval, everyone is approved.", "guaranteed-approval"));

  test("allows an ordinary approval update", () =>
    allowed("Your application moved to underwriting. We will let you know the decision."));

  test("blocks a guaranteed funding amount", () =>
    blockedBy("We guarantee $50,000 in funding for you.", "guaranteed-funding-amount"));

  test("allows an up-to amount with conditions", () =>
    allowed("Clients qualify for up to $50,000 depending on credit and revenue."));

  // The TikTok row's pattern is `.*` — it matches literally every string. It is
  // scoped to a platform, and a text message is not sent on a platform, so it
  // must never fire here. If it does, the gate blocks 100% of messages and the
  // near-misses above are the only thing that would catch it.
  test("never fires the platform-scoped TikTok rule", async () => {
    const res = await run({ body: "Anything at all." });
    assert.ok(!codes(res).includes("tiktok-credit-repair-prohibited"),
      "a platform-scoped rule must not apply to a message");
    assert.strictEqual(res.state, "allowed");
  });

  // Presence rules describe an ad funnel carrying a disclosure, not a text.
  // Applying them here would block every message ever sent.
  test("does not require the ad-funnel disclosure in a text message", async () => {
    const res = await run({ body: "Your documents were received." });
    assert.ok(!codes(res).includes("croa-consumer-rights"), JSON.stringify(codes(res)));
    assert.strictEqual(res.state, "allowed");
  });

  // Scoping is deliberately WIDER than the ad screen's: a message declares no
  // offer type, so a CROA rule applies to it regardless. Narrowing this to
  // offer_type would let every CROA phrase through in a text.
  test("applies credit-repair rules even though a message declares no offer type", async () => {
    const res = await run({ body: "We guarantee a 100 point score increase." });
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).some((c) => c === "guaranteed-score-increase"));
  });

  test("raises a task, and names the rule in it", async () => {
    const res = await run({ body: "We guarantee a 100 point score increase.", messageId: MESSAGE });
    assert.ok(res.task, "a restricted-word block must raise a task");
    assert.match(res.task.title, /restricted wording/i);
    assert.ok(res.task.body.includes(MESSAGE), "the task must name the message");
    assert.ok(res.task.detail.some((d) => /score/i.test(d)), "the task must carry a readable reason");
    assert.strictEqual(res.task.orgId, ORG);
  });

  // Work with no owner reaches nobody — src/lib/create-task.mjs rejects a task
  // without an employee role, and task-routing.test.mjs fails the build on a
  // raw INSERT INTO tasks anywhere in src/.
  test("the task carries an owning employee role", async () => {
    const res = await run({ body: "We guarantee a 100 point score increase.", messageId: MESSAGE });
    assert.ok(TASK_ROLES.has(res.task.assigneeRole),
      `${res.task.assigneeRole} is not an employee role`);
    assert.strictEqual(res.task.sourceWorkflow, GATE_SOURCE);
  });

  // body is the dedupe key (006_tasks_idempotency.sql keys on client +
  // source_workflow + body). Re-gating the same held message must produce the
  // same key, or a retry loop files a task per attempt.
  test("the dedupe key is stable across re-gating the same message", async () => {
    const msg = { body: "We guarantee a 100 point score increase.", messageId: MESSAGE };
    const a = await run(msg);
    const b = await run(msg);
    assert.strictEqual(a.task.body, b.task.body);
  });

  test("the dedupe key differs between two different messages", async () => {
    const a = await run({ body: "We guarantee a 100 point score increase.", messageId: MESSAGE });
    const b = await run({ body: "We guarantee a 100 point score increase.", messageId: CLIENT });
    assert.notStrictEqual(a.task.body, b.task.body);
  });

  // The task is an index over work, not a second outbox — the offending copy is
  // client-facing text about a consumer's file and is not duplicated into it.
  test("does not copy the message body into the task", async () => {
    const body = "We guarantee a 100 point score increase.";
    const res = await run({ body, messageId: MESSAGE });
    assert.ok(!res.task.body.includes(body), "the task must not carry the message body");
    assert.ok(!JSON.stringify(res.task.detail).includes(body),
      "the readable detail must not carry the message body either");
  });

  // The other two blocks clear on their own — the person opts back in, the clock
  // reaches 11am. Neither needs a human, so neither raises a task.
  test("raises no task for an opt-out block", async () => {
    const res = await run({}, { optedOut: new Set([`${CLIENT}:sms`]) });
    assert.strictEqual(res.state, "blocked");
    assert.strictEqual(res.task, null);
  });

  test("raises no task for a quiet-hours block", async () => {
    const res = await gate(fakeDb(), base, { now: () => new Date("2026-08-01T07:00:00Z") });
    assert.strictEqual(res.state, "blocked");
    assert.strictEqual(res.task, null);
  });
});

// ---------------------------------------------------------------------------
// No bypass. This section is the reason the file exists as much as the rules are.
// ---------------------------------------------------------------------------

describe("there is no override", () => {
  // Each of these is a name somebody would plausibly reach for. All of them must
  // be rejected, and rejected INTO A BLOCK — an attempt to bypass the gate has
  // to close it, never open it.
  for (const flag of ["force", "skipCompliance", "override", "test_bypass", "bypass", "ignoreOptOut"]) {
    test(`rejects a ${flag} option, and blocks`, async () => {
      const res = await gate(fakeDb(), base, { now: MIDDAY, [flag]: true });
      assert.strictEqual(res.state, "blocked",
        `${flag} must not produce a send — it must fail closed`);
      assert.ok(codes(res).includes("gate_error"));
    });
  }

  // The same names on the MESSAGE rather than the options object. These are
  // simply not read, so they change nothing: an opted-out client stays blocked.
  test("ignores bypass-looking fields on the message itself", async () => {
    const res = await gate(fakeDb({ optedOut: new Set([`${CLIENT}:sms`]) }), {
      ...base, force: true, skipCompliance: true, override: true, compliance_check_passed: true
    }, { now: MIDDAY });
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("opted_out"));
  });

  // The source itself carries no such word. This catches an override added in a
  // later edit that the cases above do not happen to name.
  test("the gate source contains no bypass flag", () => {
    const src = fs.readFileSync(path.join(HERE, "gate.mjs"), "utf8");
    // Strip comments AND string literals before looking. Both discuss these
    // words on purpose — the header at length, and assertNoBypass's error
    // message names them so a caller who tries one gets told why it failed.
    // What must not exist is an IDENTIFIER: a parameter, option or property
    // that actually does something. So this checks code, not prose.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/`(?:[^`\\]|\\.)*`/g, "``")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''");
    for (const flag of ["force", "skipCompliance", "skip_compliance", "override", "test_bypass", "bypass"]) {
      assert.ok(!new RegExp(`\\b${flag}\\b`, "i").test(code),
        `gate.mjs must not contain a ${flag} identifier`);
    }
  });
});

// ---------------------------------------------------------------------------
// Fail closed
// ---------------------------------------------------------------------------

describe("fails closed", () => {
  test("blocks when the database is down", async () => {
    const res = await run({}, { failOptOut: true });
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("gate_error"), JSON.stringify(codes(res)));
  });

  test("blocks when a rule pattern will not compile", async () => {
    const broken = [{
      rule_set: "claims", rule_key: "broken", offer_types: [], platforms: [],
      match_type: "regex", pattern: "([unclosed", severity: "block",
      message: "broken rule", citation: null
    }];
    const res = await run({}, { rules: broken });
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("gate_error"));
  });

  test("blocks a message with no org", async () => {
    const res = await run({ orgId: null });
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("gate_error"));
  });

  test("blocks an unknown channel", async () => {
    const res = await run({ channel: "carrier_pigeon" });
    assert.strictEqual(res.state, "blocked");
    assert.ok(codes(res).includes("gate_error"));
  });

  test("blocks a message with no channel", async () => {
    const res = await run({ channel: null });
    assert.strictEqual(res.state, "blocked");
  });
});

// ---------------------------------------------------------------------------
// Reasons accumulate
// ---------------------------------------------------------------------------

describe("reasons", () => {
  // An operator looking at a held message should see everything wrong with it,
  // not fix one thing and rediscover the next on the retry.
  test("reports every reason at once, not just the first", async () => {
    const res = await gate(
      fakeDb({ optedOut: new Set([`${CLIENT}:sms`]) }),
      { ...base, body: "We guarantee a 100 point score increase." },
      { now: () => new Date("2026-08-01T07:00:00Z") } // 3am Eastern
    );
    assert.strictEqual(res.state, "blocked");
    const c = codes(res);
    assert.ok(c.includes("opted_out"), JSON.stringify(c));
    assert.ok(c.includes("quiet_hours"), JSON.stringify(c));
    assert.ok(c.includes("guaranteed-score-increase"), JSON.stringify(c));
  });
});

// ---------------------------------------------------------------------------
// gateAndRecord
// ---------------------------------------------------------------------------

describe("gateAndRecord", () => {
  test("records the block on the message row", async () => {
    const db = fakeDb({ optedOut: new Set([`${CLIENT}:sms`]) });
    await gateAndRecord(db, { ...base, messageId: MESSAGE }, { now: MIDDAY });
    const w = db.writes.find((x) => x.kind === "message");
    assert.ok(w, "a blocked message must be recorded");
    assert.strictEqual(w.params[0], MESSAGE);
    assert.match(w.params[1], /opted_out/);
  });

  test("writes the task when one was raised", async () => {
    const db = fakeDb();
    await gateAndRecord(db, {
      ...base, messageId: MESSAGE, body: "We guarantee a 100 point score increase."
    }, { now: MIDDAY });
    assert.ok(db.writes.some((x) => x.kind === "task"), "a restricted-word block must file a task");
  });

  // An allowed message is not an audit event. Writing one on every send would
  // put a row-per-message write in front of the dispatcher's hot path.
  test("writes nothing when the message is allowed", async () => {
    const db = fakeDb();
    const res = await gateAndRecord(db, { ...base, messageId: MESSAGE }, { now: MIDDAY });
    assert.strictEqual(res.state, "allowed");
    assert.deepStrictEqual(db.writes, []);
  });

  // A block is an audit record. Nothing here may clear it — the way to send
  // after a block is a new message row that passes on its own merits.
  test("never clears an existing block", async () => {
    const db = fakeDb();
    await gateAndRecord(db, { ...base, messageId: MESSAGE }, { now: MIDDAY });
    for (const w of db.writes) {
      assert.ok(!/blocked_reason\s*=\s*NULL/i.test(w.sql), "a block must never be cleared");
    }
  });
});

// ---------------------------------------------------------------------------
// The constants are what the ticket asked for
// ---------------------------------------------------------------------------

describe("configuration", () => {
  test("the quiet window is 23:00-11:00 Eastern", () => {
    assert.strictEqual(QUIET_START_HOUR, 23);
    assert.strictEqual(QUIET_END_HOUR, 11);
    assert.strictEqual(QUIET_HOURS_TZ, "America/New_York");
  });
});

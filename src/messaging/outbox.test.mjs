// The outbox, and the one-message path that answers F1.
//
// F1, reported on the live walk of 2026-09-03: a booking confirmation text,
// email and AI call all arrived about three minutes after the booking. The
// owner's target is sixty seconds.
//
// Measured against the production database on the walk's own rows, the delay
// is two things stacked. Roughly half of it is this queue — a templated
// message is written and then waits for the next scheduled sweep. These tests
// hold the target still and hold the immediate path to the same rules the
// scheduled one obeys, because "urgent" must never come to mean "unchecked".

import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { drain, drainMessageNow, URGENT_MAX_LATENCY_MS } from "./outbox.mjs";
import { SWEEP_CRON } from "../workflows/message-dispatch-sweeper.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORG = "11111111-1111-4111-8111-111111111111";
const MSG = "33333333-3333-4333-8333-333333333333";

/* A company that is switched on with no ceiling, so a test can get past the
   guards and watch what the send path actually does. */
const sendingOn = (extra) => ({
  query: async (sql, params) => {
    if (/FROM messaging_settings/.test(sql)) {
      return { rows: [{ org_id: ORG, outbound_enabled: true, daily_send_cap: 0 }] };
    }
    return extra(sql, params);
  }
});

// ---------------------------------------------------------------------------
// The target
// ---------------------------------------------------------------------------

describe("the 60-second booking-confirmation target", () => {
  test("the owner's number is written down once, in code", () => {
    assert.strictEqual(URGENT_MAX_LATENCY_MS, 60 * 1000,
      "owner-set 2026-09-03: text, email and AI call all inside sixty seconds of the booking");
  });

  test("the scheduled sweep alone cannot meet it — this is why a one-message path exists", () => {
    // Worst case on an every-N-minutes cron is one whole interval: a row
    // written one second after a pass waits the entire cycle for the next one.
    // The measured waits on the 2026-09-03 rows were 46s to 270s, which is
    // exactly the spread of arriving at a random point in a five-minute cycle.
    const [minute] = SWEEP_CRON.split(" ");
    const every = Number(String(minute).replace("*/", ""));
    assert.ok(Number.isFinite(every) && every > 0, `unexpected sweep cron: ${SWEEP_CRON}`);
    const worstCaseMs = every * 60 * 1000;
    assert.strictEqual(worstCaseMs, 5 * 60 * 1000,
      "the sweep runs every five minutes — measured, 2026-09-03");
    assert.ok(worstCaseMs > URGENT_MAX_LATENCY_MS,
      "a message that waits for this clock cannot be inside sixty seconds");
  });
});

// ---------------------------------------------------------------------------
// The one-message path
// ---------------------------------------------------------------------------

describe("drainMessageNow", () => {
  test("it works the named row and does not scan the queue", async () => {
    const sql = [];
    const db = sendingOn(async (text) => {
      sql.push(text);
      return { rows: [] }; // nothing claimable — the claim shape is the subject here
    });
    const out = await drainMessageNow(db, MSG, { orgId: ORG });

    assert.equal(out.ran, true);
    assert.equal(out.dispatched, 1);
    const claim = sql.find((s) => /UPDATE messages/.test(s));
    assert.ok(claim, "it must claim a row");
    assert.ok(/WHERE id = \$1/.test(claim), "claimed by id, not by a due-time scan");
    assert.ok(/status = 'queued'/.test(claim), "still only claims a queued row");
    assert.ok(!sql.some((s) => /SELECT DISTINCT org_id FROM messages/.test(s)),
      "this is one message, not a sweep over every company");
    assert.ok(!sql.some((s) => /FOR UPDATE SKIP LOCKED/.test(s)),
      "the batch claim belongs to the sweeper, not here");
  });

  test("a message somebody else already has is left alone, not re-sent", async () => {
    const db = sendingOn(async () => ({ rows: [] }));
    const out = await drainMessageNow(db, MSG, { orgId: ORG });
    assert.equal(out.results[0].outcome, "not_claimable",
      "already sent, already blocked, or a sweep has it — the double-send guard working");
    assert.equal(out.sent, 0);
  });

  test("A PAUSED COMPANY SENDS NOTHING, urgent or not", async () => {
    const db = {
      query: async (sql) => {
        if (/FROM messaging_settings/.test(sql)) {
          return { rows: [{ org_id: ORG, outbound_enabled: false, daily_send_cap: 500 }] };
        }
        throw new Error("an urgent send reached the database past a paused switch: " + sql);
      }
    };
    const out = await drainMessageNow(db, MSG, { orgId: ORG });
    assert.equal(out.ran, false);
    assert.equal(out.reason, "paused");
    assert.equal(out.dispatched, 0);
  });

  test("the daily cap holds for an urgent send too", async () => {
    const db = {
      query: async (sql) => {
        if (/FROM messaging_settings/.test(sql)) {
          return { rows: [{ org_id: ORG, outbound_enabled: true, daily_send_cap: 10 }] };
        }
        if (/count\(\*\)::int AS n FROM messages/.test(sql)) return { rows: [{ n: 10 }] };
        throw new Error("an urgent send dispatched past its daily cap: " + sql);
      }
    };
    const out = await drainMessageNow(db, MSG, { orgId: ORG });
    assert.equal(out.ran, false);
    assert.equal(out.reason, "daily_cap_reached");
  });

  test("a missing org or message is refused before any query", async () => {
    const db = { query: async () => { throw new Error("should not have queried"); } };
    assert.equal((await drainMessageNow(db, MSG, {})).reason, "no_org");
    assert.equal((await drainMessageNow(db, null, { orgId: ORG })).reason, "no_message");
  });

  test("a broken database is reported, not thrown — the sweeper is still the backstop", async () => {
    const db = sendingOn(async () => { throw new Error("connection refused"); });
    const out = await drainMessageNow(db, MSG, { orgId: ORG });
    assert.equal(out.ran, false);
    assert.match(out.error, /connection refused/);
  });

  test("the switch and the cap are ONE rule, shared with the scheduled drain", async () => {
    /* Two copies of "may this company send" is how a paused company keeps
       sending down one path. Both entry points must refuse identically. */
    const paused = () => ({
      query: async (sql) => {
        if (/FROM messaging_settings/.test(sql)) {
          return { rows: [{ org_id: ORG, outbound_enabled: false, daily_send_cap: 500 }] };
        }
        throw new Error("reached the database past a paused switch");
      }
    });
    const batch = await drain(paused(), { orgId: ORG });
    const single = await drainMessageNow(paused(), MSG, { orgId: ORG });
    assert.deepEqual(
      { ran: single.ran, reason: single.reason },
      { ran: batch.ran, reason: batch.reason }
    );
  });

  test("it carries no bypass flag", () => {
    const src = fs.readFileSync(path.join(HERE, "outbox.mjs"), "utf8");
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''");
    for (const flag of ["force", "skipCompliance", "skip_compliance", "override", "test_bypass", "bypass"]) {
      assert.ok(!new RegExp(`\\b${flag}\\b`, "i").test(code),
        `the outbox must not contain a ${flag} identifier`);
    }
    assert.ok(/dispatchMessage\(/.test(code),
      "the urgent path must go through the dispatcher, which runs gate -> route -> send");
  });
});

import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handle, inquiryCallSweeper } from "./inquiry-call-sweeper.mjs";
import { fakeStep } from "./test-support.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "inquiry-call-sweeper.mjs");
const INDEX = join(HERE, "index.mjs");

async function withFetchTrap(fn) {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls.push({ url: String(args[0]), via: "global.fetch" });
    throw new Error(`inquiry-call-sweeper must not fetch (${String(args[0])})`);
  };
  try {
    return await fn({ calls });
  } finally {
    globalThis.fetch = prev;
  }
}

/** No due cases — fireDueCalls SELECT returns empty. */
const emptyDueDb = () => ({
  query: async () => ({ rows: [] })
});

/**
 * One due case. After UPDATE, later SELECTs return empty so a second pass stays zero.
 * Staff lookup returns empty so logAttempt (and any voice path) is skipped.
 */
function dueCaseDb() {
  const caseRow = {
    id: "case-1",
    org_id: "org-1",
    client_id: "client-1",
    selected_bureaus_raw: "EX",
    first_delivery_channel: "mail",
    call_due_at: "2020-01-01T00:00:00.000Z",
    call_fired_at: null,
    case_status: "In Progress"
  };
  let fired = false;
  const queries = [];
  return {
    queries,
    query: async (sql, params = []) => {
      queries.push(String(sql));
      if (/FROM inquiry_removal_cases/.test(sql) && /call_due_at IS NOT NULL/.test(sql)) {
        return { rows: fired ? [] : [{ ...caseRow }] };
      }
      if (/FROM staff/.test(sql)) return { rows: [] };
      if (/FROM inquiry_log/.test(sql)) return { rows: [] };
      if (/SELECT phone FROM clients/.test(sql)) return { rows: [{ phone: null }] };
      if (/UPDATE inquiry_removal_cases/.test(sql)) {
        fired = true;
        return {
          rows: [{
            ...caseRow,
            call_fired_at: params[1] || new Date().toISOString(),
            ai_call_status: params[2] || "failed",
            master_call_state: params[2] || "failed"
          }]
        };
      }
      throw new Error("unexpected query: " + sql);
    }
  };
}

test("it is defined, and stays a reviewable file", () => {
  assert.ok(inquiryCallSweeper);
});

test("happy path: empty due list is a quiet zero pass", async () => {
  await withFetchTrap(async ({ calls }) => {
    const res = await handle({ db: emptyDueDb(), step: fakeStep() });
    assert.equal(res.count, 0);
    assert.deepEqual(res.fired, []);
    assert.equal(calls.length, 0);
  });
});

test("smash: fireDueCalls path stamps one due case with a mocked db — no fetch", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = dueCaseDb();
    const res = await handle({ db, step: fakeStep() });
    assert.equal(res.count, 1);
    assert.equal(res.fired.length, 1);
    assert.equal(res.fired[0].id, "case-1");
    assert.ok(res.fired[0].call_fired_at);
    assert.ok(db.queries.some((s) => /FROM inquiry_removal_cases/.test(s)));
    assert.ok(db.queries.some((s) => /UPDATE inquiry_removal_cases/.test(s)));
    assert.equal(calls.length, 0);
  });
});

test("smash: second pass after fire stays zero — no fetch, no drain", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = dueCaseDb();
    const first = await handle({ db, step: fakeStep() });
    const second = await handle({ db, step: fakeStep() });
    assert.equal(first.count, 1);
    assert.equal(second.count, 0);
    assert.deepEqual(second.fired, []);
    assert.equal(calls.length, 0);
  });
});

test("smash: missing db does not throw", async () => {
  await withFetchTrap(async ({ calls }) => {
    for (const bad of [null, undefined, {}, { query: null }]) {
      const res = await handle({ db: bad, step: fakeStep() });
      assert.equal(res.reason, "no_db");
      assert.equal(res.count, 0);
      assert.deepEqual(res.fired, []);
    }
    assert.equal(calls.length, 0);
  });
});

test("smash: missing step does not throw", async () => {
  await withFetchTrap(async ({ calls }) => {
    for (const bad of [null, undefined, {}, { run: null }]) {
      const res = await handle({ db: emptyDueDb(), step: bad });
      assert.equal(res.reason, "no_step");
      assert.equal(res.count, 0);
      assert.deepEqual(res.fired, []);
    }
    assert.equal(calls.length, 0);
  });
});

test("smash: junk event does not throw", async () => {
  await withFetchTrap(async ({ calls }) => {
    for (const junk of [null, "nope", 7, true, []]) {
      const res = await handle({ db: emptyDueDb(), step: fakeStep(), event: junk });
      assert.equal(res.reason, "no_event");
      assert.equal(res.count, 0);
      assert.deepEqual(res.fired, []);
    }
    assert.equal(calls.length, 0);
  });
});

test("source must not fetch, flip CRS live, drain outbox, talk to GHL, or send mail", () => {
  const code = readFileSync(SRC, "utf8");
  assert.doesNotMatch(code, /\bfetch\s*\(/);
  assert.doesNotMatch(code, /\bfetchImpl\b/);
  assert.doesNotMatch(code, /\bCRS_ALLOW_LIVE\b/);
  assert.doesNotMatch(code, /\bdrain(All)?\s*\(/);
  assert.doesNotMatch(code, /\bdispatchDue\b/);
  assert.doesNotMatch(code, /outbox\.mjs/);
  assert.doesNotMatch(code, /\bGHL\b/i);
  assert.doesNotMatch(code, /gohighlevel|ghl\.com/i);
  assert.doesNotMatch(code, /\bsendTemplated\b/);
  assert.doesNotMatch(code, /providers\/resend/);
  assert.doesNotMatch(code, /providers\/twilio/);
  assert.doesNotMatch(code, /vercel\.app/);
});

test("inquiry-call-sweeper MUST stay unregistered in the functions array", () => {
  const index = readFileSync(INDEX, "utf8");
  const stripped = index
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(stripped, /inquiryCallSweeper/);
  assert.doesNotMatch(stripped, /inquiry-call-sweeper/);
  assert.doesNotMatch(stripped, /from ['"]\.\/inquiry-call-sweeper\.mjs['"]/);
  const arrayMatch = stripped.match(/export const functions = \[([\s\S]*?)\];/);
  assert.ok(arrayMatch, "functions array must be present");
  assert.doesNotMatch(arrayMatch[1], /inquiryCallSweeper|inquiry-call-sweeper/);
});

import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handle, runChase, orgsWithOutstandingContracts, CHASE_CRON } from "./contract-chaser.mjs";
import { fakeStep } from "./test-support.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "contract-chaser.mjs");

async function withFetchTrap(fn) {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls.push({ url: String(args[0]), via: "global.fetch" });
    throw new Error(`contract-chaser must not fetch (${String(args[0])})`);
  };
  try {
    return await fn({ calls });
  } finally {
    globalThis.fetch = prev;
  }
}

/** Empty queue: no outstanding contracts. */
const emptyDb = () => ({
  query: async () => ({ rows: [] })
});

/** One org listed, but no due contracts on chase (outstanding SELECT returns []). */
const oneOrgNoDueDb = () => {
  const calls = [];
  return {
    calls,
    query: async (sql, params = []) => {
      calls.push({ sql: String(sql).slice(0, 80), params });
      if (/SELECT DISTINCT org_id FROM contracts/.test(sql)) {
        return { rows: [{ org_id: "org-1" }] };
      }
      // outstandingContracts SELECT — none due
      if (/FROM contracts c/.test(sql) && /status IN/.test(sql)) {
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
};

test("happy path: empty outstanding list is a quiet zero pass", async () => {
  await withFetchTrap(async ({ calls }) => {
    const res = await handle({ db: emptyDb(), step: fakeStep() });
    assert.equal(res.orgs, 0);
    assert.equal(res.reminded, 0);
    assert.equal(res.tasked, 0);
    assert.equal(calls.length, 0);
  });
});

test("branch: one org with nothing due — chase returns zeros, no fetch", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = oneOrgNoDueDb();
    const res = await handle({ db, step: fakeStep() });
    assert.equal(res.orgs, 1);
    assert.equal(res.reminded, 0);
    assert.equal(res.tasked, 0);
    assert.equal(calls.length, 0);
  });
});

test("runChase with org and no due contracts — considered 0", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = oneOrgNoDueDb();
    const res = await runChase(db, { orgId: "org-1" });
    assert.equal(res.considered, 0);
    assert.equal(res.reminded, 0);
    assert.equal(res.tasked, 0);
    assert.equal(calls.length, 0);
  });
});

test("cron is once a day mid-morning UTC", () => {
  assert.equal(CHASE_CRON, "0 10 * * *");
});

test("smash: missing orgId does not throw, no CRS, no outbox drain", async () => {
  await withFetchTrap(async ({ calls }) => {
    const res = await runChase(emptyDb(), {});
    assert.equal(res.reason, "no_org");
    assert.equal(res.reminded, 0);
    assert.equal(res.tasked, 0);
    assert.equal(res.considered, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: null / missing db or step does not throw", async () => {
  await withFetchTrap(async ({ calls }) => {
    for (const bad of [null, undefined, {}, { query: null }]) {
      const res = await handle({ db: bad, step: fakeStep() });
      assert.equal(res.reason, "no_db");
      assert.equal(res.orgs, 0);
      assert.equal(res.reminded, 0);
    }
    for (const bad of [null, undefined, {}, { run: null }]) {
      const res = await handle({ db: emptyDb(), step: bad });
      assert.equal(res.reason, "no_step");
      assert.equal(res.orgs, 0);
    }
    assert.deepEqual(await orgsWithOutstandingContracts(null), []);
    assert.deepEqual(await orgsWithOutstandingContracts(undefined), []);
    const noOrg = await runChase(null, { orgId: "org-1" });
    assert.equal(noOrg.reason, "no_db");
    assert.equal(calls.length, 0);
  });
});

test("smash: empty outstanding (no orgs) — no throw, no fetch, no mail path", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = emptyDb();
    const res = await handle({ db, step: fakeStep() });
    assert.equal(res.orgs, 0);
    assert.equal(res.reminded, 0);
    assert.equal(res.tasked, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: duplicate empty sweep stays zero — no fetch, no drain", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = emptyDb();
    const first = await handle({ db, step: fakeStep() });
    const second = await handle({ db, step: fakeStep() });
    assert.equal(first.orgs, 0);
    assert.equal(second.orgs, 0);
    assert.equal(first.reminded, 0);
    assert.equal(second.reminded, 0);
    assert.equal(first.tasked, 0);
    assert.equal(second.tasked, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: org listed but nothing due — second pass still zero, no fetch", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = oneOrgNoDueDb();
    const first = await handle({ db, step: fakeStep() });
    const second = await handle({ db, step: fakeStep() });
    assert.equal(first.orgs, 1);
    assert.equal(second.orgs, 1);
    assert.equal(first.reminded + second.reminded, 0);
    assert.equal(first.tasked + second.tasked, 0);
    assert.equal(calls.length, 0);
  });
});

test("source must not pull CRS, drain outbox, or flip CRS_ALLOW_LIVE", () => {
  const code = readFileSync(SRC, "utf8");
  assert.doesNotMatch(code, /\bfetch\s*\(/);
  assert.doesNotMatch(code, /\bfetchImpl\b/);
  assert.doesNotMatch(code, /\brunCrsPull\b/);
  assert.doesNotMatch(code, /\brequestSoftPull\b/);
  assert.doesNotMatch(code, /\bcrs-pull\b/);
  assert.doesNotMatch(code, /\bCRS_ALLOW_LIVE\b/);
  assert.doesNotMatch(code, /\bsoft_pull\b/);
  assert.doesNotMatch(code, /\bdrain(All)?\s*\(/);
  assert.doesNotMatch(code, /\bdispatchDue\b/);
  assert.doesNotMatch(code, /outbox\.mjs/);
  assert.doesNotMatch(code, /vercel\.app/);
  assert.doesNotMatch(code, /bland/i);
  assert.doesNotMatch(code, /gohighlevel|ghl\.com/i);
  // Chaser queues via notify.mjs — must not call providers or sendTemplated here.
  assert.doesNotMatch(code, /\bsendTemplated\b/);
  assert.doesNotMatch(code, /providers\/resend/);
  assert.doesNotMatch(code, /providers\/twilio/);
});

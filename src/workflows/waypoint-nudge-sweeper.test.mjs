// The sweeper is registered, it is on a clock, and one pass cannot send.

import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SWEEP_CRON, sweep, handle, waypointNudgeSweeper } from "./waypoint-nudge-sweeper.mjs";
import { functions } from "./index.mjs";

test("it is registered, so something actually runs it", () => {
  assert.ok(
    functions.some((f) => f?.id?.("") === "waypoint-nudge-sweeper" || f === waypointNudgeSweeper),
    "waypointNudgeSweeper is in the exported functions array"
  );
});

test("it runs hourly", () => {
  assert.equal(SWEEP_CRON, "0 * * * *");
});

test("a pass over an empty result set does nothing and does not throw", async () => {
  const calls = [];
  const fakeDb = { query: async (sql, params) => { calls.push([sql, params]); return { rows: [] }; } };
  const tally = await sweep(fakeDb, { orgId: "00000000-0000-0000-0000-000000000000" });
  assert.equal(tally.considered, 0);
  assert.equal(tally.queued, 0);
  assert.equal(tally.failed, 0);
  assert.ok(calls.length >= 1, "it did look");
});

test("handle() is callable the way the journey runner expects", async () => {
  const fakeDb = { query: async () => ({ rows: [] }) };
  const ran = [];
  const step = { run: async (name, fn) => { ran.push(name); return fn(); } };
  const out = await handle({ db: fakeDb, step });
  assert.deepEqual(ran, ["sweep"]);
  assert.equal(out.considered, 0);
});

test("nothing under src/nudge/ transmits — CLAUDE.md section 12", () => {
  // Outbound transmission is permitted in src/messaging/providers/ and nowhere
  // else. This asserts the rule structurally instead of trusting a comment.
  const here = fileURLToPath(new URL(".", import.meta.url));
  const files = [
    "ladder.mjs", "clock.mjs", "exits.mjs", "run.mjs", "regulator.mjs", "index.mjs"
  ];
  for (const f of files) {
    const src = readFileSync(`${here}../nudge/${f}`, "utf8");
    assert.ok(!/\bfetch\s*\(/.test(src), `${f} must not call fetch`);
    // Comments may NAME the rule; an import may not break it. So this looks at
    // import statements only, not at prose.
    const imports = src.match(/^\s*import[^;]+from\s+["'][^"']+["']/gm) || [];
    for (const line of imports) {
      assert.ok(!/providers\//.test(line), `${f} must not import a provider: ${line.trim()}`);
    }
  }
});

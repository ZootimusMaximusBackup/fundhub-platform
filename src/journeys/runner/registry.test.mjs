/* The workflow registry, and the two ways it used to fail quietly.
 *
 * Production is healthy — every registered workflow resolves. That is exactly
 * why these tests exist: a failure mode nobody has hit yet is a failure mode
 * nobody has seen the shape of, and both of these turned into a report the
 * owner could not act on:
 *
 *   1. A missing workflow folder threw a raw ENOENT out of fs.readdir. It
 *      reached the owner as a bare 500 with no clue what was missing.
 *   2. Worse: if the folder existed but nothing in it imported, EVERY workflow
 *      landed in `unrunnable`, the run walked an empty registry, and it
 *      returned HTTP 200 saying "0 of 53 automations reached". That reads as
 *      "the whole product is disconnected" when what really happened is that
 *      the runner could not load anything to reach. Two opposite problems, one
 *      identical report.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { load, readModules, assemble, neverFired } from "./registry.mjs";

/* A stand-in for an Inngest function object: the registry reads only id() and
   opts.triggers off it. */
const fn = (id, events = []) => ({
  id: () => id,
  opts: { name: `The ${id} workflow`, triggers: events.map((event) => ({ event })) }
});

test("a workflow folder that cannot be read is a named error, not a raw ENOENT", async () => {
  await assert.rejects(
    () => readModules("/nonexistent/definitely/not/a/directory"),
    (err) => {
      assert.match(err.message, /workflow folder could not be read/);
      assert.match(err.message, /nonexistent/, "the path has to be in the message or it is not actionable");
      return true;
    }
  );
});

test("everything registered and nothing runnable throws, and names the ids", () => {
  const fns = [fn("a-01-thing", ["entry.captured"]), fn("b-02-other", ["booking.created"])];
  assert.throws(
    () => assemble(fns, new Map()),
    (err) => {
      assert.match(err.message, /not one of them could be loaded/);
      assert.match(err.message, /fault in the runner, not a finding about the journeys/);
      assert.match(err.message, /a-01-thing/);
      assert.match(err.message, /b-02-other/);
      return true;
    }
  );
});

test("SOME unrunnable is still a result, not a throw — that distinction is the whole point", () => {
  const fns = [fn("a-01-thing", ["entry.captured"]), fn("b-02-other", ["booking.created"])];
  const byId = new Map([["a-01-thing", { mod: { handle: async () => ({}) }, file: "a-01-thing.mjs" }]]);
  const reg = assemble(fns, byId);
  assert.equal(reg.registered, 2);
  assert.equal(reg.workflows.length, 1);
  assert.equal(reg.unrunnable.length, 1);
  assert.equal(reg.unrunnable[0].id, "b-02-other");
  assert.equal(reg.unrunnable[0].reason, "module not found on disk");
});

test("a module that exists but exports no handle says so", () => {
  const fns = [fn("a-01-thing"), fn("b-02-other")];
  const byId = new Map([
    ["a-01-thing", { mod: { handle: async () => ({}) }, file: "a.mjs" }],
    ["b-02-other", { mod: {}, file: "b.mjs" }]
  ]);
  const reg = assemble(fns, byId);
  assert.equal(reg.unrunnable[0].reason, "module exports no handle()");
});

test("no registered workflows at all is empty, not an error", () => {
  // Nothing registered means nothing to fail to load. The guard must not fire
  // on an empty list or it would turn a valid state into a crash.
  const reg = assemble([], new Map());
  assert.equal(reg.registered, 0);
  assert.deepEqual(reg.workflows, []);
});

test("byEvent indexes every trigger a runnable workflow declares", () => {
  const fns = [fn("a-01", ["entry.captured", "booking.created"]), fn("b-02", ["entry.captured"])];
  const handle = async () => ({});
  const byId = new Map([
    ["a-01", { mod: { handle }, file: "a.mjs" }],
    ["b-02", { mod: { handle }, file: "b.mjs" }]
  ]);
  const reg = assemble(fns, byId);
  assert.deepEqual(reg.byEvent.get("entry.captured").map((w) => w.id), ["a-01", "b-02"]);
  assert.deepEqual(reg.byEvent.get("booking.created").map((w) => w.id), ["a-01"]);
});

test("neverFired names every workflow no journey reached, with what it waits for", () => {
  const fns = [fn("a-01", ["entry.captured"]), fn("b-02", ["booking.created"])];
  const handle = async () => ({});
  const byId = new Map([
    ["a-01", { mod: { handle }, file: "a.mjs" }],
    ["b-02", { mod: { handle }, file: "b.mjs" }]
  ]);
  const reg = assemble(fns, byId);
  const never = neverFired(reg, ["a-01"]);
  assert.equal(never.length, 1);
  assert.equal(never[0].id, "b-02");
  assert.deepEqual(never[0].triggers, ["booking.created"]);
});

test("the real registry loads, and every registered workflow is runnable", async () => {
  const reg = await load();
  assert.ok(reg.registered > 0, "src/workflows/index.mjs must register something");
  assert.deepEqual(reg.unrunnable, [], "no registered workflow may be unreachable by the runner");
  assert.equal(reg.workflows.length, reg.registered);
});

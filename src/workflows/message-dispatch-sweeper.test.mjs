// Tests for the message dispatch sweeper.
//
// The most important test in this file is the last one: that the sweeper is NOT
// registered. Everything else here is about a pass being bounded and surviving a
// failure; that one is about the fact that building the dispatcher must not have
// started sending.

import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sweep, SWEEP_CRON, messageDispatchSweeper } from "./message-dispatch-sweeper.mjs";
import { DEFAULT_BATCH } from "../messaging/dispatch.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* A database that hands back no due messages. The sweeper's job is to claim and
   delegate; what happens to a claimed message is dispatch.test.mjs's subject. */
const emptyDb = () => ({ query: async () => ({ rows: [] }) });

describe("the sweeper", () => {
  test("an empty queue is a clean, quiet pass", async () => {
    const res = await sweep(emptyDb());
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.claimed, 0);
  });

  test("a pass is bounded by the batch size", async () => {
    let limit = null;
    const db = {
      query: async (sql, params) => {
        if (sql.startsWith("UPDATE messages m")) { [, limit] = params; return { rows: [] }; }
        return { rows: [] };
      }
    };
    await sweep(db);
    assert.strictEqual(limit, DEFAULT_BATCH,
      "a pass must claim a bounded batch, not everything that is due");
  });

  test("an explicit limit is honoured", async () => {
    let limit = null;
    const db = {
      query: async (sql, params) => {
        if (sql.startsWith("UPDATE messages m")) { [, limit] = params; return { rows: [] }; }
        return { rows: [] };
      }
    };
    await sweep(db, { limit: 5 });
    assert.strictEqual(limit, 5);
  });

  /* A failing pass must not take the scheduled function down. The next pass is
     the recovery: nothing it failed to finish was lost, because an unclaimed
     message is still queued and still due. */
  test("a broken database is reported, not thrown", async () => {
    const db = { query: async () => { throw new Error("connection refused"); } };
    const res = await sweep(db);
    assert.strictEqual(res.ok, false);
    assert.match(res.error, /connection refused/);
  });

  test("it does not loop until the queue is empty", () => {
    const src = fs.readFileSync(path.join(HERE, "message-dispatch-sweeper.mjs"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/\bwhile\s*\(|\bfor\s*\(/.test(code),
      "a pass must be one bounded batch — an unbounded drain holds the function open for as long as the backlog is long");
  });

  test("it runs often enough that a text held overnight goes out near 11am", () => {
    const [minute] = SWEEP_CRON.split(" ");
    assert.match(minute, /^\*\/(\d+)$/);
    assert.ok(Number(minute.slice(2)) <= 15,
      "a text held to 11:00 Eastern should go out within minutes of the window opening");
  });
});

// ---------------------------------------------------------------------------
// THE ONE THAT MATTERS
// ---------------------------------------------------------------------------

describe("nothing is switched on", () => {
  /* src/workflows/index.mjs is what netlify/functions/inngest.mjs serves. A
     function missing from it is never registered and never invoked.

     If this test fails, someone has scheduled outbound sending. That is W5 on
     the cutover board, it needs the owner's say-so, and it needs
     INNGEST_EVENT_KEY — one of the three things CLAUDE.md §11 says to ask about
     first. Do not "fix" this test by adding the export. */
  test("the sweeper is not registered with Inngest", () => {
    const index = fs.readFileSync(path.join(HERE, "index.mjs"), "utf8");
    assert.ok(!/message-dispatch-sweeper/.test(index),
      "THE SWEEPER IS REGISTERED — outbound sending is scheduled. This is W5 and it needs the owner's approval.");
    assert.ok(!/messageDispatchSweeper/.test(index),
      "THE SWEEPER IS REGISTERED — outbound sending is scheduled. This is W5 and it needs the owner's approval.");
  });

  test("it is defined, so switching it on is one reviewable line", () => {
    assert.ok(messageDispatchSweeper, "the definition should exist even though it is not registered");
  });

  test("the sweeper carries no bypass flag", () => {
    const src = fs.readFileSync(path.join(HERE, "message-dispatch-sweeper.mjs"), "utf8");
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''");
    for (const flag of ["force", "skipCompliance", "skip_compliance", "override", "test_bypass", "bypass"]) {
      assert.ok(!new RegExp(`\\b${flag}\\b`, "i").test(code),
        `the sweeper must not contain a ${flag} identifier`);
    }
  });
});

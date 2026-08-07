// The value grammar of the dry-run fence.
//
// This test exists because the fence it replaces had none. That fence compared
// against the literal string "1", the owner set the variable to "true", and
// nothing anywhere noticed that the safety switch had been off the whole time.
// The bug was not the comparison — it was that no test ever asked what the
// comparison did with a value a human would plausibly type.

import test from "node:test";
import assert from "node:assert/strict";

import {
  fenceVerdict, messagingBlocked, adaptersBlocked,
  MESSAGING_DRY_RUN, ADAPTERS_DRY_RUN
} from "./dry-run.mjs";

const verdict = (value) =>
  fenceVerdict(MESSAGING_DRY_RUN, value === undefined ? {} : { [MESSAGING_DRY_RUN]: value });

test("dry-run: absent means BLOCKED — the default is not open", () => {
  assert.equal(fenceVerdict(MESSAGING_DRY_RUN, {}).allowed, false);
  assert.match(fenceVerdict(MESSAGING_DRY_RUN, {}).reason, /defaults to BLOCKED/);
});

test("dry-run: only an explicit off value permits transmission", () => {
  for (const off of ["0", "false", "no", "off", "FALSE", " Off ", "No"]) {
    assert.equal(verdict(off).allowed, true, `${JSON.stringify(off)} should permit sending`);
  }
});

test("dry-run: every on-ish spelling holds, including the one that broke us", () => {
  // "true" is the exact value that was live in production against a `=== "1"`
  // check. It must read as fence UP.
  for (const on of ["1", "true", "TRUE", "yes", "on", " 1 ", "True"]) {
    assert.equal(verdict(on).allowed, false, `${JSON.stringify(on)} should hold`);
  }
});

test("dry-run: unparseable or unexpected values hold rather than open", () => {
  for (const junk of ["maybe", "2", "-1", "null", "undefined", "please", "0.0", "o"]) {
    const v = verdict(junk);
    assert.equal(v.allowed, false, `${JSON.stringify(junk)} must not permit sending`);
    assert.match(v.reason, /not an explicit off value/);
  }
});

test("dry-run: empty and whitespace-only hold", () => {
  for (const blank of ["", "   ", "\t"]) {
    assert.equal(verdict(blank).allowed, false, `${JSON.stringify(blank)} must hold`);
  }
});

test("dry-run: null and undefined hold", () => {
  assert.equal(fenceVerdict(MESSAGING_DRY_RUN, { [MESSAGING_DRY_RUN]: null }).allowed, false);
  assert.equal(fenceVerdict(MESSAGING_DRY_RUN, { [MESSAGING_DRY_RUN]: undefined }).allowed, false);
});

test("dry-run: the two fences are independent", () => {
  const env = { [MESSAGING_DRY_RUN]: "0", [ADAPTERS_DRY_RUN]: "1" };
  assert.equal(messagingBlocked(env), false);
  assert.equal(adaptersBlocked(env), true);
});

test("dry-run: a reason is always given when blocked, and never when allowed", () => {
  assert.equal(verdict("0").reason, null);
  assert.ok(verdict("1").reason.includes(MESSAGING_DRY_RUN));
  assert.ok(fenceVerdict(ADAPTERS_DRY_RUN, {}).reason.includes(ADAPTERS_DRY_RUN));
});

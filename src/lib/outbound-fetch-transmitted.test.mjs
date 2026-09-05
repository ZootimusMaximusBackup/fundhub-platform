// `transmitted` — the chokepoint's answer to "did a request actually go out?"
//
// WHY THIS FIELD EXISTS. src/repair/send.mjs has to decide whether a failed
// letter send may be retried. Retrying something that DID go out puts a second
// dispute letter in a real person's post and bills for it twice. Refusing to
// retry something that did NOT go out destroys the letter — measured on a real
// database on 2026-09-05, a send the dry-run fence held left the row claimed
// for ever, and every regenerated replacement was refused as well.
//
// Both mistakes came from reading `status` and error text. `status: 0` is
// returned by a fence hold AND by a timeout, and those are opposite facts. So
// the chokepoint states it outright, from control flow: every `transmitted:
// false` below is returned from a branch that sits above the `doFetch` call.

import { test } from "node:test";
import assert from "node:assert/strict";
import { transmit, MESSAGING, INTERNAL } from "./outbound-fetch.mjs";

const neverCalled = () => { throw new Error("nothing should have reached fetch"); };

test("the dry-run fence holding a call reports transmitted:false", async () => {
  // MESSAGING_DRY_RUN absent = fence UP.
  const res = await transmit("https://example.test/x", {}, {
    fence: MESSAGING, env: {}, fetchImpl: neverCalled
  });
  assert.equal(res.transmitted, false);
  assert.equal(res.blocked, true);
  assert.equal(res.status, 0);
});

test("an unrecognised fence reports transmitted:false", async () => {
  const res = await transmit("https://example.test/x", {}, {
    fence: "not_a_fence", env: {}, fetchImpl: neverCalled
  });
  assert.equal(res.transmitted, false);
  assert.equal(res.blocked, true);
});

test("no fetch implementation reports transmitted:false", async () => {
  // INTERNAL is not held by a flag, so this gets past the fence and then finds
  // no transport. Nothing was sent, and it is not a fence hold either — which
  // is why `blocked` alone is not enough to decide a retry.
  //
  // A non-function transport rather than an absent one, deliberately: leaving
  // fetchImpl unset would fall through to the real global fetch and this test
  // would make a live request.
  const res = await transmit("https://example.test/x", {}, {
    fence: INTERNAL, env: {}, fetchImpl: "not a function"
  });
  assert.equal(res.transmitted, false);
  assert.equal(res.blocked, false);
  assert.equal(res.error, "no fetch implementation available");
});

test("a completed request reports transmitted:true, success or failure", async () => {
  const env = { MESSAGING_DRY_RUN: "0" };
  const ok = await transmit("https://example.test/x", {}, {
    fence: MESSAGING, env,
    fetchImpl: async () => new Response('{"id":"a"}', { status: 200 })
  });
  assert.equal(ok.transmitted, true);
  assert.equal(ok.ok, true);

  const bad = await transmit("https://example.test/x", {}, {
    fence: MESSAGING, env,
    fetchImpl: async () => new Response("nope", { status: 502 })
  });
  assert.equal(bad.transmitted, true, "a 502 went out — the vendor may have acted on it");
  assert.equal(bad.ok, false);
});

test("a thrown transport error reports transmitted:TRUE — the call was made", async () => {
  // This is the direction that must never be got wrong. A socket that dies mid
  // request says nothing about whether the vendor accepted the work.
  const res = await transmit("https://example.test/x", {}, {
    fence: MESSAGING, env: { MESSAGING_DRY_RUN: "0" },
    fetchImpl: async () => { throw new Error("socket hang up"); }
  });
  assert.equal(res.transmitted, true);
  assert.equal(res.blocked, false);
  assert.equal(res.status, 0, "same status as a fence hold, and the opposite fact");
});

test("a timeout reports transmitted:true", async () => {
  const res = await transmit("https://example.test/x", {}, {
    fence: MESSAGING, env: { MESSAGING_DRY_RUN: "0" }, timeoutMs: 5,
    fetchImpl: (url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      });
    })
  });
  assert.equal(res.transmitted, true);
  assert.match(res.error, /timed out/);
});

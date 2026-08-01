import { test } from "node:test";
import assert from "node:assert";
import { checkDashboardAuth } from "./dashboard-auth.mjs";

const req = (opts = {}) => ({ headers: opts.headers || {}, query: opts.query || {} });

/* This test used to assert the OPPOSITE — that an unset secret opens the gate
   outside production. That is the behaviour an audit found serving the entire
   client book to anonymous callers, so the test was encoding the defect. The
   deployed case is the one that matters: netlify.toml sets neither variable, so
   NODE_ENV is undefined in the function and "not production" was true there. */
test("no secret: denied, whatever NODE_ENV says", () => {
  for (const env of [
    {},                              // the deployed Netlify config — the real case
    { NODE_ENV: undefined },
    { NODE_ENV: "" },
    { NODE_ENV: "development" },
    { NODE_ENV: "test" },
    { NODE_ENV: "production" }
  ]) {
    assert.equal(checkDashboardAuth(req(), env), false,
      `unset DASHBOARD_SECRET opened the gate with NODE_ENV=${JSON.stringify(env.NODE_ENV)}`);
  }
});

test("no secret: a supplied key cannot talk its way in either", () => {
  // With no secret configured there is nothing to compare against; presenting a
  // key must not be mistaken for presenting the right one.
  assert.equal(checkDashboardAuth(req({ headers: { "x-dashboard-key": "anything" } }), {}), false);
  assert.equal(checkDashboardAuth(req({ query: { key: "anything" } }), {}), false);
});

test("secret set: denies missing/wrong key", () => {
  const env = { DASHBOARD_SECRET: "s3cret" };
  assert.equal(checkDashboardAuth(req(), env), false);
  assert.equal(checkDashboardAuth(req({ headers: { "x-dashboard-key": "nope" } }), env), false);
  assert.equal(checkDashboardAuth(req({ query: { key: "close-but-no" } }), env), false);
});

/* This assertion used to read `checkDashboardAuth(req({ query: { key: "s3cret" } })) === true`
   — i.e. it required the master secret to be accepted from the URL, which is
   the defect audit M2 found. Same story as the NODE_ENV test above: the test was
   encoding the bug, so the assertion is inverted rather than removed, and the
   coverage it was carrying (the header carrier still works) is kept intact.
   The reasoning lives in src/http/dashboard-secret-in-url.test.mjs. */
test("secret set: accepts correct key via header only, never via the URL", () => {
  const env = { DASHBOARD_SECRET: "s3cret" };
  assert.equal(checkDashboardAuth(req({ headers: { "x-dashboard-key": "s3cret" } }), env), true);
  assert.equal(checkDashboardAuth(req({ query: { key: "s3cret" } }), env), false,
    "the master secret was accepted from the query string, where it lands in " +
    "browser history, bookmarks and Referer headers");
});

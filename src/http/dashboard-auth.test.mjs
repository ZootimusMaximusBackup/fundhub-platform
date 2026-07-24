import { test } from "node:test";
import assert from "node:assert";
import { checkDashboardAuth } from "./dashboard-auth.mjs";

const req = (opts = {}) => ({ headers: opts.headers || {}, query: opts.query || {} });

test("no secret: allowed in dev, denied in production", () => {
  assert.equal(checkDashboardAuth(req(), { NODE_ENV: "development" }), true);
  assert.equal(checkDashboardAuth(req(), { NODE_ENV: "production" }), false);
});

test("secret set: denies missing/wrong key", () => {
  const env = { DASHBOARD_SECRET: "s3cret" };
  assert.equal(checkDashboardAuth(req(), env), false);
  assert.equal(checkDashboardAuth(req({ headers: { "x-dashboard-key": "nope" } }), env), false);
  assert.equal(checkDashboardAuth(req({ query: { key: "close-but-no" } }), env), false);
});

test("secret set: accepts correct key via header or query", () => {
  const env = { DASHBOARD_SECRET: "s3cret" };
  assert.equal(checkDashboardAuth(req({ headers: { "x-dashboard-key": "s3cret" } }), env), true);
  assert.equal(checkDashboardAuth(req({ query: { key: "s3cret" } }), env), true);
});

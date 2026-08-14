import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "./c-00-crs-soft-pull-request.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";
import { SoftPullError } from "../finance/soft-pulls.mjs";

function dbWithAccount(accounts) {
  const list = accounts === undefined
    ? [{
      id: "acct-1",
      client_id: "cl-1",
      kind: "client",
      created_at: "2026-01-01T00:00:00.000Z"
    }]
    : accounts;
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }]
  });
  const baseQuery = db.query.bind(db);
  db.query = async (sql, params = []) => {
    if (/SELECT id FROM accounts[\s\S]*kind = 'client'/.test(sql)) {
      const hit = list
        .filter((a) => a.client_id === params[0] && a.kind === "client")
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0];
      return { rows: hit ? [{ id: hit.id }] : [] };
    }
    return baseQuery(sql, params);
  };
  return db;
}

function stepWithRequest(result) {
  const step = fakeStep();
  const originalRun = step.run;
  step.run = (id, fn) => {
    if (id === "request-soft-pull") return result;
    return originalRun(id, fn);
  };
  return step;
}

test("happy path: diagnostic.paid requests the CRS pull", async () => {
  const db = dbWithAccount();
  const res = await handle({
    event: ev("diagnostic.paid", {}, { clientId: "cl-1" }),
    db,
    step: stepWithRequest({ created: true, request: { id: "spr-1" } }),
    runPull: async () => ({ ok: true, crsResultId: "crs-1", bureausPulled: ["TU", "EX", "EQ"] })
  });
  assert.equal(res.done, true);
  assert.equal(db.clients[0].custom_fields.crs_status, "Requested");
  assert.equal(db.clients[0].custom_fields.round_hold_reason, "Awaiting CRS");
  assert.equal(res.scope, "consumer_only");
  assert.equal(res.pulled, true);
});

test("branch: business scope requested", async () => {
  const db = dbWithAccount();
  const res = await handle({
    event: ev("diagnostic.paid", { businessScope: true }, { clientId: "cl-1" }),
    db,
    step: stepWithRequest({ created: true, request: { id: "spr-1" } }),
    runPull: async () => ({ ok: true, crsResultId: "crs-1", bureausPulled: ["TU"] })
  });
  assert.equal(res.scope, "consumer_plus_ex_business");
});

test("branch: businessScope absent → defaults to consumer_only", async () => {
  const db = dbWithAccount();
  const res = await handle({
    event: ev("diagnostic.paid", {}, { clientId: "cl-1" }),
    db,
    step: stepWithRequest({ created: true, request: { id: "spr-1" } }),
    runPull: async () => ({ ok: true, crsResultId: "crs-1", bureausPulled: [] })
  });
  assert.equal(res.scope, "consumer_only");
  assert.equal(db.clients[0].custom_fields.crs_pull_scope, "consumer_only");
});

test("no portal account → stamps Requested but does not pull", async () => {
  const db = dbWithAccount([]);
  let pulled = false;
  const res = await handle({
    event: ev("diagnostic.paid", {}, { clientId: "cl-1" }),
    db,
    step: fakeStep(),
    runPull: async () => { pulled = true; return { ok: true }; }
  });
  assert.equal(res.pulled, false);
  assert.equal(res.reason, "no_account_for_attribution");
  assert.equal(pulled, false);
  assert.equal(db.clients[0].custom_fields.crs_status, "Requested");
});

test("consent refusal → no pull, no throw", async () => {
  const db = dbWithAccount();
  const step = fakeStep();
  const originalRun = step.run;
  step.run = (id, fn) => {
    if (id === "request-soft-pull") {
      throw new SoftPullError("consent required", { status: 403, code: "consent_required" });
    }
    return originalRun(id, fn);
  };
  const res = await handle({
    event: ev("diagnostic.paid", {}, { clientId: "cl-1" }),
    db,
    step,
    runPull: async () => ({ ok: true })
  });
  assert.equal(res.pulled, false);
  assert.equal(res.reason, "consent_required");
});

test("successful pull returns crsResultId and bureaus", async () => {
  const db = dbWithAccount();
  const res = await handle({
    event: ev("diagnostic.paid", {}, { clientId: "cl-1", id: "pay-1" }),
    db,
    step: stepWithRequest({ created: true, request: { id: "spr-1" } }),
    runPull: async (_db, opts) => {
      assert.equal(opts.requestId, "spr-1");
      assert.equal(opts.clientId, "cl-1");
      return {
        ok: true,
        crsResultId: "crs-9",
        bureausPulled: ["TU", "EX", "EQ"]
      };
    }
  });
  assert.equal(res.pulled, true);
  assert.equal(res.crsResultId, "crs-9");
  assert.deepEqual(res.bureausPulled, ["TU", "EX", "EQ"]);
  assert.equal(res.requestId, "spr-1");
});

test("replayed soft-pull request does not order again", async () => {
  const db = dbWithAccount();
  let pulled = false;
  const res = await handle({
    event: ev("diagnostic.paid", {}, { clientId: "cl-1" }),
    db,
    step: stepWithRequest({
      created: false,
      reason: "replay",
      request: { id: "spr-existing" }
    }),
    runPull: async () => { pulled = true; return { ok: true }; }
  });
  assert.equal(res.pulled, false);
  assert.equal(res.reason, "replay");
  assert.equal(res.requestId, "spr-existing");
  assert.equal(pulled, false);
});

test("smash: missing client → no throw, no pull", async () => {
  let pulled = false;
  const res = await handle({
    event: ev("diagnostic.paid", {}),
    db: pgFake({ clients: [] }),
    step: fakeStep(),
    env: { CRS_ALLOW_LIVE: "0" },
    runPull: async () => { pulled = true; return { ok: true }; }
  });
  assert.equal(res.done, false);
  assert.equal(res.reason, "no_client");
  assert.equal(pulled, false);
});

test("smash: already_open duplicate → no throw, no second pull", async () => {
  const db = dbWithAccount();
  let pulled = false;
  const res = await handle({
    event: ev("diagnostic.paid", {}, { clientId: "cl-1" }),
    db,
    step: stepWithRequest({
      created: false,
      reason: "already_open",
      request: { id: "spr-open" }
    }),
    env: { CRS_ALLOW_LIVE: "0" },
    runPull: async () => { pulled = true; return { ok: true }; }
  });
  assert.equal(res.done, true);
  assert.equal(res.pulled, false);
  assert.equal(res.reason, "already_open");
  assert.equal(res.requestId, "spr-open");
  assert.equal(pulled, false);
});

test("smash: CRS_ALLOW_LIVE=0 → env forwarded, live refuse, no throw", async () => {
  const db = dbWithAccount();
  let runPullCalls = 0;
  let inventedLiveOk = false;
  const res = await handle({
    event: ev("diagnostic.paid", {}, { clientId: "cl-1" }),
    db,
    step: stepWithRequest({ created: true, request: { id: "spr-1" } }),
    env: { CRS_ALLOW_LIVE: "0", CRS_API_HOST: "api.stitchcredit.com" },
    runPull: async (_db, opts) => {
      runPullCalls += 1;
      assert.equal(opts.env.CRS_ALLOW_LIVE, "0");
      // Owner law: live off. Refuse production — never invent a successful live order.
      if (opts.env.CRS_ALLOW_LIVE === "1") inventedLiveOk = true;
      return {
        ok: false,
        code: "production_host_refused",
        reason: "CRS production host refused — CRS_ALLOW_LIVE is not explicitly on"
      };
    }
  });
  assert.equal(res.done, true);
  assert.equal(res.pulled, false);
  assert.equal(res.reason, "production_host_refused");
  assert.equal(res.requestId, "spr-1");
  assert.equal(runPullCalls, 1);
  assert.equal(inventedLiveOk, false);
});

test("smash: SoftPullError from runPull → no throw, no pulled", async () => {
  const db = dbWithAccount();
  const res = await handle({
    event: ev("diagnostic.paid", {}, { clientId: "cl-1" }),
    db,
    step: stepWithRequest({ created: true, request: { id: "spr-1" } }),
    env: { CRS_ALLOW_LIVE: "0" },
    runPull: async () => {
      throw new SoftPullError("soft pull request is already failed", {
        status: 409,
        code: "already_failed"
      });
    }
  });
  assert.equal(res.done, true);
  assert.equal(res.pulled, false);
  assert.equal(res.reason, "already_failed");
  assert.equal(res.requestId, "spr-1");
});

test("smash: c-00 source never calls live CRS itself", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("./c-00-crs-soft-pull-request.mjs", import.meta.url), "utf8");
  assert.equal(/\bfetch\s*\(/.test(src), false);
  assert.equal(/stitchcredit\.com/.test(src), false);
  assert.equal(/CRS_ALLOW_LIVE\s*=\s*["']1["']/.test(src), false);
});

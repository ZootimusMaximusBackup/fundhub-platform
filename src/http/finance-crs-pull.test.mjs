// Unit tests for POST /api/finance/crs-pull — no database, no bureau call.
// The handler must queue a ledger row and then run CRS for exactly one bureau.

import { test } from "node:test";
import assert from "node:assert/strict";
import handler from "../../api/finance/crs-pull.mjs";
import { SoftPullError } from "../finance/soft-pulls.mjs";

const ORG = "22222222-2222-4222-8222-222222222222";
const CLIENT = "aaaaaaaa-1111-4111-8111-111111111111";
const STAFF = "11111111-1111-4111-8111-111111111111";
const REQUEST = "bbbbbbbb-1111-4111-8111-111111111111";

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; }
  };
}

function staff(role = "funding_advisor") {
  return {
    kind: "staff",
    staffId: STAFF,
    orgId: ORG,
    role,
    email: role + "@test.example"
  };
}

function deps(extra = {}) {
  return {
    db: {
      query: async () => ({ rows: [{ "?column?": 1 }] })
    },
    requirePrincipal: async () => staff(extra.role || "funding_advisor"),
    requestSoftPull: extra.requestSoftPull || (async () => ({
      created: true,
      request: { id: REQUEST, status: "queued" }
    })),
    runCrsPull: extra.runCrsPull || (async () => ({
      ok: true,
      crsResultId: "crs-1",
      request: { id: REQUEST, status: "fulfilled" },
      bureausPulled: extra.bureausPulled || ["TU"]
    })),
    ...extra
  };
}

test("crs-pull refuses setter (not in the soft-pull role set)", async () => {
  const res = mockRes();
  await handler(
    { method: "POST", body: { client_id: CLIENT, bureau: "TU" } },
    res,
    deps({ requirePrincipal: async () => staff("setter") })
  );
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.ok, false);
});

test("crs-pull refuses a missing bureau", async () => {
  const res = mockRes();
  await handler(
    { method: "POST", body: { client_id: CLIENT } },
    res,
    deps()
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /bureau/);
});

test("crs-pull queues then runs CRS for TransUnion only", async () => {
  let queued = null;
  let ran = null;
  const res = mockRes();
  await handler(
    { method: "POST", body: { client_id: CLIENT, bureau: "TU" } },
    res,
    deps({
      requestSoftPull: async (_db, args) => {
        queued = args;
        return { created: true, request: { id: REQUEST, status: "queued" } };
      },
      runCrsPull: async (_db, args) => {
        ran = args;
        return { ok: true, crsResultId: "crs-1", request: { id: REQUEST }, bureausPulled: ["TU"] };
      }
    })
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.bureau, "TU");
  assert.equal(queued.clientId, CLIENT);
  assert.equal(ran.requestId, REQUEST);
  assert.deepEqual(ran.bureaus, ["TU"]);
  assert.ok(!("scores" in res.body), "must not invent or echo scores");
});

test("crs-pull maps EX and EQ to a one-bureau run", async () => {
  for (const bureau of ["EX", "EQ"]) {
    let ran = null;
    const res = mockRes();
    await handler(
      { method: "POST", body: { client_id: CLIENT, bureau } },
      res,
      deps({
        runCrsPull: async (_db, args) => {
          ran = args;
          return { ok: true, crsResultId: "crs-1", request: { id: REQUEST }, bureausPulled: [bureau] };
        }
      })
    );
    assert.equal(res.statusCode, 200, bureau);
    assert.deepEqual(ran.bureaus, [bureau]);
  }
});

test("crs-pull returns the CRS not-configured reason", async () => {
  const res = mockRes();
  await handler(
    { method: "POST", body: { client_id: CLIENT, bureau: "EQ" } },
    res,
    deps({
      runCrsPull: async () => ({
        ok: false,
        code: "not_configured",
        reason: "CRS is not configured — missing CRS_USERNAME, CRS_PASSWORD"
      })
    })
  );
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, "not_configured");
  assert.match(res.body.error, /CRS is not configured/);
});

test("crs-pull returns the missing-identity reason", async () => {
  const res = mockRes();
  await handler(
    { method: "POST", body: { client_id: CLIENT, bureau: "EX" } },
    res,
    deps({
      runCrsPull: async () => ({
        ok: false,
        code: "identity_required",
        reason: "no identity on file for this client — a credit report cannot be ordered"
      })
    })
  );
  assert.equal(res.statusCode, 422);
  assert.match(res.body.error, /no identity on file/);
});

test("crs-pull forwards a consent refusal from the queue step", async () => {
  const res = mockRes();
  await handler(
    { method: "POST", body: { client_id: CLIENT, bureau: "TU" } },
    res,
    deps({
      requestSoftPull: async () => {
        throw new SoftPullError("no soft-pull consent on file for this client — capture consent before requesting a pull", {
          status: 403,
          code: "consent_required"
        });
      }
    })
  );
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "consent_required");
  assert.match(res.body.error, /consent/);
});

/* ── THE SIMULATION FENCE AT THE ENDPOINT ───────────────────────────────────
   Finding T3-13. The whole design is in src/finance/crs-pull.mjs; these tests
   cover only what the handler itself decides: how it reads `simulate`, what it
   passes on, what it stamps on the ledger row, and what it tells the caller. */

test("crs-pull passes simulate:true through and stamps the ledger reason", async () => {
  let queued = null;
  let ran = null;
  const res = mockRes();
  await handler(
    { method: "POST", body: { client_id: CLIENT, bureau: "TU", simulate: true } },
    res,
    deps({
      requestSoftPull: async (_db, args) => {
        queued = args;
        return { created: true, request: { id: REQUEST, status: "queued" } };
      },
      runCrsPull: async (_db, args) => {
        ran = args;
        return {
          ok: true, simulated: true, crsResultId: "crs-sim-1",
          request: { id: REQUEST }, bureausPulled: ["TU"]
        };
      }
    })
  );

  assert.equal(res.statusCode, 200);
  assert.equal(ran.simulate, true);
  assert.equal(res.body.simulated, true);
  assert.match(queued.reason, /SIMULATED/,
    "the pull history reads soft_pull_requests.reason long before anyone opens the payload");
});

test("crs-pull without simulate runs a real pull, exactly as before", async () => {
  let ran = null;
  const res = mockRes();
  await handler(
    { method: "POST", body: { client_id: CLIENT, bureau: "TU" } },
    res,
    deps({
      runCrsPull: async (_db, args) => {
        ran = args;
        return { ok: true, crsResultId: "crs-1", request: { id: REQUEST }, bureausPulled: ["TU"] };
      }
    })
  );
  assert.equal(res.statusCode, 200);
  assert.equal(ran.simulate, false);
  assert.equal(res.body.simulated, false);
});

test("crs-pull refuses an unreadable simulate before any ledger row exists", async () => {
  for (const value of ["true", "yes", 1, 0, "false", {}]) {
    let queued = false;
    let ran = false;
    const res = mockRes();
    await handler(
      { method: "POST", body: { client_id: CLIENT, bureau: "TU", simulate: value } },
      res,
      deps({
        requestSoftPull: async () => { queued = true; return { created: true, request: { id: REQUEST } }; },
        runCrsPull: async () => { ran = true; return { ok: true }; }
      })
    );
    assert.equal(res.statusCode, 400, JSON.stringify(value));
    assert.equal(res.body.code, "simulate_invalid");
    assert.equal(queued, false, "no ledger row may be opened for a request being refused");
    assert.equal(ran, false, "and nothing may run");
  }
});

test("crs-pull reports the run's own answer, not the caller's request", async () => {
  // A replay reports what was stored. A caller asking for a real pull cannot be
  // handed a rehearsal labelled as real, and vice versa.
  const res = mockRes();
  await handler(
    { method: "POST", body: { client_id: CLIENT, bureau: "TU", simulate: true } },
    res,
    deps({
      runCrsPull: async () => ({
        ok: true, simulated: false, crsResultId: "crs-1",
        request: { id: REQUEST }, bureausPulled: ["TU"]
      })
    })
  );
  assert.equal(res.body.simulated, false);
});

test("the consent gate still refuses first when a simulation is asked for", async () => {
  let ran = false;
  const res = mockRes();
  await handler(
    { method: "POST", body: { client_id: CLIENT, bureau: "TU", simulate: true } },
    res,
    deps({
      requestSoftPull: async () => {
        throw new SoftPullError("no soft-pull consent on file for this client — capture consent before requesting a pull", {
          status: 403,
          code: "consent_required"
        });
      },
      runCrsPull: async () => { ran = true; return { ok: true }; }
    })
  );
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "consent_required");
  assert.equal(ran, false, "a rehearsal is still a pull: no consent, no run");
});

test("a setter cannot rehearse a pull either", async () => {
  const res = mockRes();
  await handler(
    { method: "POST", body: { client_id: CLIENT, bureau: "TU", simulate: true } },
    res,
    deps({ requirePrincipal: async () => staff("setter") })
  );
  assert.equal(res.statusCode, 403);
});

test("a failed simulation says it was a simulation", async () => {
  const res = mockRes();
  await handler(
    { method: "POST", body: { client_id: CLIENT, bureau: "EX", simulate: true } },
    res,
    deps({
      runCrsPull: async () => ({
        ok: false, simulated: true, code: "identity_required",
        reason: "no identity on file for this client — a credit report cannot be ordered"
      })
    })
  );
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, "identity_required");
  assert.equal(res.body.simulated, true);
});

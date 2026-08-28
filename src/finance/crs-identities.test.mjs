// The gate that keeps a real person off the fake host, and a fake person off
// the real one — and that keeps live pulls behind TWO explicit switches.

import test from "node:test";
import assert from "node:assert/strict";

import {
  BUREAUS,
  activeBureausFromEnv,
  CRS_ALLOW_LIVE,
  CRS_PRODUCTION_HOST,
  CRS_SANDBOX_HOST,
  CrsIdentityError,
  NEVER_ISSUED_SSN_PREFIX,
  SANDBOX_TEST_IDENTITIES,
  assertIdentityAllowed,
  identityForBureau,
  isoBirthDate,
  livePullAllowed,
  matchesSandboxIdentity,
  normalizeHost,
  sandboxBureauFor,
  ssnDigits
} from "./crs-identities.mjs";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/* A stand-in for a real client. The SSN is in the 555 range, which is issuable,
   so this value is exactly the kind of thing the sandbox must refuse. */
const REAL_PERSON = Object.freeze({
  firstName: "CHRIS",
  lastName: "STANBRIDGE",
  birthDate: "1985-06-02",
  ssn: "555443333",
  addresses: [{ addressLine1: "1 REAL ST", city: "PHOENIX", state: "AZ", postalCode: "85001" }]
});

const LIVE_ON = Object.freeze({ [CRS_ALLOW_LIVE]: "1" });

test("every published test identity sits in the SSA's never-issued range", () => {
  for (const bureau of BUREAUS) {
    const ssn = ssnDigits(SANDBOX_TEST_IDENTITIES[bureau].ssn);
    assert.equal(ssn.length, 9, `${bureau} test SSN is not nine digits`);
    assert.ok(
      ssn.startsWith(NEVER_ISSUED_SSN_PREFIX),
      `${bureau} test identity is not in the never-issued range — is this a real person?`
    );
  }
});

test("each bureau has its own test person", () => {
  const ssns = BUREAUS.map((b) => ssnDigits(SANDBOX_TEST_IDENTITIES[b].ssn));
  assert.equal(new Set(ssns).size, BUREAUS.length);
});

test("CRS identities: every fixture is accepted only for its bureau on sandbox", () => {
  for (const bureau of BUREAUS) {
    const identity = clone(SANDBOX_TEST_IDENTITIES[bureau]);
    assert.equal(matchesSandboxIdentity(bureau, identity), true);
    assert.doesNotThrow(() => assertIdentityAllowed({
      host: CRS_SANDBOX_HOST,
      bureau,
      identity
    }));
  }
});

test("CRS identities: the full Postman fixture must match", () => {
  const changes = [
    (identity) => { identity.firstName = "NOT-THE-FIXTURE"; },
    (identity) => { identity.birthDate = "1900-01-01"; },
    (identity) => { identity.ssn = "666000000"; },
    (identity) => { identity.addresses[0].postalCode = "00000"; },
    (identity) => { identity.email = "extra@example.invalid"; }
  ];

  for (const change of changes) {
    const identity = clone(SANDBOX_TEST_IDENTITIES.EX);
    change(identity);
    assert.equal(matchesSandboxIdentity("EX", identity), false);
    assert.throws(
      () => assertIdentityAllowed({
        host: CRS_SANDBOX_HOST,
        bureau: "EX",
        identity
      }),
      (error) => error.code === "identity_not_allowed_on_sandbox"
    );
  }
});

test("REFUSES a real identity on the sandbox host", () => {
  for (const bureau of BUREAUS) {
    assert.throws(
      () => assertIdentityAllowed({
        host: CRS_SANDBOX_HOST, bureau, identity: REAL_PERSON
      }),
      (e) => e instanceof CrsIdentityError && e.code === "identity_not_allowed_on_sandbox"
    );
  }
});

test("livePullAllowed is fail-closed — only explicit on values pass", () => {
  assert.equal(livePullAllowed({}), false);
  assert.equal(livePullAllowed({ [CRS_ALLOW_LIVE]: "" }), false);
  assert.equal(livePullAllowed({ [CRS_ALLOW_LIVE]: "0" }), false);
  assert.equal(livePullAllowed({ [CRS_ALLOW_LIVE]: "false" }), false);
  assert.equal(livePullAllowed({ [CRS_ALLOW_LIVE]: "maybe" }), false);
  assert.equal(livePullAllowed({ [CRS_ALLOW_LIVE]: "1" }), true);
  assert.equal(livePullAllowed({ [CRS_ALLOW_LIVE]: "true" }), true);
  assert.equal(livePullAllowed({ [CRS_ALLOW_LIVE]: "YES" }), true);
  assert.equal(livePullAllowed({ [CRS_ALLOW_LIVE]: "on" }), true);
});

test("production host alone is refused — CRS_ALLOW_LIVE must also be on", () => {
  const identity = clone(REAL_PERSON);
  assert.throws(
    () => assertIdentityAllowed({
      host: CRS_PRODUCTION_HOST, bureau: "TU", identity
    }),
    (error) => error.code === "production_host_refused"
  );
  assert.throws(
    () => assertIdentityAllowed({
      host: CRS_PRODUCTION_HOST, bureau: "TU", identity,
      env: { [CRS_ALLOW_LIVE]: "0" }
    }),
    (error) => error.code === "production_host_refused"
  );
  assert.throws(
    () => identityForBureau({ host: CRS_PRODUCTION_HOST, bureau: "TU", identity }),
    (error) => error.code === "production_host_refused"
  );
});

test("production host + CRS_ALLOW_LIVE on allows a real identity", () => {
  assert.doesNotThrow(() => assertIdentityAllowed({
    host: CRS_PRODUCTION_HOST,
    bureau: "TU",
    identity: REAL_PERSON,
    env: LIVE_ON
  }));
  assert.deepEqual(
    identityForBureau({
      host: CRS_PRODUCTION_HOST,
      bureau: "TU",
      identity: REAL_PERSON,
      env: LIVE_ON
    }),
    { ...REAL_PERSON, birthDate: "1985-06-02" }
  );
});

test("production host + CRS_ALLOW_LIVE on REFUSES a test fixture", () => {
  assert.throws(
    () => assertIdentityAllowed({
      host: CRS_PRODUCTION_HOST,
      bureau: "TU",
      identity: SANDBOX_TEST_IDENTITIES.TU,
      env: LIVE_ON
    }),
    (error) => error.code === "test_identity_on_production"
  );
});

test("CRS_ALLOW_LIVE on without the production host does not open sandbox to real people", () => {
  assert.throws(
    () => assertIdentityAllowed({
      host: CRS_SANDBOX_HOST,
      bureau: "TU",
      identity: REAL_PERSON,
      env: LIVE_ON
    }),
    (error) => error.code === "identity_not_allowed_on_sandbox"
  );
});

test("unknown hosts are refused even with CRS_ALLOW_LIVE on", () => {
  assert.throws(
    () => assertIdentityAllowed({
      host: "unknown.example",
      bureau: "TU",
      identity: REAL_PERSON,
      env: LIVE_ON
    }),
    (error) => error.code === "unknown_host"
  );
});

test("host normalization cannot weaken the sandbox gate", () => {
  assert.equal(
    normalizeHost("https://API-SANDBOX.STITCHCREDIT.COM:443/api"),
    CRS_SANDBOX_HOST
  );
  assert.equal(identityForBureau({
    host: CRS_SANDBOX_HOST,
    bureau: "EQ",
    identity: REAL_PERSON
  }), SANDBOX_TEST_IDENTITIES.EQ);
});

test("isoBirthDate never sends weekday text to a bureau", () => {
  assert.equal(isoBirthDate("1985-06-02"), "1985-06-02");
  assert.equal(isoBirthDate("1985-06-02T00:00:00.000Z"), "1985-06-02");
  assert.equal(isoBirthDate(new Date("1985-06-02T00:00:00.000Z")), "1985-06-02");
  assert.equal(isoBirthDate("Sat Sep 02"), null);
  assert.equal(isoBirthDate(String(new Date("1985-09-02T00:00:00.000Z")).slice(0, 10)), null);
  assert.equal(isoBirthDate(""), null);
  assert.equal(isoBirthDate(null), null);
});

test("production pull REFUSES a weekday birth date", () => {
  const bad = { ...REAL_PERSON, birthDate: "Sat Sep 02" };
  assert.throws(
    () => assertIdentityAllowed({
      host: CRS_PRODUCTION_HOST,
      bureau: "TU",
      identity: bad,
      env: LIVE_ON
    }),
    (error) => error.code === "dob_invalid"
  );
});

test("identityForBureau turns a Date birth date into YYYY-MM-DD", () => {
  const out = identityForBureau({
    host: CRS_PRODUCTION_HOST,
    bureau: "TU",
    identity: { ...REAL_PERSON, birthDate: new Date("1985-06-02T00:00:00.000Z") },
    env: LIVE_ON
  });
  assert.equal(out.birthDate, "1985-06-02");
});

test("activeBureausFromEnv: unset is TU+EX+EQ; override can drop or keep TU", () => {
  assert.deepEqual(activeBureausFromEnv({}), ["TU", "EX", "EQ"]);
  assert.deepEqual(activeBureausFromEnv({ CRS_ACTIVE_BUREAUS: "TU,EX,EQ" }), ["TU", "EX", "EQ"]);
  assert.deepEqual(activeBureausFromEnv({ CRS_ACTIVE_BUREAUS: "EX,EQ" }), ["EX", "EQ"]);
  assert.deepEqual(activeBureausFromEnv({ CRS_ACTIVE_BUREAUS: " tu , eq " }), ["TU", "EQ"]);
});

test("sandbox identities are frozen", () => {
  assert.throws(() => { SANDBOX_TEST_IDENTITIES.TU.ssn = REAL_PERSON.ssn; }, TypeError);
  assert.equal(sandboxBureauFor(SANDBOX_TEST_IDENTITIES.EQ), "EQ");
  assert.equal(sandboxBureauFor(REAL_PERSON), null);
});

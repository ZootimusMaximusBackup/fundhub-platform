import test from "node:test";
import assert from "node:assert/strict";

import {
  BUREAUS,
  CRS_PRODUCTION_HOST,
  CRS_SANDBOX_HOST,
  NEVER_ISSUED_SSN_PREFIX,
  SANDBOX_TEST_IDENTITIES,
  assertIdentityAllowed,
  identityForBureau,
  matchesSandboxIdentity,
  normalizeHost,
  ssnDigits
} from "./crs-identities.mjs";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("CRS identities: every fixture is synthetic and accepted only for its bureau", () => {
  for (const bureau of BUREAUS) {
    const identity = SANDBOX_TEST_IDENTITIES[bureau];
    assert.equal(ssnDigits(identity.ssn).slice(0, 3), NEVER_ISSUED_SSN_PREFIX);
    assert.equal(matchesSandboxIdentity(bureau, clone(identity)), true);
    assert.doesNotThrow(() => assertIdentityAllowed({
      host: CRS_SANDBOX_HOST,
      bureau,
      identity: clone(identity)
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

test("CRS identities: production and unknown hosts are refused", () => {
  const identity = clone(SANDBOX_TEST_IDENTITIES.TU);
  assert.throws(
    () => assertIdentityAllowed({
      host: CRS_PRODUCTION_HOST,
      bureau: "TU",
      identity
    }),
    (error) => error.code === "production_host_refused"
  );
  assert.throws(
    () => assertIdentityAllowed({
      host: "unknown.example",
      bureau: "TU",
      identity
    }),
    (error) => error.code === "unknown_host"
  );
  assert.throws(
    () => identityForBureau({ host: CRS_PRODUCTION_HOST, bureau: "TU" }),
    (error) => error.code === "production_host_refused"
  );
});

test("CRS identities: host normalization cannot weaken the sandbox gate", () => {
  assert.equal(
    normalizeHost("https://API-SANDBOX.STITCHCREDIT.COM:443/api"),
    CRS_SANDBOX_HOST
  );
  assert.equal(identityForBureau({
    host: CRS_SANDBOX_HOST,
    bureau: "EQ"
  }), SANDBOX_TEST_IDENTITIES.EQ);
});

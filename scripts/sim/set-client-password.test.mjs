// Pins the two rules that make set-client-password.mjs safe to approve once:
// the secret comes from the environment, and it is refused on the command line.
//
// No database here on purpose — main() is guarded behind the argv check, so
// importing this module runs nothing.

import test from "node:test";
import assert from "node:assert/strict";
import { readPassword, passwordOnArgv } from "./set-client-password.mjs";

test("the password is read from the environment, explicit name first", () => {
  assert.deepEqual(
    readPassword({ SIM_CLIENT_PASSWORD: "explicit-one", TEST_ACCOUNT_PASSWORD: "shared-one" }),
    { password: "explicit-one", source: "SIM_CLIENT_PASSWORD" }
  );
  assert.deepEqual(
    readPassword({ TEST_ACCOUNT_PASSWORD: "shared-one" }),
    { password: "shared-one", source: "TEST_ACCOUNT_PASSWORD" }
  );
});

test("no password in the environment is reported, not guessed", () => {
  assert.deepEqual(readPassword({}), { password: null, source: null });
  // Empty is the same as absent — an exported-but-blank variable must not be
  // read as "the password is the empty string".
  assert.deepEqual(readPassword({ SIM_CLIENT_PASSWORD: "" }), { password: null, source: null });
});

test("a password on the command line is detected so it can be refused", () => {
  // A command line is recorded in shell history and visible in ps, so these
  // forms have to fail loudly rather than quietly work.
  assert.equal(passwordOnArgv(["node", "x.mjs", "--email", "a@b.c", "--password", "hunter2"]), true);
  assert.equal(passwordOnArgv(["node", "x.mjs", "--password=hunter2"]), true);
  assert.equal(passwordOnArgv(["node", "x.mjs", "--pass", "hunter2"]), true);
  assert.equal(passwordOnArgv(["node", "x.mjs", "--pw=hunter2"]), true);
  assert.equal(passwordOnArgv(["node", "x.mjs", "--email", "a@b.c", "--dry"]), false);
});

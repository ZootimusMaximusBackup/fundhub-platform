import { test } from "node:test";
import assert from "node:assert";
import {
  hashPassword, verifyPassword, needsRehash, validatePassword, verifyDecoy,
  PARAMS, MIN_PASSWORD_LENGTH
} from "./hash.mjs";

const GOOD = "correct horse battery staple";

test("hashPassword produces a PHC string that carries algo + params, not the password", async () => {
  const h = await hashPassword(GOOD);
  assert.match(h, /^\$scrypt\$N=32768,r=8,p=1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.ok(!h.includes(GOOD), "hash must not contain the plaintext");
  assert.ok(!h.includes("horse"), "hash must not contain any part of the plaintext");
});

test("the same password hashes differently every time (unique salt)", async () => {
  const [a, b] = await Promise.all([hashPassword(GOOD), hashPassword(GOOD)]);
  assert.notEqual(a, b);
  assert.ok(await verifyPassword(GOOD, a));
  assert.ok(await verifyPassword(GOOD, b));
});

test("verifyPassword accepts the right password and rejects near-misses", async () => {
  const h = await hashPassword(GOOD);
  assert.equal(await verifyPassword(GOOD, h), true);
  assert.equal(await verifyPassword(GOOD + " ", h), false);
  assert.equal(await verifyPassword(GOOD.toUpperCase(), h), false);
  assert.equal(await verifyPassword(GOOD.slice(0, -1), h), false);
});

test("verifyPassword never throws on junk — a missing hash is false, not a bypass", async () => {
  for (const junk of [null, undefined, "", "not-a-hash", "$scrypt$", "$scrypt$N=0,r=8,p=1$a$b",
                      "$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA", "$scrypt$N=8,r=1,p=1$!!!$!!!", 42, {}]) {
    assert.equal(await verifyPassword(GOOD, junk), false, `junk hash: ${String(junk)}`);
  }
  const h = await hashPassword(GOOD);
  for (const junk of [null, undefined, "", 42, {}]) {
    assert.equal(await verifyPassword(junk, h), false, `junk password: ${String(junk)}`);
  }
});

test("a staff row with a NULL password_hash can never authenticate", async () => {
  assert.equal(await verifyPassword("anything at all", null), false);
});

test("password policy rejects short, blank and oversized inputs", async () => {
  assert.equal(validatePassword(GOOD), null);
  assert.match(validatePassword("short"), /at least 12/);
  assert.equal(validatePassword("x".repeat(MIN_PASSWORD_LENGTH)), null);
  assert.match(validatePassword(" ".repeat(20)), /blank/);
  assert.match(validatePassword("x".repeat(2000)), /at most/);
  assert.match(validatePassword(12345678901234), /string/);
  await assert.rejects(() => hashPassword("short"), /at least 12/);
});

test("policy failures never echo the password back", () => {
  const secret = "hunter2hunter2";
  const reason = validatePassword("x".repeat(2000)) ?? "";
  assert.ok(!reason.includes(secret));
  assert.ok(!reason.includes("x".repeat(20)));
});

test("unicode-equivalent passwords match (NFKC normalisation)", async () => {
  // Same string, composed vs decomposed forms.
  const composed = "café password ok";
  const decomposed = "café password ok";
  assert.notEqual(composed, decomposed);
  const h = await hashPassword(composed);
  assert.equal(await verifyPassword(decomposed, h), true);
});

test("needsRehash flags foreign/older hashes and clears current ones", async () => {
  const h = await hashPassword(GOOD);
  assert.equal(needsRehash(h), false);
  assert.equal(needsRehash(h.replace(`N=${PARAMS.N}`, "N=16384")), true);
  assert.equal(needsRehash("$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA"), true);
  assert.equal(needsRehash(null), true);
});

test("verifyDecoy always returns false but does real work (timing floor)", async () => {
  assert.equal(await verifyDecoy(GOOD), false);
  assert.equal(await verifyDecoy(""), false);
  assert.equal(await verifyDecoy(null), false);
});

test("scrypt parameters are memory-hard and maxmem clears 128*N*r", () => {
  assert.ok(PARAMS.N >= 16384, "N must be at least 2^14");
  assert.equal(PARAMS.N & (PARAMS.N - 1), 0, "N must be a power of two");
  assert.ok(PARAMS.maxmem > 128 * PARAMS.N * PARAMS.r, "maxmem must exceed the scrypt working set");
  assert.ok(PARAMS.keylen >= 32);
  assert.ok(PARAMS.saltlen >= 16);
});

// Unit tests for identity encryption and the reveal path.
//
// The crypto here is real — no database needed to prove that a ciphertext bound
// to client A does not decrypt for client B, which is the single most important
// property in this module. The database-shaped claims (the log row lands, the
// transaction aborts the disclosure) are asserted through a recording stub and
// re-checked against Postgres in index.pg.test.mjs.

import { test } from "node:test";
import assert from "node:assert";
import { encryptSsn, decryptSsn, maskSsn, revealSsn, readIdentity, PiiError } from "./index.mjs";

const KEY = Buffer.alloc(32, 7).toString("base64");
const ENV = { PII_ENC_KEY: KEY };
const CLIENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

test("an SSN round-trips, and the stored form is not the plaintext", () => {
  const enc = encryptSsn("123-45-6789", { clientId: CLIENT_A, env: ENV });
  assert.ok(Buffer.isBuffer(enc));
  assert.doesNotMatch(enc.toString("utf8"), /123456789/, "the digits must not survive in the stored value");
  assert.equal(decryptSsn(enc, { clientId: CLIENT_A, env: ENV }), "123456789");
});

test("a ciphertext moved to another client's row does not decrypt", () => {
  const enc = encryptSsn("123456789", { clientId: CLIENT_A, env: ENV });
  assert.throws(() => decryptSsn(enc, { clientId: CLIENT_B, env: ENV }),
    "a mis-joined update must fail loudly, not attribute one person's SSN to another");
});

test("a tampered ciphertext fails rather than decrypting to garbage", () => {
  const enc = encryptSsn("123456789", { clientId: CLIENT_A, env: ENV });
  const parts = enc.toString("utf8").split(":");
  const flipped = Buffer.from(parts[3], "base64");
  flipped[0] ^= 0xff;
  parts[3] = flipped.toString("base64");
  assert.throws(() => decryptSsn(Buffer.from(parts.join(":"), "utf8"), { clientId: CLIENT_A, env: ENV }));
});

test("an unset key refuses to encrypt instead of storing plaintext", () => {
  assert.throws(
    () => encryptSsn("123456789", { clientId: CLIENT_A, env: {} }),
    (e) => e instanceof PiiError && /PII_ENC_KEY is not set/.test(e.message)
  );
});

test("a wrong-length key is refused", () => {
  assert.throws(
    () => encryptSsn("123456789", { clientId: CLIENT_A, env: { PII_ENC_KEY: Buffer.alloc(16).toString("base64") } }),
    /32 bytes/
  );
});

test("encryption requires a client id — without it the binding silently would not apply", () => {
  assert.throws(() => encryptSsn("123456789", { env: ENV }), /clientId is required/);
});

test("a value that is not nine digits is not an SSN", () => {
  assert.throws(() => encryptSsn("1234", { clientId: CLIENT_A, env: ENV }), /9 digits/);
  assert.equal(encryptSsn("", { clientId: CLIENT_A, env: ENV }), null);
  assert.equal(encryptSsn(null, { clientId: CLIENT_A, env: ENV }), null);
});

test("maskSsn gives last four and nothing else", () => {
  assert.equal(maskSsn("123456789"), "6789");
  assert.equal(maskSsn("123-45-6789"), "6789");
  assert.equal(maskSsn("1234"), null, "a partial value is not silently padded into a mask");
  assert.equal(maskSsn(null), null);
});

/* Stub covering the two statements the read paths issue. */
function stubDb({ row = undefined } = {}) {
  const calls = [];
  const client = {
    query(sql, params = []) {
      calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      if (/FROM pii_identity/.test(sql)) return { rows: row ? [row] : [] };
      return { rows: [] };
    },
    release() {}
  };
  return { calls, connect: async () => client, query: (s, p) => client.query(s, p) };
}

test("readIdentity returns a mask and never the ciphertext", async () => {
  const db = stubDb({
    row: {
      id: "1", org_id: ORG, client_id: CLIENT_A, dob: "1980-01-01", addresses: [],
      ssn_enc: encryptSsn("123456789", { clientId: CLIENT_A, env: ENV }),
      created_at: null, updated_at: null
    }
  });
  const out = await readIdentity(db, { clientId: CLIENT_A, env: ENV });
  assert.equal(out.ssn_last4, "6789");
  assert.equal(out.ssn_present, true);
  assert.equal(out.ssn_enc, undefined, "the ciphertext must not leave this module");
  assert.equal(out.ssn, undefined);
});

test("readIdentity survives an unreadable key without blanking the record", async () => {
  const db = stubDb({
    row: {
      id: "1", org_id: ORG, client_id: CLIENT_A, dob: "1980-01-01", addresses: [],
      ssn_enc: encryptSsn("123456789", { clientId: CLIENT_A, env: ENV })
    }
  });
  const out = await readIdentity(db, { clientId: CLIENT_A, env: {} });
  assert.equal(out.ssn_present, true, "we still know an SSN is on file");
  assert.equal(out.ssn_last4, null, "we just cannot show it");
  assert.equal(out.dob, "1980-01-01");
});

test("readIdentity is not logged — the log is for disclosures, not traffic", async () => {
  const db = stubDb({ row: { id: "1", org_id: ORG, client_id: CLIENT_A, ssn_enc: null, addresses: [] } });
  await readIdentity(db, { clientId: CLIENT_A, env: ENV });
  assert.ok(!db.calls.some((c) => /pii_access_log/.test(c.sql)));
});

test("revealSsn writes the access log before it returns the number", async () => {
  const db = stubDb({ row: { org_id: ORG, ssn_enc: encryptSsn("123456789", { clientId: CLIENT_A, env: ENV }) } });
  const out = await revealSsn(db, { clientId: CLIENT_A, accessedBy: "alvin", reason: "inquiry 42", env: ENV });

  assert.equal(out.ssn, "123456789");
  const sqls = db.calls.map((c) => c.sql);
  assert.equal(sqls[0], "BEGIN");
  const logIdx = sqls.findIndex((s) => /INSERT INTO pii_access_log/.test(s));
  assert.ok(logIdx > 0, "the disclosure must be recorded");
  assert.equal(sqls.at(-1), "COMMIT");

  const logCall = db.calls[logIdx];
  assert.equal(logCall.params[2], "alvin");
  assert.equal(logCall.params[3], "ssn (inquiry 42)", "the reason travels with the log row");
});

test("revealSsn refuses an unattributed read", async () => {
  const db = stubDb({ row: { org_id: ORG, ssn_enc: encryptSsn("123456789", { clientId: CLIENT_A, env: ENV }) } });
  await assert.rejects(() => revealSsn(db, { clientId: CLIENT_A, env: ENV }), (e) => e.status === 401);
});

test("revealSsn on a client with no SSN is a 404, not an empty string", async () => {
  const db = stubDb({ row: { org_id: ORG, ssn_enc: null } });
  await assert.rejects(
    () => revealSsn(db, { clientId: CLIENT_A, accessedBy: "alvin", env: ENV }),
    (e) => e.status === 404
  );
});

test("a failed decrypt rolls back rather than leaving a log row for a disclosure that did not happen", async () => {
  const db = stubDb({ row: { org_id: ORG, ssn_enc: encryptSsn("123456789", { clientId: CLIENT_B, env: ENV }) } });
  await assert.rejects(() => revealSsn(db, { clientId: CLIENT_A, accessedBy: "alvin", env: ENV }));
  assert.ok(db.calls.some((c) => c.sql === "ROLLBACK"));
});

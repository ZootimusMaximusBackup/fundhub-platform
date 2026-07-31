// Bank credential handling — the parts that must hold with no database.
//
// The Postgres side lives in src/http/banking.pg.test.mjs. What is here is the
// cipher and the refusals, because those are the two places where being wrong is
// silent: plaintext in a column looks exactly like ciphertext to a passing
// glance, and a validation that never fires looks exactly like one that passes.
//
// THE TEST THAT MATTERS MOST is the cross-client one. Binding the client id into
// the AAD means a token copied from one client's row into another's FAILS to
// decrypt. Without it, a bad backfill or a mis-joined UPDATE would hand one
// client a working credential for another person's bank account, and every
// downstream check would pass because the token really is valid. The database
// cannot catch that. The cipher can, and this asserts it does.

import { test, describe } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";

import {
  encryptAccessToken,
  decryptAccessToken,
  writeSyncAudit,
  classifyAccount,
  linkItem,
  syncItem,
  listItems,
  listAccounts,
  syncHistory,
  ENTITY_KINDS,
  BankingError
} from "./index.mjs";

const env = { BANK_TOKEN_ENC_KEY: crypto.randomBytes(32).toString("base64") };
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const TOKEN = "access-production-8a1f6c22-1111-2222-3333-a1b2c3d4e5f6";

function thrown(fn, Kind) {
  try {
    fn();
  } catch (e) {
    if (Kind) assert.ok(e instanceof Kind, `expected ${Kind.name}, got ${e?.name}: ${e?.message}`);
    return e;
  }
  assert.fail("expected a throw, got a return");
}

async function rejected(fn, Kind) {
  try {
    await fn();
  } catch (e) {
    if (Kind) assert.ok(e instanceof Kind, `expected ${Kind.name}, got ${e?.name}: ${e?.message}`);
    return e;
  }
  assert.fail("expected a rejection, got a resolve");
}

/* A database that answers nothing and records everything it was asked. Used to
   prove a call never reached SQL, which is the only way to tell "it refused"
   apart from "it wrote the row and then complained". */
const recordingDb = () => {
  const queries = [];
  return { queries, query: async (sql, params) => (queries.push({ sql, params }), { rows: [], rowCount: 0 }) };
};

describe("round trip", () => {
  test("encrypts and decrypts for the same client", () => {
    const ct = encryptAccessToken(TOKEN, { clientId: A, env });
    assert.equal(decryptAccessToken(ct, { clientId: A, env }), TOKEN);
  });

  test("the ciphertext does not contain the plaintext", () => {
    const ct = encryptAccessToken(TOKEN, { clientId: A, env });
    assert.ok(!ct.includes(TOKEN));
    assert.ok(!ct.includes("access-production"));
  });

  test("the same token encrypts differently every time", () => {
    // Random IV per call. Deterministic ciphertext would let anyone with read
    // access tell that two clients hold the same token.
    assert.notEqual(encryptAccessToken(TOKEN, { clientId: A, env }), encryptAccessToken(TOKEN, { clientId: A, env }));
  });

  test("null and empty round-trip to null rather than encrypting a blank", () => {
    assert.equal(encryptAccessToken(null, { clientId: A, env }), null);
    assert.equal(encryptAccessToken("", { clientId: A, env }), null);
    assert.equal(decryptAccessToken(null, { clientId: A, env }), null);
  });
});

describe("the ciphertext is bound to one client", () => {
  test("a token copied into another client's row FAILS to decrypt", () => {
    const ct = encryptAccessToken(TOKEN, { clientId: A, env });
    assert.throws(() => decryptAccessToken(ct, { clientId: B, env }));
  });

  test("encrypting without a client id is refused — the binding is not optional", () => {
    thrown(() => encryptAccessToken(TOKEN, { env }), BankingError);
    thrown(() => decryptAccessToken("v1:a:b:c", { env }), BankingError);
  });

  test("a tampered ciphertext fails rather than decrypting to garbage", () => {
    const ct = encryptAccessToken(TOKEN, { clientId: A, env });
    const parts = ct.split(":");
    const flipped = Buffer.from(parts[3], "base64");
    flipped[0] ^= 0xff;
    parts[3] = flipped.toString("base64");
    assert.throws(() => decryptAccessToken(parts.join(":"), { clientId: A, env }));
  });

  test("a malformed envelope is refused, not parsed optimistically", () => {
    thrown(() => decryptAccessToken("not-a-ciphertext", { clientId: A, env }), BankingError);
    thrown(() => decryptAccessToken("v1:a:b", { clientId: A, env }), BankingError);
  });
});

describe("an unset key stops the feature — it never stores plaintext", () => {
  test("encrypting with no key throws a 503 and names the variable", () => {
    const err = thrown(() => encryptAccessToken(TOKEN, { clientId: A, env: {} }), BankingError);
    assert.match(err.message, /BANK_TOKEN_ENC_KEY/);
    assert.equal(err.status, 503);
    assert.ok(!err.message.includes(TOKEN));
  });

  test("a wrong-length key is refused rather than padded", () => {
    const err = thrown(
      () => encryptAccessToken(TOKEN, { clientId: A, env: { BANK_TOKEN_ENC_KEY: Buffer.alloc(16, 1).toString("base64") } }),
      BankingError
    );
    assert.match(err.message, /32 bytes/);
  });

  test("the key is checked BEFORE the exchange, so no credential is created that we cannot store", async () => {
    // Discovering the key is missing after the exchange would leave a live token
    // at Plaid that this platform can neither store nor revoke, because it never
    // wrote down the item id.
    const db = recordingDb();
    const fetchImpl = () => {
      throw new Error("the exchange must not run without a key to store the result");
    };
    await rejected(
      () =>
        linkItem(db, {
          orgId: A, clientId: B, publicToken: "public-x", triggeredBy: "staff-1",
          env: { PLAID_CLIENT_ID: "c", PLAID_SECRET: "s", PLAID_ENV: "sandbox" },
          fetchImpl
        }),
      BankingError
    );
    assert.equal(db.queries.length, 0, "nothing was written");
  });
});

describe("nothing in this module hands a token back", () => {
  test("no export is named to suggest revealing one", async () => {
    const mod = await import("./index.mjs");
    const names = Object.keys(mod);
    // src/pii/index.mjs has revealSsn() because a human occasionally has to read
    // an SSN to a bureau. A bank token has no equivalent use, so there is no
    // equivalent function — and adding one should be a conversation, not a
    // convenience.
    assert.ok(!names.some((n) => /reveal/i.test(n)), `found a reveal-shaped export: ${names.join(", ")}`);
    assert.ok(!names.some((n) => /^getAccessToken|^readToken/i.test(n)));
  });

  test("decryptAccessToken exists but is never reachable through a read", async () => {
    // It is exported for the pg tests and for a future rotation script. The
    // guarantee that matters is that listItems/listAccounts/syncHistory do not
    // project the ciphertext, which src/http/banking.pg.test.mjs asserts against
    // real rows.
    const db = recordingDb();
    await listItems(db, { clientId: A });
    await listAccounts(db, { clientId: A });
    await syncHistory(db, { clientId: A });
    for (const q of db.queries) {
      assert.ok(!/access_token_enc\s*,/.test(q.sql), `a read projected the ciphertext:\n${q.sql}`);
      assert.ok(!/SELECT\s+\*/i.test(q.sql), `a read used SELECT * and could pick up the ciphertext:\n${q.sql}`);
    }
  });
});

describe("an audit row is required, and it must be attributable", () => {
  test("writeSyncAudit with no author is refused", async () => {
    const db = recordingDb();
    const err = await rejected(
      () => writeSyncAudit(db, { orgId: A, action: "accounts_sync", outcome: "ok" }),
      BankingError
    );
    assert.equal(err.status, 401);
    assert.equal(db.queries.length, 0, "an unattributed attempt must not write a row at all");
  });

  test("writeSyncAudit with no org is refused", async () => {
    const db = recordingDb();
    await rejected(() => writeSyncAudit(db, { action: "accounts_sync", outcome: "ok", triggeredBy: "s" }), BankingError);
    assert.equal(db.queries.length, 0);
  });

  test("an over-long provider error is truncated rather than refused", async () => {
    const db = recordingDb();
    await writeSyncAudit(db, {
      orgId: A, action: "accounts_sync", outcome: "error", triggeredBy: "staff-1",
      errorMessage: "x".repeat(5000)
    });
    const params = db.queries[0].params;
    assert.equal(params[10].length, 2000);
  });

  test("syncItem refuses without an author, before it reads the credential", async () => {
    const db = recordingDb();
    await rejected(() => syncItem(db, { itemRowId: A }), BankingError);
    assert.equal(db.queries.length, 0);
  });
});

describe("classification", () => {
  test("the three kinds are exactly personal, business and unknown", () => {
    assert.deepEqual([...ENTITY_KINDS].sort(), ["business", "personal", "unknown"]);
  });

  test("'unknown' is an allowed answer, not just a starting state", async () => {
    // "Somebody looked and could not tell" is a real outcome and is materially
    // different from "nobody has looked" — which is why the row still records
    // who said so.
    const db = recordingDb();
    db.query = async () => ({ rows: [{ id: A, entity_kind: "unknown" }], rowCount: 1 });
    const out = await classifyAccount(db, { accountRowId: A, entityKind: "unknown", setBy: "staff-1" });
    assert.equal(out.entity_kind, "unknown");
  });

  test("an invented kind is refused", async () => {
    const db = recordingDb();
    for (const kind of ["corporate", "PERSONAL", "", null, undefined]) {
      await rejected(() => classifyAccount(db, { accountRowId: A, entityKind: kind, setBy: "s" }), BankingError);
    }
    assert.equal(db.queries.length, 0);
  });

  test("naming a business on a personal account is refused before it reaches SQL", async () => {
    const db = recordingDb();
    const err = await rejected(
      () => classifyAccount(db, { accountRowId: A, entityKind: "personal", businessId: B, setBy: "s" }),
      BankingError
    );
    assert.match(err.message, /business/);
    assert.equal(db.queries.length, 0);
  });

  test("a classification with no author is refused", async () => {
    const db = recordingDb();
    const err = await rejected(
      () => classifyAccount(db, { accountRowId: A, entityKind: "business", setBy: "" }),
      BankingError
    );
    assert.equal(err.status, 401);
    assert.equal(db.queries.length, 0);
  });

  test("the balance sync's upsert assigns NO classification column", async () => {
    /* RULE 4, checked against the SQL itself rather than trusted to a comment.
       A balance refresh must never undo a person's classification, and the way
       that regression would arrive is somebody adding `entity_kind` to this SET
       list while making the upsert "complete". Plaid has no opinion to overwrite
       it with, so there is nothing to add.

       Reading the source is crude, and it is the only way to assert on a
       statement that needs a real Postgres to execute. The pg suite proves the
       behaviour end to end; this proves it without a database, so it runs in
       every CI pass rather than only the ones with DATABASE_URL set. */
    const fs = await import("node:fs");
    const src = await fs.promises.readFile(new URL("./index.mjs", import.meta.url), "utf8");

    const start = src.indexOf("INSERT INTO bank_accounts");
    assert.ok(start > -1, "the accounts upsert moved — this test needs updating with it");
    const setBlock = src.slice(start, src.indexOf("`,", start));

    for (const column of ["entity_kind", "business_id", "entity_kind_source", "entity_kind_set_by", "entity_kind_set_at"]) {
      const assigns = new RegExp(`${column}\\s*=`).test(setBlock.replace(/--[^\n]*/g, ""));
      assert.equal(assigns, false, `the balance sync assigns ${column} — a re-sync would erase a human's answer`);
    }
  });

  test("classifyAccount is the only place entity_kind is assigned at all", async () => {
    const fs = await import("node:fs");
    const src = (await fs.promises.readFile(new URL("./index.mjs", import.meta.url), "utf8")).replace(/--[^\n]*/g, "");
    const assignments = src.split("\n").filter((l) => /\bentity_kind\s*=/.test(l));
    assert.equal(assignments.length, 1, `entity_kind is assigned in ${assignments.length} places:\n${assignments.join("\n")}`);
  });
});

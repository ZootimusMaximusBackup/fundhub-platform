// revealSsn — rule 3, proven rather than asserted in a comment.
//
//   "The access log is written in the same transaction as the reveal, BEFORE the
//    value is returned. If the log write fails, the reveal fails."
//
// That sentence has been in src/pii/index.mjs's header since the module was
// written, and it was NOT TRUE. The ordering was always right; the transaction
// was not a transaction. The local withTransaction() probed
// `typeof db.connect !== "function"` and ran the callback inline when there was
// none — and src/db.mjs exports `db` as `{ query }` with NO connect(), so on the
// one handle every production caller passes it took the no-transaction branch
// every single time.
//
// Under autocommit the INSERT commits itself the moment it runs. A failure after
// it cannot undo it, and — the direction that actually matters — a failure OF it
// raises only after the statement has already been attempted standalone, so the
// reveal and its audit trail were never bound together.
//
// THE TEST THAT MATTERS IS THE SECOND ONE: make the log write fail, and assert
// that no social security number comes back. It fails against the old code.
//
// No database and no DATABASE_URL. The doubles here record BEGIN/COMMIT/ROLLBACK,
// which is precisely what src/db/with-transaction.mjs's first branch is
// documented to support: "a real Pool, OR A TEST DOUBLE THAT WANTS TO OBSERVE
// BEGIN/COMMIT/ROLLBACK".

import { test, describe } from "node:test";
import assert from "node:assert";

import { revealSsn, encryptSsn, PiiError } from "./index.mjs";

const CLIENT = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ORG = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const KEY = Buffer.alloc(32, 7).toString("base64");   // fixed, fake, test-only
const ENV = { PII_ENC_KEY: KEY };
const SSN = "123456789";

/* A pool double. Records every statement in order, so the test can assert that
   the work really was wrapped — not merely that it produced the right answer. */
function poolDouble({ failLogWrite = false, identityRow = undefined } = {}) {
  const issued = [];
  const row = identityRow === undefined
    ? { org_id: ORG, ssn_enc: encryptSsn(SSN, { clientId: CLIENT, env: ENV }) }
    : identityRow;

  const query = async (sql) => {
    issued.push(String(sql).replace(/\s+/g, " ").trim());
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(String(sql).trim())) return { rows: [] };
    if (/FROM pii_identity/i.test(sql)) return { rows: row ? [row] : [] };
    if (/INSERT INTO pii_access_log/i.test(sql)) {
      if (failLogWrite) {
        // What a real failure looks like here: the org_id FK, a NOT NULL, a
        // constraint — anything that makes the audit row impossible to write.
        const e = new Error('insert or update on table "pii_access_log" violates foreign key constraint');
        e.code = "23503";
        throw e;
      }
      return { rows: [], rowCount: 1 };
    }
    throw new Error("unexpected sql: " + sql);
  };

  let released = false;
  return {
    issued,
    get released() { return released; },
    query,                                   // used if anything calls it directly
    connect: async () => ({ query, release() { released = true; } })
  };
}

const verbs = (db) => db.issued.filter((s) => /^(BEGIN|COMMIT|ROLLBACK)$/i.test(s));

describe("revealSsn runs inside a real transaction", () => {

  test("a successful reveal is wrapped in BEGIN/COMMIT", async () => {
    const db = poolDouble();
    const out = await revealSsn(db, { clientId: CLIENT, accessedBy: "dana", env: ENV });

    assert.equal(out.ssn, SSN);
    assert.deepEqual(verbs(db), ["BEGIN", "COMMIT"],
      "the reveal must be wrapped in a transaction — it was running under autocommit");
    assert.ok(db.released, "the client must be released back to the pool");
  });

  test("the log row is written BEFORE the value is decrypted and returned", async () => {
    const db = poolDouble();
    await revealSsn(db, { clientId: CLIENT, accessedBy: "dana", env: ENV });

    const begin = db.issued.findIndex((s) => /^BEGIN$/i.test(s));
    const log = db.issued.findIndex((s) => /INSERT INTO pii_access_log/i.test(s));
    const commit = db.issued.findIndex((s) => /^COMMIT$/i.test(s));

    assert.ok(begin >= 0 && log > begin && commit > log,
      "the access-log insert must happen inside the transaction, before it commits");
  });

  test("*** A FAILING LOG WRITE MEANS NO SSN COMES BACK — this is rule 3 ***", async () => {
    // THE ASSERTION THIS FILE EXISTS FOR. Against the old code the callback ran
    // inline with no transaction, so this path was never bound together at all.
    const db = poolDouble({ failLogWrite: true });

    await assert.rejects(
      () => revealSsn(db, { clientId: CLIENT, accessedBy: "dana", env: ENV }),
      (err) => {
        // Whatever comes back must not be, or contain, the number.
        const blob = JSON.stringify({ m: err.message, s: String(err) });
        assert.ok(!blob.includes(SSN),
          "the social security number leaked through the error path of a failed reveal");
        return true;
      },
      "a reveal whose access log could not be written must fail, not succeed quietly"
    );

    assert.deepEqual(verbs(db), ["BEGIN", "ROLLBACK"],
      "a failed audit write must roll the reveal back");
    assert.ok(db.released, "the client must be released even on the failure path");
  });

  test("nothing is decrypted after the log write fails", async () => {
    // Stronger than "it threw": the value must not be produced at all. If the
    // implementation ever decrypts first and logs second, this catches it even
    // if the error still propagates.
    const db = poolDouble({ failLogWrite: true });
    await assert.rejects(() => revealSsn(db, { clientId: CLIENT, accessedBy: "dana", env: ENV }));

    const log = db.issued.findIndex((s) => /INSERT INTO pii_access_log/i.test(s));
    const rollback = db.issued.findIndex((s) => /^ROLLBACK$/i.test(s));
    assert.ok(log >= 0, "the log write was never attempted");
    assert.equal(rollback, log + 1, "the rollback must follow the failed log write immediately");
  });

  test("an unattributed reveal is refused before any query runs", async () => {
    const db = poolDouble();
    await assert.rejects(
      () => revealSsn(db, { clientId: CLIENT, accessedBy: null, env: ENV }),
      (e) => { assert.equal(e.status, 401); return true; }
    );
    assert.deepEqual(db.issued, [], "an unloggable reveal must not open a transaction at all");
  });

  test("a client with no identity record rolls back rather than committing an empty read", async () => {
    const db = poolDouble({ identityRow: null });
    await assert.rejects(
      () => revealSsn(db, { clientId: CLIENT, accessedBy: "dana", env: ENV }),
      (e) => { assert.equal(e.status, 404); return true; }
    );
    assert.deepEqual(verbs(db), ["BEGIN", "ROLLBACK"]);
  });

  test("a client with no SSN on file writes no access-log row", async () => {
    // Nothing was disclosed, so there is nothing to log. Logging it anyway would
    // put "Dana viewed an SSN" in the audit trail for a client who has none.
    const db = poolDouble({ identityRow: { org_id: ORG, ssn_enc: null } });
    await assert.rejects(
      () => revealSsn(db, { clientId: CLIENT, accessedBy: "dana", env: ENV }),
      (e) => { assert.equal(e.status, 404); return true; }
    );
    assert.ok(!db.issued.some((s) => /INSERT INTO pii_access_log/i.test(s)),
      "a reveal that disclosed nothing must not claim in the log that it did");
  });
});

describe("the PRODUCTION handle shape, which is where this actually broke", () => {

  test("*** the shared db handle takes the transactional path, not the inline one ***", async () => {
    // THE GAP IN THE TESTS ABOVE, CLOSED. Every double in this file has a
    // connect(), so the OLD broken probe took its transactional branch and those
    // tests passed against the bug. They were proving the shape of the code, not
    // the behaviour of production.
    //
    // What actually broke was the handle `src/db.mjs` exports: `{ query }`, with
    // NO connect(). The old probe saw that and ran inline. So the assertion that
    // matters is about THAT object specifically.
    //
    // IT HAS TO PROVE THE SAME THING IN BOTH MODES, and the observable differs:
    // with no DATABASE_URL, reaching for the pool throws; with one, it hands back
    // a pooled client. An earlier version asserted only the throw and therefore
    // failed the moment the suite was run against a real database — a test that
    // only works when the database is absent is not much of a test of production.
    //
    // The invariant underneath both is the same: the shared handle must NOT take
    // the run-inline branch. That is what the old probe got wrong.
    const { db: sharedDb } = await import("../db.mjs");
    const { withTransaction } = await import("../db/with-transaction.mjs");

    assert.equal(typeof sharedDb.connect, "undefined",
      "src/db.mjs's export grew a connect(). If that is deliberate the old probe " +
      "would now work by accident — but this test, and the reason for the shared " +
      "helper, both need rewriting rather than quietly passing.");

    let handedIn = null;
    let threw = null;
    try {
      await withTransaction(sharedDb, async (tx) => { handedIn = tx; return "ok"; });
    } catch (e) { threw = e; }

    if (threw) {
      // No database configured: it tried to acquire a connection and could not.
      // Trying at all is the proof — the inline branch never touches the pool.
      assert.match(threw.message, /DATABASE_URL not set/,
        "the shared handle must reach for the pool; it failed for some other reason");
      assert.equal(handedIn, null,
        "the callback ran WITHOUT a transaction — the exact bug: the access log " +
        "and the reveal were never atomic on the handle every caller uses.");
    } else {
      // A database is configured: it must have handed back a POOLED CLIENT, not
      // the shared handle itself. Getting sharedDb back means the inline branch ran.
      assert.notEqual(handedIn, sharedDb,
        "withTransaction handed the callback the shared handle instead of a pooled " +
        "client, which means it ran inline with autocommit — the exact bug.");
      assert.ok(handedIn && typeof handedIn.query === "function",
        "the callback must receive a usable transactional client");
    }
  });

  test("a plain unit-test fake still runs inline, so the stubbed tests keep working", async () => {
    // The third branch, and it is load-bearing: every stubbed-db test in this repo
    // passes a plain object. Removing it to "make transactions mandatory" would
    // break them all.
    const { withTransaction } = await import("../db/with-transaction.mjs");
    const fake = { query: async () => ({ rows: [] }) };
    assert.equal(await withTransaction(fake, async (tx) => (tx === fake ? "inline" : "wrapped")), "inline");
  });
});

describe("the broken probe is gone for good", () => {

  test("src/pii/index.mjs no longer defines its own withTransaction", async () => {
    // The fix is a DELETION plus an import, not a patch. A local copy reappearing
    // here is how this bug came back once already — soft-pulls.mjs found the same
    // probe in its own copy.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, "index.mjs"), "utf8");

    assert.ok(!/^\s*(async\s+)?function\s+withTransaction\s*\(/m.test(src),
      "a local withTransaction is defined here again — import it from " +
      "src/db/with-transaction.mjs instead, or the autocommit bug returns");

    assert.match(src, /import\s*\{\s*withTransaction\s*\}\s*from\s*"\.\.\/db\/with-transaction\.mjs"/,
      "the shared, corrected helper must be imported");
  });

  test("the probe that caused this is not present in the CODE", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("./index.mjs", import.meta.url), "utf8");

    /* Comments stripped first, and that is not a technicality: the header of
       index.mjs now QUOTES the broken probe while explaining what went wrong.
       Matching raw text would flag the explanation as the bug — the same trap
       scripts/journeys/extract.mjs hit, where a comment describing a broken gate
       was read as the gate. */
    /* BLOCK COMMENTS FIRST, then line comments — the opposite order to
       scripts/journeys/extract.mjs, and for the opposite reason. Filtering lines
       first deletes the opening `/*` and leaves the block's middle lines behind,
       which is exactly what happened on the first run of this test: the
       explanation of the bug survived the strip and was flagged as the bug. */
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

    assert.ok(!/typeof\s+db\.connect\s*!==\s*"function"/.test(code),
      'the `typeof db.connect !== "function"` probe is back in the code. src/db.mjs ' +
      "exports `db` as { query } with no connect(), so that probe silently disables " +
      "the transaction on every production call path.");

    // And the explanation really is still there — a fix nobody can read is one
    // somebody reverts.
    assert.match(src, /AUTOCOMMIT/, "the header must keep explaining what went wrong");
  });
});

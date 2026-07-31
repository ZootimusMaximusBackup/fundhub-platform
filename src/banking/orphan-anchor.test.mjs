// THE ORPHAN BUG — the invariant, asserted where it can be checked on every run.
//
// ============================================================================
// THE BUG
// ============================================================================
//
// Deleting one `clients` row does two defensible things at the same moment:
//
//   bank_transactions.client_id  is ON DELETE SET NULL (085)  -> becomes NULL
//   bank_accounts.client_id      is ON DELETE CASCADE  (081)  -> row is deleted
//
// bank_transactions.bank_account_id has no foreign key (085 section 4), so its
// value survives — pointing at an account row that no longer exists. The result
// is a transaction row holding a real person's financial history with NO route
// back to the person and NO route to the account. A later erasure request
// searching by client_id matches nothing and reports success. The data is not
// erased, it is unfindable, and it is now also unauditable.
//
// ============================================================================
// WHY THIS TEST READS SQL INSTEAD OF DELETING A CLIENT
// ============================================================================
//
// The honest version of this test deletes a client against a real database and
// asserts the rows are still reachable. That test exists — src/banking/
// revoke.pg.test.mjs and src/privacy/erasure.pg.test.mjs — and it SKIPS unless
// DATABASE_URL is set, like every other .pg.test.mjs here.
//
// Skipping is exactly the problem. CLAUDE.md §12 records that with DATABASE_URL
// unset roughly 193 pg tests skip and the suite reports zero failures. A control
// that only runs in the passes that have Postgres is a control that does not run
// in the passes where somebody reverts it. This bug is silent by construction —
// the broken and the fixed schema are indistinguishable until a client is deleted
// AND an erasure is later requested, which may be months apart — so the guarantee
// is asserted against the schema text, which is available on every run at no cost.
//
// Same argument, and the same shape, as src/http/auth-gate.test.mjs: "the mistake
// is visible in the text, so the text is where it is caught."
//
// ============================================================================
// THIS TEST DOES NOT HARDCODE "101"
// ============================================================================
//
// It searches every migration for one that establishes the invariant. A later
// migration that supersedes 101 keeps this green as long as the guarantee still
// holds — which is the point. What it will NOT tolerate is the guarantee being
// absent, whichever file was supposed to provide it.

import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const MIGRATIONS = path.join(ROOT, "db/migrations");

/* THE ANCHOR COLUMN. The name is part of the contract: src/privacy/erasure.mjs
   and src/banking/revoke.mjs both query it, and the pg tests assert on it. */
const ANCHOR = "subject_client_id";

/* Every migration file, newest last, as { file, sql }. */
function migrations() {
  return fs.readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ file: f, sql: fs.readFileSync(path.join(MIGRATIONS, f), "utf8") }));
}

/* Strip SQL line comments before matching. Every migration in this repo carries a
   long comment header that discusses the very things being asserted — matching
   against prose would let a file that only TALKS about an anchor pass for one
   that creates it. This is the difference between a real check and a keyword search. */
function code(sql) {
  return sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
}

const ALL = migrations();
const ANCHOR_MIGRATIONS = ALL.filter(({ sql }) =>
  new RegExp(`ALTER\\s+TABLE\\s+bank_transactions[\\s\\S]{0,200}?ADD\\s+COLUMN(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+${ANCHOR}\\b`, "i")
    .test(code(sql))
);

describe("the orphan bug: a bank transaction keeps a route back to the person", () => {

  test("*** A MIGRATION GIVES bank_transactions A DURABLE CLIENT ANCHOR ***", () => {
    // This is the assertion that fails if the fix is reverted.
    assert.ok(
      ANCHOR_MIGRATIONS.length > 0,
      `No migration in db/migrations adds bank_transactions.${ANCHOR}.\n\n` +
      `THE ORPHAN BUG IS OPEN. Deleting a client sets bank_transactions.client_id to\n` +
      `NULL (085, ON DELETE SET NULL) and cascade-deletes every bank_accounts row\n` +
      `(081, ON DELETE CASCADE). bank_account_id has no foreign key, so it keeps\n` +
      `pointing at an account that no longer exists.\n\n` +
      `That leaves this person's merchant names, amounts and dates in the table with\n` +
      `no route back to them at all. A later erasure request will search by\n` +
      `client_id, match nothing, and report that the person was erased. They will\n` +
      `not have been.\n\n` +
      `Restore db/migrations/101_bank_transaction_subject_anchor.sql.`
    );
  });

  test("the anchor is NOT a foreign key, because every ON DELETE option reopens the bug", () => {
    // SET NULL reproduces the bug. CASCADE destroys the ledger, which 085
    // deliberately refused to do. RESTRICT makes deleting a client a database
    // error nobody can clear. There is no FK behaviour that means "keep pointing
    // at who this was", so the column must stay a plain uuid.
    for (const { file, sql } of ANCHOR_MIGRATIONS) {
      const body = code(sql);
      const decl = new RegExp(`ADD\\s+COLUMN(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+${ANCHOR}\\b[^;]*`, "i").exec(body);
      assert.ok(decl, `${file}: could not read the ${ANCHOR} column declaration`);
      assert.ok(
        !/REFERENCES/i.test(decl[0]),
        `${file}: ${ANCHOR} is declared REFERENCES. It must not be a foreign key — ` +
        `SET NULL reproduces the orphan bug, CASCADE destroys the ledger, and RESTRICT ` +
        `blocks client deletion outright. Read the migration header.`
      );

      // The same thing said the other way, in case someone adds it later as a
      // named constraint rather than inline.
      assert.ok(
        !new RegExp(`FOREIGN\\s+KEY\\s*\\(\\s*${ANCHOR}\\s*\\)`, "i").test(body),
        `${file}: a FOREIGN KEY constraint was added on ${ANCHOR}. See above.`
      );
    }
  });

  test("a trigger populates the anchor, so any writer picks it up — not just this repo's code", () => {
    // The ingest path for this table is owned by another workflow and does not
    // exist yet. Rows also arrive from backfills and psql sessions. An anchor that
    // depends on every writer remembering to set it is NULL on the rows that matter.
    const withTrigger = ANCHOR_MIGRATIONS.filter(({ sql }) => {
      const body = code(sql);
      return /CREATE\s+TRIGGER/i.test(body) &&
             /BEFORE\s+INSERT\s+OR\s+UPDATE\s+ON\s+bank_transactions/i.test(body);
    });
    assert.ok(
      withTrigger.length > 0,
      `The ${ANCHOR} column exists but nothing populates it automatically. A BEFORE ` +
      `INSERT OR UPDATE trigger on bank_transactions is required: the ingest path is ` +
      `owned by another workflow, and rows also arrive from backfills and psql ` +
      `sessions that will never read this repository's code.`
    );
  });

  test("*** THE TRIGGER IS ONE-DIRECTIONAL — it fills the anchor, it never clears it ***", () => {
    // The subtlest way to reintroduce this bug while appearing to fix it.
    //
    // ON DELETE SET NULL fires as an UPDATE on the transaction row with
    // NEW.client_id IS NULL. A symmetric trigger — `NEW.subject_client_id :=
    // NEW.client_id` — would helpfully null the anchor at exactly the instant it
    // becomes the only remaining copy. The column would exist, the trigger would
    // exist, every other test here would pass, and the bug would be fully open.
    for (const { file, sql } of ANCHOR_MIGRATIONS) {
      const body = code(sql);
      const fn = /CREATE\s+OR\s+REPLACE\s+FUNCTION[\s\S]*?\$\$([\s\S]*?)\$\$/i.exec(body);
      assert.ok(fn, `${file}: could not find the trigger function body`);

      const assignments = [...fn[1].matchAll(new RegExp(`NEW\\.${ANCHOR}\\s*:=\\s*([^;]+);`, "gi"))];
      assert.ok(assignments.length > 0, `${file}: the trigger never assigns ${ANCHOR}`);

      for (const [, rhs] of assignments) {
        assert.ok(
          !/\bNULL\b/i.test(rhs),
          `${file}: the trigger assigns NULL to ${ANCHOR}. The anchor must never be ` +
          `cleared — ON DELETE SET NULL arrives here as an UPDATE with client_id NULL, ` +
          `and clearing the anchor then is the orphan bug, re-implemented inside its fix.`
        );
      }

      // The assignment must be guarded on the anchor being empty. Unguarded, it
      // runs on every UPDATE — including the SET NULL one.
      assert.ok(
        new RegExp(`IF\\s+NEW\\.${ANCHOR}\\s+IS\\s+NULL`, "i").test(fn[1]),
        `${file}: the assignment is not guarded by "IF NEW.${ANCHOR} IS NULL". ` +
        `Unguarded, it re-evaluates on every UPDATE, including the ON DELETE SET NULL ` +
        `on client_id, and overwrites a good anchor with NULL.`
      );
    }
  });

  test("existing rows are backfilled, so the fix covers the data already in the table", () => {
    // A column that only applies to future rows leaves every transaction written
    // before the migration unreachable — which is most of them.
    const withBackfill = ANCHOR_MIGRATIONS.filter(({ sql }) =>
      new RegExp(`UPDATE\\s+bank_transactions[\\s\\S]*?SET\\s+${ANCHOR}\\s*=\\s*client_id`, "i").test(code(sql))
    );
    assert.ok(
      withBackfill.length > 0,
      `Nothing backfills ${ANCHOR} from client_id. Without it the fix only protects ` +
      `rows written after the migration ran.`
    );
  });

  test("the erasure lookup is indexed, so honouring a request is not a full table scan", () => {
    const withIndex = ANCHOR_MIGRATIONS.filter(({ sql }) =>
      new RegExp(`CREATE\\s+INDEX[\\s\\S]{0,120}?ON\\s+bank_transactions\\s*\\([^)]*${ANCHOR}`, "i").test(code(sql))
    );
    assert.ok(
      withIndex.length > 0,
      `No index covers ${ANCHOR}. The erasure path would sequentially scan the whole ` +
      `ledger, which is the kind of cost that gets a compliance job quietly disabled.`
    );
  });

  test("the migration removes nothing — a schema fix must never delete data", () => {
    // CLAUDE.md and this batch's brief: erasure runs on an explicit request with
    // an audit record, never on a schedule and never as a side effect of a
    // migration. A DELETE here would be an automatic erasure wearing a hat.
    for (const { file, sql } of ANCHOR_MIGRATIONS) {
      const body = code(sql);
      assert.ok(!/\bDELETE\s+FROM\b/i.test(body),
        `${file}: contains DELETE FROM. This migration must not remove data — erasure ` +
        `runs on an explicit request with an audit record, never inside a migration.`);
      assert.ok(!/\bDROP\s+TABLE\b/i.test(body), `${file}: contains DROP TABLE.`);
      assert.ok(!/\bTRUNCATE\b/i.test(body), `${file}: contains TRUNCATE.`);
    }
  });
});

describe("the code honours the anchor", () => {

  test("erasure finds a person's transactions by the anchor, not only by client_id", () => {
    // The migration is half the fix. If the erasure path still searches only
    // client_id, an already-orphaned row stays invisible and the request is
    // answered wrongly — which is the outcome the whole batch exists to prevent.
    const src = fs.readFileSync(path.join(ROOT, "src/privacy/erasure.mjs"), "utf8");
    assert.ok(
      new RegExp(`${ANCHOR}\\s*=\\s*\\$`).test(src),
      `src/privacy/erasure.mjs does not query bank_transactions by ${ANCHOR}. ` +
      `Searching only client_id misses every row whose client was already deleted — ` +
      `exactly the rows the anchor exists to recover.`
    );
  });

  test("erasure does not clear the anchor, which would re-orphan the rows it just found", () => {
    const src = fs.readFileSync(path.join(ROOT, "src/privacy/erasure.mjs"), "utf8");
    assert.ok(
      !new RegExp(`SET[\\s\\S]{0,200}?${ANCHOR}\\s*=\\s*NULL`, "i").test(src),
      `src/privacy/erasure.mjs sets ${ANCHOR} to NULL. After erasure the anchor is a ` +
      `pseudonymous key — it no longer resolves to a name, email, phone or SSN because ` +
      `none of those are left. Clearing it destroys the ability to prove the erasure ` +
      `happened and re-creates the orphan.`
    );
  });

  test("revoke refuses to drop accounts over transactions that have no anchor", () => {
    // Revoking deletes plaid_items, which cascades bank_accounts away. Doing that
    // to unanchored transactions manufactures the exact orphan this batch fixes —
    // while writing an audit row claiming the ledger was kept safely.
    const src = fs.readFileSync(path.join(ROOT, "src/banking/revoke.mjs"), "utf8");
    assert.ok(
      new RegExp(`${ANCHOR}\\s+IS\\s+NULL`, "i").test(src),
      `src/banking/revoke.mjs does not check for transactions with a NULL ${ANCHOR} ` +
      `before deleting the accounts above them. Without that guard, a revoke against a ` +
      `database where migration 101 has not been applied silently creates orphans.`
    );
    assert.ok(
      /refusing to revoke/i.test(src),
      `src/banking/revoke.mjs must REFUSE, not warn, when the anchor is missing.`
    );
  });
});

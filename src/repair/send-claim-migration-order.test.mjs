// The one ordering rule inside db/migrations/333 that a reader cannot see is
// broken until a deploy fails.
//
// MEASURED 2026-09-05. With the DROP of 332's `dispute_letters_claim_ck` written
// AFTER the backfill instead of before it, `node db/migrate.mjs` against a
// scratch Postgres carrying a single 332-shaped stuck row aborted with:
//
//   ✗ FAILED migrations/333_dispute_letter_send_claim.sql: new row for relation
//     "dispute_letters" violates check constraint "dispute_letters_claim_ck"
//
// and applied nothing. 332's constraint reads
// `status <> 'sending' OR mailed_at IS NOT NULL`, and the backfill's whole job is
// to clear mailed_at on exactly the rows sitting in 'sending'. A virgin database
// has no such row, so the file applies cleanly there and the fault only appears
// on a database that has actually been used — which is the only kind of database
// production is.
//
// This is a text check on purpose. Proving it by execution needs a database in
// 332's shape with a stuck row in it, which is not something a *.pg.test.mjs can
// build: migrate.mjs applies 333 the moment it applies 332.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(new URL("../../db/migrations/333_dispute_letter_send_claim.sql", import.meta.url)),
  "utf8"
);

test("333 drops 332's claim CHECK before the backfill clears mailed_at", () => {
  const drop = SQL.indexOf("DROP CONSTRAINT IF EXISTS dispute_letters_claim_ck");
  const backfill = SQL.indexOf("SET mailed_at = NULL");

  assert.ok(drop > 0, "the drop is in the file");
  assert.ok(backfill > 0, "the backfill is in the file");
  assert.ok(
    drop < backfill,
    "332's dispute_letters_claim_ck must be dropped BEFORE the backfill clears "
    + "mailed_at, or the migration fails on any database holding a stuck row"
  );
});

test("333 adds the replacement claim CHECK after the backfill, not before", () => {
  const backfill = SQL.indexOf("SET mailed_at = NULL");
  const add = SQL.indexOf("ADD CONSTRAINT dispute_letters_claim_ck");

  assert.ok(add > 0, "the replacement constraint is in the file");
  assert.ok(
    add > backfill,
    "the new CHECK requires send_claimed_at on every 'sending' row and it is the "
    + "backfill that puts one there"
  );
});

test("nothing in 333 sets mailed_at to a value — it is only ever cleared", () => {
  // mailed_at means "the provider accepted this letter". A migration cannot know
  // that about any row, so it must never invent one. The only write to the column
  // in this file is the NULL that undoes 332's false stamp.
  const writes = [...SQL.matchAll(/SET\s+mailed_at\s*=\s*([^\s,]+)/gi)].map((m) => m[1]);
  assert.deepEqual(writes, ["NULL"]);
});

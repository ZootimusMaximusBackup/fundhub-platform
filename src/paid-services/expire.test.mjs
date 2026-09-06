// The checkout expiry sweep, and the workflow that runs it on a clock.
//
// The database half — that the row really moves to 'cancelled', that the CHECK
// refuses an awaiting_payment row with no deadline, and that the chase resumes
// afterwards — is proved against a real Postgres in src/nudge/run.pg.test.mjs.
// What is proved here is the SHAPE: what the sweep sends to the database, that
// it never throws, and that neither this file nor the workflow can transmit.

import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expireStaleCheckouts, EXPIRED_REASON, DEFAULT_LIMIT } from "./expire.mjs";
import { CHECKOUT_LINK_TTL_DAYS, CHECKOUT_LINK_TTL_MS, checkoutExpiresAt } from "./link-ttl.mjs";
import { sweep, SWEEP_CRON } from "../workflows/paid-checkout-expiry-sweeper.mjs";

const NOW = new Date("2026-09-10T18:00:00.000Z");

function fakeDb(rows = [{ id: "req-1" }]) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      return { rows };
    }
  };
}

test("seven days, and the number lives in exactly one place", () => {
  assert.equal(CHECKOUT_LINK_TTL_DAYS, 7);
  assert.equal(CHECKOUT_LINK_TTL_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(
    checkoutExpiresAt(NOW).toISOString(),
    new Date(NOW.getTime() + CHECKOUT_LINK_TTL_MS).toISOString()
  );
});

test("an unreadable clock produces no stamp rather than a guessed one", () => {
  /* No stamp means db/migrations/370's CHECK refuses the row, which is the
     right failure: an invitation with no deadline is the defect. */
  assert.equal(checkoutExpiresAt(new Date("not a date")), null);
});

test("the sweep only ever touches awaiting_payment rows that are out of time", async () => {
  const db = fakeDb();
  const out = await expireStaleCheckouts(db, { now: NOW });

  assert.equal(out.closed, 1);
  assert.deepEqual(out.ids, ["req-1"]);
  const { sql, params } = db.calls[0];
  assert.match(sql, /SET status = 'cancelled'/);
  assert.match(sql, /WHERE status = 'awaiting_payment'/);
  assert.match(sql, /checkout_expires_at IS NOT NULL/,
    "NULL means unknown and must never be swept — CLAUDE.md section 12");
  assert.match(sql, /checkout_expires_at <= \$1/);
  assert.equal(params[0], NOW.toISOString());
  assert.equal(params[1], EXPIRED_REASON);
  assert.equal(params[2], DEFAULT_LIMIT);
});

test("the status check is INSIDE the statement, so a payment landing at the same instant wins", async () => {
  /* A read-then-write would let a sweep cancel a request the processor had just
     paid. The status predicate is part of the UPDATE, so whichever statement is
     second matches no row. */
  const db = fakeDb([]);
  const out = await expireStaleCheckouts(db, { now: NOW });
  assert.equal(out.closed, 0);
  assert.equal(db.calls.length, 1, "one statement, not a select then an update");
});

test("a batch that fills says so instead of looking like a clean sweep", async () => {
  const rows = Array.from({ length: 3 }, (_, i) => ({ id: `r${i}` }));
  const out = await expireStaleCheckouts(fakeDb(rows), { now: NOW, limit: 3 });
  assert.equal(out.more, true);
  assert.equal(out.limit, 3);
});

test("a database error is reported, never returned as a quiet zero", async () => {
  const db = { async query() { throw new Error("connection reset"); } };
  const out = await expireStaleCheckouts(db, { now: NOW });
  assert.equal(out.closed, 0);
  assert.match(out.error, /connection reset/,
    "a failed sweep must be distinguishable from a sweep that found nothing");
});

test("the sweeper runs hourly and never throws", async () => {
  assert.equal(SWEEP_CRON, "0 * * * *");
  const out = await sweep({ async query() { throw new Error("down"); } }, { now: NOW });
  assert.equal(out.closed, 0);
  assert.ok(out.error);
});

test("nothing in this lane transmits, and nothing in it moves money", () => {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const files = [
    `${here}expire.mjs`,
    `${here}link-ttl.mjs`,
    `${here}../workflows/paid-checkout-expiry-sweeper.mjs`
  ];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    assert.ok(!/\bfetch\s*\(/.test(src), `${f} must not call fetch`);
    const imports = src.match(/^\s*import[^;]+from\s+["'][^"']+["']/gm) || [];
    for (const line of imports) {
      assert.ok(!/providers\//.test(line), `${f} must not import a provider: ${line.trim()}`);
      assert.ok(!/payments\//.test(line), `${f} must not import a payment rail: ${line.trim()}`);
    }
    /* The only money columns on this table are amount_paid_cents and paid_at.
       This sweep may READ them — it refuses to close a row that carries either
       — and must never WRITE one. So the SET clause is checked, not the file. */
    const sets = src.match(/SET[\s\S]*?WHERE/g) || [];
    for (const clause of sets) {
      assert.ok(!/amount_paid_cents/.test(clause), `${f} must not write an amount`);
      assert.ok(!/paid_at\s*=/.test(clause), `${f} must not write a payment time`);
    }
  }
});

test("a row that already carries money is never closed by the sweep", async () => {
  const db = fakeDb();
  await expireStaleCheckouts(db, { now: NOW });
  const { sql } = db.calls[0];
  assert.match(sql, /paid_at IS NULL/);
  assert.match(sql, /amount_paid_cents IS NULL/);
});

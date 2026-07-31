// Real-Postgres integration test for card liability storage (083 / 084).
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
//
// WHY THIS FILE IS NOT OPTIONAL. AUDIT-FINDINGS.md's most expensive entry:
// src/invoices/index.mjs wrote to columns a migration had renamed, and every
// test passed, because the tests ran against an in-memory fake modelling the OLD
// column names. A fake that models the schema you wish you had cannot fail when
// the schema moves. So the constraints that actually protect a consumer's money
// — the APR range, the money CHECKs, the NOT NULLs, the unique indexes — are
// asserted against a live database or they are not asserted at all.
//
// Run live:
//   DATABASE_URL=postgres://... node db/migrate.mjs && DATABASE_URL=... npm test

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import {
  recordLiability, getCurrentLiability, getCurrentLiabilities,
  getLiabilityHistory, ingestCrsLiabilities
} from "./store.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "card_liabilities_pg_test@example.com";

let orgId = null;
let clientId = null;
let tradelineA = null;
let tradelineB = null;

async function wipe() {
  const scope = `client_id IN (SELECT id FROM clients WHERE email=$1)`;
  await db.query(`DELETE FROM card_liability_history WHERE ${scope}`, [EMAIL]);
  await db.query(`DELETE FROM card_liabilities WHERE ${scope}`, [EMAIL]);
  await db.query(`DELETE FROM tradelines WHERE ${scope}`, [EMAIL]);
  await db.query(`DELETE FROM crs_results WHERE ${scope}`, [EMAIL]);
  await db.query(`DELETE FROM clients WHERE email=$1`, [EMAIL]);
}

async function newCard(accountRef, lender) {
  const r = await db.query(
    `INSERT INTO tradelines (org_id, client_id, lender, account_ref) VALUES ($1,$2,$3,$4) RETURNING id`,
    [orgId, clientId, lender, accountRef]
  );
  return r.rows[0].id;
}

async function clearPositions() {
  await db.query(`DELETE FROM card_liability_history WHERE client_id = $1`, [clientId]);
  await db.query(`DELETE FROM card_liabilities WHERE client_id = $1`, [clientId]);
}

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the seed");
  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1,$2,'Card','Liability') RETURNING id`,
    [orgId, EMAIL]
  )).rows[0].id;
  tradelineA = await newCard("LIAB-A", "Amex Blue Business");
  tradelineB = await newCard("LIAB-B", "Citi Costco");
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

/* pg hands a `date` column back as a JS Date pinned to LOCAL midnight. Reading
   the day off it with toISOString() shifts it backwards in any timezone west of
   UTC, so the local components are used instead. This is test-only formatting;
   nothing in the module does date arithmetic. */
function dayOf(v) {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0")
  ].join("-");
}

function position(over = {}) {
  return {
    as_of: "2026-06-30",
    statement_balance_cents: 482000,
    current_balance_cents: 495012,
    minimum_payment_cents: 12500,
    past_due_cents: 0,
    last_payment_cents: 20000,
    last_payment_date: "2026-06-05",
    statement_date: "2026-06-15",
    payment_due_date: "2026-07-10",
    apr: 0.1899,
    payment_status: "current",
    source: "crs",
    source_ref: null,
    raw: { balance: 4950.12 },
    ...over
  };
}

// ---------------------------------------------------------------------------
// The APR constraint. The headline guard: a percentage number must not fit.
// ---------------------------------------------------------------------------

test("the database rejects 18.99 — the column takes a fraction, not a percentage",
  { skip: !HAS_DB }, async () => {
  // TWO GUARDS, AND THIS ONE TRIPS THE OUTER ONE FIRST. numeric(6,5) tops out
  // at 9.99999, so 18.99 never reaches the CHECK — it is refused by the type as
  // a field overflow. That is still a refusal and it is the one that matters
  // most in practice, because 18.99 is the exact value a caller who forgot to
  // convert would pass. The band the TYPE cannot catch (1 < apr <= 9.99999) is
  // covered by the next test, which is the CHECK's own job.
  for (const table of ["card_liabilities", "card_liability_history"]) {
    await assert.rejects(
      () => db.query(
        `INSERT INTO ${table} (org_id, client_id, tradeline_id, as_of, apr, current_balance_cents)
         VALUES ($1,$2,$3,'2026-06-30',18.99,100)`,
        [orgId, clientId, tradelineA]
      ),
      /numeric field overflow|violates check constraint/,
      `${table} must refuse 18.99 — it means 1899%`
    );
  }
});

test("the APR CHECK rejects a rate above 1 and below 0, and accepts the full legal range",
  { skip: !HAS_DB }, async () => {
  // 1.5 fits numeric(6,5) comfortably. Only CHECK (apr >= 0 AND apr <= 1) stops
  // it — this is the assertion that fails if that constraint is ever dropped.
  for (const table of ["card_liabilities", "card_liability_history"]) {
    for (const bad of [1.5, 9.99999, -0.01]) {
      await assert.rejects(
        () => db.query(
          `INSERT INTO ${table} (org_id, client_id, tradeline_id, as_of, apr, current_balance_cents)
           VALUES ($1,$2,$3,'2026-06-30',${bad},100)`,
          [orgId, clientId, tradelineA]
        ),
        /violates check constraint/,
        `${table} must refuse apr=${bad} — outside [0,1]`
      );
    }
  }
  await clearPositions();
  for (const apr of [0, 0.1899, 1]) {
    const { current } = await recordLiability(db, {
      orgId, clientId, tradelineId: tradelineA, row: position({ apr, as_of: "2026-01-01" })
    });
    assert.equal(Number(current.apr), apr, `${apr} is inside [0,1] and must store exactly`);
    await clearPositions();
  }
});

// ---------------------------------------------------------------------------
// NULL survives a round trip. This is the one that protects a consumer.
// ---------------------------------------------------------------------------

test("a NULL minimum payment survives the round trip and never lands as 0",
  { skip: !HAS_DB }, async () => {
  await clearPositions();
  const { current, history } = await recordLiability(db, {
    orgId, clientId, tradelineId: tradelineA,
    row: position({ minimum_payment_cents: null, past_due_cents: null, apr: null,
                    payment_status: null, statement_date: null, payment_due_date: null })
  });

  for (const row of [current, history]) {
    assert.strictEqual(row.minimum_payment_cents, null,
      "an unreported minimum is UNKNOWN — $0 would tell a client nothing is due");
    assert.notStrictEqual(row.minimum_payment_cents, 0);
    assert.strictEqual(row.past_due_cents, null);
    assert.strictEqual(row.apr, null);
    assert.strictEqual(row.payment_status, null);
    assert.strictEqual(row.statement_date, null);
    assert.strictEqual(row.payment_due_date, null);
  }

  const readBack = await getCurrentLiability(db, { tradelineId: tradelineA });
  assert.strictEqual(readBack.minimum_payment_cents, null, "still null after a fresh SELECT");
});

test("a REPORTED zero stays zero and is distinguishable from unknown",
  { skip: !HAS_DB }, async () => {
  await clearPositions();
  const { current } = await recordLiability(db, {
    orgId, clientId, tradelineId: tradelineA,
    row: position({ past_due_cents: 0, minimum_payment_cents: null })
  });
  assert.strictEqual(Number(current.past_due_cents), 0, "the bureau affirming $0 past due is a fact");
  assert.strictEqual(current.minimum_payment_cents, null, "silence is not the same fact");
});

// ---------------------------------------------------------------------------
// Cents are stored as cents.
// ---------------------------------------------------------------------------

test("money is stored as integer cents, exactly, with no float drift",
  { skip: !HAS_DB }, async () => {
  await clearPositions();
  const { current, history } = await recordLiability(db, {
    orgId, clientId, tradelineId: tradelineA,
    row: position({ current_balance_cents: 495012, minimum_payment_cents: 12500,
                    statement_balance_cents: 482000 })
  });
  for (const row of [current, history]) {
    assert.strictEqual(Number(row.current_balance_cents), 495012, "$4,950.12 is 495012 cents");
    assert.strictEqual(Number(row.minimum_payment_cents), 12500);
    assert.strictEqual(Number(row.statement_balance_cents), 482000);
  }
  const types = await db.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'card_liabilities' AND column_name LIKE '%_cents'`
  );
  assert.ok(types.rows.length >= 5, "every money column is accounted for");
  for (const c of types.rows) {
    assert.equal(c.data_type, "bigint", `${c.column_name} must be bigint cents, not numeric dollars`);
  }
});

test("the money CHECKs refuse a negative amount on both tables",
  { skip: !HAS_DB }, async () => {
  for (const table of ["card_liabilities", "card_liability_history"]) {
    await assert.rejects(
      () => db.query(
        `INSERT INTO ${table} (org_id, client_id, tradeline_id, as_of, minimum_payment_cents)
         VALUES ($1,$2,$3,'2026-06-30',-1)`,
        [orgId, clientId, tradelineA]
      ),
      /violates check constraint/,
      `${table} must refuse a negative minimum payment`
    );
  }
});

test("payment_status is constrained to the seven values the parser can produce",
  { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => db.query(
      `INSERT INTO card_liabilities (org_id, client_id, tradeline_id, as_of, payment_status)
       VALUES ($1,$2,$3,'2026-06-30','R9')`,
      [orgId, clientId, tradelineA]
    ),
    /violates check constraint/
  );
});

// ---------------------------------------------------------------------------
// The series, and which observation is "current".
// ---------------------------------------------------------------------------

test("getLiabilityHistory returns the series newest-first and getCurrentLiability its head",
  { skip: !HAS_DB }, async () => {
  await clearPositions();
  for (const [asOf, balance] of [["2026-04-30", 300000], ["2026-05-31", 400000], ["2026-06-30", 495012]]) {
    await recordLiability(db, {
      orgId, clientId, tradelineId: tradelineA,
      row: position({ as_of: asOf, current_balance_cents: balance })
    });
  }
  const series = await getLiabilityHistory(db, { tradelineId: tradelineA });
  assert.equal(series.length, 3, "three observations, three rows — the series keeps them all");
  assert.deepEqual(
    series.map((r) => dayOf(r.as_of)),
    ["2026-06-30", "2026-05-31", "2026-04-30"],
    "newest first"
  );

  const current = await getCurrentLiability(db, { tradelineId: tradelineA });
  assert.equal(Number(current.current_balance_cents), 495012);
  assert.equal(dayOf(current.as_of), "2026-06-30");
});

test("the ordering key is as_of, not created_at — a backfill does not become current",
  { skip: !HAS_DB }, async () => {
  await clearPositions();
  // Ingested in the WRONG order on purpose: June first, then a late-arriving
  // April file. Ordering on created_at would crown April.
  await recordLiability(db, {
    orgId, clientId, tradelineId: tradelineA,
    row: position({ as_of: "2026-06-30", current_balance_cents: 495012 })
  });
  await recordLiability(db, {
    orgId, clientId, tradelineId: tradelineA,
    row: position({ as_of: "2026-04-30", current_balance_cents: 300000 })
  });

  const current = await getCurrentLiability(db, { tradelineId: tradelineA });
  assert.equal(dayOf(current.as_of), "2026-06-30",
    "the older statement landed in the series but must not demote the current position");
  assert.equal(Number(current.current_balance_cents), 495012);

  const series = await getLiabilityHistory(db, { tradelineId: tradelineA });
  assert.equal(series.length, 2, "the backfilled observation is still kept");
  assert.deepEqual(
    series.map((r) => dayOf(r.as_of)),
    ["2026-06-30", "2026-04-30"],
    "the series orders on as_of too — ordering on created_at would put the late-arriving April file first"
  );
  const head = await getCurrentLiability(db, { tradelineId: tradelineA, fromHistory: true });
  assert.equal(dayOf(head.as_of), "2026-06-30", "and its head is the newest position, not the newest write");
});

test("the projection agrees with the series it projects", { skip: !HAS_DB }, async () => {
  // The drift check. If these two ever disagree, the current-position table has
  // become a second answer to the question the series already answers.
  const fromProjection = await getCurrentLiability(db, { tradelineId: tradelineA });
  const fromSeries = await getCurrentLiability(db, { tradelineId: tradelineA, fromHistory: true });
  assert.equal(dayOf(fromProjection.as_of), dayOf(fromSeries.as_of));
  assert.equal(
    Number(fromProjection.current_balance_cents),
    Number(fromSeries.current_balance_cents)
  );
});

test("re-reading the same observation date corrects it rather than growing a duplicate",
  { skip: !HAS_DB }, async () => {
  await clearPositions();
  await recordLiability(db, {
    orgId, clientId, tradelineId: tradelineA,
    row: position({ as_of: "2026-06-30", current_balance_cents: 495012 })
  });
  await recordLiability(db, {
    orgId, clientId, tradelineId: tradelineA,
    row: position({ as_of: "2026-06-30", current_balance_cents: 495500 })
  });
  const series = await getLiabilityHistory(db, { tradelineId: tradelineA });
  assert.equal(series.length, 1, "a retried job must not turn a flat balance into a staircase");
  assert.equal(Number(series[0].current_balance_cents), 495500, "the restatement wins");
});

test("a later file that omits the APR does not erase the rate we already knew",
  { skip: !HAS_DB }, async () => {
  await clearPositions();
  await recordLiability(db, {
    orgId, clientId, tradelineId: tradelineA, row: position({ as_of: "2026-05-31", apr: 0.1899 })
  });
  const { current, history } = await recordLiability(db, {
    orgId, clientId, tradelineId: tradelineA, row: position({ as_of: "2026-06-30", apr: null })
  });
  assert.equal(Number(current.apr), 0.1899, "absence is not a correction");
  assert.strictEqual(history.apr, null,
    "but the SERIES records what the June file actually said — history is not retouched");
});

test("one current position per card, and the cards stay separate",
  { skip: !HAS_DB }, async () => {
  await clearPositions();
  await recordLiability(db, { orgId, clientId, tradelineId: tradelineA, row: position({ current_balance_cents: 100000 }) });
  await recordLiability(db, { orgId, clientId, tradelineId: tradelineB, row: position({ current_balance_cents: 200000 }) });
  await recordLiability(db, { orgId, clientId, tradelineId: tradelineA, row: position({ as_of: "2026-07-31", current_balance_cents: 111111 }) });

  const all = await getCurrentLiabilities(db, { clientId });
  assert.equal(all.length, 2, "two cards, two current rows — never a second 'current' per card");
  const byCard = new Map(all.map((r) => [r.tradeline_id, Number(r.current_balance_cents)]));
  assert.equal(byCard.get(tradelineA), 111111);
  assert.equal(byCard.get(tradelineB), 200000);
});

test("a history row points at the current-position row that stands", { skip: !HAS_DB }, async () => {
  await clearPositions();
  const { history, current } = await recordLiability(db, {
    orgId, clientId, tradelineId: tradelineA, row: position()
  });
  assert.equal(history.liability_id, current.id);
});

test("as_of is NOT NULL — an observation that cannot be placed in time is refused",
  { skip: !HAS_DB }, async () => {
  for (const table of ["card_liabilities", "card_liability_history"]) {
    await assert.rejects(
      () => db.query(
        `INSERT INTO ${table} (org_id, client_id, tradeline_id, current_balance_cents)
         VALUES ($1,$2,$3,100)`,
        [orgId, clientId, tradelineA]
      ),
      /null value in column "as_of"/,
      `${table}.as_of must be required — it is the ordering key`
    );
  }
});

test("a position cannot exist without a card behind it", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => db.query(
      `INSERT INTO card_liabilities (org_id, client_id, as_of, current_balance_cents)
       VALUES ($1,$2,'2026-06-30',100)`,
      [orgId, clientId]
    ),
    /null value in column "tradeline_id"/
  );
});

// ---------------------------------------------------------------------------
// The whole path, from a stored pull.
// ---------------------------------------------------------------------------

test("ingestCrsLiabilities records positions against the cards they belong to",
  { skip: !HAS_DB }, async () => {
  await clearPositions();
  const crs = (await db.query(
    `INSERT INTO crs_results (org_id, client_id, result) VALUES ($1,$2,$3) RETURNING *`,
    [orgId, clientId, JSON.stringify({
      tradelines: [
        { account_number: "LIAB-A", balance: 4950.12, minimum_payment: 125, apr: 18.99,
          statement_balance: 4820, due_date: "07/10/2026", payment_status: "Current" },
        { account_number: "LIAB-B", balance: 4700, apr: 14.99 },
        { account_number: "NOT-A-CARD", balance: 100, minimum_payment: 10 }
      ]
    })]
  )).rows[0];

  const { recorded, skipped } = await ingestCrsLiabilities(db, crs);
  assert.equal(recorded, 2, "two known cards");
  assert.equal(skipped, 1, "a position for an unknown card is skipped, not invented into a tradeline");

  const a = await getCurrentLiability(db, { tradelineId: tradelineA });
  assert.equal(Number(a.current_balance_cents), 495012, "$4,950.12 read as cents through the parser");
  assert.equal(Number(a.minimum_payment_cents), 12500);
  assert.equal(Number(a.apr), 0.1899, "18.99 from the file is stored as the fraction 0.1899");
  assert.equal(a.payment_status, "current");
  assert.equal(a.source, "crs");
  assert.equal(a.source_ref, crs.id, "every position points back at the pull it came from");

  const b = await getCurrentLiability(db, { tradelineId: tradelineB });
  assert.strictEqual(b.minimum_payment_cents, null,
    "the second card reported no minimum — that stays unknown all the way to the row");
});

test("re-ingesting the same pull is idempotent", { skip: !HAS_DB }, async () => {
  const crs = (await db.query(
    `SELECT * FROM crs_results WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1`, [clientId]
  )).rows[0];
  const before = await getLiabilityHistory(db, { clientId });
  await ingestCrsLiabilities(db, crs);
  const after = await getLiabilityHistory(db, { clientId });
  assert.equal(after.length, before.length, "a replayed event must not grow the series");
});

test("getLiabilityHistory returns [] for a card with no observations — not a zero balance",
  { skip: !HAS_DB }, async () => {
  const fresh = await newCard("LIAB-C", "Chase Ink");
  assert.deepEqual(await getLiabilityHistory(db, { tradelineId: fresh }), []);
  assert.equal(await getCurrentLiability(db, { tradelineId: fresh }), null);
});

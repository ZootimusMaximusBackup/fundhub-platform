// Real-Postgres integration test for card liabilities and their term history.
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
//
// Run live:
//   DATABASE_URL=postgres://... node db/migrate.mjs
//   DATABASE_URL=postgres://... STAFF_INITIAL_PASSWORD='...' node scripts/seed-staff.mjs
//   DATABASE_URL=postgres://... npm test
//
// WHAT THIS PROVES THAT THE PURE TESTS CANNOT. AUDIT-FINDINGS.md's first lesson
// is "a fake that models the schema you wish you had cannot fail when the schema
// moves", and every claim below is one this module makes about the DATABASE
// rather than about its own arithmetic:
//
//   * 083's constraints actually reject what the comments say they reject;
//   * NULL really does survive a round trip, rather than picking up a default;
//   * the upsert is idempotent against the real unique index;
//   * 084's one-open-row index holds against a concurrent second writer;
//   * 084's trigger really does refuse an in-place rate edit;
//   * the close-and-open leaves no gap and no overlap, so termsAsOf always has
//     exactly one answer.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import {
  upsertCardLiability,
  listCardLiabilities,
  getCardLiability,
  openTerms,
  currentTerms,
  changeTerms,
  listTerms,
  termsAsOf
} from "./store.mjs";
import { coerceLiabilityRow, summarise, utilisation } from "./index.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "card_liabilities_pg_test@example.com";

let orgId = null;
let clientId = null;

async function wipe() {
  await db.query(
    `DELETE FROM card_liabilities WHERE client_id IN (SELECT id FROM clients WHERE email=$1)`, [EMAIL]);
  await db.query(`DELETE FROM clients WHERE email=$1`, [EMAIL]);
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
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

const card = (over = {}) => coerceLiabilityRow({
  accountRef: "bank-acct-1",
  issuer: "Chase Ink Business Preferred",
  last4: "1004",
  isBusiness: true,
  creditLimit: 25000,
  balance: 4137.42,
  statementBalance: 3900,
  minimumPayment: 117,
  aprPurchase: 18.99,
  aprCashAdvance: 29.99,
  statementCloseDate: "2026-07-20",
  paymentDueDate: "2026-08-15",
  ...over
});

/* ------------------------------------------------------------ 083: the card */

test("a card round-trips as integer cents and a fractional APR", { skip: !HAS_DB }, async () => {
  const row = await upsertCardLiability(db, { orgId, clientId, accountRef: "bank-acct-1", row: card() });
  assert.equal(Number(row.credit_limit_cents), 2500000);
  assert.equal(Number(row.balance_cents), 413742);
  assert.equal(Number(row.statement_balance_cents), 390000);
  assert.equal(Number(row.minimum_payment_cents), 11700);
  assert.equal(Number(row.apr_purchase), 0.1899);
  assert.equal(Number(row.apr_cash_advance), 0.2999);
  assert.strictEqual(row.apr_balance_transfer, null, "an unreported rate stays unknown");
  assert.equal(row.last4, "1004");
  assert.strictEqual(row.is_business, true);
});

test("the statement dates land as calendar days, not instants", { skip: !HAS_DB }, async () => {
  const row = await getCardLiability(db, { clientId, accountRef: "bank-acct-1" });
  // node-postgres returns `date` as a JS Date at local midnight; the calendar
  // day is what the column stores and what must survive.
  const asDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  assert.equal(asDay(row.statement_close_date), "2026-07-20");
  assert.equal(asDay(row.payment_due_date), "2026-08-15");
});

test("re-running the same refresh updates the card rather than adding a second one", { skip: !HAS_DB }, async () => {
  await upsertCardLiability(db, { orgId, clientId, accountRef: "bank-acct-1", row: card({ balance: 5200 }) });
  const rows = await listCardLiabilities(db, { clientId });
  assert.equal(rows.length, 1, "same account_ref must update, not insert a second card");
  assert.equal(Number(rows[0].balance_cents), 520000, "the newer balance wins");
});

test("a partial refresh does not erase what was already known", { skip: !HAS_DB }, async () => {
  // The aggregator returned balances only this cycle. Every term is absent.
  await upsertCardLiability(db, {
    orgId, clientId, accountRef: "bank-acct-1",
    row: coerceLiabilityRow({ accountRef: "bank-acct-1", issuer: "Chase Ink Business Preferred", balance: 6000 })
  });
  const row = await getCardLiability(db, { clientId, accountRef: "bank-acct-1" });
  assert.equal(Number(row.balance_cents), 600000, "the new balance landed");
  assert.equal(Number(row.credit_limit_cents), 2500000, "absence is not a correction — the limit survived");
  assert.equal(Number(row.apr_purchase), 0.1899, "and so did the rate");
  assert.strictEqual(row.is_business, true, "and so did the classification");
  assert.equal(row.last4, "1004");
});

test("an unclassified card stores NULL, not false", { skip: !HAS_DB }, async () => {
  const row = await upsertCardLiability(db, {
    orgId, clientId, accountRef: "bank-acct-unclassified",
    row: card({ accountRef: "bank-acct-unclassified", isBusiness: undefined, issuer: "Unknown Issuer" })
  });
  assert.strictEqual(row.is_business, null, "unknown is a third state and must reach the column as NULL");
  assert.notStrictEqual(row.is_business, false);
});

test("an unknown limit stores NULL, not 0, and utilisation stays unanswerable", { skip: !HAS_DB }, async () => {
  const row = await upsertCardLiability(db, {
    orgId, clientId, accountRef: "bank-acct-nolimit",
    row: coerceLiabilityRow({ accountRef: "bank-acct-nolimit", issuer: "Store Card", balance: 812.5 })
  });
  assert.strictEqual(row.credit_limit_cents, null);
  assert.notStrictEqual(row.credit_limit_cents, "0");
  assert.strictEqual(utilisation(row.balance_cents, row.credit_limit_cents), null,
    "a card with no known limit has no utilisation, not 0%");
});

test("the schema refuses negative money, an out-of-range APR and a bad last4", { skip: !HAS_DB }, async () => {
  const bad = (cols, vals) => db.query(
    `INSERT INTO card_liabilities (org_id, client_id, account_ref, issuer, ${cols})
     VALUES ($1,$2,$3,'Bad',${vals})`, [orgId, clientId, `bad-${cols}`]);

  await assert.rejects(() => bad("credit_limit_cents", "-1"), /violates check constraint/);
  await assert.rejects(() => bad("balance_cents", "-1"), /violates check constraint/);
  await assert.rejects(() => bad("statement_balance_cents", "-1"), /violates check constraint/);
  await assert.rejects(() => bad("minimum_payment_cents", "-1"), /violates check constraint/);
  await assert.rejects(() => bad("apr_purchase", "1.5"), /violates check constraint/,
    "an APR is a fraction in [0,1] — 1.5 would be 150% read as a percentage");
  await assert.rejects(() => bad("apr_cash_advance", "-0.01"), /violates check constraint/);
  await assert.rejects(() => bad("last4", "'12345'"), /violates check constraint/);
  await assert.rejects(() => bad("last4", "'12a4'"), /violates check constraint/);
});

test("the schema refuses a card with no account reference", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => db.query(`INSERT INTO card_liabilities (org_id, client_id, issuer) VALUES ($1,$2,'No ref')`,
      [orgId, clientId]),
    /null value in column "account_ref"/
  );
});

test("the store refuses to write a card it cannot identify", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => upsertCardLiability(db, { orgId, clientId, row: card({ accountRef: null }) }),
    /accountRef is required/
  );
  await assert.rejects(
    () => upsertCardLiability(db, { orgId, clientId, accountRef: "x", row: { issuer: null } }),
    /issuer is required/
  );
});

test("summarise over the real rows keeps the unknown limit out of the total", { skip: !HAS_DB }, async () => {
  const rows = await listCardLiabilities(db, { clientId });
  const s = summarise(rows);
  assert.equal(s.all.count, 3);
  assert.equal(s.all.limitUnknownCount, 1, "the store-card row has no limit");
  assert.strictEqual(s.all.utilisation, null, "so the client's overall utilisation is unknown, not a partial figure");
  assert.equal(s.business.count, 1);
  assert.equal(s.unclassified.count, 2);
});

test("closed cards drop out of the list unless asked for", { skip: !HAS_DB }, async () => {
  await db.query(`UPDATE card_liabilities SET closed_at = now() WHERE client_id=$1 AND account_ref=$2`,
    [clientId, "bank-acct-nolimit"]);
  assert.equal((await listCardLiabilities(db, { clientId })).length, 2);
  assert.equal((await listCardLiabilities(db, { clientId, includeClosed: true })).length, 3);
});

/* ------------------------------------------------------- 084: term history */

let termCardId = null;

test("opening the first terms records them as in effect", { skip: !HAS_DB }, async () => {
  const c = await upsertCardLiability(db, {
    orgId, clientId, accountRef: "bank-acct-terms",
    row: card({ accountRef: "bank-acct-terms", issuer: "Amex Business Platinum", creditLimit: 20000 })
  });
  termCardId = c.id;

  const t = await openTerms(db, {
    orgId, cardLiabilityId: termCardId,
    terms: { credit_limit_cents: 2000000, apr_purchase: 0.1899, is_business: true },
    reason: "first observation"
  });
  assert.equal(Number(t.credit_limit_cents), 2000000);
  assert.strictEqual(t.effective_to, null, "NULL effective_to means still in effect");
  assert.equal(t.source, "bank");
});

test("a card cannot hold two sets of terms at once", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => openTerms(db, { orgId, cardLiabilityId: termCardId, terms: { credit_limit_cents: 9900000 } }),
    /uq_card_liability_terms_open|duplicate key/,
    "the unique partial index is what stops two racing writers, not a check in application code"
  );
});

test("a limit increase closes the old row and opens a new one — the old figure survives", { skip: !HAS_DB }, async () => {
  const before = await currentTerms(db, { cardLiabilityId: termCardId });
  const out = await changeTerms(db, {
    orgId, cardLiabilityId: termCardId,
    terms: { credit_limit_cents: 3500000 },
    reason: "CLI approved"
  });

  assert.equal(out.changed, true);
  assert.deepEqual(out.changedFields, ["credit_limit_cents"]);
  assert.equal(Number(out.opened.credit_limit_cents), 3500000);

  const history = await listTerms(db, { cardLiabilityId: termCardId });
  assert.equal(history.length, 2, "the old row is closed, not overwritten");
  const old = history.find((r) => r.id === before.id);
  assert.equal(Number(old.credit_limit_cents), 2000000, "what was true last month is still readable");
  assert.ok(old.effective_to, "and it is dated");
});

test("the unreported rate carried forward instead of being versioned to unknown", { skip: !HAS_DB }, async () => {
  const now = await currentTerms(db, { cardLiabilityId: termCardId });
  assert.equal(Number(now.apr_purchase), 0.1899, "absence is not a change");
  assert.strictEqual(now.is_business, true);
});

test("the close and the open share one instant — no gap, no overlap", { skip: !HAS_DB }, async () => {
  const history = await listTerms(db, { cardLiabilityId: termCardId }); // newest first
  const [newer, older] = history;
  assert.equal(older.effective_to.getTime(), newer.effective_from.getTime(),
    "a half-open interval that meets exactly is what makes 'which terms at T' single-valued");

  // The boundary instant itself belongs to the NEW row, because the interval is
  // [from, to). Asking at exactly that instant must not return two rows or none.
  const atBoundary = await termsAsOf(db, { cardLiabilityId: termCardId, at: newer.effective_from });
  assert.equal(atBoundary.id, newer.id);
});

test("every stored instant survives a round trip through a JavaScript Date", { skip: !HAS_DB }, async () => {
  // THE BUG THIS PINS. Postgres timestamptz keeps microseconds; a JS Date keeps
  // milliseconds. Storing .734567 and reading it back as .734 means the most
  // obvious call anyone will ever make — "the terms in effect when this row
  // began" — asks about an instant 567 microseconds too early and is handed the
  // PREVIOUS row. It fails only at the boundary and it raises nothing.
  const rows = await db.query(
    `SELECT effective_from, effective_to,
            date_trunc('milliseconds', effective_from) = effective_from AS from_is_ms,
            (effective_to IS NULL OR date_trunc('milliseconds', effective_to) = effective_to) AS to_is_ms
       FROM card_liability_terms WHERE card_liability_id = $1`, [termCardId]);
  assert.ok(rows.rows.length > 0);
  for (const r of rows.rows) {
    assert.ok(r.from_is_ms, "effective_from must carry no microseconds a JS Date would drop");
    assert.ok(r.to_is_ms, "and neither must effective_to");
  }
});

test("back-to-back changes stay strictly ordered even inside one millisecond", { skip: !HAS_DB }, async () => {
  // The cost of the truncation above, and the proof it is paid safely: two
  // changes this close together are pushed 1ms apart rather than colliding on
  // 084's "a term must end after it begins" CHECK.
  const c = await upsertCardLiability(db, {
    orgId, clientId, accountRef: "bank-acct-rapid",
    row: card({ accountRef: "bank-acct-rapid", issuer: "Rapid" })
  });
  await openTerms(db, { orgId, cardLiabilityId: c.id, terms: { credit_limit_cents: 100000 } });
  for (const limit of [200000, 300000, 400000, 500000]) {
    const out = await changeTerms(db, { orgId, cardLiabilityId: c.id, terms: { credit_limit_cents: limit } });
    assert.equal(out.changed, true);
  }
  const history = await listTerms(db, { cardLiabilityId: c.id });
  assert.equal(history.length, 5);
  for (let i = 0; i < history.length - 1; i += 1) {
    // listTerms is newest first, so history[i] begins where history[i+1] ends.
    assert.ok(history[i].effective_from > history[i + 1].effective_from, "strictly increasing");
    assert.equal(history[i + 1].effective_to.getTime(), history[i].effective_from.getTime(),
      "and still contiguous");
    const at = await termsAsOf(db, { cardLiabilityId: c.id, at: history[i].effective_from });
    assert.equal(at.id, history[i].id, "each row still owns the instant it begins");
  }
});

test("termsAsOf answers what was true then, not what is true now", { skip: !HAS_DB }, async () => {
  const [newer, older] = await listTerms(db, { cardLiabilityId: termCardId });
  const midpointOfOld = new Date((older.effective_from.getTime() + older.effective_to.getTime()) / 2);

  const then = await termsAsOf(db, { cardLiabilityId: termCardId, at: midpointOfOld });
  assert.equal(then.id, older.id);
  assert.equal(Number(then.credit_limit_cents), 2000000);

  const now = await termsAsOf(db, { cardLiabilityId: termCardId, at: new Date() });
  assert.equal(now.id, newer.id);
  assert.equal(Number(now.credit_limit_cents), 3500000);
});

test("termsAsOf before the card had any terms returns nothing rather than the earliest row", { skip: !HAS_DB }, async () => {
  const found = await termsAsOf(db, { cardLiabilityId: termCardId, at: new Date("2020-01-01T00:00:00Z") });
  assert.strictEqual(found, null, "there were no terms in 2020 — inventing some would be the whole failure mode");
});

test("termsAsOf refuses to default the instant to now", { skip: !HAS_DB }, async () => {
  await assert.rejects(() => termsAsOf(db, { cardLiabilityId: termCardId }), /`at` is required/);
});

test("a refresh reporting the same terms writes no history row", { skip: !HAS_DB }, async () => {
  const before = (await listTerms(db, { cardLiabilityId: termCardId })).length;
  const out = await changeTerms(db, {
    orgId, cardLiabilityId: termCardId,
    terms: { credit_limit_cents: 3500000, apr_purchase: 0.1899, is_business: true }
  });
  assert.equal(out.changed, false);
  assert.deepEqual(out.changedFields, []);
  assert.equal((await listTerms(db, { cardLiabilityId: termCardId })).length, before,
    "a nightly refresh must not add a row per night to a table that answers 'when did this change'");
});

test("the same terms arriving as Postgres strings are still not a change", { skip: !HAS_DB }, async () => {
  // The bug this guards: node-postgres returns bigint and numeric as STRINGS,
  // so a bare !== between '3500000' and 3500000 reports a change every time.
  const before = (await listTerms(db, { cardLiabilityId: termCardId })).length;
  const out = await changeTerms(db, {
    orgId, cardLiabilityId: termCardId,
    terms: { credit_limit_cents: "3500000", apr_purchase: "0.18990" }
  });
  assert.equal(out.changed, false);
  assert.equal((await listTerms(db, { cardLiabilityId: termCardId })).length, before);
});

test("reclassifying a card from business to personal is versioned", { skip: !HAS_DB }, async () => {
  const out = await changeTerms(db, {
    orgId, cardLiabilityId: termCardId,
    terms: { is_business: false }, source: "manual", reason: "opened as a sole trader, not the LLC"
  });
  assert.equal(out.changed, true);
  assert.deepEqual(out.changedFields, ["is_business"]);
  assert.strictEqual(out.opened.is_business, false);
  assert.equal(out.opened.source, "manual");
  assert.strictEqual(out.closed.is_business, true, "and what it used to be is still on the record");
});

test("changing a rate to a known value from an unknown one is a change", { skip: !HAS_DB }, async () => {
  const out = await changeTerms(db, {
    orgId, cardLiabilityId: termCardId, terms: { apr_balance_transfer: 0 }, reason: "promo booked"
  });
  assert.equal(out.changed, true);
  assert.deepEqual(out.changedFields, ["apr_balance_transfer"]);
  assert.equal(Number(out.opened.apr_balance_transfer), 0, "0% is a rate, not an absent one");
  assert.strictEqual(out.closed.apr_balance_transfer, null);
});

test("084 REFUSES an in-place rate edit — the rule 013 only stated", { skip: !HAS_DB }, async () => {
  const open = await currentTerms(db, { cardLiabilityId: termCardId });
  await assert.rejects(
    () => db.query(`UPDATE card_liability_terms SET apr_purchase = 0.0499 WHERE id = $1`, [open.id]),
    /cannot be edited in place/
  );
  await assert.rejects(
    () => db.query(`UPDATE card_liability_terms SET credit_limit_cents = 9900000 WHERE id = $1`, [open.id]),
    /cannot be edited in place/
  );
  await assert.rejects(
    () => db.query(`UPDATE card_liability_terms SET is_business = NULL WHERE id = $1`, [open.id]),
    /cannot be edited in place/,
    "IS DISTINCT FROM, not <>: a change TO null must be caught too"
  );
  await assert.rejects(
    () => db.query(`UPDATE card_liability_terms SET effective_from = now() WHERE id = $1`, [open.id]),
    /cannot be edited in place/
  );

  const after = await currentTerms(db, { cardLiabilityId: termCardId });
  assert.equal(after.id, open.id, "and nothing moved");
  assert.strictEqual(after.apr_purchase, open.apr_purchase);
});

test("084 REFUSES reopening or sliding a closed term", { skip: !HAS_DB }, async () => {
  const [, older] = await listTerms(db, { cardLiabilityId: termCardId });
  assert.ok(older.effective_to, "precondition: this row is closed");
  await assert.rejects(
    () => db.query(`UPDATE card_liability_terms SET effective_to = NULL WHERE id = $1`, [older.id]),
    /cannot be reopened or moved/
  );
  await assert.rejects(
    () => db.query(`UPDATE card_liability_terms SET effective_to = now() WHERE id = $1`, [older.id]),
    /cannot be reopened or moved/
  );
});

test("084 allows the one UPDATE the design needs — closing the open row", { skip: !HAS_DB }, async () => {
  const c = await upsertCardLiability(db, {
    orgId, clientId, accountRef: "bank-acct-closeable",
    row: card({ accountRef: "bank-acct-closeable", issuer: "Closeable" })
  });
  const t = await openTerms(db, { orgId, cardLiabilityId: c.id, terms: { credit_limit_cents: 100000 } });
  await db.query(`UPDATE card_liability_terms SET effective_to = clock_timestamp() WHERE id = $1`, [t.id]);
  assert.strictEqual(await currentTerms(db, { cardLiabilityId: c.id }), null);
});

test("084 refuses a term that ends before it begins", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => db.query(
      `INSERT INTO card_liability_terms (org_id, card_liability_id, effective_from, effective_to)
       VALUES ($1,$2,now(), now() - interval '1 hour')`, [orgId, termCardId]),
    /card_liability_terms_interval/
  );
  await assert.rejects(
    () => db.query(
      `INSERT INTO card_liability_terms (org_id, card_liability_id, effective_from, effective_to)
       VALUES ($1,$2,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`, [orgId, termCardId]),
    /card_liability_terms_interval/,
    "a zero-length term has no answer to 'which terms were in effect', so it cannot exist"
  );
});

test("084 refuses a term source it does not recognise", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => db.query(
      `INSERT INTO card_liability_terms (org_id, card_liability_id, source, effective_from)
       VALUES ($1,$2,'guessed', now() + interval '1 year')`, [orgId, termCardId]),
    /violates check constraint/
  );
});

test("term history is exactly one answer at every instant it covers", { skip: !HAS_DB }, async () => {
  const history = await listTerms(db, { cardLiabilityId: termCardId });
  assert.ok(history.length >= 3);
  // Walk every boundary in the history and assert termsAsOf returns exactly one
  // row. This is the invariant the whole table exists for.
  for (const row of history) {
    const found = await termsAsOf(db, { cardLiabilityId: termCardId, at: row.effective_from });
    assert.equal(found.id, row.id, "each row owns the instant it begins");
  }
  const open = history.filter((r) => r.effective_to === null);
  assert.equal(open.length, 1, "and exactly one row is open");
});

test("deleting the client takes the cards and their history with it", { skip: !HAS_DB }, async () => {
  // Proves the deliberate absence of a DELETE guard on 084: a guard would fire
  // on this CASCADE and make a client undeletable, which is why the trigger is
  // BEFORE UPDATE only. See the note at the foot of 084.
  const probeEmail = "card_liabilities_cascade_probe@example.com";
  await db.query(`DELETE FROM clients WHERE email=$1`, [probeEmail]);
  const probe = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1,$2,'C','P') RETURNING id`,
    [orgId, probeEmail])).rows[0].id;
  const c = await upsertCardLiability(db, {
    orgId, clientId: probe, accountRef: "probe-1", row: card({ accountRef: "probe-1", issuer: "Probe" })
  });
  await openTerms(db, { orgId, cardLiabilityId: c.id, terms: { credit_limit_cents: 100000 } });

  await db.query(`DELETE FROM clients WHERE id=$1`, [probe]);
  assert.equal((await db.query(`SELECT 1 FROM card_liabilities WHERE id=$1`, [c.id])).rowCount, 0);
  assert.equal((await db.query(`SELECT 1 FROM card_liability_terms WHERE card_liability_id=$1`, [c.id])).rowCount, 0);
});

test("a card can point at the tradeline it is the same physical card as", { skip: !HAS_DB }, async () => {
  const tl = (await db.query(
    `INSERT INTO tradelines (org_id, client_id, lender, credit_limit_cents, balance_cents, apr, source)
     VALUES ($1,$2,'Chase Ink',1800000,820000,0.1699,'crs') RETURNING id`, [orgId, clientId])).rows[0];

  const linked = await upsertCardLiability(db, {
    orgId, clientId, accountRef: "bank-acct-1", row: card({ tradelineId: tl.id })
  });
  assert.equal(linked.tradeline_id, tl.id);

  // ON DELETE SET NULL, not CASCADE: losing the bureau line must not delete the
  // bank's record of a real debt.
  await db.query(`DELETE FROM tradelines WHERE id=$1`, [tl.id]);
  const after = await getCardLiability(db, { clientId, accountRef: "bank-acct-1" });
  assert.ok(after, "the card survives");
  assert.strictEqual(after.tradeline_id, null);
});

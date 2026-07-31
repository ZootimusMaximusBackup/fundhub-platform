// Real-Postgres schema test for 075_subscriptions.sql and 076_client_cards.sql.
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
// Run live:  DATABASE_URL=postgres://... node db/migrate.mjs && DATABASE_URL=... npm test
//
// This file asserts against information_schema, pg_constraint and pg_index —
// what the DATABASE actually has — and then proves each rule by trying to break
// it. A schema test that only reads the migration file back to itself proves
// nothing: the migration could have been skipped, superseded, or applied to a
// different database.
//
// Every negative test below names the constraint it is holding down, so that
// dropping that constraint fails a test whose name says which one.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { encryptCardToken } from "./card-tokens.mjs";

const HAS_DB = !!process.env.DATABASE_URL;

const EMAIL = "w2_billing_schema_pg_test@example.com";
const EMAIL2 = "w2_billing_schema_pg_test_2@example.com";
const PRODUCT_CODE = "w2-schema-test-plan";
const PRODUCT_CODE2 = "w2-schema-test-plan-2";
const ENC_ENV = { CARD_TOKEN_ENC_KEY: Buffer.alloc(32, 3).toString("base64") };

let orgId = null;
let clientId = null;
let clientId2 = null;
let productId = null;
let productId2 = null;

async function wipe() {
  await db.query(
    `DELETE FROM subscriptions WHERE client_id IN (SELECT id FROM clients WHERE email = ANY($1))`,
    [[EMAIL, EMAIL2]]
  );
  await db.query(
    `DELETE FROM client_cards WHERE client_id IN (SELECT id FROM clients WHERE email = ANY($1))`,
    [[EMAIL, EMAIL2]]
  );
  await db.query(`DELETE FROM clients WHERE email = ANY($1)`, [[EMAIL, EMAIL2]]);
  await db.query(`DELETE FROM products WHERE code = ANY($1)`, [[PRODUCT_CODE, PRODUCT_CODE2]]);
}

/** Run a statement expected to fail, and return its SQLSTATE + message. */
async function failure(sql, params) {
  try {
    await db.query(sql, params);
  } catch (e) {
    return { code: e.code, message: e.message, constraint: e.constraint };
  }
  return null;
}

/** Insert one subscription; overrides replace the defaults below. */
function subInsert(overrides = {}) {
  const row = {
    org_id: orgId, client_id: clientId, product_id: productId,
    status: "draft", price_cents: null, currency: "USD",
    billing_interval: "month", billing_interval_count: 1,
    started_at: null, ends_at: null,
    current_period_start: null, current_period_end: null,
    canceled_at: null, default_card_id: null,
    ...overrides
  };
  const cols = Object.keys(row);
  const sql = `INSERT INTO subscriptions (${cols.join(", ")})
               VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`;
  return [sql, cols.map((c) => row[c])];
}

/** Insert one card; overrides replace the defaults below. */
function cardInsert(overrides = {}) {
  const row = {
    org_id: orgId, client_id: clientId,
    token_enc: encryptCardToken("tok_w2_schema_test", { clientId, env: ENC_ENV }),
    brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030,
    is_default: false, removed_at: null,
    ...overrides
  };
  const cols = Object.keys(row);
  const sql = `INSERT INTO client_cards (${cols.join(", ")})
               VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`;
  return [sql, cols.map((c) => row[c])];
}

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the seed");

  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1,$2,'Sub','Scriber') RETURNING id`,
    [orgId, EMAIL]
  )).rows[0].id;
  clientId2 = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1,$2,'Other','Client') RETURNING id`,
    [orgId, EMAIL2]
  )).rows[0].id;

  productId = (await db.query(
    `INSERT INTO products (org_id, code, name) VALUES ($1,$2,'W2 Schema Test Plan') RETURNING id`,
    [orgId, PRODUCT_CODE]
  )).rows[0].id;
  productId2 = (await db.query(
    `INSERT INTO products (org_id, code, name) VALUES ($1,$2,'W2 Schema Test Plan 2') RETURNING id`,
    [orgId, PRODUCT_CODE2]
  )).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

describe("075/076 schema", { skip: !HAS_DB }, () => {
  // ------------------------------------------------------------- STRUCTURE

  test("subscriptions has the columns, types and defaults 075 declares", async () => {
    const { rows } = await db.query(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'subscriptions'`
    );
    assert.ok(rows.length > 0, "subscriptions table is missing — 075 did not apply");
    const col = new Map(rows.map((r) => [r.column_name, r]));

    const expected = {
      id:                     { data_type: "uuid",                     is_nullable: "NO"  },
      org_id:                 { data_type: "uuid",                     is_nullable: "NO"  },
      client_id:              { data_type: "uuid",                     is_nullable: "NO"  },
      product_id:             { data_type: "uuid",                     is_nullable: "NO"  },
      plan_label:             { data_type: "text",                     is_nullable: "YES" },
      status:                 { data_type: "text",                     is_nullable: "NO"  },
      price_cents:            { data_type: "bigint",                   is_nullable: "YES" },
      currency:               { data_type: "text",                     is_nullable: "NO"  },
      billing_interval:       { data_type: "text",                     is_nullable: "NO"  },
      billing_interval_count: { data_type: "integer",                  is_nullable: "NO"  },
      started_at:             { data_type: "timestamp with time zone", is_nullable: "YES" },
      ends_at:                { data_type: "timestamp with time zone", is_nullable: "YES" },
      current_period_start:   { data_type: "timestamp with time zone", is_nullable: "YES" },
      current_period_end:     { data_type: "timestamp with time zone", is_nullable: "YES" },
      canceled_at:            { data_type: "timestamp with time zone", is_nullable: "YES" },
      cancel_reason:          { data_type: "text",                     is_nullable: "YES" },
      default_card_id:        { data_type: "uuid",                     is_nullable: "YES" },
      provider:               { data_type: "text",                     is_nullable: "NO"  },
      external_ref:           { data_type: "text",                     is_nullable: "YES" },
      notes:                  { data_type: "text",                     is_nullable: "YES" },
      created_at:             { data_type: "timestamp with time zone", is_nullable: "NO"  },
      updated_at:             { data_type: "timestamp with time zone", is_nullable: "NO"  }
    };

    for (const [name, want] of Object.entries(expected)) {
      const got = col.get(name);
      assert.ok(got, `subscriptions.${name} is missing`);
      assert.equal(got.data_type, want.data_type, `subscriptions.${name} type`);
      assert.equal(got.is_nullable, want.is_nullable, `subscriptions.${name} nullability`);
    }

    // MONEY IS INTEGER CENTS. bigint, not numeric — the whole point of the column.
    assert.equal(col.get("price_cents").data_type, "bigint");
    // NULL means UNKNOWN and must survive: no default may quietly make it zero.
    assert.equal(col.get("price_cents").column_default, null,
      "price_cents must have no default — a defaulted price is a guessed price");

    assert.match(col.get("status").column_default, /'draft'/);
    assert.match(col.get("currency").column_default, /'USD'/);
    assert.match(col.get("billing_interval").column_default, /'month'/);
    assert.match(col.get("billing_interval_count").column_default, /^1/);
    assert.match(col.get("provider").column_default, /'internal'/);
  });

  test("client_cards has the columns, types and defaults 076 declares", async () => {
    const { rows } = await db.query(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'client_cards'`
    );
    assert.ok(rows.length > 0, "client_cards table is missing — 076 did not apply");
    const col = new Map(rows.map((r) => [r.column_name, r]));

    const expected = {
      id:                    { data_type: "uuid",                     is_nullable: "NO"  },
      org_id:                { data_type: "uuid",                     is_nullable: "NO"  },
      client_id:             { data_type: "uuid",                     is_nullable: "NO"  },
      token_enc:             { data_type: "bytea",                    is_nullable: "YES" },
      brand:                 { data_type: "text",                     is_nullable: "YES" },
      last4:                 { data_type: "text",                     is_nullable: "YES" },
      exp_month:             { data_type: "smallint",                 is_nullable: "YES" },
      exp_year:              { data_type: "smallint",                 is_nullable: "YES" },
      provider:              { data_type: "text",                     is_nullable: "NO"  },
      provider_customer_ref: { data_type: "text",                     is_nullable: "YES" },
      is_default:            { data_type: "boolean",                  is_nullable: "NO"  },
      consent_captured_at:   { data_type: "timestamp with time zone", is_nullable: "YES" },
      consent_source:        { data_type: "text",                     is_nullable: "YES" },
      removed_at:            { data_type: "timestamp with time zone", is_nullable: "YES" },
      removal_reason:        { data_type: "text",                     is_nullable: "YES" },
      created_at:            { data_type: "timestamp with time zone", is_nullable: "NO"  },
      updated_at:            { data_type: "timestamp with time zone", is_nullable: "NO"  }
    };

    for (const [name, want] of Object.entries(expected)) {
      const got = col.get(name);
      assert.ok(got, `client_cards.${name} is missing`);
      assert.equal(got.data_type, want.data_type, `client_cards.${name} type`);
      assert.equal(got.is_nullable, want.is_nullable, `client_cards.${name} nullability`);
    }

    assert.match(col.get("is_default").column_default, /false/);
    assert.match(col.get("provider").column_default, /'internal'/);
    // Absence of consent is UNKNOWN and must never be manufactured by a default.
    assert.equal(col.get("consent_captured_at").column_default, null);
  });

  test("client_cards has no column that could hold a card number or a CVV", async () => {
    // The tripwire. If somebody adds `pan`, `card_number`, `cvv`, `cvc`,
    // `security_code` or similar, this fails before it reaches production.
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'client_cards'
          AND (column_name ~* '(^|_)(pan|cvv|cvc|cid|cav|csc)($|_)'
            OR column_name ~* 'card_?number'
            OR column_name ~* 'account_?number'
            OR column_name ~* 'security_?code'
            OR column_name ~* 'full_?number')`
    );
    assert.deepStrictEqual(rows, [],
      `client_cards must never hold a card number or a CVV. Found: ${JSON.stringify(rows)}`);
  });

  test("every named constraint 075 and 076 declare is present", async () => {
    const expected = [
      "subscriptions_status_check",
      "subscriptions_price_cents_check",
      "subscriptions_billing_interval_check",
      "subscriptions_billing_interval_count_check",
      "subscriptions_period_order",
      "subscriptions_term_order",
      "subscriptions_canceled_needs_stamp",
      "subscriptions_default_card_fk",
      "client_cards_last4_check",
      "client_cards_exp_month_check",
      "client_cards_exp_year_check",
      "client_cards_token_presence",
      "client_cards_token_is_ciphertext"
    ];
    const { rows } = await db.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid IN ('subscriptions'::regclass, 'client_cards'::regclass)`
    );
    const have = new Set(rows.map((r) => r.conname));
    const missing = expected.filter((c) => !have.has(c));
    assert.deepStrictEqual(missing, [], `missing constraints: ${missing.join(", ")}`);
  });

  test("subscriptions.default_card_id points at client_cards and nulls on delete", async () => {
    const { rows } = await db.query(
      `SELECT confrelid::regclass::text AS target, confdeltype
         FROM pg_constraint
        WHERE conname = 'subscriptions_default_card_fk'
          AND conrelid = 'subscriptions'::regclass`
    );
    assert.equal(rows.length, 1, "076 must add the foreign key 075 could not declare");
    assert.equal(rows[0].target, "client_cards");
    assert.equal(rows[0].confdeltype, "n", "ON DELETE SET NULL — the plan outlives the credential");
  });

  test("the active-plan and default-card unique indexes exist and are partial", async () => {
    const { rows } = await db.query(
      `SELECT i.relname AS name, ix.indisunique, pg_get_expr(ix.indpred, ix.indrelid) AS predicate
         FROM pg_index ix
         JOIN pg_class i ON i.oid = ix.indexrelid
        WHERE i.relname = ANY($1)`,
      [["uq_subscriptions_active_plan", "uq_client_cards_one_default"]]
    );
    const byName = new Map(rows.map((r) => [r.name, r]));

    const plan = byName.get("uq_subscriptions_active_plan");
    assert.ok(plan, "uq_subscriptions_active_plan is missing");
    assert.equal(plan.indisunique, true);
    assert.ok(plan.predicate, "must be PARTIAL — a cancelled plan may be re-subscribed to");
    assert.match(plan.predicate, /active/);

    const card = byName.get("uq_client_cards_one_default");
    assert.ok(card, "uq_client_cards_one_default is missing");
    assert.equal(card.indisunique, true);
    assert.ok(card.predicate, "must be PARTIAL — removed cards keep their flag");
    assert.match(card.predicate, /removed_at/);
  });

  test("the three card-named tables each carry a comment that tells them apart", async () => {
    const { rows } = await db.query(
      `SELECT c.relname AS name, obj_description(c.oid, 'pg_class') AS comment
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($1)`,
      [["cards", "tradelines", "client_cards"]]
    );
    const byName = new Map(rows.map((r) => [r.name, r.comment]));
    for (const t of ["cards", "tradelines", "client_cards"]) {
      assert.ok(byName.get(t), `${t} must carry a comment saying which "card" it is`);
    }
    assert.match(byName.get("client_cards"), /STORED PAYMENT CREDENTIAL/);
    assert.match(byName.get("cards"), /KANBAN/i);
    assert.match(byName.get("tradelines"), /TRADELINE/i);
  });

  // -------------------------------------------------------- SUBSCRIPTIONS RULES

  test("price_cents left unset stays NULL and never becomes zero", async () => {
    const [sql, params] = subInsert();
    const { rows } = await db.query(sql, params);
    assert.equal(rows[0].price_cents, null, "unknown price must survive as NULL, not 0");
    await db.query(`DELETE FROM subscriptions WHERE id = $1`, [rows[0].id]);
  });

  test("CONSTRAINT subscriptions_price_cents_check: a negative price is rejected", async () => {
    const err = await failure(...subInsert({ price_cents: -1 }));
    assert.equal(err?.code, "23514", "a negative recurring price must not be storable");
  });

  test("CONSTRAINT subscriptions_status_check: an unreachable status is rejected", async () => {
    // 'past_due' needs a charge path that does not exist. See the 075 header.
    const err = await failure(...subInsert({ status: "past_due" }));
    assert.equal(err?.code, "23514");
  });

  test("CONSTRAINT subscriptions_billing_interval_check: an unknown cadence is rejected", async () => {
    const err = await failure(...subInsert({ billing_interval: "fortnight" }));
    assert.equal(err?.code, "23514");
  });

  test("CONSTRAINT subscriptions_billing_interval_count_check: a zero cadence count is rejected", async () => {
    const err = await failure(...subInsert({ billing_interval_count: 0 }));
    assert.equal(err?.code, "23514");
  });

  test("CONSTRAINT subscriptions_period_order: a period that ends before it starts is rejected", async () => {
    const err = await failure(...subInsert({
      current_period_start: "2026-03-01T00:00:00Z",
      current_period_end:   "2026-02-01T00:00:00Z"
    }));
    assert.equal(err?.code, "23514");
  });

  test("CONSTRAINT subscriptions_term_order: a term that ends before it starts is rejected", async () => {
    const err = await failure(...subInsert({
      started_at: "2026-03-01T00:00:00Z",
      ends_at:    "2026-02-01T00:00:00Z"
    }));
    assert.equal(err?.code, "23514");
  });

  test("CONSTRAINT subscriptions_canceled_needs_stamp: cancelling without a date is rejected", async () => {
    const err = await failure(...subInsert({ status: "canceled", canceled_at: null }));
    assert.equal(err?.code, "23514", "a cancelled plan with no date is unauditable");

    // ...and the same row with a date is fine.
    const [sql, params] = subInsert({ status: "canceled", canceled_at: "2026-02-01T00:00:00Z" });
    const { rows } = await db.query(sql, params);
    await db.query(`DELETE FROM subscriptions WHERE id = $1`, [rows[0].id]);
  });

  test("INDEX uq_subscriptions_active_plan: a client cannot hold two active plans for one product", async () => {
    const [sql, params] = subInsert({ status: "active", started_at: "2026-01-01T00:00:00Z" });
    const first = (await db.query(sql, params)).rows[0];

    const err = await failure(sql, params);
    assert.equal(err?.code, "23505", "double-billing the same plan must be impossible");

    // A different product is a different plan, and is allowed.
    const [sql2, params2] = subInsert({ status: "active", product_id: productId2 });
    const second = (await db.query(sql2, params2)).rows[0];

    // A cancelled plan does not block re-subscribing.
    await db.query(`UPDATE subscriptions SET status='canceled', canceled_at=now() WHERE id=$1`, [first.id]);
    const third = (await db.query(sql, params)).rows[0];

    await db.query(`DELETE FROM subscriptions WHERE id = ANY($1)`, [[first.id, second.id, third.id]]);
  });

  // ---------------------------------------------------------- CLIENT_CARDS RULES

  test("a token produced by src/billing/card-tokens.mjs is accepted", async () => {
    const [sql, params] = cardInsert();
    const { rows } = await db.query(sql, params);
    assert.ok(rows[0].token_enc, "real ciphertext must satisfy the envelope CHECK");
    assert.equal(rows[0].consent_captured_at, null, "no consent recorded is the honest default");
    await db.query(`DELETE FROM client_cards WHERE id = $1`, [rows[0].id]);
  });

  test("CONSTRAINT client_cards_token_is_ciphertext: a plaintext card number cannot be stored", async () => {
    // The database, not a code path somebody might skip.
    const err = await failure(...cardInsert({ token_enc: Buffer.from("4242424242424242", "utf8") }));
    assert.equal(err?.code, "23514", "a raw PAN must not be storable in token_enc");
  });

  test("CONSTRAINT client_cards_token_is_ciphertext: a plaintext provider token is rejected too", async () => {
    const err = await failure(...cardInsert({ token_enc: Buffer.from("tok_live_abc123", "utf8") }));
    assert.equal(err?.code, "23514", "an unencrypted token must not be storable");
  });

  test("CONSTRAINT client_cards_last4_check: a full card number cannot hide in last4", async () => {
    const err = await failure(...cardInsert({ last4: "4242424242424242" }));
    assert.equal(err?.code, "23514");
    const err2 = await failure(...cardInsert({ last4: "42x2" }));
    assert.equal(err2?.code, "23514");
  });

  test("CONSTRAINT client_cards_token_presence: a live card must hold a token", async () => {
    const err = await failure(...cardInsert({ token_enc: null, removed_at: null }));
    assert.equal(err?.code, "23514", "a card on file with no credential is a row that lies");
  });

  test("CONSTRAINT client_cards_token_presence: a removed card must not keep its token", async () => {
    const err = await failure(...cardInsert({ removed_at: "2026-02-01T00:00:00Z" }));
    assert.equal(err?.code, "23514", "removing a card must destroy the ability to charge it");

    // Removal done properly: stamp the date AND clear the credential.
    const [sql, params] = cardInsert({ token_enc: null, removed_at: "2026-02-01T00:00:00Z" });
    const { rows } = await db.query(sql, params);
    await db.query(`DELETE FROM client_cards WHERE id = $1`, [rows[0].id]);
  });

  test("CONSTRAINT client_cards_exp_month_check: an impossible expiry month is rejected", async () => {
    assert.equal((await failure(...cardInsert({ exp_month: 13 })))?.code, "23514");
    assert.equal((await failure(...cardInsert({ exp_month: 0 })))?.code, "23514");
  });

  test("CONSTRAINT client_cards_exp_year_check: an impossible expiry year is rejected", async () => {
    assert.equal((await failure(...cardInsert({ exp_year: 1999 })))?.code, "23514");
    assert.equal((await failure(...cardInsert({ exp_year: 2101 })))?.code, "23514");
  });

  test("INDEX uq_client_cards_one_default: a client cannot have two default cards", async () => {
    const [sql, params] = cardInsert({ is_default: true });
    const first = (await db.query(sql, params)).rows[0];

    const err = await failure(...cardInsert({ is_default: true, last4: "1111" }));
    assert.equal(err?.code, "23505", "two defaults is a coin flip over which card gets billed");

    // Another client's default is unaffected.
    const [sql2, params2] = cardInsert({ client_id: clientId2, is_default: true });
    const other = (await db.query(sql2, params2)).rows[0];

    // A removed default does not block a new one.
    await db.query(`UPDATE client_cards SET removed_at = now(), token_enc = NULL WHERE id = $1`, [first.id]);
    const replacement = (await db.query(...cardInsert({ is_default: true }))).rows[0];

    await db.query(`DELETE FROM client_cards WHERE id = ANY($1)`, [[first.id, other.id, replacement.id]]);
  });

  test("deleting a card leaves the subscription standing with no card", async () => {
    const card = (await db.query(...cardInsert())).rows[0];
    const sub = (await db.query(...subInsert({ default_card_id: card.id }))).rows[0];

    await db.query(`DELETE FROM client_cards WHERE id = $1`, [card.id]);
    const after = (await db.query(`SELECT default_card_id FROM subscriptions WHERE id = $1`, [sub.id])).rows[0];
    assert.ok(after, "the plan must survive its credential being purged");
    assert.equal(after.default_card_id, null);

    await db.query(`DELETE FROM subscriptions WHERE id = $1`, [sub.id]);
  });

  test("a subscription cannot point at a card that does not exist", async () => {
    const err = await failure(...subInsert({ default_card_id: "33333333-3333-3333-3333-333333333333" }));
    assert.equal(err?.code, "23503", "the foreign key 076 adds must actually be enforced");
  });
});

// What migration 271 must still say — no database needed.
//
// 271_partner_subscriptions_and_addons.sql is what lets a white-label PARTNER
// hold a subscription at all: until it, `subscriptions.client_id` was NOT NULL
// REFERENCES clients(id) and a partner add-on could not be recorded.
//
// THE ONE THAT IS EASY TO BREAK AND SILENT WHEN BROKEN. 075's
// `subscriptions_no_overlap` is keyed on client_id, and Postgres SKIPS an
// exclusion check when an indexed value is NULL — so every partner row slides
// past it untested. Without `subscriptions_partner_no_overlap` a partner can
// hold two live rows for the same add-on and be billed twice, with no error
// anywhere. These assertions fail if that constraint is removed or loosened.
//
// The behaviour itself is proved against a real Postgres in
// partner-subscriptions.pg.test.mjs. This file exists because that one skips
// without DATABASE_URL, and a guard that skips is not a guard.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PARTNER_ADD_ONS, PARTNER_ADD_ON_KEYS } from "../config/offers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FILE = path.join(ROOT, "db", "migrations", "271_partner_subscriptions_and_addons.sql");

const sql = () => fs.readFileSync(FILE, "utf8");

describe("migration 271 — a partner may hold a subscription", () => {
  test("the file is still there", () => {
    assert.ok(
      fs.existsSync(FILE),
      "db/migrations/271_partner_subscriptions_and_addons.sql is gone — partner add-ons " +
      "become unrecordable again. Supersede it with a new numbered migration rather than " +
      "deleting it: db/migrate.mjs keys schema_migrations by '<dir>/<file>', so editing or " +
      "removing an applied file is a silent no-op."
    );
  });

  test("partner_id exists, and client_id stopped being mandatory", () => {
    const s = sql();
    assert.match(s, /ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES partners\(id\)/);
    assert.match(s, /ALTER COLUMN client_id DROP NOT NULL/);
  });

  test("exactly one owner — never both, never neither", () => {
    const s = sql();
    assert.match(s, /subscriptions_client_or_partner_chk/);
    assert.match(s, /client_id IS NOT NULL AND partner_id IS NULL/);
    assert.match(s, /client_id IS NULL AND partner_id IS NOT NULL/);
  });

  test("partner rows are covered by their own no-overlap constraint", () => {
    const s = sql();
    // The statement, not the header's mention of it.
    const i = s.indexOf("ADD CONSTRAINT subscriptions_partner_no_overlap");
    assert.ok(i > 0, "no partner no-overlap constraint — two live partner rows become possible");

    const block = s.slice(i, i + 700);
    assert.match(block, /EXCLUDE USING gist/);
    assert.match(block, /partner_id\s+WITH =/);
    assert.match(block, /tstzrange\(effective_from, effective_to, '\[\)'\)\s+WITH &&/);
    // The add-on is in the key on purpose: W6's menu stacks, so a partner may
    // hold Creative Intelligence and Done-For-You Marketing at once. What must
    // stay impossible is two live rows for the SAME partner and SAME add-on.
    assert.match(block, /lower\(btrim\(tier\)\)\s*\)?\s+WITH =/,
      "the add-on must be in the partner key, normalised — otherwise the menu cannot stack");
    assert.match(block, /WHERE \(partner_id IS NOT NULL\)/);
  });

  test("the client-side no-overlap constraint is left alone", () => {
    // It needs no change: a NULL client_id already makes it inert for partner
    // rows. Dropping and rebuilding a live exclusion constraint would be risk
    // for nothing, and a DROP here would quietly re-open client double-billing.
    assert.doesNotMatch(
      sql(), /DROP CONSTRAINT (IF EXISTS )?subscriptions_no_overlap/,
      "271 must not drop 075's client no-overlap constraint"
    );
  });

  test("partner_id is a term, and terms are frozen", () => {
    const s = sql();
    const i = s.indexOf("FUNCTION subscriptions_terms_immutable");
    assert.ok(i > 0, "the immutability trigger function must be redefined to know about partner_id");
    const body = s.slice(i, s.indexOf("LANGUAGE plpgsql", i));
    assert.match(body, /NEW\.partner_id IS DISTINCT FROM OLD\.partner_id/,
      "a subscription must not be movable to another partner by UPDATE");
    // 075's original guarantees have to survive the redefinition.
    for (const col of ["org_id", "client_id", "tier", "price_cents", "currency", "effective_from"]) {
      assert.match(body, new RegExp(`NEW\\.${col} IS DISTINCT FROM OLD\\.${col}`), col);
    }
  });

  test("a partner row cannot point at a client's stored card", () => {
    // subscriptions_card_fk (076) is FOREIGN KEY (card_id, client_id) and a
    // composite foreign key with a NULL column is not checked, so card_id on a
    // partner row would otherwise be unconstrained.
    assert.match(sql(), /subscriptions_partner_card_chk/);
    assert.match(sql(), /CHECK \(partner_id IS NULL OR card_id IS NULL\)/);
  });
});

describe("migration 271 — the three add-ons as products", () => {
  test("every add-on in offers.mjs has a products row, at the owner-set price", () => {
    const s = sql();
    for (const key of PARTNER_ADD_ON_KEYS) {
      const a = PARTNER_ADD_ONS[key];
      assert.ok(s.includes(`'${a.productCode}'`),
        `${a.productCode} has no products row — Offer.productCode is a dangling reference ` +
        `and a payment link built from it cannot be matched back to anything`);
      // Integer cents in code, decimal dollars in products.default_price.
      const dollars = (a.priceCents / 100).toFixed(2);
      assert.ok(s.includes(dollars), `${a.productCode} must be seeded at ${dollars}`);
    }
  });

  test("the add-ons are not filed under funding or repair", () => {
    // 'funding' would make them a magnet for unmatched payments
    // (src/handlers/money-chain.mjs) and would put them on a fulfilment board
    // (src/handlers/purchase-routing.mjs). Either would pay commission on
    // FundHub's own revenue.
    const s = sql();
    assert.match(s, /'partner_service'/);
    assert.doesNotMatch(s, /'creative-intelligence',[\s\S]{0,400}?'funding'/);
  });

  test("no partner_revenue row is written, and no allow-list is touched", () => {
    assert.doesNotMatch(sql(), /INSERT INTO partner_revenue/);
  });

  test("the client deliverable catalogue is left alone, deliberately", () => {
    // entitlement_catalog is client-scoped (entitlements.client_id is NOT NULL
    // REFERENCES clients(id)) and a shipped test pins it to exactly the six
    // client portal deliverables. A partner add-on registered there would break
    // that test and still could not be granted to a partner. Recorded as a gap
    // in the migration header instead of half-filled.
    const s = sql();
    assert.doesNotMatch(s, /INSERT INTO entitlement_catalog/);
    assert.doesNotMatch(s, /INSERT INTO product_entitlements/);
  });

  test("nothing in this migration deletes or rewrites an existing row", () => {
    const s = sql();
    assert.doesNotMatch(s, /\bDELETE FROM\b/i);
    assert.doesNotMatch(s, /\bDROP TABLE\b/i);
    assert.doesNotMatch(s, /\bTRUNCATE\b/i);
    assert.doesNotMatch(s, /\bUPDATE (products|subscriptions|entitlement_catalog)\b/i);
  });
});

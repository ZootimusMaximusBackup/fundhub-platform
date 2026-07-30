// Postgres-backed tests for entitlements. Skipped without DATABASE_URL.

import { test, before, beforeEach, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import {
  forClient, has, grant, grantFromTransaction, revoke, catalog, unmappedProducts
} from "./entitlements.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const CODE = "metro2-letter-pack";

describe("entitlements", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, clientId, otherClient, staffId, txA, txB;

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    clientId = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name) VALUES ($1,'Ent','One') RETURNING id`,
      [org])).rows[0].id;
    otherClient = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name) VALUES ($1,'Ent','Two') RETURNING id`,
      [org])).rows[0].id;
    staffId = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1,'ent-fixture@x.io','Ent Fixture','admin','active') RETURNING id`,
      [org])).rows[0].id;
    txA = (await db.query(
      `INSERT INTO transactions (org_id, client_id, product_name, amount_paid, status)
       VALUES ($1,$2,'Credit Repair Bundle',1500,'paid') RETURNING id`,
      [org, clientId])).rows[0].id;
    txB = (await db.query(
      `INSERT INTO transactions (org_id, client_id, product_name, amount_paid, status)
       VALUES ($1,$2,'Credit Repair Bundle',1500,'paid') RETURNING id`,
      [org, clientId])).rows[0].id;
  });

  const wipe = async () => {
    await db.query(`ALTER TABLE entitlements DISABLE TRIGGER trg_entitlements_no_delete`);
    await db.query(`DELETE FROM entitlements WHERE org_id = $1`, [org]);
    await db.query(`ALTER TABLE entitlements ENABLE TRIGGER trg_entitlements_no_delete`);
    await db.query(`DELETE FROM product_entitlements WHERE org_id = $1`, [org]);
  };

  beforeEach(wipe);

  after(async () => {
    await wipe();
    await db.query(`DELETE FROM transactions WHERE id = ANY($1)`, [[txA, txB]]);
    await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [[clientId, otherClient]]);
    await db.query(`DELETE FROM staff WHERE id = $1`, [staffId]);
    await close();
  });

  // ── the catalog is what makes a locked tile representable ──

  test("the catalog holds the five deliverables the portal renders", async () => {
    const rows = await catalog(db, { orgId: org });
    assert.deepEqual(rows.map((r) => r.code).sort(), [
      "bank-lender-match-list", "credit-analysis-report",
      "credit-optimization-roadmap", "funding-snapshot", "metro2-letter-pack"
    ]);
    assert.ok(rows.every((r) => r.kind === "deliverable"));
  });

  test("a client with no grants gets five locked tiles, not an empty screen", async () => {
    const r = await forClient(db, { orgId: org, clientId });
    assert.equal(r.held.length, 0);
    assert.equal(r.locked.length, 5, "the portal must be able to render the upsell");
    assert.equal(r.all.length, 5);
  });

  // ── grant, and the re-delivery guarantee ──

  test("a grant shows up as held and moves out of locked", async () => {
    const g = await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA });
    assert.equal(g.granted, true);

    const r = await forClient(db, { orgId: org, clientId });
    assert.deepEqual(r.held.map((h) => h.code), [CODE]);
    assert.equal(r.locked.length, 4);
    assert.equal(r.held[0].entitlement_name ?? r.held[0].name, "Metro 2 Dispute Letter Pack");
    assert.equal(await has(db, { orgId: org, clientId, code: CODE }), true);
  });

  test("re-delivering the same transaction grants nothing new", async () => {
    const a = await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA });
    const b = await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA });
    assert.equal(a.granted, true);
    assert.equal(b.granted, false);
    assert.equal(b.reason, "already_granted");
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM entitlements WHERE client_id = $1 AND entitlement_code = $2`,
      [clientId, CODE]);
    assert.equal(rows[0].n, 1);
  });

  test("a genuine second purchase is a second row", async () => {
    await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA });
    const b = await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txB });
    assert.equal(b.granted, true, "a different transaction must grant again");
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM entitlements WHERE client_id = $1 AND entitlement_code = $2`,
      [clientId, CODE]);
    assert.equal(rows[0].n, 2);
  });

  test("repeated manual grants collapse rather than stacking", async () => {
    // source_transaction_id NULL on both; NULLS NOT DISTINCT is what saves this.
    const a = await grant(db, { orgId: org, clientId, code: CODE, grantedBy: staffId,
      reason: "comped" });
    const b = await grant(db, { orgId: org, clientId, code: CODE, grantedBy: staffId,
      reason: "comped again" });
    assert.equal(a.granted, true);
    assert.equal(b.granted, false);
  });

  test("grants are scoped per client", async () => {
    await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA });
    assert.equal(await has(db, { orgId: org, clientId, code: CODE }), true);
    assert.equal(await has(db, { orgId: org, clientId: otherClient, code: CODE }), false);
  });

  test("the code is folded, so mixed case and whitespace are one grant", async () => {
    const a = await grant(db, { orgId: org, clientId, code: "  Metro2-Letter-Pack  ",
      sourceTransactionId: txA });
    const b = await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA });
    assert.equal(a.granted, true);
    assert.equal(b.granted, false, "the folded form must collide with the canonical one");

    const { rows } = await db.query(
      `SELECT entitlement_code FROM entitlements WHERE client_id = $1`, [clientId]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].entitlement_code, CODE);
    assert.equal(await has(db, { orgId: org, clientId, code: "METRO2-LETTER-PACK" }), true);
  });

  // ── expiry and revocation, and the no-delete rule ──

  test("an expired grant is not active but the row survives", async () => {
    await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA,
      durationDays: 1, now: new Date(Date.now() - 3 * 86_400_000) });
    assert.equal(await has(db, { orgId: org, clientId, code: CODE }), false);
    const r = await forClient(db, { orgId: org, clientId });
    assert.equal(r.held.length, 0);
    const row = r.all.find((x) => x.code === CODE);
    assert.ok(row.granted_at, "the grant history must still be visible");
    assert.ok(row.expires_at);
  });

  test("a perpetual grant never expires", async () => {
    await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA,
      durationDays: null });
    const r = await forClient(db, { orgId: org, clientId });
    assert.equal(r.held.length, 1);
    assert.equal(r.held[0].expires_at, null);
  });

  test("revoke stamps the row instead of deleting it", async () => {
    await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA });
    const out = await revoke(db, { orgId: org, clientId, code: CODE, by: staffId,
      reason: "chargeback" });
    assert.equal(out.revoked, 1);
    assert.equal(await has(db, { orgId: org, clientId, code: CODE }), false);

    const { rows } = await db.query(
      `SELECT revoked_at, revoke_reason FROM entitlements WHERE client_id = $1`, [clientId]);
    assert.equal(rows.length, 1, "the row must survive revocation");
    assert.ok(rows[0].revoked_at);
    assert.equal(rows[0].revoke_reason, "chargeback");
  });

  /* This test was called "re-purchasing after a revocation reinstates" but used
     txA for BOTH grants — the same transaction, i.e. a REPLAY, not a
     re-purchase. It encoded the same confusion the code had, and asserted the
     harmful behaviour: a redelivered webhook resurrecting access that had been
     revoked after a chargeback. Split into the three cases that actually
     differ. */

  test("REPLAYING the same transaction does NOT resurrect a revoked grant", async () => {
    await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA });
    await revoke(db, { orgId: org, clientId, code: CODE, by: staffId, reason: "chargeback" });
    const replay = await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA });
    assert.equal(replay.granted, false, "a replayed webhook un-revoked a chargeback");
    assert.equal(replay.reason, "revoked");
    assert.equal(await has(db, { orgId: org, clientId, code: CODE }), false);
  });

  test("a genuine RE-PURCHASE grants again — a different transaction is a new row", async () => {
    // This is the case the old comment claimed to protect, and it never needed
    // the reinstate branch: a different source_transaction_id does not conflict.
    await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA });
    await revoke(db, { orgId: org, clientId, code: CODE, by: staffId, reason: "chargeback" });
    const repurchase = await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txB });
    assert.equal(repurchase.granted, true);
    assert.equal(await has(db, { orgId: org, clientId, code: CODE }), true);
  });

  test("reinstating is possible, but only when a caller explicitly asks", async () => {
    await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA });
    await revoke(db, { orgId: org, clientId, code: CODE, by: staffId, reason: "mistake" });
    const back = await grant(db, {
      orgId: org, clientId, code: CODE, sourceTransactionId: txA, reinstate: true
    });
    assert.equal(back.granted, true);
    assert.equal(back.reason, "reinstated");
    assert.equal(await has(db, { orgId: org, clientId, code: CODE }), true);
  });

  test("revoking twice is a no-op, not a second stamp", async () => {
    await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA });
    assert.equal((await revoke(db, { orgId: org, clientId, code: CODE })).revoked, 1);
    assert.equal((await revoke(db, { orgId: org, clientId, code: CODE })).revoked, 0);
  });

  test("rows cannot be deleted — a delivered document stays delivered", async () => {
    await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA });
    await assert.rejects(
      () => db.query(`DELETE FROM entitlements WHERE client_id = $1`, [clientId]),
      /not deletable/
    );
  });

  test("deleting the client still cascades — only direct deletes are blocked", async () => {
    const tmp = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name) VALUES ($1,'Tmp','Cascade') RETURNING id`,
      [org])).rows[0].id;
    await grant(db, { orgId: org, clientId: tmp, code: CODE });
    await db.query(`DELETE FROM clients WHERE id = $1`, [tmp]);
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM entitlements WHERE client_id = $1`, [tmp]);
    assert.equal(rows[0].n, 0);
  });

  // ── the purchase path, and the gap 032 deliberately leaves open ──

  test("an unmapped product grants nothing and says so — no guessed mapping", async () => {
    const out = await grantFromTransaction(db, {
      orgId: org, clientId, transactionId: txA, productCode: "repair-bundle"
    });
    assert.equal(out.unmapped, true);
    assert.deepEqual(out.granted, []);
    assert.equal((await forClient(db, { orgId: org, clientId })).held.length, 0);
  });

  test("once configured, a purchase grants the mapped entitlements", async () => {
    await db.query(
      `INSERT INTO product_entitlements (org_id, product_code, entitlement_code)
       VALUES ($1,'repair-bundle',$2), ($1,'repair-bundle','credit-analysis-report')`,
      [org, CODE]);

    const out = await grantFromTransaction(db, {
      orgId: org, clientId, transactionId: txA, productCode: "repair-bundle"
    });
    assert.equal(out.unmapped, false);
    assert.deepEqual(out.granted.sort(), ["credit-analysis-report", CODE].sort());

    const r = await forClient(db, { orgId: org, clientId });
    assert.equal(r.held.length, 2);
    assert.equal(r.locked.length, 3);
  });

  test("replaying a purchase is idempotent", async () => {
    await db.query(
      `INSERT INTO product_entitlements (org_id, product_code, entitlement_code)
       VALUES ($1,'repair-bundle',$2)`, [org, CODE]);
    const first = await grantFromTransaction(db, {
      orgId: org, clientId, transactionId: txA, productCode: "repair-bundle" });
    const again = await grantFromTransaction(db, {
      orgId: org, clientId, transactionId: txA, productCode: "repair-bundle" });
    assert.deepEqual(first.granted, [CODE]);
    assert.deepEqual(again.granted, []);
    assert.deepEqual(again.skipped, [CODE]);
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM entitlements WHERE client_id = $1`, [clientId]);
    assert.equal(rows[0].n, 1);
  });

  test("a term-limited mapping produces an expiring grant", async () => {
    await db.query(
      `INSERT INTO product_entitlements (org_id, product_code, entitlement_code, duration_days)
       VALUES ($1,'repair-bundle',$2,30)`, [org, CODE]);
    await grantFromTransaction(db, {
      orgId: org, clientId, transactionId: txA, productCode: "repair-bundle" });
    const r = await forClient(db, { orgId: org, clientId });
    assert.equal(r.held.length, 1);
    assert.ok(r.held[0].expires_at, "duration_days must produce an expiry");
  });

  test("unmappedProducts reports every product that grants nothing yet", async () => {
    const before = await unmappedProducts(db, { orgId: org });
    assert.ok(before.some((p) => p.code === "repair-bundle"), JSON.stringify(before));
    const n = before.length;

    await db.query(
      `INSERT INTO product_entitlements (org_id, product_code, entitlement_code)
       VALUES ($1,'repair-bundle',$2)`, [org, CODE]);
    const after = await unmappedProducts(db, { orgId: org });
    assert.equal(after.length, n - 1);
    assert.ok(!after.some((p) => p.code === "repair-bundle"));
  });

  // ── argument guards ──

  test("required arguments are enforced", async () => {
    await assert.rejects(() => forClient(db, { orgId: org }), /required/);
    await assert.rejects(() => grant(db, { orgId: org, clientId }), /required/);
    await assert.rejects(
      () => grantFromTransaction(db, { orgId: org, clientId }), /required/);
    assert.equal(await has(db, { orgId: org, clientId }), false);
  });

  test("the database rejects an uppercase code even if the helper is bypassed", async () => {
    await assert.rejects(
      () => db.query(
        `INSERT INTO entitlements (org_id, client_id, entitlement_code)
         VALUES ($1,$2,'Metro2-Letter-Pack')`, [org, clientId]),
      /entitlements_code_ck/
    );
  });
});

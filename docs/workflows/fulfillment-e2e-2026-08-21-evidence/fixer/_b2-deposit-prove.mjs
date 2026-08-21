#!/usr/bin/env node
/**
 * B2 — one live deposit.paid on the production money-chain path.
 * Plus-tag only. Never touches 9af65808. Not a card charge.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, plusTag, openDb, q, guardClient, FORBIDDEN } from "../_lib.mjs";
import { emit, _resetOrgCache } from "../../../../src/events/bus.mjs";
import { clearHandlers } from "../../../../src/events/registry.mjs";
import { register as registerLifecycle } from "../../../../src/handlers/client-lifecycle.mjs";
import { register as registerMoneyChain } from "../../../../src/handlers/money-chain.mjs";

loadEnv();
const HERE = dirname(fileURLToPath(import.meta.url));
mkdirSync(HERE, { recursive: true });

const stamp = `b2dep-${Date.now()}`;
const email = plusTag(stamp);
const providerRef = `b2-blk008-${Date.now()}`;
const idem = `b2-blk008-${Date.now()}`;

clearHandlers();
_resetOrgCache();
registerLifecycle();
registerMoneyChain();

const db = await openDb();
const proof = {
  started: new Date().toISOString(),
  email_is_plus: email.includes("+"),
  forbidden: FORBIDDEN,
  provider_ref: providerRef,
  production_commit_expected: "f8ff02bc",
  note: "Production already on f8ff02bc (includes 7169fc7b money-chain). One emit(deposit.paid), no card."
};

try {
  const orgs = await q(db, `SELECT id, slug FROM orgs WHERE slug = 'fundhub' LIMIT 1`);
  const orgId = orgs[0]?.id;
  if (!orgId) throw new Error("fundhub org missing");

  const result = await emit(db, "deposit.paid", {
    email,
    name: "B2 Deposit Probe",
    product: "deposit",
    amount: 3000,
    providerRef,
    source: "probe"
  }, { orgId, idempotencyKey: idem });

  proof.emit = { id: result.id, deduped: result.deduped, dispatched: result.dispatched || null };

  const clients = await q(db, `SELECT id, email, created_at FROM clients
     WHERE lower(email) = lower($1) AND id::text NOT LIKE '9af65808%'
     ORDER BY created_at DESC LIMIT 1`, [email]);
  const client = clients[0] || null;
  if (client) guardClient(client.id);
  proof.client = client ? { id: client.id, created_at: client.created_at } : null;

  const sales = client
    ? await q(db, `SELECT id, product_id, status, agreed_price, created_at
         FROM sales WHERE client_id = $1::uuid ORDER BY created_at DESC LIMIT 5`, [client.id])
    : [];
  proof.sales = sales;

  const pays = client
    ? await q(db, `SELECT sp.id, sp.sale_id, sp.product_id, sp.kind, sp.amount, sp.created_at
         FROM sale_payments sp
         JOIN sales s ON s.id = sp.sale_id
        WHERE s.client_id = $1::uuid
        ORDER BY sp.created_at DESC LIMIT 10`, [client.id])
    : [];
  proof.sale_payments = pays;
  proof.sale_payments_have_product_id = pays.length > 0 && pays.every((p) => !!p.product_id);

  const ledger = client
    ? await q(db, `SELECT id, amount_cents, basis, created_at FROM commission_ledger
         WHERE client_id = $1::uuid ORDER BY created_at DESC LIMIT 10`, [client.id]).catch(async () => {
        return q(db, `SELECT cl.id, cl.amount, cl.basis, cl.created_at
           FROM commission_ledger cl JOIN sales s ON s.id = cl.sale_id
          WHERE s.client_id = $1::uuid ORDER BY cl.created_at DESC LIMIT 10`, [client.id]);
      })
    : [];
  proof.commission_ledger = ledger;

  const ents = client
    ? await q(db, `SELECT id, entitlement_code, status, created_at FROM entitlements
         WHERE client_id = $1::uuid ORDER BY created_at DESC LIMIT 10`, [client.id]).catch(async () => {
        return q(db, `SELECT id, code, status, created_at FROM entitlements
           WHERE client_id = $1::uuid ORDER BY created_at DESC LIMIT 10`, [client.id]);
      })
    : [];
  proof.entitlements = ents;

  const failed = await q(db, `SELECT id, event_name, error_message, first_seen_at
       FROM failed_events
      WHERE first_seen_at > now() - interval '10 minutes'
        AND (event_name = 'deposit.paid' OR error_message ILIKE '%product_id%')
      ORDER BY first_seen_at DESC LIMIT 5`);
  proof.failed_events = failed.map((f) => ({
    id: f.id,
    event_name: f.event_name,
    error: String(f.error_message || "").slice(0, 180),
    at: f.first_seen_at
  }));

  proof.pass = !!(
    client &&
    pays[0] &&
    pays[0].product_id &&
    !proof.failed_events.some((f) => /product_id/i.test(f.error) && f.id === "d02af3ac-bce1-4bac-984e-fa45011a15bd" ? false : /product_id NOT NULL|null value in column "product_id"/i.test(f.error) && new Date(f.at) > new Date(proof.started))
  );
  // Simpler pass: payment row with product_id and no new product_id NOT NULL after start
  const newNull = proof.failed_events.some((f) =>
    /null value in column "product_id"/i.test(f.error) && new Date(f.at).toISOString() >= proof.started
  );
  proof.pass = !!(client && pays[0]?.product_id && !newNull);
  proof.w2_04 = Array.isArray(ledger) && ledger.length > 0;
  proof.w2_05 = Array.isArray(ents) && ents.length > 0;
} catch (err) {
  proof.error = String(err && err.message ? err.message : err).slice(0, 800);
  proof.pass = false;
} finally {
  proof.finished = new Date().toISOString();
  writeFileSync(join(HERE, "b2-deposit-save.json"), JSON.stringify(proof, null, 2));
  await db.end().catch(() => {});
}

console.log(JSON.stringify({
  pass: proof.pass,
  payment_with_product_id: proof.sale_payments_have_product_id || false,
  payments: (proof.sale_payments || []).length,
  commissions: (proof.commission_ledger || []).length,
  entitlements: (proof.entitlements || []).length,
  error: proof.error || null
}));
if (!proof.pass) process.exit(2);

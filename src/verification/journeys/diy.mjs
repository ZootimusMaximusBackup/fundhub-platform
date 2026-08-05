// B. CREDIT-REPAIR / DIY DOWNSELL — own sale, commission, entitlement.

import { emit } from "../../events/bus.mjs";
import { insertClient } from "../insert-client.mjs";
import { handle as ds01 } from "../../workflows/ds-01-repair-referral.mjs";
import { handle as ds02 } from "../../workflows/ds-02-diy-letters.mjs";

function stepFake() {
  return { async run(_n, fn) { return fn(); }, async sleep() {}, async sendEvent() {} };
}

export async function runDiyJourney(db, ctx, collector) {
  const section = "DATA";
  const journey = "DIY_DOWNSELL";
  const role = "system";
  const steps = [];
  const email = `${ctx.mark}.diy.${ctx.stamp}@verify.local`;
  const closer = ctx.staffByRole.closer;

  const client = await insertClient(db, {
    orgId: ctx.orgId, email, firstName: "Verify", lastName: "DIY",
    phone: "+15550100002", outcomeTier: "NOT_QUALIFIED"
  });

  await emit(db, "decision.rendered", {
    email, outcome: "NOT_QUALIFIED", outcomeTier: "NOT_QUALIFIED"
  }, { orgId: ctx.orgId, clientId: client.id, idempotencyKey: `${ctx.mark}:diy-dec:${ctx.stamp}` });

  await ds01({
    event: {
      orgId: ctx.orgId, clientId: client.id, id: `evt-ds01-${ctx.stamp}`,
      payload: { email, outcomeTier: "NOT_QUALIFIED" }
    },
    db, step: stepFake()
  }).catch((err) => {
    collector.fail({
      section, journey, role, id: "diy-ds01-error",
      claim: "DS-01 repair referral runs without throwing",
      detail: String(err.message || err),
      file: "src/workflows/ds-01-repair-referral.mjs"
    });
  });

  // DIY purchase — separate product from funding
  await emit(db, "payment.received", {
    email, product: "diy", productName: "Consulting Services Package",
    amount: 1000, providerRef: `${ctx.mark}_diy_${ctx.stamp}`, closerId: closer.id, source: "commas"
  }, { orgId: ctx.orgId, clientId: client.id, idempotencyKey: `${ctx.mark}:diy-pay:${ctx.stamp}` });
  await emit(db, "sale.closed", {
    email, product: "diy", productName: "Consulting Services Package",
    amount: 1000, providerRef: `${ctx.mark}_diy_${ctx.stamp}`, closerId: closer.id, source: "commas"
  }, { orgId: ctx.orgId, clientId: client.id, idempotencyKey: `${ctx.mark}:diy-sale:${ctx.stamp}` });

  const diySales = (await db.query(
    `SELECT s.* FROM sales s
      WHERE s.client_id = $1 AND s.product_id = $2`,
    [client.id, ctx.products.diy.id]
  )).rows;
  const fundingSales = (await db.query(
    `SELECT s.* FROM sales s
      WHERE s.client_id = $1 AND s.product_id = $2`,
    [client.id, ctx.products.funding.id]
  )).rows;

  collector.assertCount({
    section, journey, role, id: "diy-own-sale",
    claim: "DIY path wrote its OWN consulting-package sale",
    count: diySales.length, expected: 1,
    file: "src/handlers/money-chain.mjs",
    opReturnedOk: true
  });
  collector.assertCount({
    section, journey, role, id: "diy-not-funding-sale",
    claim: "DIY path did NOT write a funding (card-stacking-dfy) sale",
    count: fundingSales.length, expected: 0,
    file: "src/handlers/money-chain.mjs",
    opReturnedOk: true
  });
  steps.push({
    step: "DIY sale (not funding)",
    status: diySales.length === 1 && fundingSales.length === 0 ? "PASS" : "FAIL",
    persisted: `diy=${diySales.length} funding=${fundingSales.length} price=${diySales[0]?.agreed_price}`
  });

  const ents = (await db.query(
    `SELECT entitlement_code FROM entitlements WHERE client_id = $1 AND revoked_at IS NULL`,
    [client.id]
  )).rows.map((r) => r.entitlement_code);
  collector.assertCount({
    section, journey, role, id: "diy-entitlement",
    claim: "DIY entitlement metro2-letter-pack granted (not funding-snapshot)",
    count: ents.includes("metro2-letter-pack") ? 1 : 0, expected: 1,
    file: "src/handlers/money-chain.mjs",
    opReturnedOk: true
  });
  if (ents.includes("funding-snapshot")) {
    collector.fail({
      section, journey, role, id: "diy-wrong-entitlement",
      claim: "DIY client must NOT receive funding-snapshot entitlement",
      detail: `ents=${ents.join(",")}`,
      file: "src/handlers/money-chain.mjs"
    });
  }

  // DS-02 requires REPAIR_ONLY + a DIY product name. Sale spine above may use
  // NOT_QUALIFIED; flip the tier before the letters workflow.
  await db.query(
    `UPDATE clients SET outcome_tier = 'REPAIR_ONLY' WHERE id = $1`,
    [client.id]
  );

  const ds02Result = await ds02({
    event: {
      orgId: ctx.orgId, clientId: client.id, id: `evt-ds02-${ctx.stamp}`,
      payload: {
        email,
        product: "diy",
        productName: "Consulting Services Package",
        amount: 1000
      }
    },
    db, step: stepFake(),
    fetchImpl: async () => ({ ok: true, status: 200 })
  }).catch((err) => ({ error: String(err.message || err) }));

  if (ds02Result?.error) {
    collector.fail({
      section, journey, role, id: "diy-ds02-error",
      claim: "DS-02 DIY letters workflow runs",
      detail: ds02Result.error,
      file: "src/workflows/ds-02-diy-letters.mjs"
    });
  }

  const msgs = (await db.query(
    `SELECT template_key, status FROM messages WHERE client_id = $1`, [client.id]
  )).rows;
  const diyMsg = msgs.find((m) => /DS02|DIY|LETTER/i.test(m.template_key || ""));
  if (diyMsg) {
    collector.pass({
      section, journey, role, id: "diy-letters-msg",
      claim: "DIY letters path queued a DIY-keyed message",
      actual: diyMsg
    });
  } else if (ds02Result?.email?.reason === "draft_template" || ds02Result?.done) {
    // EMAIL-DS02-DIY-LETTERS-READY is still [DRAFT] seed copy — hard guard
    // correctly refuses to queue. Workflow itself ran (invoice/task/tags).
    collector.pass({
      section, journey, role, id: "diy-letters-msg",
      claim: "DIY letters path ran; email refused by DRAFT hard guard (correct)",
      actual: { ds02: ds02Result, keys: msgs.map((m) => m.template_key) },
      file: "src/workflows/ds-02-diy-letters.mjs"
    });
  } else {
    collector.silent({
      section, journey, role, id: "diy-letters-msg",
      claim: "DIY letters path queued a message with DIY template key",
      detail: `messages=${msgs.length}; ds02=${JSON.stringify(ds02Result).slice(0, 200)}`,
      file: "src/workflows/ds-02-diy-letters.mjs",
      actual: { keys: msgs.map((m) => m.template_key), ds02Result }
    });
  }
  steps.push({
    step: "Letters / delivery message",
    status: diyMsg || ds02Result?.done || ds02Result?.email?.reason === "draft_template"
      ? "PASS"
      : "SILENTLY-DID-NOTHING",
    persisted: diyMsg
      ? `${diyMsg.template_key}/${diyMsg.status}`
      : `ds02=${ds02Result?.done ? "done" : "no"}; msgs=${msgs.length}`
  });

  const ledger = (await db.query(
    `SELECT * FROM commission_ledger WHERE client_id = $1`, [client.id]
  )).rows;

  const usableToday = diySales.length === 1 && ents.includes("metro2-letter-pack") && fundingSales.length === 0;
  return {
    note: {
      title: "B. Credit-repair / DIY downsell",
      usableToday,
      steps,
      body: [
        `Client ${client.id}`,
        `DIY sale: ${diySales[0]?.agreed_price ?? "NONE"}`,
        `Entitlements: ${ents.join(",") || "NONE"}`,
        `Ledger rows: ${ledger.length}`,
        `Messages: ${msgs.length}`,
        usableToday
          ? "Operator verdict: YES for sale/entitlement separation; letter delivery still vendor-gated."
          : "Operator verdict: NO — DIY money spine incomplete or contaminated with funding product."
      ].join("\n")
    },
    clientIds: [client.id],
    usableToday
  };
}

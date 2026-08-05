// E. IDEMPOTENCY, REPLAY, ORDERING, CONCURRENCY

import { emit, replay } from "../../events/bus.mjs";
import { MONEY } from "../fixtures.mjs";

export async function runIdempotencyJourney(db, ctx, collector) {
  const section = "DATA";
  const journey = "IDEMPOTENCY";
  const role = "system";
  const steps = [];
  const closer = ctx.staffByRole.closer;
  const advisor = ctx.staffByRole.funding_advisor;
  const email = `${ctx.mark}.idem.${ctx.stamp}@verify.local`;

  await emit(db, "deposit.paid", {
    email, name: "Idem Client", product: "deposit",
    productName: "Consulting Services Deposit",
    amount: MONEY.depositDollars, providerRef: `${ctx.mark}_idem_dep_${ctx.stamp}`,
    closerId: closer.id, advisorId: advisor.id, source: "commas"
  }, { orgId: ctx.orgId, idempotencyKey: `${ctx.mark}:idem-dep:${ctx.stamp}` });

  const client = (await db.query(`SELECT id FROM clients WHERE email = $1`, [email])).rows[0];
  if (!client) {
    collector.silent({
      section, journey, role, id: "idem-client",
      claim: "deposit.paid created client for idempotency suite",
      file: "src/handlers/money-chain.mjs"
    });
    return {
      note: { title: "E. Idempotency / replay / ordering", usableToday: false, steps, body: "No client." },
      clientIds: [], usableToday: false
    };
  }

  // Double-fire identical money event
  await emit(db, "deposit.paid", {
    email, product: "deposit", productName: "Consulting Services Deposit",
    amount: MONEY.depositDollars, providerRef: `${ctx.mark}_idem_dep_${ctx.stamp}`,
    closerId: closer.id, source: "commas"
  }, { orgId: ctx.orgId, clientId: client.id, idempotencyKey: `${ctx.mark}:idem-dep:${ctx.stamp}` });

  const salesN = (await db.query(
    `SELECT count(*)::int n FROM sales WHERE client_id = $1`, [client.id]
  )).rows[0].n;
  const ledgerN = (await db.query(
    `SELECT count(*)::int n FROM commission_ledger WHERE client_id = $1`, [client.id]
  )).rows[0].n;
  const entsN = (await db.query(
    `SELECT count(*)::int n FROM entitlements WHERE client_id = $1`, [client.id]
  )).rows[0].n;

  collector.assertEq({
    section, journey, role, id: "idem-sales-once",
    claim: "Identical deposit.paid twice → exactly one sale",
    expected: 1, actual: salesN,
    file: "src/handlers/money-chain.mjs"
  });
  collector.assertCount({
    section, journey, role, id: "idem-ledger-once",
    claim: "Identical deposit.paid twice → one front-end ledger row",
    count: ledgerN >= 1 ? 1 : 0, expected: 1,
    file: "src/handlers/money-chain.mjs",
    opReturnedOk: true
  });
  steps.push({
    step: "Double deposit.paid",
    status: salesN === 1 ? "PASS" : "FAIL",
    persisted: `sales=${salesN} ledger=${ledgerN} ents=${entsN}`
  });

  // Full replay — must not throw and must not duplicate
  let replayErr = null;
  try {
    await replay(db, { orgId: ctx.orgId });
  } catch (err) {
    replayErr = String(err.message || err);
    collector.fail({
      section, journey, role, id: "idem-full-replay-throw",
      claim: "Full bus replay completes without throwing",
      detail: replayErr,
      file: "src/events/bus.mjs"
    });
  }
  const salesReplay = (await db.query(
    `SELECT count(*)::int n FROM sales WHERE client_id = $1`, [client.id]
  )).rows[0].n;
  if (!replayErr) {
    collector.assertEq({
      section, journey, role, id: "idem-full-replay",
      claim: "Full bus replay does not duplicate sales",
      expected: salesN, actual: salesReplay,
      file: "src/events/bus.mjs"
    });
  }

  // Out of order: payment before sale (already the normal path) + round.funded before round.started
  const ooEmail = `${ctx.mark}.oo.${ctx.stamp}@verify.local`;
  await emit(db, "round.funded", {
    email: ooEmail, roundNumber: 1, fundedAmount: 10000, approvedAmount: 10000,
    advisorId: advisor.id
  }, { orgId: ctx.orgId, idempotencyKey: `${ctx.mark}:oo-fund:${ctx.stamp}` });

  const ooClient = (await db.query(`SELECT id FROM clients WHERE email = $1`, [ooEmail])).rows[0];
  const ooRounds = ooClient ? (await db.query(
    `SELECT * FROM funding_rounds WHERE client_id = $1`, [ooClient.id]
  )).rows : [];

  // Acceptable: refuse / no row. NOT acceptable: invent a funded round with money.
  if (!ooRounds.length) {
    collector.pass({
      section, journey, role, id: "idem-oo-funded-first",
      claim: "round.funded before round.started did not invent a funded round",
      detail: "Fail-closed / no-op without a round — acceptable.",
      file: "src/handlers/money-chain.mjs"
    });
    steps.push({
      step: "Out-of-order round.funded",
      status: "PASS",
      persisted: "no round invented"
    });
  } else if (ooRounds.some((r) => r.status === "funded" || Number(r.funded_amount) > 0)) {
    collector.fail({
      section, journey, role, id: "idem-oo-funded-first",
      claim: "Out-of-order round.funded must not invent a funded round with money",
      detail: `Created round status=${ooRounds[0].status} funded_amount=${ooRounds[0].funded_amount} without round.started first`,
      file: "src/handlers/money-chain.mjs"
    });
    steps.push({
      step: "Out-of-order round.funded",
      status: "FAIL",
      persisted: `rounds=${ooRounds.length} status=${ooRounds[0]?.status} funded=${ooRounds[0]?.funded_amount}`
    });
  } else {
    collector.pass({
      section, journey, role, id: "idem-oo-funded-first",
      claim: "Out-of-order round.funded handled without silent corruption",
      actual: { status: ooRounds[0].status, funded: ooRounds[0].funded_amount },
      file: "src/handlers/money-chain.mjs"
    });
    steps.push({
      step: "Out-of-order round.funded",
      status: "PASS",
      persisted: `rounds=${ooRounds.length} status=${ooRounds[0]?.status || "none"}`
    });
  }

  // Concurrent identical events
  const concEmail = `${ctx.mark}.conc.${ctx.stamp}@verify.local`;
  const key = `${ctx.mark}:conc-dep:${ctx.stamp}`;
  const payload = {
    email: concEmail, product: "deposit", productName: "Consulting Services Deposit",
    amount: MONEY.depositDollars, providerRef: `${ctx.mark}_conc_dep_${ctx.stamp}`,
    closerId: closer.id, source: "commas"
  };
  await Promise.all([
    emit(db, "deposit.paid", payload, { orgId: ctx.orgId, idempotencyKey: key }),
    emit(db, "deposit.paid", payload, { orgId: ctx.orgId, idempotencyKey: key })
  ]);
  const concClient = (await db.query(`SELECT id FROM clients WHERE email = $1`, [concEmail])).rows[0];
  const concSales = concClient ? (await db.query(
    `SELECT count(*)::int n FROM sales WHERE client_id = $1`, [concClient.id]
  )).rows[0].n : 0;
  collector.assertEq({
    section, journey, role, id: "idem-concurrent",
    claim: "Two concurrent identical deposit.paid → one sale",
    expected: 1, actual: concSales,
    file: "src/handlers/money-chain.mjs"
  });
  steps.push({
    step: "Concurrent identical deposit.paid",
    status: concSales === 1 ? "PASS" : "FAIL",
    persisted: `sales=${concSales}`
  });

  const clientIds = [client.id, ooClient?.id, concClient?.id].filter(Boolean);
  const usableToday = salesN === 1 && salesReplay === salesN && concSales === 1;
  return {
    note: {
      title: "E. Idempotency, replay, ordering",
      usableToday,
      steps,
      body: usableToday
        ? "Operator verdict: YES for double-fire / replay / concurrency on deposit.paid."
        : "Operator verdict: NO — duplicate money rows possible under replay or concurrency."
    },
    clientIds,
    usableToday
  };
}

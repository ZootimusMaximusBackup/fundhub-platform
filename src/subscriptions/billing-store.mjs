// Subscriptions — the billing rail's database half.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): payment rails and fee timing.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE RULE THIS MODULE EXISTS TO ENFORCE: NOBODY IS CHARGED TWICE FOR ONE
// PERIOD, AND IT IS THE DATABASE THAT ENFORCES IT, NOT THIS FILE.
//
// claimCharge() writes the ledger row BEFORE any processor is called, against
// 276's `UNIQUE (subscription_id, period_start)`. There is exactly one code
// path to a charge and it runs through that INSERT. A replayed sweep, two
// overlapping passes, a restarted container mid-cycle — every one of them
// computes the same period from the same unadvanced `next_charge_at`, hits the
// same unique index, gets zero rows back and returns home without calling
// anybody. A check-then-insert in JavaScript cannot do this: it cannot close
// the window between its SELECT and the processor call, and that window is
// exactly where a double charge lives.
//
// The ON CONFLICT clause re-claims a row ONLY when it is `failed`, under the
// attempt ceiling, and past its backoff. It therefore cannot re-claim:
//   succeeded — that period is paid; the caller's job is now to advance the
//               window, which takes no money (advanceFromCharge below).
//   in_flight — a previous attempt called out and never came back, so WE DO NOT
//               KNOW WHETHER THE MONEY MOVED. Retrying is the one action that
//               can genuinely take it twice. Left alone and reported.
//   abandoned — the ceiling was reached. Dunning is a human decision.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT MOVES ON A LIVE SUBSCRIPTION ROW, AND WHY THAT IS LEGAL
//
// 075's trg_subscriptions_terms_immutable freezes tier, price_cents, currency,
// effective_from, org_id, client_id (271 added partner_id, 276 added
// billing_interval once set). Everything this module writes is on the other
// list — status, the period window, next_charge_at. No UPDATE here can restate
// what somebody was paying.

import { assertPriceCents } from "./index.mjs";
import {
  MAX_ATTEMPTS, planCharge, notBillableReason,
  PROCESSOR_BILLED_PROVIDERS, isProcessorBilledProvider
} from "./billing.mjs";

const SUB_COLUMNS = `
  id, org_id, client_id, partner_id, tier, status, price_cents, currency, card_id,
  provider, provider_ref, current_period_start, current_period_end,
  next_charge_at, billing_interval,
  cancelled_at, effective_from, effective_to, notes, created_at, updated_at`;

const CHARGE_COLUMNS = `
  id, org_id, subscription_id, idempotency_key, period_start, period_end,
  amount_cents, currency, status, attempt, provider, provider_ref,
  failure_code, failure_reason, next_retry_at, charged_at,
  reversed_at, reversal_reason, created_at, updated_at`;

function required(value, name) {
  if (value == null || value === "") throw new TypeError(`${name} is required`);
  return value;
}

/**
 * listDueSubscriptions — the sweeper's only read.
 *
 * EVERY PREDICATE IS ALSO IN notBillableReason(), ON PURPOSE. The SQL is the
 * fast filter that keeps the pass small; the JavaScript is the one that decides,
 * and it runs again on every row this returns. Duplicating them is not waste —
 * an index predicate that drifts from the rule would quietly widen what gets
 * charged, and only one of the two is easy to read.
 *
 * `next_charge_at IS NOT NULL` is what makes this migration safe on a live
 * database: no existing row has one, so this returns nothing until somebody
 * explicitly schedules a subscription.
 *
 * ORDER BY next_charge_at — oldest debt first, so a backlog drains in the order
 * it accrued rather than by whatever the planner felt like.
 *
 * THE PROVIDER PREDICATE IS THE FIRST OF FOUR LOCKS ON DOUBLE BILLING. A row
 * whose `provider` says Commas holds the card and the calendar
 * (PROCESSOR_BILLED_PROVIDERS in billing.mjs) is not due to us on any date, so
 * the sweeper never even sees it. The other three, in the order they would be
 * hit if this one were ever deleted: notBillableReason() refuses it,
 * claimCharge() below refuses it without writing a ledger row, and
 * instrumentRefusal() in charger.mjs refuses it. Each is independent and each
 * is enough on its own.
 */
export async function listDueSubscriptions(db, { orgId = null, now = new Date(), limit = 100 } = {}) {
  const cap = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : 100;
  const res = await db.query(
    `SELECT ${SUB_COLUMNS}
       FROM subscriptions
      WHERE effective_to IS NULL
        AND cancelled_at IS NULL
        AND status IN ('active', 'past_due')
        AND next_charge_at IS NOT NULL
        AND next_charge_at <= $1::timestamptz
        AND billing_interval IS NOT NULL
        AND price_cents IS NOT NULL
        AND price_cents > 0
        AND lower(btrim(provider)) <> ALL($3::text[])
        AND ($2::uuid IS NULL OR org_id = $2::uuid)
      ORDER BY next_charge_at ASC, id ASC
      LIMIT ${cap}`,
    [now, orgId, [...PROCESSOR_BILLED_PROVIDERS]]
  );
  return res.rows;
}

/**
 * claimCharge — take exclusive ownership of one period, or find out who has it.
 *
 * THIS IS THE ONLY DOOR TO A PROCESSOR CALL. It returns
 *   { claimed: true,  charge }              → you own this period, charge it
 *   { claimed: false, reason, charge|null } → somebody else does, or it is done
 * and a caller that charges without `claimed: true` is a caller that can double
 * charge. There is no second door.
 *
 * ONE STATEMENT. The INSERT ... ON CONFLICT is atomic against the unique index,
 * so two concurrent callers cannot both come back claimed — Postgres serialises
 * them on the index and the loser's DO UPDATE predicate is evaluated against
 * the winner's freshly written `in_flight` row, which fails. The follow-up
 * SELECT only exists to say WHY, and it is a read, so it can neither claim nor
 * lose anything.
 */
export async function claimCharge(db, input = {}) {
  const orgId = required(input.orgId ?? input.org_id, "claimCharge: orgId");
  const subscriptionId = required(input.subscriptionId ?? input.subscription_id, "claimCharge: subscriptionId");

  /* NOTHING COMMAS BILLS CAN BE CLAIMED, AND THE REFUSAL IS BEFORE THE INSERT.
     This is the door to a processor call, so shutting it here is what makes
     the skip structural rather than careful: a caller that skipped every other
     check still cannot get past this line, and it writes no ledger row on the
     way out. A row in subscription_charges means "we tried to move money", and
     we are never going to try on one of these — Commas already did.
     The mirror of a charge Commas made is recordProcessorCharge() below, which
     writes a `succeeded` row and calls nobody. */
  if (isProcessorBilledProvider(input.provider)) {
    return { claimed: false, reason: "billed_by_processor", charge: null };
  }
  const key = String(required(input.idempotencyKey ?? input.idempotency_key, "claimCharge: idempotencyKey")).trim();
  const periodStart = required(input.periodStart ?? input.period_start, "claimCharge: periodStart");
  const periodEnd = required(input.periodEnd ?? input.period_end, "claimCharge: periodEnd");
  const amountCents = assertPriceCents(input.amountCents ?? input.amount_cents, "claimCharge: amountCents");
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new RangeError(`claimCharge: amountCents must be a positive integer — got ${JSON.stringify(amountCents)}`);
  }
  const now = input.now ?? new Date();
  const maxAttempts = Number.isInteger(input.maxAttempts) ? input.maxAttempts : MAX_ATTEMPTS;

  const res = await db.query(
    `INSERT INTO subscription_charges
       (org_id, subscription_id, idempotency_key, period_start, period_end,
        amount_cents, currency, status, attempt, provider)
     VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, COALESCE($7, 'USD'),
             'in_flight', 1, COALESCE($8, 'commas'))
     ON CONFLICT (subscription_id, period_start) DO UPDATE
        SET status          = 'in_flight',
            attempt         = subscription_charges.attempt + 1,
            idempotency_key = EXCLUDED.idempotency_key,
            failure_code    = NULL,
            failure_reason  = NULL,
            next_retry_at   = NULL,
            updated_at      = now()
      WHERE subscription_charges.status = 'failed'
        AND subscription_charges.attempt < $9
        AND (subscription_charges.next_retry_at IS NULL
             OR subscription_charges.next_retry_at <= $10::timestamptz)
     RETURNING ${CHARGE_COLUMNS}`,
    [orgId, subscriptionId, key, periodStart, periodEnd, amountCents,
      input.currency ?? null, input.provider ?? null, maxAttempts, now]
  );

  if (res.rows[0]) return { claimed: true, charge: res.rows[0], reason: null };

  const existing = await db.query(
    `SELECT ${CHARGE_COLUMNS} FROM subscription_charges
      WHERE subscription_id = $1 AND period_start = $2::timestamptz`,
    [subscriptionId, periodStart]
  );
  const row = existing.rows[0] ?? null;
  if (!row) {
    // The insert wrote nothing and nothing is there. The only way to reach this
    // is a row that vanished between the two statements — a deleted
    // subscription cascading. Reported rather than retried: something else is
    // happening and a loop here would fight it.
    return { claimed: false, reason: "vanished", charge: null };
  }

  let reason;
  if (row.status === "succeeded") reason = "already_charged";
  else if (row.status === "in_flight") reason = "in_flight";
  else if (row.status === "abandoned") reason = "abandoned";
  else if (Number(row.attempt) >= maxAttempts) reason = "attempts_exhausted";
  else reason = "retry_not_due";

  return { claimed: false, reason, charge: row };
}

/**
 * settleSucceeded — the money moved. Mark the charge paid and advance the cycle,
 * in ONE statement.
 *
 * ONE STATEMENT BECAUSE OF WHAT A CRASH BETWEEN TWO WOULD LEAVE. Marking the
 * charge paid and then dying would leave `next_charge_at` on the period we just
 * bought — the next sweep would come back for the same money. It could not
 * actually take it (the ledger row is `succeeded` and claimCharge refuses), but
 * the subscription would sit stuck forever with a paid period it never advanced
 * past. Doing both under one transaction removes the state; advanceFromCharge()
 * below is the repair path for the older rows that could already be in it.
 *
 * `status = 'active'` only when it was past_due: a successful charge is what
 * clears a past-due plan, and it must not overwrite anything else.
 * The immutability trigger permits status, the period window and next_charge_at
 * — none of them are terms.
 */
export async function settleSucceeded(db, { orgId, chargeId, providerRef = null, nextChargeAt, at = null } = {}) {
  required(orgId, "settleSucceeded: orgId");
  required(chargeId, "settleSucceeded: chargeId");
  required(nextChargeAt, "settleSucceeded: nextChargeAt");

  const res = await db.query(
    `WITH paid AS (
       UPDATE subscription_charges
          SET status         = 'succeeded',
              charged_at     = COALESCE(charged_at, COALESCE($3::timestamptz, now())),
              provider_ref   = COALESCE($4, provider_ref),
              failure_code   = NULL,
              failure_reason = NULL,
              next_retry_at  = NULL
        WHERE id = $2 AND org_id = $1 AND status = 'in_flight'
        RETURNING ${CHARGE_COLUMNS}
     ), advanced AS (
       UPDATE subscriptions s
          SET current_period_start = p.period_start,
              current_period_end   = p.period_end,
              next_charge_at       = $5::timestamptz,
              status               = CASE WHEN s.status = 'past_due' THEN 'active' ELSE s.status END
         FROM paid p
        WHERE s.id = p.subscription_id AND s.effective_to IS NULL
        RETURNING s.id
     )
     SELECT ${CHARGE_COLUMNS.split(",").map((c) => `p.${c.trim()}`).join(", ")},
            (SELECT count(*) FROM advanced) AS advanced_rows
       FROM paid p`,
    [orgId, chargeId, at, providerRef, nextChargeAt]
  );
  return res.rows[0] ?? null;
}

/**
 * settleFailed — the charge did not take.
 *
 * WHO GETS BLAMED IS THE DECISION HERE, and it is deliberately narrow:
 *   pastDue true  — the instrument declined, or the retries are spent. The
 *                   subscription's money state has genuinely changed.
 *   pastDue false — a timeout, a 500, an unreachable host. Nothing about the
 *                   customer changed, so nothing about the customer is written.
 *                   Only the ledger records the miss.
 * classifyChargeResult() in billing.mjs makes that call; this executes it.
 *
 * `next_charge_at` IS NOT MOVED on a failure. The period is still owed, so the
 * subscription stays due and the ledger row's backoff is what paces the retry.
 * Moving it would skip a period the customer never paid for.
 */
export async function settleFailed(db, {
  orgId, chargeId, failureCode = null, failureReason = null,
  retryAt = null, abandoned = false, pastDue = false
} = {}) {
  required(orgId, "settleFailed: orgId");
  required(chargeId, "settleFailed: chargeId");

  const res = await db.query(
    `WITH missed AS (
       UPDATE subscription_charges
          SET status         = CASE WHEN $5::boolean THEN 'abandoned' ELSE 'failed' END,
              failure_code   = $3,
              failure_reason = $4,
              next_retry_at  = CASE WHEN $5::boolean THEN NULL ELSE $6::timestamptz END
        WHERE id = $2 AND org_id = $1 AND status = 'in_flight'
        RETURNING ${CHARGE_COLUMNS}
     ), flagged AS (
       UPDATE subscriptions s
          SET status = 'past_due'
         FROM missed m
        WHERE s.id = m.subscription_id
          AND s.effective_to IS NULL
          AND s.status = 'active'
          AND $7::boolean
        RETURNING s.id
     )
     SELECT ${CHARGE_COLUMNS.split(",").map((c) => `m.${c.trim()}`).join(", ")},
            (SELECT count(*) FROM flagged) AS flagged_rows
       FROM missed m`,
    [orgId, chargeId, failureCode, failureReason, !!abandoned, retryAt, !!pastDue]
  );
  return res.rows[0] ?? null;
}

/**
 * advanceFromCharge — the repair path.
 *
 * A period whose ledger row says `succeeded` while the subscription still points
 * at it means the money moved and our follow-up write did not land. Advancing
 * the window costs nothing and takes nothing; leaving it stuck means a paid
 * customer whose plan never moves on.
 *
 * IDEMPOTENT AND NARROW. The `s.next_charge_at = c.period_start` predicate is
 * what makes a second call a no-op — once advanced, next_charge_at is the
 * period END and no longer matches. It also means this cannot skip a period: it
 * only ever moves a subscription off the exact period the charge paid for.
 */
export async function advanceFromCharge(db, { orgId, chargeId } = {}) {
  required(orgId, "advanceFromCharge: orgId");
  required(chargeId, "advanceFromCharge: chargeId");
  const res = await db.query(
    `UPDATE subscriptions s
        SET current_period_start = c.period_start,
            current_period_end   = c.period_end,
            next_charge_at       = c.period_end,
            status               = CASE WHEN s.status = 'past_due' THEN 'active' ELSE s.status END
       FROM subscription_charges c
      WHERE c.id = $2 AND c.org_id = $1 AND c.status = 'succeeded'
        AND s.id = c.subscription_id
        AND s.effective_to IS NULL
        AND s.next_charge_at = c.period_start
      RETURNING ${SUB_COLUMNS.split(",").map((x) => `s.${x.trim()}`).join(", ")}`,
    [orgId, chargeId]
  );
  return res.rows[0] ?? null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE MIRROR — writing down money COMMAS ALREADY TOOK.
   COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): payment rails and fee timing.

   Everything above this line is the rail that ASKS for money. The two
   functions below are the opposite: they record what a processor did on its
   own schedule, after it happened, because it told us so on a webhook. They
   call nobody, they claim nothing, and there is no path from either of them to
   a charge.

   THEY ARE THE ONLY WRITERS FOR A `commas_subscription` ROW, and claimCharge()
   refuses one, so the two shapes cannot be confused: an arrangement is either
   ours to bill or theirs to bill, and the provider column says which.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * recordProcessorCharge — one renewal Commas has already taken, written down.
 *
 * Returns { recorded, reason, charge, advanced }. `recorded: false` with a
 * charge attached is the normal answer to a replayed webhook, not a failure.
 *
 * WHAT MAKES A REPLAY SAFE. The bus redelivers, the dead-letter queue retries,
 * and a handler may run any number of times for one renewal. Two independent
 * guards, because they catch different things:
 *
 *   `already`     — a charge row on this subscription already carries THIS
 *                   provider reference (the processor's payment id). This is
 *                   the one that survives the period moving: a second run
 *                   reads an already-advanced subscription and would compute a
 *                   later period, so a period-only guard would happily insert a
 *                   row for a month nobody paid for.
 *   ON CONFLICT   — 276's UNIQUE (subscription_id, period_start), which is what
 *                   adjudicates two deliveries racing on the same period.
 *
 * THE PROVIDER REFERENCE IS THEREFORE REQUIRED. A renewal with no payment id
 * on it cannot be recorded safely, so it is refused and named rather than
 * written on a guessed anchor. NULL means unknown and must survive.
 *
 * THE PERIOD IS THE CALLER'S, and it must come off the subscription row (the
 * period after the one currently recorded), never off a clock. Commas charges
 * in advance on its cadence, the same shape 276's header describes for ours.
 *
 * ADVANCING IS IN THE SAME STATEMENT for the reason settleSucceeded() gives:
 * a crash between two statements would leave a recorded payment whose
 * arrangement never moved on. A past-due plan that pays goes back to active,
 * which is what `subscription.recovered` means.
 */
export async function recordProcessorCharge(db, {
  orgId, subscriptionId, periodStart, periodEnd, amountCents, currency = null,
  providerRef = null, provider = null, chargedAt = null, idempotencyKey = null
} = {}) {
  required(orgId, "recordProcessorCharge: orgId");
  required(subscriptionId, "recordProcessorCharge: subscriptionId");
  required(periodStart, "recordProcessorCharge: periodStart");
  required(periodEnd, "recordProcessorCharge: periodEnd");

  const ref = providerRef == null ? "" : String(providerRef).trim();
  if (!ref) {
    return {
      recorded: false,
      reason: "no_provider_ref",
      charge: null,
      advanced: false
    };
  }

  const cents = assertPriceCents(amountCents, "recordProcessorCharge: amountCents");
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new RangeError(
      `recordProcessorCharge: amountCents must be a positive integer — got ${JSON.stringify(amountCents)}`
    );
  }

  const key = String(
    idempotencyKey || `commas:sub:${subscriptionId}:payment:${ref}`
  ).trim();
  const cols = CHARGE_COLUMNS.split(",").map((c) => c.trim());
  const pick = (alias) => cols.map((c) => `${alias}.${c}`).join(", ");

  const res = await db.query(
    `WITH sub AS (
       SELECT id, org_id FROM subscriptions
        WHERE id = $2 AND org_id = $1 AND effective_to IS NULL
     ), already AS (
       SELECT ${CHARGE_COLUMNS} FROM subscription_charges
        WHERE org_id = $1 AND subscription_id = $2 AND provider_ref = $10
        ORDER BY period_start DESC LIMIT 1
     ), ins AS (
       INSERT INTO subscription_charges
         (org_id, subscription_id, idempotency_key, period_start, period_end,
          amount_cents, currency, status, attempt, provider, provider_ref, charged_at)
       SELECT s.org_id, s.id, $3, $4::timestamptz, $5::timestamptz,
              $6, COALESCE($7, 'USD'), 'succeeded', 1, COALESCE($8, 'commas_subscription'),
              $10, COALESCE($9::timestamptz, now())
         FROM sub s
        WHERE NOT EXISTS (SELECT 1 FROM already)
       ON CONFLICT (subscription_id, period_start) DO NOTHING
       RETURNING ${CHARGE_COLUMNS}
     ), advanced AS (
       UPDATE subscriptions s
          SET current_period_start = i.period_start,
              current_period_end   = i.period_end,
              status = CASE WHEN s.status = 'past_due' THEN 'active' ELSE s.status END
         FROM ins i
        WHERE s.id = i.subscription_id AND s.effective_to IS NULL
       RETURNING s.id
     ), conflicted AS (
       SELECT ${CHARGE_COLUMNS} FROM subscription_charges
        WHERE org_id = $1 AND subscription_id = $2 AND period_start = $4::timestamptz
     )
     SELECT ${pick("i")}, true AS recorded, 'recorded'::text AS outcome,
            (SELECT count(*) FROM advanced) AS advanced_rows
       FROM ins i
      UNION ALL
     SELECT ${pick("a")}, false AS recorded, 'already_recorded'::text AS outcome,
            0::bigint AS advanced_rows
       FROM already a WHERE NOT EXISTS (SELECT 1 FROM ins)
      UNION ALL
     SELECT ${pick("c")}, false AS recorded, 'period_already_recorded'::text AS outcome,
            0::bigint AS advanced_rows
       FROM conflicted c
      WHERE NOT EXISTS (SELECT 1 FROM ins) AND NOT EXISTS (SELECT 1 FROM already)`,
    [orgId, subscriptionId, key, periodStart, periodEnd, cents,
      currency, provider, chargedAt, ref]
  );

  const row = res.rows[0] ?? null;
  if (!row) {
    /* No live subscription with that id in that org — or another writer took
       this period between this statement's snapshot and now. Both mean the
       same thing to the caller: nothing was written here, and nothing should
       be retried blindly. */
    return { recorded: false, reason: "not_recorded", charge: null, advanced: false };
  }
  return {
    recorded: row.recorded === true,
    reason: row.recorded === true ? null : row.outcome,
    charge: row,
    advanced: Number(row.advanced_rows ?? 0) > 0
  };
}

/**
 * markProcessorPastDue — Commas says the card failed. Show it, change nothing
 * else.
 *
 * SCOPED TO PROCESSOR-BILLED ROWS ONLY, deliberately. Flipping a subscription
 * past_due is a money state other screens read, and the only thing entitled to
 * set it on our own rail is a real failed attempt with a ledger row behind it
 * (settleFailed above). This is the other rail's equivalent and it must not
 * become a general-purpose switch.
 *
 * IT DOES NOT MOVE THE PERIOD OR SCHEDULE ANYTHING. Commas owns the retries and
 * the dunning; if the customer fixes the card, `subscription.recovered` comes
 * back and recordProcessorCharge() returns the row to active. A cancelled row
 * is left alone — a cancellation already answered the question.
 */
export async function markProcessorPastDue(db, { orgId, subscriptionId } = {}) {
  required(orgId, "markProcessorPastDue: orgId");
  required(subscriptionId, "markProcessorPastDue: subscriptionId");
  const res = await db.query(
    `UPDATE subscriptions
        SET status = 'past_due'
      WHERE id = $2 AND org_id = $1
        AND effective_to IS NULL
        AND cancelled_at IS NULL
        AND status = 'active'
        AND lower(btrim(provider)) = ANY($3::text[])
      RETURNING ${SUB_COLUMNS}`,
    [orgId, subscriptionId, [...PROCESSOR_BILLED_PROVIDERS]]
  );
  return res.rows[0] ?? null;
}

/**
 * recordReversal — a chargeback, refund or bank reversal after the fact.
 *
 * OWNER-SET: A POST-PAYMENT REVERSAL IS FUNDHUB'S LOSS AND IS RECORDED, NEVER
 * RECOVERED. So this writes two fields and touches nothing else. It does not
 * re-open the period, does not move `next_charge_at`, does not flip the
 * subscription past_due, and there is no clawback column for it to write to
 * because there is no clawback anywhere in this product.
 *
 * Re-opening the period would be the worst of the available mistakes: the
 * period would become claimable again and the customer would be charged for it
 * a second time — the exact failure the ledger exists to prevent.
 *
 * COALESCE keeps the FIRST reversal time, the same call removeClientCard() makes
 * about removed_at: that date is what a dispute turns on and a second call must
 * not move it.
 */
export async function recordReversal(db, { orgId, chargeId, at = null, reason = null } = {}) {
  required(orgId, "recordReversal: orgId");
  required(chargeId, "recordReversal: chargeId");
  const res = await db.query(
    `UPDATE subscription_charges
        SET reversed_at     = COALESCE(reversed_at, COALESCE($3::timestamptz, now())),
            reversal_reason = COALESCE(reversal_reason, $4)
      WHERE id = $2 AND org_id = $1 AND status = 'succeeded'
      RETURNING ${CHARGE_COLUMNS}`,
    [orgId, chargeId, at, reason]
  );
  return res.rows[0] ?? null;
}

/** listCharges — the audit read for one subscription, newest period first. */
export async function listCharges(db, { orgId, subscriptionId, limit = 100 } = {}) {
  required(orgId, "listCharges: orgId");
  required(subscriptionId, "listCharges: subscriptionId");
  const cap = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : 100;
  const res = await db.query(
    `SELECT ${CHARGE_COLUMNS} FROM subscription_charges
      WHERE org_id = $1 AND subscription_id = $2
      ORDER BY period_start DESC LIMIT ${cap}`,
    [orgId, subscriptionId]
  );
  return res.rows;
}

/**
 * listStuckCharges — rows that called a processor and never came back.
 *
 * Nothing retries these. Somebody has to look at each one against
 * GET /payments/:id (src/payments/commas-api.mjs) and decide, because only that
 * lookup can answer whether the money moved. This is the read that stops them
 * being invisible.
 */
export async function listStuckCharges(db, { orgId = null, olderThan = null, limit = 100 } = {}) {
  const cap = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : 100;
  const res = await db.query(
    `SELECT ${CHARGE_COLUMNS} FROM subscription_charges
      WHERE status = 'in_flight'
        AND ($1::uuid IS NULL OR org_id = $1::uuid)
        AND updated_at <= COALESCE($2::timestamptz, now() - interval '30 minutes')
      ORDER BY updated_at ASC LIMIT ${cap}`,
    [orgId, olderThan]
  );
  return res.rows;
}

/**
 * scheduleBilling — switch a live subscription onto the rail.
 *
 * The ONLY way `next_charge_at` gets its first value, and it is deliberately an
 * explicit call rather than anything a migration or a signup flow does by
 * accident. Nothing existing is on the rail, and nothing joins it silently.
 *
 * REFUSES A ROW THAT IS NOT OTHERWISE BILLABLE, naming the reason — scheduling a
 * cancelled or unpriced subscription would create a row the sweeper picks up
 * every pass and can never charge.
 *
 * `billing_interval` is set only when it is NULL: 276's trigger permits
 * NULL → 'monthly' as first-time configuration and raises on a change, which is
 * the difference between switching billing on and rewriting what somebody
 * agreed to.
 */
export async function scheduleBilling(db, { orgId, subscriptionId, interval, firstChargeAt } = {}) {
  required(orgId, "scheduleBilling: orgId");
  required(subscriptionId, "scheduleBilling: subscriptionId");
  required(interval, "scheduleBilling: interval");
  required(firstChargeAt, "scheduleBilling: firstChargeAt");

  const found = await db.query(
    `SELECT ${SUB_COLUMNS} FROM subscriptions WHERE id = $1 AND org_id = $2`,
    [subscriptionId, orgId]
  );
  const sub = found.rows[0];
  if (!sub) throw new TypeError("scheduleBilling: no such subscription");

  // Check billability as it WILL be, so "not_scheduled"/"not_due" — the two
  // states this call is about to create — are not reported as refusals.
  const refusal = notBillableReason(
    { ...sub, billing_interval: sub.billing_interval ?? interval, next_charge_at: firstChargeAt },
    { now: firstChargeAt }
  );
  if (refusal) throw new TypeError(`scheduleBilling: this subscription cannot be billed — ${refusal}`);

  const res = await db.query(
    `UPDATE subscriptions
        SET next_charge_at   = $3::timestamptz,
            billing_interval = COALESCE(billing_interval, $4)
      WHERE id = $1 AND org_id = $2 AND effective_to IS NULL
      RETURNING ${SUB_COLUMNS}`,
    [subscriptionId, orgId, firstChargeAt, String(interval)]
  );
  return res.rows[0] ?? null;
}

export { planCharge, notBillableReason };

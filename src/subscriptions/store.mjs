// Subscriptions — the database half. The rules that must hold without a
// database live next door in index.mjs.
//
// THE ONE THING THIS MODULE WILL NOT DO IS CHARGE ANYTHING. There is no
// processor call here, no scheduler, no next-charge column to poll, and no
// HTTP handler. It records what a client is on and which instrument pays for
// it. A billing run is a payment-rail change and needs compliance review
// before a line of it exists.
//
// A PLAN CHANGE IS ONE STATEMENT, NOT TWO. changeTier() closes the live row and
// opens its successor inside a single data-modifying CTE, so there is no window
// in which a client has no subscription and no window in which they have two.
// The alternative — read, close, insert — needs a transaction, and the repo
// already carries three separate copies of a withTransaction helper. This needs
// none of them: the statement is atomic on its own, and the exclusion
// constraint from 075 is what actually adjudicates a race, not a check in JS.
//
// NOTHING HERE UPDATES A PRICE. The trigger in 075 raises if anything tries,
// which is deliberate belt-and-braces: this module is the sanctioned writer, and
// the database does not depend on it being the only one.

import {
  normalizeCardMeta, assertPriceCents, planChange
} from "./index.mjs";

/**
 * SubscriptionConflictError — "somebody else got here first", as a type a caller
 * can branch on rather than a sentence it would have to pattern-match.
 *
 * WHY A CLASS AND NOT JUST A BETTER MESSAGE (audit m11). Every refusal in this
 * module used to be a plain `Error`, and `netlify/functions/api.mjs:334` turns a
 * plain Error into HTTP 500 — "the server broke". Two of the refusals here are
 * not that: the client is not double-booked because of a fault, and a plan
 * change is not lost because of a fault. Both mean "the record moved under you,
 * look again", which is a 409 and a retry, not an incident.
 *
 * The shape is deliberately the one src/finance/soft-pulls.mjs:57 already uses —
 * a message plus a `status` — because api/finance/soft-pull.mjs:126 already
 * knows how to turn that into a response (`res.status(e.status)`), so the first
 * subscription endpoint to exist inherits the mapping instead of inventing a
 * second convention. There is no subscription endpoint yet; this is what one
 * will need on the day it is written, and it is testable now.
 */
export class SubscriptionConflictError extends Error {
  constructor(message, { status = 409 } = {}) {
    super(message);
    this.name = "SubscriptionConflictError";
    this.status = status;
  }
}

const SUB_COLUMNS = `
  id, org_id, client_id, tier, status, price_cents, currency, card_id,
  provider, provider_ref, current_period_start, current_period_end,
  cancelled_at, effective_from, effective_to, notes, created_at, updated_at`;

function required(value, name) {
  if (value == null || value === "") throw new TypeError(`${name} is required`);
  return value;
}

// ---------------------------------------------------------------------------
// client_cards — the payment instrument on file
// ---------------------------------------------------------------------------

/**
 * putClientCard — store or refresh one instrument. Idempotent on the token.
 *
 * THE UPSERT REFRESHES METADATA AND NOTHING ELSE. Two things it deliberately
 * does not do:
 *
 *   1. IT DOES NOT UN-REMOVE A CARD. Storing a token again is a metadata
 *      refresh — a processor re-sending what it holds. It is not a client
 *      saying "start charging this again", and treating it as one is how a
 *      removed instrument quietly comes back to life. removed_at is left
 *      exactly as it was.
 *   2. IT DOES NOT ERASE WHAT IT WAS NOT TOLD. COALESCE, not overwrite: a
 *      refresh that omits the brand does not blank the brand we already had.
 *      Absence is not a correction — the same call src/tradelines/store.mjs
 *      makes about a missing APR.
 *
 * A token already on file for a DIFFERENT client throws. The unique key is
 * (org_id, provider, provider_token), so without the client_id guard on the
 * DO UPDATE this call would quietly hand back another client's card row and the
 * caller would attach it to their subscription.
 */
export async function putClientCard(db, input = {}) {
  const orgId = required(input.orgId ?? input.org_id, "putClientCard: orgId");
  const clientId = required(input.clientId ?? input.client_id, "putClientCard: clientId");
  const meta = normalizeCardMeta(input);   // throws on a PAN, a CVV, a long last4

  const res = await db.query(
    `INSERT INTO client_cards
       (org_id, client_id, provider, provider_token, brand, last4, exp_month, exp_year)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (org_id, provider, provider_token) DO UPDATE SET
       brand      = COALESCE(EXCLUDED.brand,     client_cards.brand),
       last4      = COALESCE(EXCLUDED.last4,     client_cards.last4),
       exp_month  = COALESCE(EXCLUDED.exp_month, client_cards.exp_month),
       exp_year   = COALESCE(EXCLUDED.exp_year,  client_cards.exp_year),
       updated_at = now()
     WHERE client_cards.client_id = EXCLUDED.client_id
     RETURNING *`,
    [orgId, clientId, meta.provider, meta.provider_token,
      meta.brand, meta.last4, meta.exp_month, meta.exp_year]
  );

  if (!res.rows[0]) {
    throw new Error(
      "putClientCard: that token is already on file for a different client — a payment instrument belongs to one client"
    );
  }
  return res.rows[0];
}

/** listClientCards — a client's instruments. Usable ones by default; the
 *  removed ones are still readable because a subscription that charged one
 *  must stay explainable. */
export async function listClientCards(db, { orgId, clientId, includeRemoved = false } = {}) {
  required(orgId, "listClientCards: orgId");
  required(clientId, "listClientCards: clientId");
  const res = await db.query(
    `SELECT * FROM client_cards
      WHERE org_id = $1 AND client_id = $2
        AND ($3::boolean OR removed_at IS NULL)
      ORDER BY removed_at NULLS FIRST, created_at DESC`,
    [orgId, clientId, includeRemoved]
  );
  return res.rows;
}

/**
 * removeClientCard — retire an instrument. Never deletes: a card that paid for
 * something has to stay resolvable from the subscription that used it, and 076's
 * foreign key is ON DELETE RESTRICT precisely so a DELETE cannot orphan one.
 *
 * COALESCE on removed_at keeps the FIRST removal time. Re-removing must not
 * move the date, because that date is the answer to "when did they take it off
 * file", which is a question a chargeback turns on.
 */
export async function removeClientCard(db, { orgId, id, at = null } = {}) {
  required(orgId, "removeClientCard: orgId");
  required(id, "removeClientCard: id");
  const res = await db.query(
    `UPDATE client_cards
        SET removed_at = COALESCE(removed_at, COALESCE($3::timestamptz, now()))
      WHERE org_id = $1 AND id = $2
      RETURNING *`,
    [orgId, id, at]
  );
  return res.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// subscriptions
// ---------------------------------------------------------------------------

/**
 * startSubscription — open the first version of an arrangement.
 *
 * No check-then-insert on "does this client already have one". The exclusion
 * constraint in 075 answers that at write time, which is the only place a
 * double-submitted signup can be caught; a SELECT here would just widen the
 * window it races in.
 *
 * What the constraint raises is SQLSTATE 23P01 carrying the constraint name
 * `subscriptions_no_overlap`, and nothing above this reads that code, so it
 * reached the caller verbatim. The rejection is right; the wording was not.
 * This turns it into the same kind of sentence attachCard gives, without
 * softening what is refused.
 */
export async function startSubscription(db, input = {}) {
  const orgId = required(input.orgId ?? input.org_id, "startSubscription: orgId");
  const clientId = required(input.clientId ?? input.client_id, "startSubscription: clientId");
  const tier = String(required(input.tier, "startSubscription: tier")).trim();
  if (!tier) throw new TypeError("startSubscription: tier is required");

  const priceCents = assertPriceCents(
    input.priceCents ?? input.price_cents ?? null, "startSubscription: priceCents"
  );

  let res;
  try {
    res = await db.query(
      `INSERT INTO subscriptions
       (org_id, client_id, tier, status, price_cents, currency, card_id,
        provider, provider_ref, current_period_start, current_period_end,
        effective_from, notes)
     VALUES ($1, $2, $3, COALESCE($4, 'active'), $5, COALESCE($6, 'USD'), $7,
             COALESCE($8, 'commas'), $9, $10, $11,
             COALESCE($12::timestamptz, now()), $13)
     RETURNING ${SUB_COLUMNS}`,
      [orgId, clientId, tier, input.status ?? null, priceCents, input.currency ?? null,
        input.cardId ?? input.card_id ?? null, input.provider ?? null,
        input.providerRef ?? input.provider_ref ?? null,
        input.periodStart ?? input.current_period_start ?? null,
        input.periodEnd ?? input.current_period_end ?? null,
        input.at ?? null, input.notes ?? null]
    );
  } catch (err) {
    if (err?.code === "23P01" && err?.constraint === "subscriptions_no_overlap") {
      // Same sentence as before; it is now carried by the shared conflict type so
      // a caller gets a 409 out of it instead of a 500. See the class above.
      throw new SubscriptionConflictError(
        "startSubscription: this client already has a subscription covering that date — "
        + "cancel or close the current one first"
      );
    }
    throw err;
  }
  return res.rows[0];
}

/**
 * getSubscriptionAt — the version in force at a moment. Omit `at` for the live
 * one.
 *
 * Half-open [effective_from, effective_to) so that the instant of a plan change
 * resolves to exactly one version — the new one — rather than to both or
 * neither.
 */
export async function getSubscriptionAt(db, { orgId, clientId, at = null } = {}) {
  required(orgId, "getSubscriptionAt: orgId");
  required(clientId, "getSubscriptionAt: clientId");
  const res = await db.query(
    `SELECT ${SUB_COLUMNS} FROM subscriptions
      WHERE org_id = $1 AND client_id = $2
        AND effective_from <= COALESCE($3::timestamptz, now())
        AND (effective_to IS NULL OR effective_to > COALESCE($3::timestamptz, now()))
      ORDER BY effective_from DESC
      LIMIT 1`,
    [orgId, clientId, at]
  );
  return res.rows[0] ?? null;
}

/** listSubscriptions — the whole version chain, newest first. This is the audit
 *  read: what was this client paying, and when. */
export async function listSubscriptions(db, { orgId, clientId } = {}) {
  required(orgId, "listSubscriptions: orgId");
  required(clientId, "listSubscriptions: clientId");
  const res = await db.query(
    `SELECT ${SUB_COLUMNS} FROM subscriptions
      WHERE org_id = $1 AND client_id = $2
      ORDER BY effective_from DESC, created_at DESC`,
    [orgId, clientId]
  );
  return res.rows;
}

/**
 * changeTier — close the live version and open its successor, atomically.
 *
 * The two halves of the statement do different jobs on purpose:
 *
 *   TERMS come from planChange() — validated in JS so the caller gets a message
 *   naming the wrong value instead of a constraint name.
 *
 *   BINDINGS (card_id, provider, provider_ref) are copied from the row being
 *   closed INSIDE the SQL, not from the row read a moment ago. A card swap that
 *   landed between the read and the write would otherwise be reverted by this
 *   call, silently, and the client would be charged on the card they replaced.
 *
 * The new version's period window is deliberately left NULL unless the caller
 * passes one: what a mid-period upgrade owes is a fee-timing decision, and
 * carrying the old window forward would assert an answer to it.
 *
 * Returns the new live row. The closed one is in listSubscriptions().
 */
export async function changeTier(db, input = {}) {
  const orgId = required(input.orgId ?? input.org_id, "changeTier: orgId");
  const clientId = required(input.clientId ?? input.client_id, "changeTier: clientId");
  const at = input.at ?? new Date();

  const current = await getSubscriptionAt(db, { orgId, clientId });
  const terms = planChange(current, {
    tier: input.tier,
    price_cents: input.priceCents ?? input.price_cents,
    currency: input.currency
  }, at);

  const res = await db.query(
    `WITH closed AS (
       UPDATE subscriptions
          SET effective_to = $3::timestamptz
        WHERE org_id = $1 AND client_id = $2 AND effective_to IS NULL
        RETURNING *
     )
     INSERT INTO subscriptions
       (org_id, client_id, tier, status, price_cents, currency, card_id,
        provider, provider_ref, current_period_start, current_period_end,
        effective_from, notes)
     SELECT c.org_id, c.client_id, $4, 'active', $5, $6, c.card_id,
            c.provider, c.provider_ref, $7, $8, $3::timestamptz, $9
       FROM closed c
     RETURNING ${SUB_COLUMNS}`,
    [orgId, clientId, terms.effective_from, terms.tier, terms.price_cents, terms.currency,
      input.periodStart ?? input.current_period_start ?? null,
      input.periodEnd ?? input.current_period_end ?? null,
      input.notes ?? null]
  );

  if (!res.rows[0]) {
    // THE ONLY BRANCH HERE THAT TWO PEOPLE EDITING AT ONCE CAN REACH (audit m11).
    // getSubscriptionAt() found a live row a moment ago and planChange() refuses
    // to go any further without one, so reaching this line means the row was
    // closed or cancelled between that read and this write. Nothing was written:
    // the INSERT selects FROM the UPDATE, so an empty UPDATE inserts nothing and
    // there is no half-applied change to unpick.
    //
    // It used to be a plain Error, which api.mjs:334 renders as HTTP 500 — the
    // caller is told the server broke when what actually happened is that
    // somebody else changed the same subscription first. Typed as a conflict so
    // the answer is 409 and "look again", and worded for the person who has to
    // read it (CLAUDE.md §10) rather than for the engineer who wrote it.
    throw new SubscriptionConflictError(
      "changeTier: somebody else changed this subscription while you were changing it — "
      + "nothing was saved. Reload the client and try again."
    );
  }
  return res.rows[0];
}

/**
 * cancelSubscription — record that the client ended it.
 *
 * cancelled_at AND effective_to ARE NOT THE SAME DATE and this call keeps them
 * apart. cancelled_at is when they asked. effective_to is when the arrangement
 * stops applying, which for a cancellation that runs to the end of a paid period
 * is later — and until then the row is still live and still explains the charge
 * the client already made. Pass `endsAt` when that date is known; omit it and
 * effective_to defaults to the cancel time, closing the row.
 *
 * A cancelled row MUST have an effective_to, because the database overlap
 * constraint (075:241) checks only dates, not status. A row with NULL
 * effective_to is treated as open-ended and blocks every future subscription
 * overlapping its start date, making resigning impossible. Confirmed: a client
 * who cancels cannot create a new subscription with default parameters.
 *
 * Idempotent: cancelling twice keeps the first date. A second call must not
 * move the date a dispute turns on.
 *
 * Closing the row is what makes the second call need the `already` branch. The
 * UPDATE finds live rows (effective_to IS NULL) and the first call closes this
 * one, so a retry matches nothing and would report "no such subscription" for a
 * subscription that is sitting right there, already cancelled. The read hands
 * the same row back untouched instead. It is a read, so it cannot move a date;
 * a caller that genuinely has nothing to cancel still gets null.
 */
export async function cancelSubscription(db, { orgId, clientId, at = null, endsAt = null } = {}) {
  required(orgId, "cancelSubscription: orgId");
  required(clientId, "cancelSubscription: clientId");
  const cancelledAt = at ? new Date(at) : new Date();
  const closingAt = endsAt ? new Date(endsAt) : cancelledAt;
  const res = await db.query(
    `WITH cancelled AS (
       UPDATE subscriptions
          SET status       = 'cancelled',
              cancelled_at = COALESCE(cancelled_at, $3::timestamptz),
              effective_to = COALESCE(effective_to, $4::timestamptz)
        WHERE org_id = $1 AND client_id = $2 AND effective_to IS NULL
        RETURNING ${SUB_COLUMNS}
     ), already AS (
       SELECT ${SUB_COLUMNS} FROM subscriptions
        WHERE org_id = $1 AND client_id = $2 AND cancelled_at IS NOT NULL
        ORDER BY effective_from DESC, created_at DESC
        LIMIT 1
     )
     SELECT * FROM cancelled
      UNION ALL
     SELECT * FROM already WHERE NOT EXISTS (SELECT 1 FROM cancelled)`,
    [orgId, clientId, cancelledAt, closingAt]
  );
  return res.rows[0] ?? null;
}

/**
 * attachCard — point the live subscription at an instrument.
 *
 * A card change is NOT a plan change: the client is paying the same price for
 * the same tier, so this updates the live row rather than opening a version.
 * 075's immutability trigger allows exactly this and refuses the terms.
 *
 * The join is the guard. The card must exist, belong to the same org AND the
 * same client, and not be removed — so a removed card cannot be re-pointed at,
 * and one client's card can never end up on another's subscription. (076's
 * composite foreign key enforces the client half at the storage layer too; this
 * is what turns it into an error message instead of a constraint name.)
 */
export async function attachCard(db, { orgId, clientId, cardId } = {}) {
  required(orgId, "attachCard: orgId");
  required(clientId, "attachCard: clientId");
  required(cardId, "attachCard: cardId");
  const res = await db.query(
    `UPDATE subscriptions s
        SET card_id = c.id
       FROM client_cards c
      WHERE c.id = $3 AND c.org_id = $1 AND c.client_id = $2 AND c.removed_at IS NULL
        AND s.org_id = $1 AND s.client_id = $2 AND s.effective_to IS NULL
      RETURNING ${SUB_COLUMNS.split(",").map((c) => `s.${c.trim()}`).join(", ")}`,
    [orgId, clientId, cardId]
  );
  if (!res.rows[0]) {
    throw new Error(
      "attachCard: no live subscription, or that card is removed or belongs to another client"
    );
  }
  return res.rows[0];
}

// /api/finance/subscriptions — the plan a client is on, and the version chain
// behind it.
//
//   GET  ?client_id=<uuid>                     → { ok, current, history }
//   POST { action: "start",   client_id, tier, price_cents, currency?, notes? }
//   POST { action: "change",  client_id, tier, price_cents, currency?, notes? }
//   POST { action: "cancel",  client_id, at?, ends_at? }
//
// *** SCAFFOLD STUB — TRACK 1 OWNS THIS FILE. ***
// The auth, the role gate, the org scoping, the method switch and the error
// mapping below are FINISHED and are the contract. Track 1 replaces the bodies
// marked `not_implemented` and nothing else. Do not widen SUBSCRIPTION_ROLES and
// do not take org_id or client ownership from the request — see below.
//
// THE MODULE BEHIND THIS DOES NOT CHARGE ANYBODY. src/subscriptions/store.mjs
// opens with that sentence and means it: there is no processor call, no
// scheduler and no billing run anywhere behind this endpoint. Starting a
// subscription here RECORDS what a client is on. A billing run is a payment-rail
// change and needs compliance review before a line of it exists.
//
// ORG COMES FROM THE SESSION, ALWAYS. Every store function in
// src/subscriptions/store.mjs takes `orgId` as a required argument and throws
// without one, so the only question this file answers is WHERE that value comes
// from. It comes from `staff.org_id` and from nowhere else. A body field that
// chose the org would file one company's subscription — and one company's price
// — in another company's table, which is the same class of hole api/shifts.mjs
// refuses a body `org_id` to avoid.
//
// AND THE CLIENT MUST BE IN THAT ORG. An org-scoped write with an unchecked
// client_id still writes a row about a person this company has no relationship
// with. ownsClient() below is the same check api/finance/soft-pull.mjs:144
// makes, for the same reason, and it is not optional.
//
// SubscriptionConflictError CARRIES ITS OWN STATUS (409). Two of the refusals in
// the store are "the record moved under you, look again" and not "the server
// broke"; without the mapping in the catch below they would reach the caller as
// a 500 through netlify/functions/api.mjs:334. See the class docblock at
// src/subscriptions/store.mjs:44.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import {
  SubscriptionConflictError,
  getSubscriptionAt, listSubscriptions,
  startSubscription, changeTier, cancelSubscription
} from "../../src/subscriptions/store.mjs";
import { priceToCents, assertPriceCents, formatPrice } from "../../src/subscriptions/index.mjs";

/* ROLE_SETS.FINANCE — {owner, admin}. A subscription row carries a price, and
   price is comp-adjacent money the STAFF set does not see anywhere else in this
   API. Widening this is a decision with a sentence attached, not a convenience.
   Whatever it becomes, the screen's row in public/app/shell.js OWNER_ADMIN_ONLY
   has to move with it or the app offers a screen its data refuses. */
const SUBSCRIPTION_ROLES = ROLE_SETS.FINANCE;

/* Fields the session owns. Present in a body ⇒ 400, never merged, never
   silently dropped — api/shifts.mjs:44 explains why ignoring beats nothing and
   refusing beats ignoring. */
const SESSION_OWNED = ["org_id", "orgId"];
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(Object(o ?? {}), k);

/* THE WIRE SPEAKS DOLLARS; THE COLUMN SPEAKS INTEGER CENTS. The conversion
   happens exactly once, here, at the boundary — the rule money.mjs's header
   states and the rule src/calculators/* breaks by speaking dollars all the way
   down. `price` is a decimal the screen's <input> produced ("49.00"). Nothing
   below this line ever sees a float.

   AND AN ABSENT PRICE IS NOT A NULL PRICE. Three distinct inputs, three
   distinct answers, because collapsing any two of them writes a number nobody
   chose:

     neither key present  → undefined → "I am not saying anything about price"
     price: "" or null    → null      → "nobody has recorded what this costs"
     price: "49.00"       → 4900      → 49 dollars

   priceToCents() exists for the middle case: money.toCents() maps null to 0,
   which is right for "no payments yet" and catastrophic here — it would file a
   subscription whose price nobody knows as a FREE plan, and free is a claim.
   See src/subscriptions/index.mjs:168.

   Both spellings are accepted because both arrive: a screen posts `price` in
   dollars, a script or a later integration posts `price_cents` already
   converted. Sending both is refused rather than resolved — a caller who sends
   49 and 4901 has a bug, and picking one of them for them hides it. */
function readPriceCents(body, where) {
  const hasDollars = hasOwn(body, "price");
  const hasCents = hasOwn(body, "price_cents");
  if (hasDollars && hasCents) {
    throw new TypeError(
      `${where}: send price (dollars) or price_cents (integer cents), not both — they can disagree`
    );
  }
  if (hasCents) {
    const raw = body.price_cents;
    if (raw === null || raw === "") return null;
    return assertPriceCents(raw, `${where}: price_cents`);
  }
  if (hasDollars) return priceToCents(body.price);   // null-preserving, throws on junk
  return undefined;
}

/* withPrice — the row as the screen needs to read it.

   `price_display` is the 2dp STRING money.fromCents() produces, computed here
   and never in the browser: 19.90 as a JavaScript float is not 19.90, and a
   screen that formats money is a second implementation of how money looks. It
   is null when price_cents is null, and the screen renders a null as an em dash
   — not "0.00". "We do not know what this costs" and "this costs nothing" are
   different facts about someone's money and only one of them is a claim.

   price_cents crosses the wire too: it arrives from a bigint column as a STRING
   in node-postgres, so anything comparing it must Number() it first. */
function withPrice(row) {
  if (!row) return null;
  return { ...row, price_display: formatPrice(row.price_cents) };
}

export default async function handler(req, res) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  // A SECOND CALL, DELIBERATELY. requireAuth forwards opts to authenticate(),
  // which reads only { db, env } — passing { roles } to it does nothing at all
  // and has already shipped one hole (see the read/tradelines note in
  // netlify/functions/api.mjs:114). The gate is this line.
  if (!requireRole(res, staff, SUBSCRIPTION_ROLES)) return;

  const orgId = staff.org_id ?? null;
  if (!orgId) {
    // FAIL CLOSED. A session with no company cannot be scoped to one, and the
    // alternatives are both worse: picking a default org files the row under
    // the wrong company, and omitting the filter reads every company's rows.
    return res.status(403).json({ ok: false, error: "org_required" });
  }

  try {
    if (req.method === "GET") {
      const q = req.query || {};
      if (!isUuid(q.client_id)) {
        return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
      }
      if (!(await ownsClient(orgId, q.client_id))) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }
      const clientId = String(q.client_id).trim();

      /* TWO READS, NOT ONE, AND `current` IS NOT DERIVED FROM `history`.
         getSubscriptionAt() resolves the live version with the half-open
         [effective_from, effective_to) window that matches the exclusion
         constraint in 075 — the instant of a plan change belongs to exactly one
         version, the new one. Re-deriving that in this file (or in the browser,
         with `history[0]`) would be a second answer to the same question, and
         `history[0]` is wrong the moment a change is recorded with a future
         effective date: the newest row by effective_from is not necessarily the
         one in force now. The store decides; this file reports. */
      const current = await getSubscriptionAt(db, { orgId, clientId });
      const history = await listSubscriptions(db, { orgId, clientId });

      return res.status(200).json({
        ok: true,
        client_id: clientId,
        current: withPrice(current),
        history: history.map(withPrice)
      });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      for (const field of SESSION_OWNED) {
        if (hasOwn(body, field)) {
          return res.status(400).json({ ok: false, error: `${field}_not_accepted` });
        }
      }
      if (!isUuid(body.client_id)) {
        return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
      }
      if (!(await ownsClient(orgId, body.client_id))) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }

      const clientId = String(body.client_id).trim();

      switch (body.action) {
        case "start": {
          /* RECORDING, NOT CHARGING. This opens the first version of an
             arrangement and stops. There is no processor call behind it (see
             the header, and src/subscriptions/store.mjs:4), so "start" means
             "write down what this client is on" and the screen says so in those
             words rather than implying money moved.

             No check-then-insert on "do they already have one": the exclusion
             constraint answers that at write time, and the store turns SQLSTATE
             23P01 into a sentence a person can act on. The catch below carries
             that sentence out as a 409 — the caller sees "this client already
             has a subscription covering that date", not a constraint name. */
          const sub = await startSubscription(db, {
            orgId,
            clientId,
            tier: body.tier,
            priceCents: readPriceCents(body, "start"),
            currency: body.currency ?? null,
            provider: body.provider ?? null,
            cardId: body.card_id ?? null,
            periodStart: body.period_start ?? null,
            periodEnd: body.period_end ?? null,
            at: body.at ?? null,
            notes: body.notes ?? null
          });
          return res.status(200).json({ ok: true, action: "start", subscription: withPrice(sub) });
        }

        case "change": {
          /* ONE STATEMENT CLOSES THE OLD VERSION AND OPENS THE NEW ONE. This
             handler must not "helpfully" split that into a cancel plus a start:
             changeTier() does both halves inside a single data-modifying CTE
             precisely so there is no instant in which the client is on two
             plans or none (store.mjs:10). Two calls from here would reopen that
             window and the card binding would be copied from a row read a
             moment ago rather than from the row actually being closed.

             AN EXPLICIT NULL PRICE IS REFUSED HERE RATHER THAN MISREPORTED.
             changeTier reads `input.priceCents ?? input.price_cents`, so a
             deliberate null falls through to undefined and planChange carries
             the CURRENT price forward — the caller asks for "price unknown" and
             silently gets the old price on the new version. That is a number
             nobody chose sitting on a live subscription, so it is a 400 with
             the reason, not a quiet substitution. Omitting the field entirely
             still carries the price forward, which is what omission means. */
          const priceCents = readPriceCents(body, "change");
          if (priceCents === null) {
            return res.status(400).json({
              ok: false,
              error: "a plan change cannot record an unknown price — send the new price, "
                   + "or omit the field to keep the current one"
            });
          }
          const sub = await changeTier(db, {
            orgId,
            clientId,
            tier: body.tier,
            priceCents,
            currency: body.currency ?? null,
            periodStart: body.period_start ?? null,
            periodEnd: body.period_end ?? null,
            at: body.at ?? null,
            notes: body.notes ?? null
          });
          return res.status(200).json({ ok: true, action: "change", subscription: withPrice(sub) });
        }

        case "cancel": {
          /* TWO DATES, AND THEY ARE NOT THE SAME DATE. `at` is when the client
             asked (cancelled_at). `ends_at` is when the arrangement stops
             applying (effective_to) — later, for a cancellation that runs to
             the end of a paid period, and until then the row is still live and
             still explains the charge the client already made.

             Omitting ends_at closes the row at the cancel time. It must close:
             a cancelled row with a NULL effective_to reads as open-ended to the
             overlap constraint and blocks every future signup for that client
             forever (audit M16, fixed in the store — do not regress it by
             passing an ends_at this endpoint invented). */
          const sub = await cancelSubscription(db, {
            orgId,
            clientId,
            at: body.at ?? null,
            endsAt: body.ends_at ?? null
          });
          if (!sub) {
            // Not an error and not a success-with-nothing: this client has no
            // subscription to cancel, which the screen has to be able to say.
            return res.status(404).json({ ok: false, error: "no subscription to cancel" });
          }
          return res.status(200).json({ ok: true, action: "cancel", subscription: withPrice(sub) });
        }

        default:
          return res.status(400).json({ ok: false, error: "invalid_action" });
      }
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    // The store says what the status is, because it is the only thing that
    // knows which rule was broken. 409 means "somebody else got here first".
    if (e instanceof SubscriptionConflictError) {
      return res.status(e.status).json({ ok: false, error: e.message });
    }
    if (e instanceof TypeError) {
      // The store's required() throws TypeError for a missing argument. That is
      // the CALLER's omission, not a fault.
      return res.status(400).json({ ok: false, error: String(e.message).slice(0, 200) });
    }
    /* RangeError WAS MISSING FROM THIS MAP AND IT IS THE COMMONEST BAD INPUT ON
       THIS ENDPOINT. Three of the guards behind it throw RangeError, not
       TypeError, for a value the caller sent: assertPriceCents() on a negative
       price (index.mjs:189), planChange() on a change dated at or before the
       current version started (index.mjs:256), and toCents() on an amount past
       MAX_CENTS. Without this branch each of them left this handler as an
       unhandled throw, which netlify/functions/api.mjs:334 renders as HTTP 500
       "internal_error" — the owner types "-49" in a price box and the app tells
       them the server broke. It is a 400 with the sentence that names the value.
       The rest of the map was already right; this line is the gap in it. */
    if (e instanceof RangeError) {
      return res.status(400).json({ ok: false, error: String(e.message).slice(0, 200) });
    }
    if (CLIENT_DATA_ERRORS.has(e && e.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    /* THE DATABASE'S OWN REFUSALS, IN THE TWO CLASSES THEY ACTUALLY FALL INTO.
       The store maps 23P01 for the one path it raises on (startSubscription's
       overlap); these are the safety net for every other statement, so a rule
       enforced only in SQL still reaches the caller as an answer instead of an
       incident.

         23P01 exclusion_violation — two versions covering one instant. Somebody
               else got there first: 409, look again.
         23505 unique_violation    — 075:213 makes provider_ref unique across
               live rows, so this is "that processor reference is already on a
               live subscription". Also a conflict, not a fault.
         23514 check_violation     — a value the column refuses: a blank tier, a
               status outside the three allowed, a period window that ends
               before it starts. The caller's value, so 400.
         23503 foreign_key_violation — a card_id or client_id that is not there.

       The constraint NAME is not returned. It is not a sentence, and the two
       cases a person can act on already carry one. */
    if (e && (e.code === "23P01" || e.code === "23505")) {
      return res.status(409).json({
        ok: false,
        error: "somebody else changed this subscription while you were changing it — "
             + "nothing was saved. Reload the client and try again."
      });
    }
    if (e && (e.code === "23514" || e.code === "23503")) {
      return res.status(400).json({ ok: false, error: "the database refused that value" });
    }
    throw e;
  }
}

/* ownsClient — this company's client, or nobody's. The org is CHECKED against
   the clients table rather than assumed from the caller having sent an id.
   Same shape as api/finance/soft-pull.mjs:144. */
async function ownsClient(orgId, clientId) {
  const r = await db.query(
    `SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`,
    [String(clientId).trim(), orgId]
  );
  return r.rows.length > 0;
}

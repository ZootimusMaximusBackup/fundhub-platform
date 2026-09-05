// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7) — fee timing and payment rail.
// This module is the whole of the self-serve paid round on the server side:
// what it costs, who may buy one, what happens when the money lands.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT A PAID ROUND IS, AND WHAT IT IS NOT
//
// Owner-set. It is NOT "mail the letters we already wrote". A client presses
// this when they have stalled or when new damage has appeared, so the request
// path is: price it → take payment → RE-PULL the file → build a dispute off the
// freshest data and the client's own submission history.
//
// That ordering is the product. A round built from a report we pulled in
// January and mailed in April disputes things that may already be gone, which
// is both useless and the kind of letter a bureau learns to ignore.
//
// ═══════════════════════════════════════════════════════════════════════════
// TWO INVARIANTS THIS FILE DOES NOT TOUCH
//
// 1. NO SILENT CARD CAPTURE. src/subscriptions/charger.mjs:25 is an empty
//    charger map and :88 is a second env lock. Payment happens on a HOSTED
//    CHECKOUT LINK (src/paid-services/checkout.mjs) and nowhere else. Nothing
//    in this file reads or stores a card.
//
// 2. PAYMENT STAGES THE MAIL. IT DOES NOT SEND IT. src/metro2/delivery/send.mjs:3
//    and api/repair/send.mjs:3 both forbid mailing from payment.received, in
//    those words. So `paid` → `staged` here means "the fresh report is ordered
//    and this is on a human's board", and NOTHING in this module calls a mail
//    function, imports one, or emits an event that one listens to. A staff
//    member still presses send in the existing screen.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE TWO COUNTERS ARE INDEPENDENT
//
// `repair_programs.rounds_cap` counts what the client BOUGHT with their program.
// `paid_service_requests.round_no` counts what they have bought a la carte. A
// paid round does not consume a cap round — owner-set — and the enforcement is
// structural: db/migrations/331 gives the table no column referencing
// repair_programs, and no query in this file reads, writes or joins the cap.
//
// ═══════════════════════════════════════════════════════════════════════════
// IDEMPOTENCY: A DOUBLE PRESS IS ONE ROW AND ONE CHARGE
//
// Three layers, in this order, because the first two can both be beaten by a
// genuine race and the third cannot:
//
//   1. openRoundFor() — a read. Catches the ordinary second press, seconds
//      apart, and gives the client the row they already have.
//   2. A derived idempotency key `paid_round:<clientId>:r<n>`, so two presses
//      that both slip past (1) build the SAME key rather than two.
//   3. The database. uq_paid_service_requests_idem and
//      uq_paid_service_requests_round_no (both in 331) adjudicate the tie. The
//      loser re-reads and is handed the winner's row with `created: false`.
//
// AND THE CHARGE FOLLOWS THE ROW. The checkout link is minted ONLY when
// `created === true`. A loser never reaches the processor, so one press to a
// row is also one row to a link. This is the part that actually prevents the
// double charge; the guards above only prevent the double row.
//
// This is the shape src/finance/soft-pulls.mjs:267 gave the soft-pull double
// tap, copied rather than reinvented. What is NOT copied is
// src/handlers/money-chain.mjs:396, which dedupes transactions by
// check-then-write on provider_ref with no unique index behind it — that is
// racy and it is not a pattern.

import {
  requestPaidService,
  nextSelfServeRoundNo,
  WaypointError
} from "../waypoints/store.mjs";
import { priceDisputeRound, sumComponents } from "../waypoints/pricing.mjs";
import { onRepairPath } from "../repair/on-repair-path.mjs";
import { negativeKeysFromResult } from "../crs/snapshot-negatives.mjs";
import { requestSoftPull } from "../finance/soft-pulls.mjs";
import { mintCheckoutLink } from "./checkout.mjs";
import { REFUSAL, refuse } from "./refusals.mjs";

export const SERVICE_KIND = "dispute_round";
export const SERVICE_KEY = "paid_round";

/** Statuses that mean "this request is still going somewhere". A second press
 *  while one of these is on file is refused. `failed`, `cancelled`, `refunded`
 *  and `fulfilled` are all finished, and none of them blocks a new request. */
export const OPEN_STATUSES = Object.freeze([
  "quoted", "awaiting_payment", "paid", "staged"
]);

/** Postgres unique-violation. */
const UNIQUE_VIOLATION = "23505";

/* ── pricing ─────────────────────────────────────────────────────────────── */

/**
 * quoteRound — the receipt, with no side effect and no database.
 *
 * Owner-set: $100 base covering all three bureaus, +$10 creditor letter,
 * +$20 CFPB and state attorney general. Integer cents throughout — the
 * arithmetic lives in src/waypoints/pricing.mjs and is not repeated here.
 */
export function quoteRound({ creditorLetter = false, escalationFilings = false } = {}) {
  const { components, totalCents } = priceDisputeRound({ creditorLetter, escalationFilings });
  return { components, totalCents };
}

/** The price list a screen renders before anything is bought.
 *
 *  The `key` and `priceCents` are the facts. `label` is a short receipt line
 *  and is here because the orchestrator's contract for
 *  /api/read/client-progress carries one — it names the add-on, it is not
 *  marketing copy, and the sentences around the button still live in the front
 *  end. Owner-set branding applies to it like everything else client-facing.
 *
 *  Each add-on's price is derived by SUBTRACTION from the priced round rather
 *  than restated as a constant, so this list cannot drift away from what a
 *  client is actually charged. */
export function roundPriceList() {
  const base = priceDisputeRound({});
  const withCreditor = priceDisputeRound({ creditorLetter: true });
  const withEscalation = priceDisputeRound({ escalationFilings: true });
  return [
    {
      key: "base",
      label: "Three bureaus",
      priceCents: base.totalCents,
      required: true
    },
    {
      key: "creditor",
      label: "Creditor letter",
      priceCents: withCreditor.totalCents - base.totalCents,
      required: false
    },
    {
      key: "cfpb_and_ag",
      label: "CFPB and state attorney general",
      priceCents: withEscalation.totalCents - base.totalCents,
      required: false
    }
  ];
}

/* ── eligibility ─────────────────────────────────────────────────────────── */

/** The open request for this client, or null. */
export async function openRoundFor(db, { orgId, clientId } = {}) {
  if (!orgId || !clientId) return null;
  const r = await db.query(
    `SELECT * FROM paid_service_requests
      WHERE org_id = $1::uuid AND client_id = $2::uuid
        AND service_kind = $3
        AND status = ANY($4::text[])
      ORDER BY requested_at DESC
      LIMIT 1`,
    [orgId, clientId, SERVICE_KIND, OPEN_STATUSES]
  );
  return r.rows[0] || null;
}

/**
 * anythingToDispute — is there something on the newest report we could challenge?
 *
 * Returns `true`, `false`, or **`null` for unknown**, and the null is the whole
 * point. CLAUDE.md §12: NULL MEANS UNKNOWN and must survive; unknown must never
 * become a denial. So:
 *
 *   no pull on file at all        → null. We have no grounds to refuse.
 *   a pull whose `result` was
 *     tombstoned by retention
 *     (src/retention/classes.mjs:147)  → null. Same reasoning.
 *   a pull we can read, no negatives   → false. THIS is the refusal.
 *   a pull we can read, negatives      → true.
 *
 * `is_demo IS NOT TRUE` matches api/read/portal-summary.mjs:143 — a seeded demo
 * file must not be the thing that decides whether a real client may buy.
 */
export async function anythingToDispute(db, { orgId, clientId } = {}) {
  if (!orgId || !clientId) return null;
  const r = await db.query(
    `SELECT result
       FROM crs_results
      WHERE client_id = $1::uuid AND org_id = $2::uuid
        AND is_demo IS NOT TRUE
      ORDER BY created_at DESC
      LIMIT 1`,
    [clientId, orgId]
  );
  const row = r.rows[0];
  if (!row) return null;                       // never pulled — unknown, not "clean"
  const result = row.result;
  if (!result || typeof result !== "object") return null;  // tombstoned — unknown
  const hasTradelines = Array.isArray(result.tradelines);
  const hasRecords = Array.isArray(result.publicRecords);
  if (!hasTradelines && !hasRecords) return null;          // shape we cannot read — unknown
  return negativeKeysFromResult(result).length > 0;
}

/**
 * assessRoundEligibility — every refusal that can be decided BEFORE money.
 *
 * Returns `{ ok: true }` or a refusal from src/paid-services/refusals.mjs.
 * Order matters and is deliberate:
 *
 *   1. offer path   — the broadest "this is not for you", checked first so a
 *                     course buyer is never told "you already have one".
 *   2. in flight    — the answer that is about their own file rather than about
 *                     the product.
 *   3. nothing to dispute — the most expensive to compute, and only meaningful
 *                     for somebody the first two let through.
 */
export async function assessRoundEligibility(db, { orgId, clientId, outcomeTier } = {}) {
  if (!orgId || !clientId) {
    return refuse(REFUSAL.NOT_ON_OFFER_PATH, "no org or client on the request");
  }

  const permitted = await onRepairPath(db, { orgId, clientId, outcomeTier });
  if (!permitted) return refuse(REFUSAL.NOT_ON_OFFER_PATH);

  const open = await openRoundFor(db, { orgId, clientId });
  if (open) {
    const r = refuse(REFUSAL.ALREADY_IN_FLIGHT);
    r.request = open;
    return r;
  }

  const disputable = await anythingToDispute(db, { orgId, clientId });
  // `false` refuses. `null` (unknown) does NOT — see anythingToDispute().
  if (disputable === false) return refuse(REFUSAL.NOTHING_TO_DISPUTE);

  return { ok: true };
}

/* ── the request ─────────────────────────────────────────────────────────── */

/** The derived replay guard. Stable for a given client and round slot, so two
 *  presses of one button build the same key without the caller sending one. */
export function derivedIdempotencyKey({ clientId, roundNo }) {
  return `paid_round:${clientId}:r${roundNo}`;
}

/**
 * requestRound — price it, record it, and mint the invitation to pay.
 *
 * Returns on success:
 *   { ok: true, created, request, checkoutUrl, checkoutPending }
 *
 * `created: false` with `checkoutPending: true` is the losing side of a genuine
 * race: the winner's row exists and its link is being minted right now. The
 * caller is told to re-read rather than handed a second link, because minting a
 * second link is the one thing that turns a double press into a double charge.
 *
 * On refusal it returns the refusal object from refusals.mjs, unchanged.
 *
 * NOTHING IS CHARGED HERE. The return value's `checkoutUrl` is a page the
 * client may choose to visit.
 */
export async function requestRound(db, {
  orgId,
  clientId,
  requestedByKind,
  requestedByAccountId = null,
  requestedByStaffId = null,
  creditorLetter = false,
  escalationFilings = false,
  waypointId = null,
  idempotencyKey = null,
  outcomeTier,
  env = process.env,
  fetchImpl = fetch,
  mintFn = mintCheckoutLink
} = {}) {
  const eligible = await assessRoundEligibility(db, { orgId, clientId, outcomeTier });
  if (!eligible.ok) return eligible;

  const { components, totalCents } = quoteRound({ creditorLetter, escalationFilings });
  // Belt and braces against a future edit: the row's total must be the sum of
  // its own lines or db/migrations/331's CHECK refuses it. Recomputing here
  // means a mismatch is a thrown TypeError at the seam rather than a 23514 from
  // Postgres with no line number in it.
  if (sumComponents(components) !== totalCents) {
    throw new Error("paid round receipt does not sum to its own total");
  }

  const roundNo = await nextSelfServeRoundNo(db, { clientId });
  const idem = (typeof idempotencyKey === "string" && idempotencyKey.trim())
    ? idempotencyKey.trim()
    : derivedIdempotencyKey({ clientId, roundNo });

  let outcome;
  try {
    outcome = await requestPaidService(db, {
      orgId,
      clientId,
      waypointId,
      serviceKind: SERVICE_KIND,
      requestedByKind,
      requestedByAccountId,
      requestedByStaffId,
      components,
      roundNo,
      idempotencyKey: idem,
      status: "quoted"
    });
  } catch (err) {
    /* THE RACE, ADJUDICATED BY POSTGRES.
       requestPaidService()'s ON CONFLICT clause targets the idempotency index
       only, so a collision on uq_paid_service_requests_round_no arrives here as
       a thrown 23505 rather than as a quiet DO NOTHING. Either way the answer
       is the same: somebody else wrote the row this press was going to write,
       and their row is the answer. Re-read by both keys — the caller's own key
       first, then the round slot — and hand it back. */
    if (err?.code !== UNIQUE_VIOLATION) throw err;
    const raced = await findRacedRow(db, { orgId, clientId, idem, roundNo });
    if (!raced) throw err;
    return { ok: true, created: false, request: raced, checkoutUrl: raced.checkout_url || null, checkoutPending: !raced.checkout_url };
  }

  if (!outcome.created) {
    const existing = outcome.request
      || await findRacedRow(db, { orgId, clientId, idem, roundNo });
    if (!existing) {
      // Nothing written, nothing explaining why. Refusing loudly is the only
      // honest option — the same call src/finance/soft-pulls.mjs:365 makes.
      throw new WaypointError(
        "the request could not be recorded — please try again",
        { status: 409 }
      );
    }
    return {
      ok: true,
      created: false,
      request: existing,
      checkoutUrl: existing.checkout_url || null,
      checkoutPending: !existing.checkout_url
    };
  }

  const row = outcome.request;

  // ── The invitation to pay. Only the winner gets here. ────────────────────
  const minted = await mintFn({
    requestId: row.id,
    clientId,
    orgId,
    amountCents: totalCents,
    roundNo,
    env,
    fetchImpl
  });

  if (!minted.ok) {
    /* The processor is unreachable or declined the session. The row is marked
       failed and CLOSED (resolved_at), not left open: an open row would trip
       the in-flight guard and lock the client out of ever retrying. Nothing has
       been charged — no card has been touched at any point. */
    const closed = await closeFailed(db, {
      requestId: row.id,
      reason: `checkout_unavailable: ${String(minted.reason || "unknown").slice(0, 180)}`
    });
    const r = refuse(REFUSAL.PAYMENT_FAILED, minted.reason);
    r.request = closed || row;
    return r;
  }

  const updated = await db.query(
    `UPDATE paid_service_requests
        SET status = 'awaiting_payment', checkout_url = $2
      WHERE id = $1::uuid AND status = 'quoted'
      RETURNING *`,
    [row.id, minted.checkoutUrl]
  );

  return {
    ok: true,
    created: true,
    request: updated.rows[0] || row,
    checkoutUrl: minted.checkoutUrl,
    checkoutPending: false
  };
}

/* THE THREE WAYS A LOSING PRESS FINDS THE WINNER, IN ORDER.
   All three are needed and none of them is redundant, because the three unique
   indexes on this table catch a race at three different moments:

     idempotency key — the same tap, replayed with the same key.
     round slot      — both presses read MAX(round_no) before either inserted.
     one-open (345)  — the presses took DIFFERENT slots, because one read the
                       counter after the other had already written. That is the
                       case measured on 2026-09-05, and neither of the first two
                       lookups finds the winner in it: different key, different
                       slot, and only the open-request index refuses the row. */
async function findRacedRow(db, { orgId, clientId, idem, roundNo }) {
  if (idem) {
    const byKey = await db.query(
      `SELECT * FROM paid_service_requests
        WHERE org_id = $1::uuid AND idempotency_key = $2 LIMIT 1`,
      [orgId, idem]
    );
    if (byKey.rows[0]) return byKey.rows[0];
  }
  const bySlot = await db.query(
    `SELECT * FROM paid_service_requests
      WHERE client_id = $1::uuid AND round_no = $2 LIMIT 1`,
    [clientId, roundNo]
  );
  if (bySlot.rows[0]) return bySlot.rows[0];
  return openRoundFor(db, { orgId, clientId });
}

/** Mark a request failed and finished. `resolved_at` is required by
 *  paid_service_requests_resolved_ck for any terminal status. */
export async function closeFailed(db, { requestId, reason }) {
  const r = await db.query(
    `UPDATE paid_service_requests
        SET status = 'failed', state_reason = $2, resolved_at = now()
      WHERE id = $1::uuid
        AND status NOT IN ('fulfilled', 'failed', 'cancelled', 'refunded')
      RETURNING *`,
    [requestId, String(reason || "").slice(0, 500) || null]
  );
  return r.rows[0] || null;
}

/* ── the money lands ─────────────────────────────────────────────────────── */

/**
 * recordPayment — the webhook said this request was paid.
 *
 * IDEMPOTENT BY STATE, not by a second key: the UPDATE only fires on a row that
 * is still `quoted` or `awaiting_payment`, so a replayed webhook changes
 * nothing and returns `{ applied: false }` with the row as it stands. A webhook
 * that arrives twice is the normal case, not the exception.
 *
 * amountCents may be null — NULL MEANS UNKNOWN. But db/migrations/331's
 * paid_service_requests_paid_ck binds paid_at and amount_paid_cents together,
 * so an unknown amount cannot be stored beside a payment timestamp. When the
 * webhook does not say what was paid we fall back to what was QUOTED, and
 * `payment_amount_source` in `produced` records that we did, so nobody later
 * reads the quoted figure as a confirmed one.
 */
export async function recordPayment(db, {
  requestId,
  paymentRef = null,
  amountCents = null,
  paidAt = null
} = {}) {
  if (!requestId) throw new WaypointError("requestId is required");

  const current = (await db.query(
    `SELECT * FROM paid_service_requests WHERE id = $1::uuid`, [requestId]
  )).rows[0];
  if (!current) return { applied: false, reason: "not_found", request: null };
  if (!OPEN_STATUSES.includes(current.status)) {
    return { applied: false, reason: `status_${current.status}`, request: current };
  }
  if (current.paid_at) {
    return { applied: false, reason: "already_paid", request: current };
  }

  const known = Number.isInteger(amountCents) && amountCents >= 0;
  const amount = known ? amountCents : current.price_total_cents;
  if (!Number.isInteger(Number(amount))) {
    // Neither the webhook nor the quote knows the number. Refuse rather than
    // write a zero — a zero here reads as "they paid nothing", which is a
    // different and false claim.
    return { applied: false, reason: "amount_unknown", request: current };
  }

  const r = await db.query(
    `UPDATE paid_service_requests
        SET status = 'paid',
            paid_at = COALESCE($2::timestamptz, now()),
            amount_paid_cents = $3,
            payment_ref = COALESCE($4, payment_ref),
            produced = produced || $5::jsonb
      WHERE id = $1::uuid
        AND status = ANY($6::text[])
        AND paid_at IS NULL
      RETURNING *`,
    [
      requestId,
      paidAt,
      Number(amount),
      paymentRef,
      JSON.stringify({ payment_amount_source: known ? "processor" : "quote" }),
      ["quoted", "awaiting_payment"]
    ]
  );
  if (!r.rows[0]) {
    const after = (await db.query(
      `SELECT * FROM paid_service_requests WHERE id = $1::uuid`, [requestId]
    )).rows[0] || null;
    return { applied: false, reason: "raced", request: after };
  }
  return { applied: true, request: r.rows[0] };
}

/**
 * stageRound — order the fresh report and put the round on a human's board.
 *
 * THE MAILING INVARIANT LIVES HERE. `staged` means, precisely:
 *   * a soft_pull_requests row exists, so a fresh report is on order;
 *   * the request is on the open board a staff member works from;
 *   * NOTHING HAS BEEN MAILED, and this function cannot mail anything. It
 *     imports no mail function and emits no event a mailer listens for.
 *
 * The letters do not exist yet at this point and cannot: they are built from
 * the pull that has just been ordered. A human presses send in the existing
 * screen once it lands. src/metro2/delivery/send.mjs:3 and api/repair/send.mjs:3
 * both forbid mailing from payment.received and nothing here routes around it.
 *
 * THE PULL CAN REFUSE. requestSoftPull() reads consent at request time, every
 * time, and throws when it is missing or revoked. That is the `pull_failed`
 * refusal: the money is already taken, so the request is marked `failed` with
 * the reason on the row, and a human has a visible thing to fix. It is NOT
 * swallowed and it does NOT leave the row sitting at `paid` looking healthy.
 */
export async function stageRound(db, {
  requestId,
  orgId,
  clientId,
  requestedBy = null
} = {}) {
  if (!requestId) throw new WaypointError("requestId is required");

  const current = (await db.query(
    `SELECT * FROM paid_service_requests WHERE id = $1::uuid`, [requestId]
  )).rows[0];
  if (!current) return { ok: false, reason: "not_found", request: null };
  if (current.status === "staged") {
    return { ok: true, staged: false, request: current };  // replay
  }
  if (current.status !== "paid") {
    return { ok: false, reason: `status_${current.status}`, request: current };
  }

  const org = orgId || current.org_id;
  const client = clientId || current.client_id;

  /* WHO ASKED FOR THE REPORT IS WHO BOUGHT THE ROUND.
     A soft pull is a consumer-credit event and src/finance/soft-pulls.mjs:109
     refuses an unattributed one outright — "an unattributed soft pull is not
     loggable". There is no system actor to fall back on and inventing one would
     be exactly the unattributed record that refusal exists to prevent. So the
     attribution is copied off the request row, which db/migrations/331 already
     forces to name exactly one real requester with a foreign key
     (paid_service_requests_requester_ck). */
  const asker = requestedBy || requesterOf(current);

  let pull;
  try {
    pull = await requestSoftPull(db, {
      orgId: org,
      clientId: client,
      requestedBy: asker,
      reason: "self-serve round: fresh report before the dispute is built",
      // The request row's own id is the pull's replay guard, so re-running this
      // function orders one report rather than a second one.
      idempotencyKey: `paid_round_pull:${requestId}`
    });
  } catch (err) {
    const failed = await closeFailed(db, {
      requestId,
      reason: `pull_refused: ${String(err?.message || err).slice(0, 180)}`
    });
    const r = refuse(REFUSAL.PULL_FAILED, err?.message);
    r.request = failed || current;
    return r;
  }

  const pullId = pull?.request?.id || null;
  const staged = await db.query(
    `UPDATE paid_service_requests
        SET status = 'staged',
            state_reason = 'awaiting_fresh_report',
            produced = produced || $2::jsonb
      WHERE id = $1::uuid AND status = 'paid'
      RETURNING *`,
    [
      requestId,
      JSON.stringify({
        soft_pull_request_id: pullId,
        staged_at: new Date().toISOString(),
        mailed: false
      })
    ]
  );

  return {
    ok: true,
    staged: true,
    request: staged.rows[0] || current,
    softPullRequestId: pullId
  };
}

/** The requester on a paid_service_requests row, in the shape
 *  src/finance/soft-pulls.mjs normalizeRequester() reads. */
export function requesterOf(row) {
  if (!row) return null;
  return row.requested_by_kind === "client"
    ? { kind: "client", id: row.requested_by_account_id }
    : { kind: "staff", id: row.requested_by_staff_id };
}

/* ── the read a screen uses ──────────────────────────────────────────────── */

/**
 * paidServiceOffer — the `paidServices[]` entry for /api/read/client-progress.
 *
 * FACTS, NOT COPY. Keys, cents and booleans; the sentences a client reads live
 * in the front end. The `key` values match the orchestrator's contract exactly
 * (base / creditor / cfpb_and_ag) so the screen lane and this lane agree
 * without either having read the other's code.
 */
export async function paidServiceOffer(db, { orgId, clientId, outcomeTier } = {}) {
  const eligible = await assessRoundEligibility(db, { orgId, clientId, outcomeTier });
  const open = eligible.ok ? null : (eligible.request || null);
  return {
    serviceKey: SERVICE_KEY,
    available: eligible.ok === true,
    unavailableReason: eligible.ok ? null : eligible.reason,
    components: roundPriceList(),
    inFlight: !!open,
    inFlightRequestId: open ? open.id : null,
    inFlightStatus: open ? open.status : null
  };
}

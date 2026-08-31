// The pre-checkout gate. THIS RUNS IN FRONT OF THE PAY BUTTON.
//
// THE SINGLE MOST IMPORTANT OPERATIONAL POINT IN THE TRIAL. Meta forces every
// money-related ad into a Special Ad Category and refuses to run one from a
// business that is not verified. Verification is not FundHub's system and there
// is no measured turnaround for it. If that check happens AFTER the $297 is
// taken, FundHub has sold seven days it cannot deliver.
//
// So the ordering is: ask, decide, then show the pay button — and what the pay
// button sells depends on the answers.
//
//   ad account?      no  → hold the sale, show the two-minute setup
//   business verified?
//        yes → sell seven days
//        no  → sell a HELD-START trial. Take the $297, deliver the branded
//              funnel and the built ad set immediately, and do not start the
//              clock. The seven days begin the day verification lands. If Meta
//              refuses verification inside 30 days, full cash refund, automatic.
//   $500–$1,000 of ad spend this week?  no → hold the sale. Not negotiable.
//
// THE $297 DOES NOT BUY AD SPEND. That is the number one refund argument in
// every done-for-you trial ever sold, so the budget question is asked here and
// the answer is recorded, not assumed.
//
// NO PROMISED RESULT ANYWHERE IN THIS FILE. The gate says what FundHub will
// build. It never says how many calls a budget books, because nobody has
// measured that for any audience at any spend.

import { HELD_START_REFUND_DAYS } from "./constants.mjs";

/** DECISION — what the checkout page is allowed to do next. */
export const DECISION = Object.freeze({
  SELL: "sell",
  HELD_START: "held_start",
  HOLD_SALE: "hold_sale"
});

/* The three questions, in the order they are asked. Exported so the checkout
   page and the API answer with the same words rather than two paraphrases that
   drift apart. */
export const ELIGIBILITY_QUESTIONS = Object.freeze([
  {
    key: "has_ad_account",
    question: "Do you have a Meta ad account?",
    why: "The campaign runs in your account, under your brand. FundHub never runs it from ours.",
    onNo: "We will walk you through the two-minute setup first. Nothing is charged until it exists."
  },
  {
    key: "business_verified",
    question: "Is your Meta business verified?",
    why: "Meta will not run a money-related ad from a business it has not verified. That check is theirs, not ours.",
    onNo: "You can still start today. We build everything now and your seven days begin the day verification lands."
  },
  {
    key: "can_fund_ad_spend",
    question: "Can you fund $500 to $1,000 of ad spend this week?",
    why: "The $297 does not buy ad spend. The budget is yours, on your card, in your account.",
    onNo: "We will hold the sale. Without a budget there is nothing for the campaign to spend."
  }
]);

function tri(v) {
  if (v === true || v === "true" || v === "yes" || v === 1 || v === "1") return true;
  if (v === false || v === "false" || v === "no" || v === 0 || v === "0") return false;
  return null; // unknown, and unknown must survive — it is not "no"
}

/**
 * decideEligibility(answers) → decision object.
 *
 * An UNANSWERED question is not a "no". It holds the sale with reason
 * `unanswered` so the page asks again, rather than quietly selling a held-start
 * trial to somebody who never told us anything.
 */
export function decideEligibility(answers = {}) {
  const hasAdAccount = tri(answers.has_ad_account ?? answers.hasAdAccount);
  const verified = tri(answers.business_verified ?? answers.businessVerified);
  const canFund = tri(answers.can_fund_ad_spend ?? answers.canFundAdSpend);

  const blockers = [];
  if (hasAdAccount !== true) {
    blockers.push({
      key: "has_ad_account",
      reason: hasAdAccount === false ? "no_ad_account" : "unanswered",
      message: "You need a Meta ad account before the campaign has anywhere to run. It takes about two minutes."
    });
  }
  if (canFund !== true) {
    blockers.push({
      key: "can_fund_ad_spend",
      reason: canFund === false ? "no_ad_budget" : "unanswered",
      message: "The $297 does not include ad spend. Plan on $500 to $1,000 this week, on your own card."
    });
  }
  if (verified == null) {
    blockers.push({
      key: "business_verified",
      reason: "unanswered",
      message: "Tell us whether your Meta business is verified. It decides when your seven days start."
    });
  }

  if (blockers.length) {
    return {
      ok: false,
      decision: DECISION.HOLD_SALE,
      heldStart: false,
      blockers,
      priceApplies: false,
      headline: "Not yet — one thing first.",
      questions: ELIGIBILITY_QUESTIONS
    };
  }

  if (verified === false) {
    return {
      ok: true,
      decision: DECISION.HELD_START,
      heldStart: true,
      blockers: [],
      priceApplies: true,
      headline: "You can start today. Your seven days start when Meta verifies you.",
      terms: [
        "We build your branded funnel and your ad set now. That is delivered whether or not verification is quick.",
        "Your seven live days begin on the day verification lands — not today.",
        `If Meta refuses your verification within ${HELD_START_REFUND_DAYS} days, you get every dollar back automatically.`,
        "We cannot tell you how long Meta takes. It is their system and we have no measured number for it."
      ],
      questions: ELIGIBILITY_QUESTIONS
    };
  }

  return {
    ok: true,
    decision: DECISION.SELL,
    heldStart: false,
    blockers: [],
    priceApplies: true,
    headline: "You are ready. Your seven days start at your first ad impression.",
    terms: [
      "Your seven days start at your first ad impression, not at checkout.",
      "The $297 does not include ad spend. Plan on $500 to $1,000 this week, on your own card.",
      "Everything runs in your ad account, under your brand."
    ],
    questions: ELIGIBILITY_QUESTIONS
  };
}

/**
 * readMetaVerification(db, { orgId, partnerId }) → { state, connectionState } | null
 *
 * The database's own answer, for a buyer who already has a connection. It is a
 * CHECK, not a substitute for asking: a person who has never connected an
 * account has no row here, and no row means unknown, not unverified.
 */
export async function readMetaVerification(db, { orgId, partnerId } = {}) {
  if (!db || !orgId || !partnerId) return null;
  const { rows } = await db.query(
    `SELECT platform_verification_state, connection_state
       FROM ad_platform_connections
      WHERE org_id = $1 AND partner_id = $2 AND platform = 'meta'
      ORDER BY updated_at DESC
      LIMIT 1`,
    [orgId, partnerId]
  );
  const row = rows && rows[0];
  if (!row) return null;
  return {
    state: row.platform_verification_state,
    connectionState: row.connection_state
  };
}

/**
 * reconcileWithConnection(decision, verification) → decision.
 *
 * When the database already knows the business is verified, a buyer who ticked
 * "no" is upgraded from held-start to a full seven days: the platform's own
 * record beats a form answer. The reverse is NOT done — a form answer of "yes"
 * never overrides a database that says `rejected`, because that is the case
 * where FundHub would sell days it cannot deliver.
 */
export function reconcileWithConnection(decision, verification) {
  if (!decision || !verification) return decision;
  const state = String(verification.state || "");
  if (decision.decision === DECISION.HELD_START && state === "approved") {
    return decideEligibility({
      has_ad_account: true,
      business_verified: true,
      can_fund_ad_spend: true
    });
  }
  if (decision.decision === DECISION.SELL && (state === "rejected" || state === "unverified" || state === "submitted")) {
    return decideEligibility({
      has_ad_account: true,
      business_verified: false,
      can_fund_ad_spend: true
    });
  }
  return decision;
}

export default { DECISION, ELIGIBILITY_QUESTIONS, decideEligibility, readMetaVerification, reconcileWithConnection };

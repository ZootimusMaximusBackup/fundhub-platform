// POST /api/trials/eligibility — the gate that runs IN FRONT OF THE PAY BUTTON.
//
// PUBLIC AND UNAUTHENTICATED, on purpose. It is asked by a stranger on the
// trial sales page before any money moves and before any account exists. It
// reads nothing, writes nothing, and returns a decision.
//
// WHY IT MATTERS THAT THIS IS FIRST. Meta refuses money-related ads from a
// business it has not verified, and verification is not FundHub's system. If
// that check happens after the $297 is taken, FundHub has sold seven days it
// cannot deliver. So the page asks, this endpoint decides, and the pay button
// it renders depends on the answer:
//
//   sell        → seven days, clock starts at the first ad impression
//   held_start  → take the $297, deliver everything, hold the clock until Meta
//                 verifies them; automatic full refund if Meta refuses in 30 days
//   hold_sale   → no pay button at all
//
// NO EARNINGS CLAIMS. The response says what FundHub will build and what the
// buyer must bring. It never says how many calls a budget books, because that
// has never been measured for any audience at any spend.

import { decideEligibility } from "../../src/trials/eligibility.mjs";
import { LIVE_TRIAL_PRICE_CENTS, TRIAL_DAYS } from "../../src/trials/constants.mjs";
import { remedyPolicyText } from "../../src/trials/remedy.mjs";
import { safeError } from "../../src/http/health.mjs";

function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body || "{}"); } catch { return null; }
  }
  if (typeof req.rawBody === "string") {
    try { return JSON.parse(req.rawBody || "{}"); } catch { return null; }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const body = readBody(req);
  if (body === null) {
    return res.status(400).json({ ok: false, error: "invalid_json" });
  }

  try {
    const answers = body && typeof body.eligibility === "object" && body.eligibility
      ? body.eligibility
      : body || {};
    const decision = decideEligibility(answers);

    return res.status(200).json({
      ok: true,
      decision: decision.decision,
      sellable: decision.ok,
      held_start: decision.heldStart,
      blockers: decision.blockers,
      headline: decision.headline,
      terms: decision.terms || [],
      questions: decision.questions,
      price_cents: LIVE_TRIAL_PRICE_CENTS,
      trial_days: TRIAL_DAYS,
      // Stated on the gate as well as at checkout. It is the number one refund
      // argument in every done-for-you trial ever sold.
      ad_spend_included: false,
      guarantee: remedyPolicyText()
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}

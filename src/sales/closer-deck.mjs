// Closer deck payload + live actions.
// Reads stored CRS + survey. Never invents FICO, totals, or reason copy.

import { getOffer, offerAllowsLetters, offersForClient, formatCents } from "../config/offers.mjs";
import { isFundingPath } from "../config/product-path.mjs";
import { createPaymentLink, markSent } from "../payment-links/index.mjs";
import { formatPrice } from "../subscriptions/index.mjs";
import { sendTemplated } from "../workflows/messaging.mjs";
import { mergeCustomFields } from "../workflows/custom-fields.mjs";
import { addTags } from "../workflows/tags.mjs";
import { EMAIL_TEMPLATE_KEY } from "../workflows/ds-02-diy-letters.mjs";
import { buildLetterPackForClient } from "../underwrite/letter-pack.mjs";
import { logCallOutcome } from "./call-outcomes.mjs";

export class CloserDeckError extends Error {
  constructor(message, { status = 400, code = "bad_request" } = {}) {
    super(message);
    this.name = "CloserDeckError";
    this.status = status;
    this.code = code;
  }
}

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cf(client, key) {
  const custom = client?.custom_fields && typeof client.custom_fields === "object"
    ? client.custom_fields : {};
  const v = custom[key];
  if (Array.isArray(v)) return v.filter(Boolean).join(", ") || null;
  if (v == null || v === "") return null;
  return String(v);
}

function deckTier(outcome) {
  const t = String(outcome || "");
  if (t === "FULL_FUNDING" || t === "PREMIUM_STACK") return "FULL_FUNDING";
  if (t === "FUNDING_PLUS_REPAIR") return "FUNDING_PLUS_REPAIR";
  if (t === "REPAIR_ONLY") return "REPAIR_ONLY";
  return null;
}

function ficoFrom(result) {
  const pb = result?.scores?.perBureau
    || result?.consumerSignals?.scores?.perBureau
    || {};
  const scores = result?.scores && typeof result.scores === "object" ? result.scores : {};
  return {
    ex: numOrNull(pb.ex ?? pb.EX ?? pb.experian ?? scores.experian ?? scores.EX ?? scores.ex),
    tu: numOrNull(pb.tu ?? pb.TU ?? pb.transunion ?? scores.transunion ?? scores.TU ?? scores.tu),
    eq: numOrNull(pb.eq ?? pb.EQ ?? pb.equifax ?? scores.equifax ?? scores.EQ ?? scores.eq)
  };
}

function reasonsFrom(result) {
  const raw = result?.reasonCodes
    || result?.reason_codes
    || result?.outcomeResult?.reasonCodes
    || [];
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    if (Array.isArray(item) && item[0]) {
      return [String(item[0]), item[1] != null ? String(item[1]) : String(item[0])];
    }
    if (item && typeof item === "object") {
      const code = item.code || item.id || item.ruleId || item.rule_id;
      const text = item.text || item.reason || item.label;
      if (!code && !text) return null;
      return [String(code || text), text != null ? String(text) : String(code)];
    }
    if (item == null || item === "") return null;
    return [String(item), String(item)];
  }).filter(Boolean);
}

function negCountFrom(result) {
  const bn = result?.bureauNegatives || result?.consumerSignals?.bureauNegatives;
  if (bn && typeof bn === "object") {
    let n = 0;
    let saw = false;
    for (const v of Object.values(bn)) {
      if (v && typeof v === "object" && v.count != null) {
        saw = true;
        n += Number(v.count) || 0;
      }
    }
    if (saw) return n;
  }
  const d = result?.derogatories ?? result?.consumerSignals?.derogatories;
  if (d && typeof d === "object") {
    const n = Number(d.count ?? d.total ?? d.negatives);
    if (Number.isFinite(n)) return n;
  }
  if (typeof result?.negItems === "number") return result.negItems;
  return null;
}

function engineFromRow(crs, clientTier) {
  if (!crs?.result || typeof crs.result !== "object") {
    return {
      available: false,
      reason: "engine data unavailable",
      tier: deckTier(clientTier),
      label: null,
      fico: { ex: null, tu: null, eq: null },
      total: null,
      afterFix: null,
      negItems: null,
      reasons: [],
      plan: []
    };
  }
  const result = crs.result;
  const outcome = result.outcome
    || result.outcomeResult?.outcome
    || crs.outcome_tier
    || clientTier
    || null;
  const tier = deckTier(outcome);
  const fico = ficoFrom(result);
  const total = numOrNull(
    result.preapprovals?.totalCombined
    ?? result.totalCombined
    ?? result.fundingEstimate
    ?? result.projectedPreapproval?.currentTotal
  );
  const afterFix = numOrNull(
    result.projectedPreapproval?.totalCombined
    ?? result.projectedTotalCombined
    ?? result.lenderReach?.afterOptimization
  );
  const hasAnyNumber = [fico.ex, fico.tu, fico.eq, total, afterFix].some((n) => n != null)
    || (Array.isArray(result.reasonCodes) && result.reasonCodes.length > 0)
    || (Array.isArray(result.reason_codes) && result.reason_codes.length > 0);
  if (!hasAnyNumber) {
    return {
      available: false,
      reason: "engine data unavailable",
      tier,
      label: tier ? String(tier).replace(/_/g, " ") : null,
      fico,
      total: null,
      afterFix: null,
      negItems: null,
      reasons: [],
      plan: []
    };
  }
  const labels = {
    FULL_FUNDING: "FULL FUNDING",
    FUNDING_PLUS_REPAIR: "FUNDING PLUS REPAIR",
    REPAIR_ONLY: "REPAIR ONLY"
  };
  return {
    available: true,
    reason: null,
    tier,
    outcome: outcome || null,
    label: tier ? labels[tier] : null,
    fico,
    total,
    afterFix,
    negItems: negCountFrom(result),
    reasons: reasonsFrom(result),
    plan: Array.isArray(result.plan) ? result.plan.map(String) : []
  };
}

export function selectedOfferKey({ edu, forceRepair, tier, rung }) {
  if (edu) return Number(rung) === 1 ? "UWIQ_DELIVERABLES" : "FUNDING_MASTERY";
  const funding = (tier === "FULL_FUNDING" || tier === "FUNDING_PLUS_REPAIR") && !forceRepair;
  if (!funding) {
    if (Number(rung) === 1) return "REPAIR_TRIAL";
    if (Number(rung) === 2) return "UWIQ_DELIVERABLES";
    return "REPAIR_DFY";
  }
  return "FUNDING_DFY";
}

export async function buildCloserDeck(db, { orgId, clientId }) {
  if (!orgId || !clientId) {
    throw new TypeError("buildCloserDeck: orgId and clientId required");
  }
  const clientRes = await db.query(
    `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.outcome_tier, c.custom_fields,
            b.name AS business_name
       FROM clients c
       LEFT JOIN businesses b ON b.client_id = c.id AND b.org_id = c.org_id
      WHERE c.id = $1 AND c.org_id = $2`,
    [clientId, orgId]
  );
  const client = clientRes.rows[0];
  if (!client) return null;

  const crsRes = await db.query(
    `SELECT result, outcome_tier, created_at
       FROM crs_results
      WHERE client_id = $1 AND org_id = $2
      ORDER BY created_at DESC LIMIT 1`,
    [clientId, orgId]
  );

  const name = [client.first_name, client.last_name].filter(Boolean).join(" ").trim() || "Client";
  const engine = engineFromRow(crsRes.rows[0], client.outcome_tier);
  if (engine.total == null) {
    const prequal = numOrNull(cf(client, "analyzer_prequal_amount") || cf(client, "total_funding_estimate"));
    if (prequal != null && engine.available) engine.total = prequal;
  }

  return {
    client_id: client.id,
    survey: {
      name,
      entity: client.business_name || cf(client, "business_name") || cf(client, "cf_business_name"),
      target: cf(client, "cf_svy_funding_target_amount"),
      use: cf(client, "cf_svy_planned_use"),
      hasBiz: cf(client, "cf_svy_has_business"),
      revenue: cf(client, "cf_svy_business_revenue"),
      income: cf(client, "cf_svy_annual_income_range"),
      capital: cf(client, "cf_svy_available_capital"),
      motivation: cf(client, "cf_svy_money_change_now")
    },
    engine,
    offers: offersForClient()
  };
}

function paymentPurpose(offer) {
  return offer.paymentPurpose || "custom";
}

export async function sendDeckPayLink(db, {
  orgId, clientId, staffId, offerKey, checkoutBaseUrl
}) {
  const offer = getOffer(offerKey);
  if (!offer) {
    throw new CloserDeckError("Unknown offer.", { status: 400, code: "unknown_offer" });
  }
  if (!checkoutBaseUrl) {
    throw new CloserDeckError(
      "COMMAS_CHECKOUT_BASE_URL is not set — no checkout link can be built",
      { status: 503, code: "commas_not_configured" }
    );
  }
  const purpose = paymentPurpose(offer);
  const description = offer.name;
  const link = await createPaymentLink(db, {
    orgId,
    clientId,
    purpose,
    description,
    amountCents: offer.priceCents,
    createdByStaffId: staffId,
    checkoutBaseUrl
  });
  const context = {
    payment_link: {
      url: link.checkout_url,
      description: link.description || link.purpose,
      amount: formatPrice(link.amount_cents)
    }
  };
  const sms = await sendTemplated(db, {
    orgId, clientId, channel: "sms", templateKey: "payment_link_notice",
    eventId: `${link.id}:sms`, staffId, context
  });
  const email = await sendTemplated(db, {
    orgId, clientId, channel: "email", templateKey: "payment_link_notice",
    eventId: `${link.id}:email`, staffId, context
  });
  const sent = (await markSent(db, { id: link.id, orgId })) || link;
  return {
    link: {
      ...sent,
      amount_display: formatCents(Number(sent.amount_cents)),
      offer_key: offer.key
    },
    sms,
    email
  };
}

export async function generateDeckLetters(db, {
  orgId, clientId, staffId, offerKey, edu = false, forceRepair = false, tier = null
}) {
  const offer = getOffer(offerKey);
  if (!offer) {
    throw new CloserDeckError("Unknown offer.", { status: 400, code: "unknown_offer" });
  }
  const fundingRoute = isFundingPath(tier) && !forceRepair && !edu && offerKey === "FUNDING_DFY";
  if (fundingRoute || !offerAllowsLetters(offerKey)) {
    throw new CloserDeckError(
      "Letters do not fire on the qualified funding route.",
      { status: 409, code: "letters_blocked_funding_route" }
    );
  }
  const pack = await buildLetterPackForClient(db, { clientId, pack: "repair" });
  const email = await sendTemplated(db, {
    orgId,
    clientId,
    channel: "email",
    templateKey: EMAIL_TEMPLATE_KEY,
    eventId: `closer-deck-letters:${clientId}:${offerKey}`,
    staffId
  });
  await addTags(db, clientId, ["client:diy-letters"]);
  await mergeCustomFields(db, clientId, {
    diy_status: pack.files?.length ? "Delivered" : "Delivery Failed — Retry",
    closer_deck_letters_at: new Date().toISOString(),
    closer_deck_letters_offer: offerKey
  });
  return {
    delivered: !!(pack.files && pack.files.length),
    letterCount: pack.files?.length || 0,
    engineSkip: pack.engineSkip || null,
    email
  };
}

function outcomeForOffer(offerKey) {
  return offerKey === "FUNDING_DFY" ? "deposit" : "downsell";
}

export async function logDeckDisposition(db, {
  orgId, clientId, staffId, offerKey, route, temperature, beliefsCount, costOfInaction, taskId
}) {
  const offer = getOffer(offerKey);
  if (!offer) {
    throw new CloserDeckError("Unknown offer.", { status: 400, code: "unknown_offer" });
  }
  const notes = JSON.stringify({
    closer_deck: {
      route: route || null,
      offer_key: offer.key,
      amount_cents: offer.priceCents,
      temperature: temperature == null ? null : Number(temperature) || 0,
      beliefs_count: beliefsCount == null ? null : Number(beliefsCount) || 0,
      cost_of_inaction: costOfInaction == null || costOfInaction === "" ? null : String(costOfInaction).slice(0, 80)
    }
  });
  const result = await logCallOutcome(db, {
    orgId,
    clientId,
    staffId,
    taskId: taskId || null,
    outcome: outcomeForOffer(offer.key),
    notes
  });
  await mergeCustomFields(db, clientId, {
    closer_deck_disposition: {
      route: route || null,
      offer_key: offer.key,
      amount_cents: offer.priceCents,
      temperature: temperature == null ? null : Number(temperature) || 0,
      beliefs_count: beliefsCount == null ? null : Number(beliefsCount) || 0,
      cost_of_inaction: costOfInaction == null || costOfInaction === "" ? null : String(costOfInaction).slice(0, 80),
      at: new Date().toISOString()
    }
  });
  return result;
}

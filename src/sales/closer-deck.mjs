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
import { signSoftPullApproveUrl } from "../consent/approve-token.mjs";
import { consentStatus } from "../consent/index.mjs";
import { composeAndSend } from "../messaging/compose.mjs";
import { dispatchMessage } from "../messaging/dispatch.mjs";
import { secretFromEnv } from "../documents/signed-url.mjs";
import { incomeEstimates } from "../http/client-detail.mjs";

function jsonSafeLink(link, extra = {}) {
  if (!link) return null;
  const cents = Number(link.amount_cents);
  return {
    id: link.id || null,
    checkout_url: link.checkout_url || null,
    status: link.status || null,
    amount_cents: Number.isFinite(cents) ? cents : null,
    amount_display: extra.amount_display || formatCents(cents) || null,
    purpose: link.purpose || null,
    offer_key: extra.offer_key || null,
    description: extra.description || link.description || null
  };
}

function jsonSafeCompose(composed) {
  if (!composed) return null;
  return {
    outcome: composed.outcome ?? null,
    detail: composed.detail == null ? null : String(composed.detail).slice(0, 160),
    deduped: !!composed.deduped,
    status: composed.message?.status || null
  };
}

async function dispatchQueued(db, templated) {
  if (!templated?.messageId) return templated || null;
  try {
    const result = await dispatchMessage(db, templated.messageId);
    return {
      sent: templated.sent,
      messageId: templated.messageId,
      outcome: result?.outcome || null,
      detail: result?.detail == null ? null : String(result.detail).slice(0, 160)
    };
  } catch (err) {
    return {
      sent: templated.sent,
      messageId: templated.messageId,
      outcome: "error",
      detail: String(err && err.message ? err.message : err).slice(0, 160)
    };
  }
}

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

  const softPull = await softPullStatus(db, { orgId, clientId });
  const income = incomeEstimates(crsRes.rows);

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
    /* Bureau income guesses for closer leverage — not paystubs, not bank balances. */
    income_estimates: income,
    engine,
    soft_pull: softPull,
    offers: offersForClient()
  };
}

async function softPullStatus(db, { orgId, clientId }) {
  const consent = await consentStatus(db, {
    orgId, clientId, kind: "soft_pull_consent"
  });
  const paid = await db.query(
    `SELECT id, amount_cents, status, paid_at, created_at, checkout_url
       FROM payment_links
      WHERE org_id = $1 AND client_id = $2 AND purpose = 'diagnostic'
      ORDER BY created_at DESC LIMIT 1`,
    [orgId, clientId]
  );
  const req = await db.query(
    `SELECT id, status, requested_at, resolved_at, crs_result_id
       FROM soft_pull_requests
      WHERE org_id = $1 AND client_id = $2
      ORDER BY requested_at DESC LIMIT 1`,
    [orgId, clientId]
  );
  const crs = await db.query(
    `SELECT id, outcome_tier, created_at
       FROM crs_results
      WHERE org_id = $1 AND client_id = $2
      ORDER BY created_at DESC LIMIT 1`,
    [orgId, clientId]
  );
  const link = paid.rows[0] || null;
  const pull = req.rows[0] || null;
  const result = crs.rows[0] || null;
  return {
    consent_valid: !!consent.valid,
    consent_reason: consent.reason || null,
    diagnostic_paid: !!(link && (link.status === "paid" || link.paid_at)),
    diagnostic_link_status: link ? link.status : null,
    diagnostic_amount_cents: link ? Number(link.amount_cents) : null,
    diagnostic_checkout_url: link ? link.checkout_url : null,
    pull_status: pull ? pull.status : null,
    pull_id: pull ? pull.id : null,
    crs_result_id: result ? result.id : (pull?.crs_result_id || null),
    outcome_tier: result ? result.outcome_tier : null
  };
}

function publicBaseUrl(env = process.env) {
  if (env.PUBLIC_BASE_URL) return String(env.PUBLIC_BASE_URL).replace(/\/$/, "");
  if (env.URL) return String(env.URL).replace(/\/$/, "");
  return "https://fundhub.ai";
}

/**
 * sendDeckSoftPull — $32 fixed diagnostic pay link + soft-pull approval form.
 * Soft-pull price is never closer-editable (owner law).
 */
export async function sendDeckSoftPull(db, {
  orgId, clientId, staffId, staffRole = null, checkoutBaseUrl, env = process.env
}) {
  const offer = getOffer("SOFT_PULL");
  if (!offer) {
    throw new CloserDeckError("Soft-pull offer missing from catalog.", { status: 500, code: "offer_missing" });
  }
  if (!checkoutBaseUrl && !String(env.FANBASIS_CHECKOUT_API_KEY || "").trim()) {
    throw new CloserDeckError(
      "FANBASIS_CHECKOUT_API_KEY is not set — no checkout link can be built",
      { status: 503, code: "commas_not_configured" }
    );
  }

  let signingSecret;
  try {
    signingSecret = secretFromEnv(env);
  } catch {
    throw new CloserDeckError(
      "DOCUMENT_URL_SECRET is not set — cannot sign the soft-pull approval link",
      { status: 503, code: "signing_secret_missing" }
    );
  }

  let link;
  try {
    link = await createPaymentLink(db, {
      orgId,
      clientId,
      purpose: "diagnostic",
      description: offer.name,
      amountCents: offer.priceCents,
      createdByStaffId: staffId,
      createdByRole: staffRole,
      productCode: offer.productCode,
      checkoutBaseUrl,
      env
    });
  } catch (e) {
    throw new CloserDeckError(e.message || "Could not mint checkout link", {
      status: e.status || 502,
      code: e.code || "commas_checkout_failed"
    });
  }

  const approve = signSoftPullApproveUrl({
    orgId,
    clientId,
    secret: signingSecret,
    baseUrl: publicBaseUrl(env)
  });

  const first = await db.query(
    `SELECT first_name, email FROM clients WHERE id = $1 AND org_id = $2`,
    [clientId, orgId]
  );
  const firstName = first.rows[0]?.first_name || "there";
  const amount = formatCents(offer.priceCents) || "$32";

  const emailBody =
    `Hi ${firstName},\n\n` +
    `On our call — next step is your ${amount} soft-pull assessment.\n\n` +
    `1) Pay here (fixed ${amount}):\n${link.checkout_url}\n\n` +
    `2) Approve the soft pull and enter your details:\n${approve.url}\n\n` +
    `Both take about a minute. Stay on the Meet with your advisor.\n\n` +
    `— Fundhub`;

  const composed = await composeAndSend(db, {
    orgId,
    staffId,
    clientId,
    channel: "email",
    subject: `Your ${amount} soft-pull assessment`,
    body: emailBody,
    idempotencyKey: `soft-pull-send:${link.id}`
  });

  const smsBody =
    `Hi ${firstName}, your Fundhub soft-pull: pay ${amount} ${link.checkout_url} ` +
    `then approve ${approve.url}`;
  let sms = null;
  try {
    sms = await composeAndSend(db, {
      orgId,
      staffId,
      clientId,
      channel: "sms",
      body: smsBody,
      idempotencyKey: `soft-pull-sms:${link.id}`
    });
  } catch {
    sms = { outcome: null, detail: "sms_failed" };
  }

  const sent = (await markSent(db, { id: link.id, orgId })) || link;
  await mergeCustomFields(db, clientId, {
    closer_deck_soft_pull_sent_at: new Date().toISOString(),
    closer_deck_soft_pull_link_id: link.id
  });

  return {
    link: jsonSafeLink(sent, { offer_key: "SOFT_PULL" }),
    approve_url: approve.url,
    approve_expires_at: approve.expiresAtIso,
    email: jsonSafeCompose(composed),
    sms: jsonSafeCompose(sms)
  };
}

/** E-book downsell — closer sets the price. Empty PDF placeholder until Chris swaps it. */
export async function sendDeckEbook(db, {
  orgId, clientId, staffId, staffRole = null, amountCents,
  checkoutBaseUrl, description = null, env = process.env
}) {
  const cents = Number(amountCents);
  if (!Number.isInteger(cents) || cents < 100 || cents > 50000000) {
    throw new CloserDeckError(
      "E-book price must be a whole-cent amount between $1 and $500,000.",
      { status: 400, code: "bad_ebook_amount" }
    );
  }
  if (!checkoutBaseUrl && !String(env.FANBASIS_CHECKOUT_API_KEY || "").trim()) {
    throw new CloserDeckError(
      "FANBASIS_CHECKOUT_API_KEY is not set — no checkout link can be built",
      { status: 503, code: "commas_not_configured" }
    );
  }

  const label = String(description || "Fundhub e-book").trim().slice(0, 120) || "Fundhub e-book";
  let link;
  try {
    link = await createPaymentLink(db, {
      orgId,
      clientId,
      purpose: "custom",
      description: label,
      amountCents: cents,
      createdByStaffId: staffId,
      createdByRole: staffRole,
      checkoutBaseUrl,
      env
    });
  } catch (e) {
    throw new CloserDeckError(e.message || "Could not mint checkout link", {
      status: e.status || 502,
      code: e.code || "commas_checkout_failed"
    });
  }

  const first = await db.query(
    `SELECT first_name FROM clients WHERE id = $1 AND org_id = $2`,
    [clientId, orgId]
  );
  const firstName = first.rows[0]?.first_name || "there";
  const amount = formatCents(cents);

  const emailBody =
    `Hi ${firstName},\n\n` +
    `Here's the e-book we talked about on the call.\n\n` +
    `If it works for you, you can pay ${amount} here:\n${link.checkout_url}\n\n` +
    `The PDF is attached (placeholder until the final file is ready).\n\n` +
    `No pressure — stay on the Meet with your advisor if you have questions.\n\n` +
    `— Fundhub`;

  const composed = await composeAndSend(db, {
    orgId,
    staffId,
    clientId,
    channel: "email",
    subject: `${label} — ${amount}`,
    body: emailBody,
    idempotencyKey: `ebook-send:${link.id}`,
    attachments: [{ asset: "ebook-placeholder", filename: "fundhub-ebook.pdf" }]
  });

  const sent = (await markSent(db, { id: link.id, orgId })) || link;
  await mergeCustomFields(db, clientId, {
    closer_deck_ebook_sent_at: new Date().toISOString(),
    closer_deck_ebook_link_id: link.id,
    closer_deck_ebook_amount_cents: cents
  });

  return {
    link: jsonSafeLink(sent, { offer_key: null, description: label }),
    email: jsonSafeCompose(composed),
    attachment: "ebook-placeholder"
  };
}

function paymentPurpose(offer) {
  return offer.paymentPurpose || "custom";
}

export async function sendDeckPayLink(db, {
  orgId, clientId, staffId, staffRole = null, offerKey,
  saleMotion = null, checkoutBaseUrl, env = process.env
}) {
  const offer = getOffer(offerKey);
  if (!offer) {
    throw new CloserDeckError("Unknown offer.", { status: 400, code: "unknown_offer" });
  }
  if (!checkoutBaseUrl && !String(env.FANBASIS_CHECKOUT_API_KEY || "").trim()) {
    throw new CloserDeckError(
      "FANBASIS_CHECKOUT_API_KEY is not set — no checkout link can be built",
      { status: 503, code: "commas_not_configured" }
    );
  }
  const purpose = paymentPurpose(offer);
  const description = offer.name;
  if (offer.key !== "FUNDING_DFY" && saleMotion !== "downsell" && saleMotion !== "upsell") {
    throw new CloserDeckError(
      "Choose downsell or upsell before creating this payment link.",
      { status: 400, code: "sale_motion_required" }
    );
  }
  let link;
  try {
    link = await createPaymentLink(db, {
      orgId,
      clientId,
      purpose,
      description,
      amountCents: offer.priceCents,
      createdByStaffId: staffId,
      createdByRole: staffRole,
      productCode: offer.productCode,
      saleMotion: offer.key === "FUNDING_DFY" ? null : saleMotion,
      checkoutBaseUrl,
      env
    });
  } catch (e) {
    throw new CloserDeckError(e.message || "Could not mint checkout link", {
      status: e.status || 502,
      code: e.code || "commas_checkout_failed"
    });
  }
  const first = await db.query(
    `SELECT first_name FROM clients WHERE id = $1 AND org_id = $2`,
    [clientId, orgId]
  );
  const firstName = first.rows[0]?.first_name || "there";
  const amount = formatCents(Number(link.amount_cents)) || formatPrice(link.amount_cents);
  const emailBody =
    `Hi ${firstName},\n\n` +
    `Here's the ${description} pay link from our call.\n\n` +
    `Pay ${amount} here:\n${link.checkout_url}\n\n` +
    `Stay on the Meet with your advisor if you have questions.\n\n` +
    `— Fundhub`;
  const composed = await composeAndSend(db, {
    orgId,
    staffId,
    clientId,
    channel: "email",
    subject: `${description} — ${amount}`,
    body: emailBody,
    idempotencyKey: `pay-link-send:${link.id}`
  });
  let sms = null;
  try {
    sms = jsonSafeCompose(await composeAndSend(db, {
      orgId,
      staffId,
      clientId,
      channel: "sms",
      body: `Hi ${firstName}, Fundhub ${description}: pay ${amount} ${link.checkout_url}`,
      idempotencyKey: `pay-link-sms:${link.id}`
    }));
  } catch {
    sms = { outcome: null, detail: "sms_failed" };
  }
  const sent = (await markSent(db, { id: link.id, orgId })) || link;
  return {
    link: jsonSafeLink(sent, { offer_key: offer.key }),
    sms,
    email: jsonSafeCompose(composed)
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
  const emailQueued = await sendTemplated(db, {
    orgId,
    clientId,
    channel: "email",
    templateKey: EMAIL_TEMPLATE_KEY,
    eventId: `closer-deck-letters:${clientId}:${offerKey}`,
    staffId
  });
  const email = await dispatchQueued(db, emailQueued);
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

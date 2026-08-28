// Affiliate economics — attribution, accrual, and tier unlocking.
//
// 033_affiliates.sql models the affiliate and the referral; it does not decide
// when money is earned. This is that decision, and only that: no migration, no
// new table, no rate written in code.
//
// FOUR RULES, and where each one actually lives.
//
// 1. FIRST TOUCH IS IMMUTABLE. Enforced by the database, not here: the unique
//    index affiliate_referrals_client_tier_uniq means one direct owner and one
//    downline owner per client, forever, and every write uses ON CONFLICT DO
//    NOTHING. That single statement is both replay-idempotent and incapable of
//    stealing an existing attribution. attribute() below relies on that rather
//    than checking first and inserting second, because a check-then-insert has a
//    race and this is somebody's commission.
//
// 2. ACCRUAL ON QUALIFIED COMPLETED OUTCOMES ONLY. Not on a payment, not on a
//    signup — on an outcome that actually completed:
//      a funded engagement          (funding_rounds.funded_amount > 0)
//      a completed repair enrolment (a paid repair product on the sale)
//    A deposit is not an outcome. Idempotent per source event.
//
// 3. TIER 2 UNLOCKS on the FIRST funded referral OR the FIRST recruited
//    affiliate, whichever happens first, and unlocking is one-way. Once unlocked,
//    the recruiter earns a downline override on their recruits' conversions.
//
// 4. RATES ARE ROWS. Every amount comes from affiliate_commission_rules.
//    Owner-set 2026-08-24 (migrations 260–261): Tier 1 direct 20%, Tier 2 downline 5%.
//    This module still does not hardcode those numbers — it reads the rows.
//    With no rule in force, commission_due stays NULL, the balance stays zero and
//    nothing pays. `unrated` in the return value is how that stays visible rather
//    than looking like a zero-value conversion.

// Which products count as which kind of completed outcome. Product CODES, matched
// against products.code, because routing on a dollar amount is how a price change
// silently re-routes an outcome.
import { toCents, fromCents, percentOf } from "../commissions/money.mjs";

export const FUNDING_PRODUCT_CODES = ["card-stacking-dfy"];
export const REPAIR_PRODUCT_CODES = ["repair-bundle"];

export const TIER = { ONE: "tier1", TWO: "tier2" };

/* attribute — record first touch. Idempotent and non-stealing by construction.

   Returns { attributed, referralId, reason }. attributed:false with
   reason "already_attributed" is the sticky rule working, not a failure. */
export async function attribute(db, {
  orgId, affiliateId, clientId, tier = "direct",
  trackingIdUsed = null, source = null, sourceEvent = null,
  attributedAt = new Date(), detail = {}
} = {}) {
  if (!orgId || !affiliateId || !clientId) {
    throw new Error("attribute: orgId, affiliateId and clientId are required");
  }
  if (tier !== "direct" && tier !== "downline") {
    throw new Error(`attribute: tier must be "direct" or "downline", got "${tier}"`);
  }

  const ins = await db.query(
    `INSERT INTO affiliate_referrals
       (org_id, affiliate_id, client_id, tier, tracking_id_used, attributed_at,
        source, source_event, detail, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'attributed')
     ON CONFLICT (client_id, tier) DO NOTHING
     RETURNING id`,
    [orgId, affiliateId, clientId, tier, trackingIdUsed, attributedAt,
     source, sourceEvent, JSON.stringify(detail)]
  );

  if (ins.rows[0]) {
    // A recruited affiliate's recruiter may now qualify for tier 2.
    return { attributed: true, referralId: ins.rows[0].id, reason: null };
  }

  const existing = await db.query(
    `SELECT id, affiliate_id FROM affiliate_referrals WHERE client_id = $1 AND tier = $2`,
    [clientId, tier]
  );
  const row = existing.rows[0];
  return {
    attributed: false,
    referralId: row ? row.id : null,
    reason: row && row.affiliate_id === affiliateId ? "already_attributed" : "owned_by_other",
    ownedBy: row ? row.affiliate_id : null
  };
}

/* qualifyingOutcome — is this sale a completed outcome that earns commission?
   Returns { qualifies, kind, basis } or { qualifies: false, reason }.

   Routes on product CODE, never on amount. A funding engagement additionally
   requires a funded round: a signed deal that never funded is not an outcome. */
export async function qualifyingOutcome(db, { orgId, clientId, saleId } = {}) {
  if (!saleId) return { qualifies: false, reason: "no_sale" };

  const { rows } = await db.query(
    `SELECT s.id, s.client_id, p.code AS product_code
       FROM sales s
       LEFT JOIN products p ON p.id = s.product_id
      WHERE s.id = $1 AND s.org_id = $2`,
    [saleId, orgId]
  );
  const sale = rows[0];
  if (!sale) return { qualifies: false, reason: "sale_not_found" };

  const code = String(sale.product_code || "").trim().toLowerCase();

  if (FUNDING_PRODUCT_CODES.includes(code)) {
    // A funding sale earns only once money actually landed.
    const funded = await db.query(
      `SELECT 1 FROM funding_rounds
        WHERE client_id = $1 AND COALESCE(funded_amount, 0) > 0 LIMIT 1`,
      [sale.client_id]
    );
    if (!funded.rows[0]) return { qualifies: false, reason: "funding_not_completed" };
    return { qualifies: true, kind: "funded_engagement", productCode: code };
  }

  if (REPAIR_PRODUCT_CODES.includes(code)) {
    return { qualifies: true, kind: "repair_enrolment", productCode: code };
  }

  return { qualifies: false, reason: code ? `not_qualifying:${code}` : "no_product" };
}

/* findRule — the rate in force for (tier, product, affiliate), most specific
   first. Returns null when nothing matches. Owner-set defaults live in
   migration 261 (20% direct / 5% downline); a missing match must not invent a %. */
export async function findRule(db, {
  orgId, tier, productCode = null, affiliateId = null, asOf = new Date()
} = {}) {
  const { rows } = await db.query(
    `SELECT r.*, p.code AS product_code
       FROM affiliate_commission_rules r
       LEFT JOIN products p ON p.id = r.product_id
      WHERE r.org_id = $1
        AND (r.tier IS NULL OR r.tier = $2)
        AND (r.affiliate_id IS NULL OR r.affiliate_id = $3)
        AND (r.product_id IS NULL OR lower(btrim(p.code)) = $4)
        -- A retired rule must not keep paying. 033 carries both switches and
        -- ignoring them would let a deactivated or expired schedule accrue money
        -- nobody agreed to any more.
        AND r.active = true
        AND r.effective_from <= $5
        AND (r.effective_to IS NULL OR r.effective_to > $5)
      ORDER BY (r.affiliate_id IS NOT NULL) DESC,
               (r.product_id IS NOT NULL) DESC,
               (r.tier IS NOT NULL) DESC,
               r.effective_from DESC,
               r.created_at DESC
      LIMIT 1`,
    [orgId, tier, affiliateId, productCode ? String(productCode).toLowerCase() : null, asOf]
  );
  return rows[0] || null;
}

/* commissionFor — apply a rule to a basis. Pure, so the arithmetic is testable
   without a database. Returns null when there is no rule: a missing schedule must
   not become a zero-value conversion that looks settled. */
export function commissionFor(rule, basisAmount) {
  if (!rule) return null;
  const basis = Number(basisAmount || 0);
  if (rule.calc_method === "flat") {
    return { amount: fromCentsNumber(toCents(Number(rule.flat_amount || 0))), basis };
  }
  if (rule.calc_method === "percent") {
    /* INTEGER CENTS, not floats.

       This was `round2(basis * (percent / 100))`, where round2 was
       `Math.round((n + Number.EPSILON) * 100) / 100`. The EPSILON nudge is a
       no-op for any magnitude above 1 — EPSILON is relative to 1.0 — so
       near-tie products rounded DOWN and commission_due was persisted a cent
       short of what Postgres computes for the same expression. 15% of $1,010.10
       came out as 151.51 against an exact 151.52; the float path disagreed with
       exact half-up on 12 of 2730 realistic (price, percent) pairs.

       That matters more here than it looks: affiliate_commission_rules freezes
       rule_snapshot at conversion and nothing recalculates the accrual, so the
       wrong cent is permanent and the statement disagrees with any spreadsheet.

       src/commissions/money.mjs already does this exactly, and is what the
       commission ledger uses. Using it here removes the second, worse
       implementation rather than adding a third. */
    return {
      amount: fromCentsNumber(percentOf(toCents(basis), Number(rule.percent || 0))),
      basis
    };
  }
  return null;
}

/* money.mjs returns cents; this module's callers and the numeric(14,2) columns
   want a dollar Number. fromCents gives a fixed 2dp STRING, which is the right
   shape for display but not for arithmetic, so parse it back exactly once here. */
function fromCentsNumber(cents) {
  return Number(fromCents(cents));
}

/* basisFor — what the rate applies to. The enum is a formula per value and is
   NOT admin-editable (033's note); adding one is a code change. */
export async function basisFor(db, { amountBasis, saleId } = {}) {
  const one = async (sql, params) => {
    const { rows } = await db.query(sql, params);
    return rows[0] ? Number(rows[0].v || 0) : 0;
  };
  switch (amountBasis) {
    // The column is agreed_price (011_sales.sql), not price. 013/033 call the
    // basis "sale_price"; that is the enum value, not the column name.
    case "sale_price":
      return one(`SELECT agreed_price AS v FROM sales WHERE id = $1`, [saleId]);
    case "deposit_collected":
      return one(`SELECT COALESCE(sum(amount),0) AS v FROM sale_payments
                   WHERE sale_id = $1 AND kind = 'deposit'`, [saleId]);
    case "cash_collected":
      return one(`SELECT COALESCE(sum(amount),0) AS v FROM sale_payments
                   WHERE sale_id = $1 AND kind <> 'refund'`, [saleId]);
    case "first_payment":
      return one(`SELECT amount AS v FROM sale_payments
                   WHERE sale_id = $1 AND kind <> 'refund'
                   ORDER BY created_at ASC LIMIT 1`, [saleId]);
    default:
      throw new Error(`basisFor: unknown amount_basis "${amountBasis}"`);
  }
}

/* convert — the accrual. Marks a referral converted and records the commission,
   idempotently.

   Returns { converted, unrated, commissionDue, reason }. `unrated: true` means the
   conversion is real but no rule matched, so commission_due stays NULL —
   surfaced rather than defaulted to zero. */
export async function convert(db, {
  orgId, clientId, saleId, sourceEventId = null, now = new Date()
} = {}) {
  const outcome = await qualifyingOutcome(db, { orgId, clientId, saleId });
  if (!outcome.qualifies) return { converted: false, reason: outcome.reason };

  const refs = await db.query(
    `SELECT id, affiliate_id, tier, status FROM affiliate_referrals
      WHERE client_id = $1 AND status IN ('attributed', 'converted')`,
    [clientId]
  );
  if (!refs.rows.length) return { converted: false, reason: "no_attribution" };

  const results = [];
  for (const ref of refs.rows) {
    // Already converted: idempotent no-op. The event may be a replay.
    if (ref.status === "converted") {
      results.push({ referralId: ref.id, tier: ref.tier, converted: false,
                     reason: "already_converted" });
      continue;
    }

    // A downline override only pays if the recruiter has actually unlocked tier 2.
    if (ref.tier === "downline") {
      const up = await db.query(
        `SELECT tier_level FROM affiliates WHERE id = $1`, [ref.affiliate_id]);
      if (!up.rows[0] || up.rows[0].tier_level !== TIER.TWO) {
        results.push({ referralId: ref.id, tier: ref.tier, converted: false,
                       reason: "recruiter_not_tier2" });
        continue;
      }
    }

    const rule = await findRule(db, {
      orgId, tier: ref.tier, productCode: outcome.productCode, affiliateId: ref.affiliate_id
    });
    let due = null, basis = null, snapshot = {};
    if (rule) {
      basis = await basisFor(db, { amountBasis: rule.amount_basis, saleId });
      const c = commissionFor(rule, basis);
      due = c ? c.amount : null;
      snapshot = {
        rule_name: rule.name, calc_method: rule.calc_method,
        percent: rule.percent, flat_amount: rule.flat_amount,
        amount_basis: rule.amount_basis
      };
    }

    await db.query(
      `UPDATE affiliate_referrals
          SET status = 'converted',
              converted_at = COALESCE(converted_at, $2),
              converting_sale_id = COALESCE(converting_sale_id, $3),
              commission_due = $4,
              basis_amount = $5,
              rule_id = $6,
              rule_snapshot = $7,
              updated_at = now()
        WHERE id = $1 AND status = 'attributed'`,
      [ref.id, now, saleId, due, basis, rule ? rule.id : null, JSON.stringify(snapshot)]
    );

    results.push({
      referralId: ref.id, tier: ref.tier, affiliateId: ref.affiliate_id,
      converted: true, unrated: !rule, commissionDue: due, basisAmount: basis
    });
  }

  // A funded referral may unlock the direct affiliate's tier 2.
  const unlocked = [];
  if (outcome.kind === "funded_engagement") {
    for (const r of results.filter((x) => x.converted && x.tier === "direct")) {
      const u = await maybeUnlockTier2(db, { orgId, affiliateId: r.affiliateId, now });
      if (u.unlocked) unlocked.push(r.affiliateId);
    }
  }

  return {
    converted: results.some((r) => r.converted),
    kind: outcome.kind,
    unrated: results.some((r) => r.converted && r.unrated),
    results,
    tier2Unlocked: unlocked
  };
}

/* maybeUnlockTier2 — tier 2 opens on the FIRST funded referral OR the FIRST
   recruited affiliate, whichever comes first. One-way: it never re-locks, because
   a downline that was earning cannot stop mid-relationship. */
export async function maybeUnlockTier2(db, { orgId, affiliateId, now = new Date() } = {}) {
  if (!affiliateId) return { unlocked: false, reason: "no_affiliate" };

  const cur = await db.query(
    `SELECT tier_level, tier2_unlocked_at FROM affiliates WHERE id = $1`, [affiliateId]);
  if (!cur.rows[0]) return { unlocked: false, reason: "not_found" };
  if (cur.rows[0].tier_level === TIER.TWO) {
    return { unlocked: false, reason: "already_tier2" };
  }

  const funded = await db.query(
    `SELECT 1 FROM affiliate_referrals r
       JOIN funding_rounds f ON f.client_id = r.client_id
      WHERE r.affiliate_id = $1 AND r.tier = 'direct'
        AND r.status IN ('converted', 'paid')
        AND COALESCE(f.funded_amount, 0) > 0
      LIMIT 1`, [affiliateId]);

  const recruited = await db.query(
    `SELECT 1 FROM affiliates WHERE recruited_by = $1 LIMIT 1`, [affiliateId]);

  const reason = funded.rows[0] ? "funded_referral"
               : recruited.rows[0] ? "recruited_affiliate" : null;
  if (!reason) return { unlocked: false, reason: "no_qualifying_event" };

  await db.query(
    `UPDATE affiliates
        SET tier_level = $2, tier2_unlocked_at = COALESCE(tier2_unlocked_at, $3),
            updated_at = now()
      WHERE id = $1 AND tier_level <> $2`,
    [affiliateId, TIER.TWO, now]
  );
  return { unlocked: true, reason };
}

/* voidReferral — disqualify or claw back. Excluded from the balance by 033's
   derived state; the row is kept. */
export async function voidReferral(db, { referralId, reason } = {}) {
  if (!reason) throw new Error("voidReferral: a reason is required");
  const { rows } = await db.query(
    `UPDATE affiliate_referrals
        SET status = 'void', void_reason = $2, updated_at = now()
      WHERE id = $1 AND status <> 'paid'
      RETURNING id, status`,
    [referralId, reason]
  );
  return rows[0] || null;
}

/* unratedConversions — conversions that earned nothing because no rule matched.
   With migration 260 seeded, this should stay empty for normal funding/repair
   outcomes; it still surfaces gaps if a product or org has no rule. */
export async function unratedConversions(db, { orgId } = {}) {
  const { rows } = await db.query(
    `SELECT r.id, r.affiliate_id, r.client_id, r.tier, r.converted_at
       FROM affiliate_referrals r
      WHERE r.org_id = $1 AND r.status = 'converted' AND r.commission_due IS NULL
      ORDER BY r.converted_at DESC`,
    [orgId]
  );
  return rows;
}

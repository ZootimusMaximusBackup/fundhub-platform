/* THE PAYOUT RUN — turning what an affiliate is owed into a payout they can
 * actually be paid.
 *
 * THIS IS THE HALF THAT DID NOT EXIST. Commission has been accruing correctly
 * to affiliate_referrals.commission_due since 2026-08-31 (convert() in
 * economics.mjs, called from money-chain.mjs on every sale_payments write).
 * Nothing ever turned any of it into a payout. Measured 2026-09-20: every
 * INSERT into affiliate_payouts or affiliate_payout_lines anywhere in this
 * repository was a test fixture or a demo seed — no workflow, no sweeper, no
 * endpoint, no script. So money owed sat on the referral row for ever.
 *
 *
 * *** THIS FILE MOVES NO MONEY AND CANNOT. ***
 *
 * It writes rows. A run is created 'pending' or 'held' and stops there. Getting
 * from 'pending' to 'processing' to 'paid' is a separate, human action against
 * a payment rail this repository does not have — and 033_affiliates.sql's
 * affiliate_payouts_guard() refuses 'processing' or 'paid' outright for any
 * affiliate with no partner_license_signed_at, whoever asks and however they
 * ask. Nothing here transmits, and no outbound fetch belongs in this file
 * (CLAUDE.md §12: src/messaging/providers/* is the only place that may).
 *
 *
 * OWNER-SET DEFAULTS, 2026-09-21. Chris was asked for three numbers and said to
 * pick them. These are the picks, all three overridable per call, and every one
 * chosen to fail toward "pay later" rather than "pay twice":
 *
 *   CADENCE   Monthly, covering the previous whole calendar month.
 *   MINIMUM   $50. Under it, the affiliate is skipped and NOTHING is written,
 *             so the commission stays unsettled and rolls into the next run by
 *             itself. A carried balance needs no carrying mechanism — it is
 *             simply a referral that has not been put on a line yet.
 *   GATES     An unsigned partner license or a missing tax form creates the run
 *             'held' with the reason on the row. Held, not skipped: the money
 *             is counted and visible on their portal, it just cannot leave.
 *             The license half is belt and braces — the database refuses the
 *             release anyway. The tax half is enforced ONLY here, because
 *             affiliates.tax_form_received_at has no database guard.
 *
 *
 * WHY DOUBLE-PAYING IS NOT A FAILURE MODE. It is not this code being careful —
 * it is the schema. affiliate_payout_lines_commission_once (033:545) is a
 * UNIQUE index on referral_id for kind='commission'. Two runs racing each other
 * over the same converted referral do not both write a line; the second one
 * hits the index and loses. The SELECT below also excludes anything already
 * lined, but that read is the optimisation and the index is the guarantee, and
 * they are in that order on purpose.
 *
 * The run's own `amount` is likewise not computed here — it is a rollup the
 * trigger maintains from the lines, and 033 rejects a hand-written total that
 * disagrees with its own line items.
 */

import { toCents } from "../commissions/money.mjs";

/* The three defaults, in one place, named. */
export const PAYOUT_DEFAULTS = {
  minimumUsd: 50,
  cadence: "monthly",
  heldReasons: { license: "partner_license_unsigned", tax: "tax_form_missing" }
};

/* The previous whole calendar month, in UTC. A run started at any moment on
 * 1 October covers 1–30 September and nothing else. */
export function previousMonth(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1));
  return { periodStart: start, periodEnd: end };
}

/* The idempotency key. Deliberately derived from the affiliate and the period
 * and NOTHING ELSE — not the time, not a counter, not a random value. A re-run
 * of the same month for the same person must collide on
 * affiliate_payouts_idem_uniq (033:496) rather than build a second run. */
export function payoutKey(affiliateId, periodStart, periodEnd) {
  return `affrun:${affiliateId}:${periodStart.toISOString().slice(0, 10)}:${periodEnd.toISOString().slice(0, 10)}`;
}

/* What is owed and not yet on any run, per affiliate, for one company.
 *
 * `converted` only. An 'attributed' referral is one whose outcome has not
 * happened yet and whose commission_due is NULL; paying one would be paying for
 * a sale that has not completed. 'void' is excluded for the obvious reason and
 * 'paid' because it is already settled.
 *
 * NULL commission_due is skipped rather than read as zero. CLAUDE.md §12: NULL
 * means unknown and must survive. An unknown basis — a partner share nobody has
 * recorded — must not quietly become a $0.00 line that settles the referral for
 * ever against the commission-once index. */
const OWED_SQL = `
  SELECT r.id, r.affiliate_id, r.client_id, r.tier, r.commission_due,
         r.basis_amount, r.rule_snapshot,
         c.client_code
    FROM affiliate_referrals r
    LEFT JOIN clients c ON c.id = r.client_id
   WHERE r.org_id = $1
     AND r.status = 'converted'
     AND r.commission_due IS NOT NULL
     AND r.commission_due > 0
     AND r.converted_at < $2
     AND NOT EXISTS (
           SELECT 1 FROM affiliate_payout_lines l
            WHERE l.referral_id = r.id AND l.kind = 'commission')
   ORDER BY r.affiliate_id, r.converted_at`;

/**
 * buildPayoutRun — one company, one period.
 *
 * Returns a plain report: what was built, what was held and why, what was under
 * the minimum and is therefore waiting for next month. Every number in it comes
 * from a row that was actually written.
 */
export async function buildPayoutRun(db, {
  orgId,
  periodStart,
  periodEnd,
  minimumUsd = PAYOUT_DEFAULTS.minimumUsd,
  now = new Date()
} = {}) {
  if (!orgId) throw new Error("buildPayoutRun: orgId is required");
  if (!periodStart || !periodEnd) {
    ({ periodStart, periodEnd } = previousMonth(now));
  }
  if (!(periodEnd > periodStart)) {
    throw new Error("buildPayoutRun: periodEnd must be after periodStart");
  }

  const minimumCents = toCents(minimumUsd);
  const report = {
    orgId, periodStart, periodEnd,
    payoutsCreated: 0, linesCreated: 0,
    held: [], belowMinimum: [], skippedAlreadyRun: [], payouts: []
  };

  const owed = (await db.query(OWED_SQL, [orgId, periodEnd])).rows;
  if (!owed.length) return report;

  const byAffiliate = new Map();
  for (const r of owed) {
    if (!byAffiliate.has(r.affiliate_id)) byAffiliate.set(r.affiliate_id, []);
    byAffiliate.get(r.affiliate_id).push(r);
  }

  for (const [affiliateId, referrals] of byAffiliate) {
    const totalCents = referrals.reduce((n, r) => n + toCents(r.commission_due), 0);

    /* UNDER THE MINIMUM — write nothing at all. Not a zero run, not a held run.
       The referrals stay unlined, so next month's query picks them up again
       with whatever has been added since, and the balance carries itself. */
    if (totalCents < minimumCents) {
      report.belowMinimum.push({ affiliateId, cents: totalCents, count: referrals.length });
      continue;
    }

    const aff = (await db.query(
      `SELECT id, partner_license_signed_at, tax_form_received_at, payout_method
         FROM affiliates WHERE id = $1 AND org_id = $2`,
      [affiliateId, orgId]
    )).rows[0];
    if (!aff) continue;   // an affiliate in another company's books is not ours to pay

    /* THE GATES. License first because it is the one the database also enforces;
       naming the other reason when both are open would under-report the harder
       blocker to whoever reads the row. */
    let status = "pending";
    let holdReason = null;
    if (!aff.partner_license_signed_at) {
      status = "held"; holdReason = PAYOUT_DEFAULTS.heldReasons.license;
    } else if (!aff.tax_form_received_at) {
      status = "held"; holdReason = PAYOUT_DEFAULTS.heldReasons.tax;
    }

    const key = payoutKey(affiliateId, periodStart, periodEnd);

    /* ON CONFLICT DO NOTHING against the idempotency index. A second run of the
       same month returns no row here and is reported as already-run rather than
       throwing — a re-run is an ordinary thing to do, not an error. */
    const created = (await db.query(
      `INSERT INTO affiliate_payouts
         (org_id, affiliate_id, period_start, period_end, status, hold_reason,
          method, idempotency_key, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL
         DO NOTHING
       RETURNING id`,
      [orgId, affiliateId, periodStart, periodEnd, status, holdReason,
       aff.payout_method || null, key,
       `Built by the ${PAYOUT_DEFAULTS.cadence} payout run.`]
    )).rows[0];

    if (!created) { report.skippedAlreadyRun.push({ affiliateId, key }); continue; }

    let lines = 0;
    for (const r of referrals) {
      /* ON CONFLICT DO NOTHING again, against affiliate_payout_lines_commission_once.
         If another run got to this referral between the SELECT and here, it owns
         it, and this one simply does not carry it. */
      const line = (await db.query(
        `INSERT INTO affiliate_payout_lines
           (org_id, payout_id, referral_id, kind, amount, client_id, client_code,
            basis_amount, rule_snapshot)
         VALUES ($1,$2,$3,'commission',$4,$5,$6,$7,$8)
         ON CONFLICT (referral_id) WHERE kind = 'commission' DO NOTHING
         RETURNING id`,
        [orgId, created.id, r.id, r.commission_due, r.client_id, r.client_code || null,
         r.basis_amount, r.rule_snapshot || {}]
      )).rows[0];
      if (line) lines += 1;
    }

    /* A run that ended up carrying nothing — every referral taken by a racing
       run between the read and the write — is voided rather than left as an
       empty $0.00 payout somebody has to interpret later. */
    if (lines === 0) {
      await db.query(
        `UPDATE affiliate_payouts
            SET status = 'void', void_reason = 'no_lines_all_settled_elsewhere',
                updated_at = now()
          WHERE id = $1`,
        [created.id]
      );
      report.skippedAlreadyRun.push({ affiliateId, key });
      continue;
    }

    report.payoutsCreated += 1;
    report.linesCreated += lines;
    report.payouts.push({ payoutId: created.id, affiliateId, lines, status, holdReason });
    if (status === "held") report.held.push({ affiliateId, payoutId: created.id, reason: holdReason });
  }

  return report;
}

/**
 * buildPayoutRunsForAllOrgs — the same thing, every company.
 *
 * Scoped per company and never across them: one white-label partner's run must
 * not sweep another's referrals into it. One company failing does not stop the
 * rest; its error is reported and the loop continues, because a run that stops
 * halfway is worse than one that says which company it could not do.
 */
export async function buildPayoutRunsForAllOrgs(db, { now = new Date(), minimumUsd } = {}) {
  const { periodStart, periodEnd } = previousMonth(now);
  const orgs = (await db.query(`SELECT id FROM orgs`)).rows;
  const out = { periodStart, periodEnd, orgs: [], errors: [] };

  for (const o of orgs) {
    try {
      out.orgs.push(await buildPayoutRun(db, {
        orgId: o.id, periodStart, periodEnd, minimumUsd, now
      }));
    } catch (err) {
      out.errors.push({ orgId: o.id, error: err && err.message ? err.message : String(err) });
    }
  }
  return out;
}

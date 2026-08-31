/* Success-fee basis — the one place that answers the two money questions a
   funded round has to answer before anyone can be billed:

     1. How much did we actually CONFIRM as approved on this round?
     2. At what percent did this client agree to pay us for it?

   ── OWNER DECISION (owner-set 2026-08-30, final) ──────────────────────────
   Supersedes the 2026-08-04 funded-amount basis. Chris:

     "Approved is correct. They can really be used interchangeably. Technically
      we are getting people approved, NOT funding the actual credit cards. But
      yeah if that is cool then make sure we bill based on confirmed approvals."

   The success fee is a percent of CONFIRMED APPROVALS. Not the funded amount.
   See docs/CLOSEOUT-FEE-BASIS.md.

   ── WHAT "CONFIRMED APPROVALS" IS, EXACTLY ────────────────────────────────
       SUM(applications.approved_amount)
        WHERE funding_round_id = <round>
          AND status = 'Approved'
          AND approved_amount IS NOT NULL
          AND approved_amount > 0

   The per-application sum, NOT funding_rounds.approved_amount. Three reasons,
   and this was a money decision, so they are written down:

   * "Approved, amount unknown" is a real shipped state (owner-set 2026-08-29,
     src/applications/status.mjs). A bank yes with no number is an approval we
     have not CONFIRMED. Only the application rows can tell the two apart — a
     round-level roll-up has already thrown that distinction away.
   * funding_rounds.approved_amount is a derived summary. On the card-stacking
     rail it fell through to the FUNDED amount when no approvals existed, so it
     can hold a real number on a round where nothing was confirmed at all.
     Billing off it would quietly reinstate the funded basis this decision
     replaced.
   * funding_closeout_items is already one row per confirmed approval, so the
     invoice total and the lender breakdown reconcile to the cent.

   ── THE RATE ──────────────────────────────────────────────────────────────
   sales.agreed_success_fee_percent on the sale this round is linked to, in
   PERCENT UNITS (10 means 10%). Frozen at the sale, never the product's
   current default — the same rule src/commissions/calculate.mjs already
   applies to back-end commission. No agreed rate is a refusal, never a
   hardcoded 10.

   ── NULL IS UNKNOWN AND IT SURVIVES (CLAUDE.md §12) ───────────────────────
   Nothing confirmed returns null and a NAMED REASON. It never returns 0. A $0
   success fee is not a smaller bill, it is a bill that says we are owed
   nothing, sent to a client who owes us money.

   COMPLIANCE REVIEW REQUIRED: fee basis. */

import { toCents, fromCents, percentOf } from "../commissions/money.mjs";

/** Named refusal reasons. A caller must surface one of these, never a zero. */
export const NO_ROUND = "no_funding_round";
export const NO_CONFIRMED_APPROVALS = "no_confirmed_approvals";
export const NO_AGREED_FEE_PERCENT = "no_agreed_fee_percent";

/** Plain-English version of each refusal, for a task a person has to read. */
export const REFUSAL_TEXT = Object.freeze({
  [NO_ROUND]: "No funding round on this event — cannot work out what to bill",
  [NO_CONFIRMED_APPROVALS]:
    "No confirmed approvals — record the approved amount on each bank yes before invoicing",
  [NO_AGREED_FEE_PERCENT]:
    "No agreed success fee percent on this client's sale — set it before invoicing"
});

/* Approved applications that carry a real recorded amount. An Approved row with
   a NULL amount is deliberately NOT here: it is an approval nobody has
   confirmed a number for yet.

   Nor is an EXCLUDED approval — one staff have recorded as not counting because
   it was withdrawn, or the client never used it (migration 272). That is a
   decision on the record, with a name and a time against it, and it holds even
   when the row does carry an amount: an approval that is not ours to bill is
   not ours to bill at any size. status stays 'Approved' throughout, so
   approval-rate reporting still sees the bank's yes. */

/* ── ONE DEFINITION, EVERY PLACE THAT ASKS THE QUESTION ────────────────────
   "Is this bank yes worth anything yet?" was answered in three different
   places, in three slightly different ways, and they already disagreed:

     * this file (the biller)          — NULL or <= 0, and not excluded
     * api/dashboard/pipeline.mjs      — NULL only, and excluded rows still
                                         flagged, so the "Doesn't count" button
                                         that shipped 2026-08-30 left the board
                                         card saying "Amount needed" for good
     * client-control-panel.html       — its own JavaScript copy

   A screen cannot import a module, so the third one stays written in the page —
   but the two SQL callers now share one string, and
   src/http/client-panel-screen.test.mjs pins the screen's copy against it.

   The alias is OUR OWN literal, never anything a request can reach, and it is
   still checked: a typo that reached the query as text would be a SQL fault
   nobody could read. */
function aliasPrefix(alias) {
  const a = String(alias || "");
  if (a === "") return "";
  if (!/^[a-z_][a-z0-9_]*$/.test(a)) {
    throw new TypeError(`approval SQL alias must be a plain identifier, got ${JSON.stringify(alias)}`);
  }
  return a + ".";
}

/** A bank yes that is NOT worth anything on the bill yet: approved, nobody has
 *  recorded it as not counting, and no usable dollar amount. NULL means nobody
 *  has told us; a non-positive number is an older import, and neither one can
 *  be invoiced. */
export function unpricedApprovalConditions(alias = "") {
  const c = aliasPrefix(alias);
  return `${c}status = 'Approved'
   AND ${c}approval_excluded_at IS NULL
   AND (${c}approved_amount IS NULL OR ${c}approved_amount <= 0)`;
}

/** The mirror: a bank yes we HAVE confirmed a number for, which is what the
 *  success fee is a percent of. */
export function confirmedApprovalConditions(alias = "") {
  const c = aliasPrefix(alias);
  return `${c}status = 'Approved'
   AND ${c}approval_excluded_at IS NULL
   AND ${c}approved_amount IS NOT NULL
   AND ${c}approved_amount > 0`;
}

const SQL_CONFIRMED_APPROVALS = `
SELECT id, approved_amount, lender_name, bank, status
  FROM applications
 WHERE funding_round_id = $1::uuid
   AND ($2::uuid IS NULL OR org_id = $2::uuid)
   AND ${confirmedApprovalConditions()}
 ORDER BY created_at ASC`;

/* The mirror image of the query above, and the reason it exists: every bank yes
   on this round that is NOT yet worth anything on the bill.

   Approved, not excluded, and no usable amount — NULL because nobody has told
   us yet, or a non-positive number left behind by an older import. Each of
   these is an approval the client would never be invoiced for, so a round must
   not be marked Funded while one is still here (guardFundedAmount).

   The bank NAME comes back so the refusal can say which ones to go and fill in.
   A refusal a person cannot act on is just a locked door. */
const SQL_UNPRICED_APPROVALS = `
SELECT id, lender_id, approved_amount,
       COALESCE(NULLIF(btrim(lender_name), ''), NULLIF(btrim(bank), '')) AS bank
  FROM applications
 WHERE funding_round_id = $1::uuid
   AND ($2::uuid IS NULL OR org_id = $2::uuid)
   AND ${unpricedApprovalConditions()}
 ORDER BY created_at ASC`;

/* The rate the client agreed to, frozen on the sale this round is linked to.
   funding_round_sales is written at round.started (money-chain). */
const SQL_AGREED_FEE_PERCENT = `
SELECT s.id AS sale_id, s.agreed_success_fee_percent
  FROM funding_round_sales frs
  JOIN sales s ON s.id = frs.sale_id
 WHERE frs.funding_round_id = $1::uuid
   AND ($2::uuid IS NULL OR frs.org_id = $2::uuid)
 LIMIT 1`;

/** A dollar amount that is genuinely a number, or null. Never 0 for unknown. */
export function amountOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Every confirmed approval on a round, oldest first. */
export async function listConfirmedApprovals(db, { orgId = null, fundingRoundId } = {}) {
  if (!fundingRoundId) return [];
  const r = await db.query(SQL_CONFIRMED_APPROVALS, [fundingRoundId, orgId || null]);
  return r.rows || [];
}

/**
 * Every bank yes on a round that still has no dollar amount against it, and
 * that nobody has excluded. Oldest first. Each row carries `bank` so a caller
 * can name it.
 *
 * Empty means every approval on this round is either priced or excluded — which
 * is exactly the condition for letting the round be marked Funded.
 */
export async function listUnpricedApprovals(db, { orgId = null, fundingRoundId } = {}) {
  if (!fundingRoundId) return [];
  const r = await db.query(SQL_UNPRICED_APPROVALS, [fundingRoundId, orgId || null]);
  return r.rows || [];
}

/**
 * The bank names from listUnpricedApprovals, in order, with no blanks and no
 * repeats. A row that never recorded a lender name reads as "Unnamed bank"
 * rather than vanishing — an approval nobody can see is the one that rots.
 */
export function unpricedApprovalNames(rows) {
  const names = [];
  for (const row of rows || []) {
    const name = String(row?.bank || "").trim() || "Unnamed bank";
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * The confirmed approved total for a round, in dollars.
 * null — and only null — when nothing on this round is confirmed.
 */
export async function sumConfirmedApprovals(db, { orgId = null, fundingRoundId } = {}) {
  const rows = await listConfirmedApprovals(db, { orgId, fundingRoundId });
  if (!rows.length) return null;
  let cents = 0;
  for (const row of rows) {
    const dollars = amountOrNull(row.approved_amount);
    if (dollars == null) continue;
    cents += toCents(dollars);
  }
  return cents > 0 ? Number(fromCents(cents)) : null;
}

/**
 * The agreed success-fee percent for a round, in PERCENT UNITS (10 = 10%).
 * null when the round has no linked sale, or the sale never agreed a rate.
 */
export async function agreedFeePercent(db, { orgId = null, fundingRoundId } = {}) {
  if (!fundingRoundId) return { feePercent: null, saleId: null };
  const r = await db.query(SQL_AGREED_FEE_PERCENT, [fundingRoundId, orgId || null]);
  const row = (r.rows || [])[0];
  if (!row) return { feePercent: null, saleId: null };
  const pct = amountOrNull(row.agreed_success_fee_percent);
  return {
    feePercent: pct != null && pct > 0 && pct <= 100 ? pct : null,
    saleId: row.sale_id || null
  };
}

/**
 * The fee itself, in integer cents. Money is integer cents (CLAUDE.md §12);
 * `feePercent` is in PERCENT UNITS, so 10 means 10% — NOT 0.10.
 * Returns null when either input is unknown. Never 0 for unknown.
 */
export function successFeeCents(approvedAmount, feePercent) {
  const amount = amountOrNull(approvedAmount);
  const pct = amountOrNull(feePercent);
  if (amount == null || amount <= 0) return null;
  if (pct == null || pct <= 0 || pct > 100) return null;
  return percentOf(toCents(amount), pct);
}

/**
 * Everything needed to bill one funded round, read from the database.
 *
 * @returns {Promise<{
 *   ok: boolean, reason: string|null, saleId: string|null,
 *   confirmedApprovedAmount: number|null, feePercent: number|null,
 *   feeAmount: string|null, feeCents: number|null, approvals: object[]
 * }>}
 * `feeAmount` is a fixed 2dp string, ready for a numeric column.
 * On a refusal every money field is null — never a zero.
 */
export async function resolveSuccessFee(db, { orgId = null, fundingRoundId } = {}) {
  const none = {
    ok: false, reason: NO_ROUND, saleId: null,
    confirmedApprovedAmount: null, feePercent: null,
    feeAmount: null, feeCents: null, approvals: []
  };
  if (!fundingRoundId) return none;

  const approvals = await listConfirmedApprovals(db, { orgId, fundingRoundId });
  const confirmed = approvals.length
    ? await sumConfirmedApprovals(db, { orgId, fundingRoundId })
    : null;
  const { feePercent, saleId } = await agreedFeePercent(db, { orgId, fundingRoundId });

  if (confirmed == null) {
    return { ...none, reason: NO_CONFIRMED_APPROVALS, saleId, feePercent, approvals };
  }
  if (feePercent == null) {
    return {
      ...none, reason: NO_AGREED_FEE_PERCENT, saleId,
      confirmedApprovedAmount: confirmed, approvals
    };
  }

  const feeCents = successFeeCents(confirmed, feePercent);
  if (feeCents == null) {
    return {
      ...none, reason: NO_CONFIRMED_APPROVALS, saleId,
      confirmedApprovedAmount: confirmed, feePercent, approvals
    };
  }

  return {
    ok: true,
    reason: null,
    saleId,
    confirmedApprovedAmount: confirmed,
    feePercent,
    feeAmount: fromCents(feeCents),
    feeCents,
    approvals
  };
}

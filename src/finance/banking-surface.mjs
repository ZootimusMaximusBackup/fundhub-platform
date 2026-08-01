// Banking surface — a client's bank accounts, split by WHOSE MONEY IT IS.
//
// This extends the Finance OS grid (src/finance/os-grid.mjs), which is
// tradelines-only. Where that answers "what credit do they have", this answers
// "what cash is there, and whose is it".
//
//
// THE ONE RULE THIS MODULE EXISTS TO ENFORCE: UNKNOWN IS NOT PERSONAL.
//
// Migration 082 makes `entity_kind` NOT NULL DEFAULT 'unknown' with a CHECK of
// ('unknown','personal','business'), and a provenance constraint so a row cannot
// claim a classification without saying how it was reached. That is the storage
// half. This is the reading half, and it is where the rule is easiest to lose:
// the natural thing to write is `personal = everything that is not business`,
// and that single line silently attributes an unclassified account — which may
// be a business account, a spouse's, or a trust's — to the person.
//
// So this module NEVER folds 'unknown' into 'personal', and it goes further:
//
//   THERE IS NO COMBINED TOTAL ACROSS GROUPS, AND THAT IS DELIBERATE.
//
// A single "total cash" figure is the same defect wearing a friendlier face. The
// moment one number spans personal + business + unknown, a reader takes it as
// the client's money, and for two of those three groups that is not established.
// If a combined figure is ever genuinely wanted, it has to be asked for on
// purpose, by somebody who has decided what it means. Not returned by default.
//
//
// BALANCES ARE NOT CLAMPED, unlike credit headroom in os-grid.mjs.
// An overdrawn account is a real and important fact; `Math.max(0, …)` would hide
// exactly the account somebody needs to see. 081 stores balances as signed
// bigint cents for that reason.
//
// NULL MEANS UNKNOWN AND MUST SURVIVE. A bank that did not report an available
// balance has an unknown available balance, not a zero one. Group totals carry
// the same `basis` the Finance OS grid uses — counted, unknown, partial — and a
// total with a hole in it is a floor, not a figure.
//
// Pure. No I/O, no clock, no randomness, so all of the above is testable without
// Postgres and without a browser.

import { fromCents } from "../commissions/money.mjs";
// REUSED, NOT REIMPLEMENTED. "A total over a data set with holes in it is a
// floor and must say so" is one rule; two copies would drift apart.
import { sumKnown, basisOf } from "./os-grid.mjs";

/* The order the screen reads in, and the order these are returned in. `unknown`
   is LAST because it is the pile that needs work, not because it matters least —
   putting it first would bury the established accounts under the unresolved
   ones. All three are always present, even when empty, so the shape is
   predictable and a missing group can never be mistaken for an empty one. */
export const ENTITY_KINDS = ["personal", "business", "unknown"];

const LABELS = {
  personal: "Personal",
  business: "Business",
  // Not "Other". "Unclassified" says a decision has not been made yet, which is
  // the actual state and the thing somebody has to act on.
  unclassified: "Unclassified — whose money this is has not been established"
};

/* A closed account is excluded from balances but still counted, because "this
   client had six accounts and two are closed" is a different fact from "this
   client has four accounts". */
const isOpen = (a) => a && !a.closed_at;

/* The only type whose balance columns mean cash. 081:85-87 spells out that they
   mean something else on every other type — on a card `available` is remaining
   headroom and `current` is the amount owed — and 081:71 warns that treating an
   unclassified type as a deposit account "would quietly turn an unclassified
   line of credit into cash on hand". One predicate, used by both the totals and
   the overdrawn flag, so the two cannot drift apart. */
const isDepository = (a) => a?.account_type === "depository";

function cents(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

const money = (c) => (c === null ? null : fromCents(c));

/* readEntityKind — the stored value, or 'unknown'.
 *
 * ANYTHING UNRECOGNISED BECOMES 'unknown', NEVER 'personal'. 082's CHECK should
 * make an unrecognised value impossible, but this module also runs against rows
 * from a database that may be older than the constraint, and the safe direction
 * is unambiguous: mis-filing a personal account as unclassified costs somebody a
 * click, mis-filing anything else as personal is a false statement about whose
 * money it is. */
export function readEntityKind(value) {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "personal" || v === "business" ? v : "unknown";
}

/* accountView — one row as the screen should see it. The mask is passed through
   as stored (081 keeps the last digits only; there is no full account number
   column to leak) and the balances are rendered but never invented. */
function accountView(a) {
  const available = cents(a.available_balance_cents);
  const current = cents(a.current_balance_cents);
  return {
    id: a.id,
    name: a.name || a.official_name || null,
    mask: a.mask ?? null,
    account_type: a.account_type ?? null,
    account_subtype: a.account_subtype ?? null,
    entity_kind: readEntityKind(a.entity_kind),
    // How we know. NULL here on a classified account should be impossible under
    // 082's provenance CHECK; surfaced anyway so the screen can show the basis
    // rather than asking the reader to trust the label.
    entity_kind_source: a.entity_kind_source ?? null,
    entity_kind_set_at: a.entity_kind_set_at ?? null,
    available_balance_cents: available,
    current_balance_cents: current,
    available_display: money(available),
    current_display: money(current),
    balance_as_of: a.balance_as_of ?? null,
    closed_at: a.closed_at ?? null,
    // An overdrawn account is worth naming rather than leaving the reader to
    // notice a minus sign in a column of numbers.
    //
    // ONLY ON A DEPOSIT ACCOUNT, for the same reason the totals below only add
    // deposit accounts. 081:85-87: on a card `current` is the amount OWED, so a
    // maxed-out card reads POSITIVE and never trips this, while a card the
    // client has OVERPAID reads negative and gets painted red — the flag fires
    // on the healthiest card on the screen and stays silent on the worst one.
    //
    // NULL, NOT FALSE, on anything else. False reads as "we checked, it is
    // fine". On a loan, an investment account, or an account whose type the
    // bank never told us, whether it is overdrawn is not established.
    overdrawn: isDepository(a) ? current !== null && current < 0 : null
  };
}

/**
 * bankingSurface — stored bank_accounts rows → the grouped view.
 *
 * Returns:
 *   {
 *     source: "bank_accounts",
 *     accounts, open_accounts, closed_accounts,
 *     unclassified,                 // how many still need a decision
 *     needs_classification,         // boolean — the call to action
 *     groups: [ { key, label, accounts: [...], count, open_count,
 *                 available: { value, display, basis },
 *                 current:   { value, display, basis } } x3 ]
 *   }
 *
 * There is deliberately NO top-level combined balance. See the header.
 */
export function bankingSurface(rows = []) {
  const all = (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r === "object");
  const views = all.map(accountView);

  const groups = ENTITY_KINDS.map((key) => {
    const mine = views.filter((v) => v.entity_kind === key);
    // Balances come from OPEN accounts only — a closed account's last known
    // balance is not money anybody can reach.
    const open = mine.filter((v) => !v.closed_at);

    // Only count depository accounts (checking, savings) in totals. Credit,
    // loan, and investment accounts have different semantics and must not be
    // added to cash on hand: available = headroom, current = owed.
    const depository = open.filter(isDepository);

    const available = sumKnown(depository.map((v) => v.available_balance_cents));
    const current = sumKnown(depository.map((v) => v.current_balance_cents));

    return {
      key,
      label: key === "unknown" ? LABELS.unclassified : LABELS[key],
      count: mine.length,
      open_count: open.length,
      accounts: mine,
      available: {
        value: available.total, display: money(available.total),
        basis: basisOf(available, depository.length)
      },
      current: {
        value: current.total, display: money(current.total),
        basis: basisOf(current, depository.length)
      }
    };
  });

  const unclassified = groups.find((g) => g.key === "unknown").count;

  return {
    source: "bank_accounts",
    accounts: views.length,
    open_accounts: views.filter((v) => !v.closed_at).length,
    closed_accounts: views.filter((v) => v.closed_at).length,
    unclassified,
    // The screen's call to action. A separate boolean rather than making the
    // reader compare a count to zero, because this is the one thing on the
    // surface that somebody is supposed to DO something about.
    needs_classification: unclassified > 0,
    groups
  };
}

export default bankingSurface;

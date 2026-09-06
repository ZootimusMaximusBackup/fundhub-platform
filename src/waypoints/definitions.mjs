// The checklist, turned from catalog rows into one client's waypoints.
//
// WHAT THIS FILE IS FOR. db/migrations/361 holds the list of tasks as DATA
// because the six-month strategy is not finalised (TODO.md item 0, Chris
// 2026-09-05). This file is the only thing that knows how to turn one of those
// rows into a row of client_waypoints: which tokens the copy supports, how a
// due date is computed, and how the paydown definition becomes one waypoint per
// card. It reads the catalog. It never hardcodes the list.
//
// PURE, DELIBERATELY. Everything below loadWaypointDefinitions() takes plain
// objects and returns plain objects: no db, no clock beyond the `now` handed
// in, no writes. src/waypoints/seed.mjs does the writing. That split is what
// lets the expansion be tested against a hand-written credit file with no
// database at all.
//
// MONEY IS INTEGER CENTS (CLAUDE.md §12, src/commissions/money.mjs). The credit
// file reports balances and limits as DOLLARS, so every number that crosses out
// of here has been through toCents() and every params key that holds money ends
// in _cents.
//
// NULL MEANS UNKNOWN AND IT SURVIVES. A card with no reported limit gets no
// paydown target, because 10% of an unknown limit is not zero and it is not a
// guess we are allowed to make — it gets NO WAYPOINT rather than a waypoint
// with an invented number.

import { toCents } from "../commissions/money.mjs";

/** Tokens the catalog copy may use. Anything else is left alone. */
export const COPY_TOKENS = Object.freeze(["creditor", "target", "state_clause"]);

/** The utilization target the Credit Optimization Roadmap works to: 10% of the
 *  limit (scripts/black-reports/fundhub_gen.py target_bal(), :270). Named here
 *  rather than typed inline so the two places that need it cannot drift. */
export const PAYDOWN_TARGET_FRACTION = 0.1;

/** Status strings mapRevolving() puts in column 6 that mean "not a paydown". */
const NOT_PAYABLE_STATUS = new Set(["CLOSED"]);

/**
 * Fill {creditor} / {target} / {state_clause} in catalog copy.
 *
 * A token with no value resolves to NOTHING, not to the word "null" and not to
 * the token left showing. Every string in the catalog is written so it still
 * reads as a sentence with any token removed; the whitespace collapse here is
 * the belt to that braces.
 */
export function renderCopy(template, tokens = {}) {
  if (template == null) return null;
  let out = String(template);
  for (const name of COPY_TOKENS) {
    const raw = tokens[name];
    const value = raw === null || raw === undefined ? "" : String(raw);
    out = out.split(`{${name}}`).join(value);
  }
  // " ." and "  " are what a removed token leaves behind.
  out = out.replace(/[ \t]{2,}/g, " ").replace(/\s+([.,;:])/g, "$1").trim();
  return out;
}

/**
 * A creditor name turned into something the key CHECK will accept
 * (^[a-z0-9_]{2,64}$ on client_waypoints.key).
 *
 * Returns "" when nothing usable survives — a creditor called "***" gives no
 * key, and the caller drops the account rather than inventing one.
 */
export function slugify(text, { maxLength = 32 } = {}) {
  const s = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, maxLength)
    .replace(/_$/, "");
  return s;
}

/** Integer cents, or null when the dollar figure is missing or unusable.
 *  toCents() maps null and "" to 0 on purpose (it is written for payments,
 *  where no payment yet really is zero). Here zero and unknown are different
 *  answers, so unknown is caught before it can become a number. */
export function dollarsToCents(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return null;
  try {
    return toCents(n);
  } catch {
    return null;
  }
}

/** "$1,250" from 125000 cents. Whole dollars, because a paydown target with
 *  cents on it reads like a bill rather than a goal. */
export function formatCents(cents) {
  if (!Number.isInteger(cents)) return null;
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

/**
 * The revolving accounts on a credit file, as the paydown table sees them.
 *
 * INPUT is the `revolving` array from buildBlackReportClient()
 * (src/underwrite/black-report-client.mjs), whose rows are
 *   [creditor, bureauLabel, balance, limit, "12%", "$250 or less", "HIGH"]
 * with balance and limit as DOLLAR numbers or null.
 *
 * Every account on the file comes back, including the ones no paydown waypoint
 * will be made for, because the no-new-credit check needs the WHOLE list as its
 * baseline and a filtered list would report an old card as newly opened.
 * `payable` is the flag that says which ones can carry a paydown.
 */
export function revolvingAccounts(revolving = []) {
  const out = [];
  for (const row of Array.isArray(revolving) ? revolving : []) {
    if (!Array.isArray(row)) continue;
    const creditor = String(row[0] || "").trim();
    if (!creditor) continue;
    const bureau = String(row[1] || "").trim();
    const balanceCents = dollarsToCents(row[2]);
    const limitCents = dollarsToCents(row[3]);
    const status = String(row[6] || "").trim().toUpperCase();

    const creditorKey = slugify(creditor);
    const bureauKey = slugify(bureau);
    if (!creditorKey) continue;

    // 10% of the limit. An unknown or zero limit gives NO TARGET — see the
    // header. A target is never derived from the balance.
    const targetCents = limitCents != null && limitCents > 0
      ? Math.round(limitCents * PAYDOWN_TARGET_FRACTION)
      : null;

    out.push({
      creditor,
      bureau,
      creditorKey,
      bureauKey,
      balanceCents,
      limitCents,
      targetCents,
      status,
      /* A paydown waypoint is only honest when all three are true:
         - we know the limit, so the target is a fact and not a guess
         - we know the balance, so "pay it down" is something we can check
         - the account is open, so paying it down is a thing to do at all.
           utilStatus() reports CLOSED for closed AND for charged-off accounts
           (isClosed() matches "charge"), and a charged-off account is a dispute
           item on our side of the list, not a paydown on the client's. */
      payable: targetCents != null
        && balanceCents != null
        && !NOT_PAYABLE_STATUS.has(status)
    });
  }
  return out;
}

/**
 * ONE CARD, ONE WAYPOINT. A tri-merge reports the same physical card once per
 * bureau, so a client with three cards has NINE revolving rows on their file —
 * measured on every one of the five simulator profiles, 2026-09-06. The Credit
 * Optimization Roadmap prints all nine in its paydown table. A CHECKLIST must
 * not: telling somebody to pay Capital One Platinum down to $300 three times is
 * how a list stops being believed, and they only have to do it once.
 *
 * So the bureau rows for one creditor are merged, and merged the CONSERVATIVE
 * way in both directions:
 *
 *   balance = the HIGHEST any bureau reports
 *   limit   = the LOWEST any bureau reports, so the target is the lowest too
 *
 * which means the waypoint asks for the most paydown the file can justify, and
 * — this is the half that matters — src/waypoints/verify.mjs only closes it
 * when EVERY bureau reporting that card is at or under the target. A card that
 * one bureau still shows as maxed is not paid down.
 *
 * A limit or balance that a bureau does not report is skipped rather than
 * counted as zero. If NO bureau reports a limit there is no target and the
 * account carries no paydown at all (payable: false).
 *
 * KNOWN AND ACCEPTED: two different cards from the same issuer merge into one
 * waypoint, because a credit file gives us the issuer's name and not an account
 * number we are willing to key on. The error is in the safe direction — fewer
 * waypoints than cards, never a paydown for a card that does not exist, and
 * never a false "you opened something new".
 */
export function mergeByCreditor(rows = []) {
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.creditorKey)) {
      groups.set(r.creditorKey, {
        creditor: r.creditor,
        creditorKey: r.creditorKey,
        accountKey: r.creditorKey,
        bureaus: [],
        balanceCents: null,
        limitCents: null,
        targetCents: null,
        openBureaus: 0
      });
    }
    const g = groups.get(r.creditorKey);
    if (r.bureau && !g.bureaus.includes(r.bureau)) g.bureaus.push(r.bureau);
    if (Number.isInteger(r.balanceCents)) {
      g.balanceCents = g.balanceCents == null ? r.balanceCents : Math.max(g.balanceCents, r.balanceCents);
    }
    if (Number.isInteger(r.limitCents) && r.limitCents > 0) {
      g.limitCents = g.limitCents == null ? r.limitCents : Math.min(g.limitCents, r.limitCents);
    }
    if (!NOT_PAYABLE_STATUS.has(r.status)) g.openBureaus += 1;
  }
  const out = [];
  for (const g of groups.values()) {
    g.bureaus.sort();
    g.targetCents = g.limitCents != null && g.limitCents > 0
      ? Math.round(g.limitCents * PAYDOWN_TARGET_FRACTION)
      : null;
    /* Closed on every bureau that reports it = closed. Closed on one and open
       on another is a reporting disagreement, and the open reading is the one
       that costs the client utilization, so it is the one we act on. */
    g.payable = g.targetCents != null && g.balanceCents != null && g.openBureaus > 0;
    out.push(g);
  }
  return out.sort((a, b) => a.creditorKey.localeCompare(b.creditorKey));
}

/** enrolment date + N days, or null when the definition sets no deadline.
 *  NULL is a real answer: a waypoint with no due date is never overdue
 *  (src/waypoints/store.mjs isOverdue), which is the correct treatment of a
 *  task whose timing nobody has settled. */
export function dueAtFrom(base, offsetDays) {
  if (offsetDays === null || offsetDays === undefined) return null;
  const n = Number(offsetDays);
  if (!Number.isFinite(n) || n < 0) return null;
  const from = base instanceof Date ? base : new Date(base);
  if (Number.isNaN(from.getTime())) return null;
  return new Date(from.getTime() + n * 24 * 60 * 60 * 1000);
}

/** " in Texas", or "" when the file does not say where they live. */
export function stateClause(state) {
  const s = String(state || "").trim();
  return s ? ` in ${s}` : "";
}

/**
 * Every live definition, in display order.
 *
 * The application has SELECT and nothing else on this table (migration 361), so
 * this is the only shape of access it has to the checklist.
 */
export async function loadWaypointDefinitions(db, { includeInactive = false } = {}) {
  const r = await db.query(
    `SELECT key, expands, title, detail, position, owner_kind,
            due_offset_days, verify_kind,
            paid_alternative_price_cents, paid_alternative_label,
            paid_alternative_kind, active
       FROM waypoint_definitions
      ${includeInactive ? "" : "WHERE active"}
      ORDER BY position ASC, key ASC`
  );
  return r.rows || [];
}

function paidFrom(def) {
  const cents = def.paid_alternative_price_cents;
  const n = cents === null || cents === undefined ? null : Number(cents);
  return {
    paidAlternativePriceCents: Number.isInteger(n) && n > 0 ? n : null,
    paidAlternativeLabel: def.paid_alternative_label ?? null,
    paidAlternativeKind: def.paid_alternative_kind ?? null
  };
}

/**
 * One client's waypoints, from the catalog plus their credit file.
 *
 * @param {object}   args
 * @param {object[]} args.definitions  rows from loadWaypointDefinitions()
 * @param {object[]} args.accounts     rows from mergeByCreditor(revolvingAccounts())
 *                                     — one entry per card, not per bureau row
 * @param {string}   args.state        the client's state, "" when unknown
 * @param {Date}     args.enrolledAt   the clock the due dates count from
 * @param {boolean}  args.hasCreditFile
 *        FALSE means we never read a credit file for this client, which is a
 *        different fact from "we read one and it listed no cards". The
 *        no-new-credit baseline is NULL in the first case and an empty list in
 *        the second, and src/waypoints/verify.mjs refuses to conclude anything
 *        from a NULL baseline.
 * @param {Map<string,string>} [args.existingPaydownKeys]
 *        accountKey -> the waypoint key already on this client for that
 *        account. Re-seeding reuses it so a second run updates the same row
 *        instead of adding a second one beside it.
 * @param {Map<string,Date|null>} [args.existingDueAt]
 *        waypoint key -> the due date already stored. A re-seed keeps the
 *        deadline a client was originally given rather than quietly pushing it
 *        forward.
 */
export function expandDefinitions({
  definitions = [],
  accounts = [],
  state = "",
  enrolledAt = new Date(),
  hasCreditFile = false,
  existingPaydownKeys = new Map(),
  existingDueAt = new Map()
} = {}) {
  const waypoints = [];
  const skipped = [];
  const clause = stateClause(state);

  for (const def of definitions) {
    const paid = paidFrom(def);
    const verifyKind = def.verify_kind ?? null;

    if (def.expands === "per_revolving_account") {
      // One waypoint per CARD, not per bureau row — see mergeByCreditor().
      // `accounts` is already merged and already sorted by creditorKey, so two
      // runs over the same file produce the same keys in the same order.
      const seenSlug = new Map();
      for (const a of accounts) {
        if (!a.payable) {
          skipped.push({
            definitionKey: def.key,
            accountKey: a.accountKey,
            reason: a.targetCents == null
              ? "no_reported_limit"
              : (a.balanceCents == null ? "no_reported_balance" : "account_closed")
          });
          continue;
        }
        // ALREADY THERE. A balance at or under the target is not a task; asking
        // a client to pay down a card they have already paid down is the kind
        // of thing that makes a checklist stop being believed.
        if (a.balanceCents <= a.targetCents) {
          skipped.push({
            definitionKey: def.key,
            accountKey: a.accountKey,
            reason: "already_at_target"
          });
          continue;
        }
        /* The counter exists only for the case where two DIFFERENT creditor
           names slug down to the same 32 characters. Same-creditor rows have
           already been merged into one, so in the ordinary case n is 1 and the
           key is just paydown_<creditor>. */
        const n = (seenSlug.get(a.creditorKey) || 0) + 1;
        seenSlug.set(a.creditorKey, n);
        const generated = (n === 1 ? `paydown_${a.creditorKey}` : `paydown_${a.creditorKey}_${n}`).slice(0, 64);
        const key = existingPaydownKeys.get(a.accountKey) || generated;
        const tokens = { creditor: a.creditor, target: formatCents(a.targetCents), state_clause: clause };
        waypoints.push({
          key,
          title: renderCopy(def.title, tokens),
          detail: renderCopy(def.detail, tokens),
          position: def.position,
          ownerKind: def.owner_kind,
          dueAt: existingDueAt.has(key)
            ? existingDueAt.get(key)
            : dueAtFrom(enrolledAt, def.due_offset_days),
          verifyKind,
          params: {
            definition_key: def.key,
            creditor: a.creditor,
            creditor_key: a.creditorKey,
            // Which bureaus reported this card when the list was built. Kept so
            // a human reading the row can see where the numbers came from.
            bureaus: a.bureaus,
            target_cents: a.targetCents,
            limit_at_seed_cents: a.limitCents,
            balance_at_seed_cents: a.balanceCents
          },
          ...paid
        });
      }
      continue;
    }

    // expands = 'once'
    const tokens = { creditor: null, target: null, state_clause: clause };
    const params = { definition_key: def.key };

    /* The no-new-credit baseline. Positive evidence in one direction only: a
       card on a later pull that was not on this list was opened after we said
       not to. Nothing is evidence that the rule was KEPT, so this waypoint
       never closes itself.
       NULL, not [], when no credit file was read — see hasCreditFile above. */
    if (verifyKind === "no_new_credit") {
      params.accounts_at_seed = hasCreditFile ? accounts.map((a) => a.accountKey).sort() : null;
      params.snapshot_source = hasCreditFile ? "crs_result" : "none";
    }

    waypoints.push({
      key: def.key,
      title: renderCopy(def.title, tokens),
      detail: renderCopy(def.detail, tokens),
      position: def.position,
      ownerKind: def.owner_kind,
      dueAt: existingDueAt.has(def.key)
        ? existingDueAt.get(def.key)
        : dueAtFrom(enrolledAt, def.due_offset_days),
      verifyKind,
      params,
      ...paid
    });
  }

  return { waypoints, skipped };
}

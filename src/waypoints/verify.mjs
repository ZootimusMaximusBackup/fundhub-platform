// Close the waypoints the data can actually close, and NOTHING ELSE.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: a waypoint is never marked done on a
// guess. There are exactly two things a fresh credit pull tells us about this
// client's list, and everything else on it stays open until a person says
// otherwise.
//
//   paydown        A re-pull reports the balance on the card. The waypoint
//                  carries the target in integer cents. Balance at or under
//                  target closes it. Above target leaves it open. Card not on
//                  the new file, or a balance the file does not report, leaves
//                  it OPEN — an account we cannot see is unknown, and unknown
//                  is not "paid off".
//
//   no_new_credit  Evidence flows ONE WAY. A revolving account on the new file
//                  that was not on the file at enrolment is positive evidence
//                  the rule was broken, and the row goes to 'blocked' with the
//                  creditor named. Nothing whatsoever is evidence the rule was
//                  KEPT, so this row is never completed here, not on the last
//                  day of the program and not ever.
//
// A waypoint with a NULL verify_kind is not looked at. NULL means nothing the
// platform can see closes it — the EIN, the business bank account, the LLC
// filing and the personal loan are all in that group, and there is no feed in
// this repository that observes any of them.
//
// AN UNRECOGNISED verify_kind DOES NOTHING. It matches no branch below, so the
// worst a typo in the catalog can do is leave a row open, which is the safe
// direction.
//
// THIS FUNCTION WRITES. It does not send, queue, charge or notify. Telling the
// client is somebody else's job (CLAUDE.md §12 — transmission lives in
// src/messaging/providers/ and nowhere else).

import {
  buildBlackReportClient,
  hasBlackReportSource
} from "../underwrite/black-report-client.mjs";
import { revolvingAccounts, mergeByCreditor } from "./definitions.mjs";
import {
  listVerifiableWaypoints,
  completeWaypoint,
  markWaypointState,
  WaypointError
} from "./store.mjs";
import { latestCreditFile } from "./seed.mjs";

/** How a paydown waypoint reads against one account. Pure, so the whole
 *  decision can be tested without a database.
 *  Returns 'complete' | 'open', plus the reason it stayed open. */
export function judgePaydown(waypoint, account) {
  const target = waypoint?.params?.target_cents;
  if (!Number.isInteger(target)) return { verdict: "open", reason: "no_target_on_waypoint" };
  if (!account) return { verdict: "open", reason: "account_not_on_file" };
  if (!Number.isInteger(account.balanceCents)) return { verdict: "open", reason: "balance_unknown" };
  if (account.balanceCents <= target) {
    return { verdict: "complete", reason: "at_or_under_target", balanceCents: account.balanceCents };
  }
  return { verdict: "open", reason: "above_target", balanceCents: account.balanceCents };
}

/** Which accounts on this file were not on the file at enrolment.
 *  A NULL baseline (no credit file existed when the client was seeded) gives
 *  NULL back — unknown, and nothing may be concluded from it. */
export function newAccountsSince(baseline, accounts) {
  if (!Array.isArray(baseline)) return null;
  const before = new Set(baseline);
  return accounts.filter((a) => !before.has(a.accountKey));
}

/**
 * Re-read one client's verifiable waypoints against a credit file.
 *
 * @param {object} db
 * @param {object}   args
 * @param {string}   args.orgId
 * @param {string}   args.clientId
 * @param {object}   [args.crsResult] the fresh file; the stored newest is read
 *                                    when it is not handed in
 * @param {Date}     [args.now]
 * @returns {Promise<{
 *   ok: true, checked: number,
 *   completed: {key:string, reason:string}[],
 *   blocked:   {key:string, reason:string}[],
 *   unchanged: {key:string, reason:string}[],
 *   creditFile: 'crs_result'|'none'
 * }>}
 */
export async function evaluateWaypoints(db, {
  orgId,
  clientId,
  crsResult = undefined,
  now = new Date()
} = {}) {
  if (!db?.query) throw new WaypointError("db required", { status: 500, code: "db_required" });
  if (!orgId || !clientId) throw new WaypointError("orgId and clientId are required");

  const open = await listVerifiableWaypoints(db, { orgId, clientId });
  const empty = {
    ok: true, checked: 0, completed: [], blocked: [], unchanged: [], creditFile: "none"
  };
  if (!open.length) return empty;

  let file = crsResult;
  if (file === undefined) {
    const row = await latestCreditFile(db, { orgId, clientId });
    file = row ? row.result : null;
  }
  const usable = file && hasBlackReportSource(file) ? file : null;

  /* NO FILE, NO VERDICTS. A pull that did not come back is not evidence that a
     card was paid down and it is not evidence that a card was opened. Every row
     is reported unchanged with the reason, and not one is touched. */
  if (!usable) {
    return {
      ok: true,
      checked: open.length,
      completed: [],
      blocked: [],
      unchanged: open.map((w) => ({ key: w.key, reason: "no_credit_file" })),
      creditFile: "none"
    };
  }

  const built = buildBlackReportClient({ crsResult: usable, personal: null });
  // One entry per card, merged the conservative way: the highest balance any
  // bureau reports against the lowest limit any bureau reports. So a paydown
  // closes only when EVERY bureau reporting that card is at or under target.
  const accounts = mergeByCreditor(revolvingAccounts(built.revolving));
  const byAccount = new Map(accounts.map((a) => [a.accountKey, a]));

  const completed = [];
  const blocked = [];
  const unchanged = [];

  for (const w of open) {
    if (w.verify_kind === "paydown") {
      const ck = w.params?.creditor_key;
      const account = ck ? byAccount.get(ck) : null;
      const judged = judgePaydown(w, account);
      if (judged.verdict === "complete") {
        await completeWaypoint(db, { orgId, clientId, key: w.key, at: now });
        completed.push({ key: w.key, reason: judged.reason });
      } else {
        unchanged.push({ key: w.key, reason: judged.reason });
      }
      continue;
    }

    if (w.verify_kind === "no_new_credit") {
      const baseline = w.params?.accounts_at_seed;
      const fresh = newAccountsSince(baseline, accounts);
      if (fresh === null) {
        unchanged.push({ key: w.key, reason: "no_baseline" });
        continue;
      }
      /* A file that reports no revolving accounts at all, against a baseline
         that had some, is a thin or partial pull rather than a client who
         closed every card overnight. Nothing is concluded from it. */
      if (!accounts.length && baseline.length) {
        unchanged.push({ key: w.key, reason: "no_accounts_reported" });
        continue;
      }
      if (fresh.length) {
        const names = fresh.map((a) => a.creditor).filter(Boolean);
        const reason = `New credit opened after enrolment: ${names.join(", ") || fresh.length} account(s).`;
        await markWaypointState(db, { orgId, clientId, key: w.key, state: "blocked", reason });
        blocked.push({ key: w.key, reason });
        continue;
      }
      /* Kept, so far. NOT completed — see the header. There is no such thing as
         proof that a client will not open a card tomorrow. */
      unchanged.push({ key: w.key, reason: "no_new_accounts_seen" });
      continue;
    }

    unchanged.push({ key: w.key, reason: `unrecognised_verify_kind:${w.verify_kind}` });
  }

  return {
    ok: true,
    checked: open.length,
    completed,
    blocked,
    unchanged,
    creditFile: "crs_result"
  };
}

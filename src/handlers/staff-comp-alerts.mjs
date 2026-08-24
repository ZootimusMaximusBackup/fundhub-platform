// Bus handlers: staff payout email + deal-close win SMS.
// COMPLIANCE REVIEW REQUIRED — commission timing / staff payout notice.
//
// Registered after money-chain so sale attributions exist on deal-close events.

import { on } from "../events/registry.mjs";
import { notifyCommissionPaid, notifyDealCloseWin } from "../staff/comp-alerts.mjs";

export async function onCommissionPaidAlert(event, db) {
  try {
    return await notifyCommissionPaid(db, event);
  } catch (err) {
    console.warn(
      `[staff-comp-alerts] commission.paid notify failed: ${err && err.message}`
    );
    return { mailed: false, reason: "error" };
  }
}

export async function onDealCloseWinAlert(event, db) {
  try {
    return await notifyDealCloseWin(db, event);
  } catch (err) {
    console.warn(
      `[staff-comp-alerts] deal-close notify failed: ${err && err.message}`
    );
    return { queued: 0, reason: "error" };
  }
}

export function register() {
  on("commission.paid", onCommissionPaidAlert);
  on("sale.closed", onDealCloseWinAlert);
  on("deposit.paid", onDealCloseWinAlert);
}

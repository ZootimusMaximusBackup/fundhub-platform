// Flatten a Metro 2 engine report into letter-pack violations.
// Adds creditor / last-four / collection from the tradeline. Never invents rules.

import { valueOf } from "../provenance.mjs";
import { isCollectionAccount } from "../checks/chargeoff-collection.mjs";

export function attachTradelineFacts(violation, tradeline) {
  const last4 = valueOf(tradeline?.account_number_last4);
  return {
    ...violation,
    creditor: valueOf(tradeline?.creditor) || violation.creditor || null,
    account_last4: last4 || violation.account_last4 || violation.accountLast4 || null,
    collection: isCollectionAccount(tradeline) === true
  };
}

export function packViolationsFromReport(result) {
  const fromTrade = (result?.tradelines || []).flatMap((row) =>
    (row.violations || []).map((v) => attachTradelineFacts(v, row.tradeline))
  );
  const fromReport = result?.report || [];
  return [...fromTrade, ...fromReport];
}

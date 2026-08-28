// Audit roadmap for /optimize — reuses the repair brain + UnderwriteIQ map.
// Does not call Claude. Does not invent a planner.
//
// Brain: src/metro2/diy/from-crs.mjs (findings on a stored file)
//        src/repair/round-plan.mjs (R1–R6 attack plan from those findings)
// Map:   src/underwrite/black-report-client.mjs (same client dict the
//        optimization roadmap printer already uses)
//
// COMPLIANCE REVIEW REQUIRED — credit-file adjacent. Public chrome says Audit.

import { violationsByBureauFromMergedCrs } from "../metro2/diy/from-crs.mjs";
import { buildRoundPlan } from "../repair/round-plan.mjs";
import { buildBlackReportClient } from "../underwrite/black-report-client.mjs";

const BOOK_URL = "https://apply.fundhub.ai/schedule/phonecall";

/** Same stored Equifax body the metro2 from-crs tests already run. */
export const SAMPLE_STORED_FILE = Object.freeze({
  bureausPulled: ["EQ"],
  bureaus: {
    EQ: {
      requestedBureaus: { transunion: false, experian: false, equifax: true },
      responseDetail: { dateRequested: "2026-03-01T21:46:24.834278Z" },
      creditFiles: [
        {
          creditFileDetail: {
            creditFileInfileDate: "2026-03-01",
            creditFileResultStatusType: "FileReturned",
            sourceType: "Equifax"
          }
        }
      ],
      inquiries: [
        { creditorName: "EXAMPLE CARD CO", inquiryDate: "2024-05-09", businessType: "Finance", sourceType: "Equifax" },
        { creditorName: "EXAMPLE CARD CO", inquiryDate: "2024-05-09", businessType: "Finance", sourceType: "Equifax" }
      ],
      tradelines: [
        {
          accountIdentifier: "5121080011112222",
          accountOpenedDate: "2019-06-12",
          accountOwnershipType: "Individual",
          accountReportedDate: "2024-01-01",
          accountStatusType: "Open",
          accountType: "Revolving",
          creditorName: "EXAMPLE BANK NA",
          currentBalanceAmount: "1842",
          currentRatingType: "AsAgreed",
          sourceType: "Equifax"
        }
      ]
    }
  },
  normalized: {
    tradelines: [{
      source: "equifax",
      creditorName: "EXAMPLE BANK NA",
      accountType: "revolving",
      status: "open",
      currentBalance: 1842,
      effectiveLimit: null
    }],
    inquiries: []
  }
});

function itemsFromFindings(findings) {
  const items = [];
  for (const [bureau, list] of Object.entries(findings || {})) {
    for (const v of list || []) {
      items.push({
        bureau,
        round: "R1",
        creditor: v.creditor || v.subject || "",
        account_last4: v.account_last4 || v.accountLast4 || "",
        rule_id: v.ruleId || v.rule_id || ""
      });
    }
  }
  return items;
}

function money(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Math.round(Number(n));
}

/**
 * @param {{ crsResult?: object, personal?: object }} [input]
 * @returns {{ ok: true, source: string, bookUrl: string, today: object, later: object, accounts: object[], rounds: object[] }}
 */
export function buildOptimizeRoadmap({ crsResult = null, personal = null } = {}) {
  const file = crsResult && typeof crsResult === "object" ? crsResult : SAMPLE_STORED_FILE;
  const source = crsResult ? "file" : "sample";
  const client = buildBlackReportClient({
    crsResult: file,
    personal: personal || { name: "You" }
  });
  const findings = violationsByBureauFromMergedCrs(file);
  const rounds = buildRoundPlan({
    items: itemsFromFindings(findings),
    letters: [],
    roundsCap: 6
  });
  const accounts = (client.revolving || []).map((row) => ({
    name: row[0] || "",
    balance: money(row[2]),
    limit: money(row[3]),
    target: row[5] || ""
  }));
  return {
    ok: true,
    source,
    bookUrl: BOOK_URL,
    today: {
      preapproval: money(client.preapproval_now),
      util: client.util_pct || ""
    },
    later: {
      preapproval: money(client.preapproval_after)
    },
    accounts,
    rounds: rounds.map((r) => ({
      step: r.round,
      title: r.title,
      when: r.when,
      status: r.status,
      attacks: r.attacks || []
    }))
  };
}

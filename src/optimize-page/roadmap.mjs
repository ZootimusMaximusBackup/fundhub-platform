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
import { derogatoryClaimsByBureau, mergeDerogatoryClaims } from "../metro2/diy/derogatory.mjs";
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
        rule_id: v.ruleId || v.rule_id || "",
        // The engine computes all of the below and this function used to throw it
        // away, so the page could only ever draw a bare list. Passed through now.
        // No new engine work — these are the same objects from
        // violationsByBureauFromMergedCrs(), just not discarded.
        severity: v.severity || "",
        field: v.field || "",
        observed: v.observed ?? null,
        expected: v.expected ?? null,
        reason: v.reason || "",
        citations: Array.isArray(v.citations) ? v.citations.slice() : [],
        metro2Ref: v.metro2Ref || "",
        scope: v.scope || ""
      });
    }
  }
  return items;
}

/** True only when the stored file actually carries a preapproval figure. */
function hasPreapprovalData(file) {
  const block = file && typeof file === "object" ? file.preapprovals : null;
  if (!block) return false;
  if (Array.isArray(block)) return block.length > 0;
  return Object.keys(block).length > 0;
}

function money(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Math.round(Number(n));
}

/**
 * @param {{ crsResult?: object, personal?: object, onRepairPath?: boolean }} [input]
 * @returns {{ ok: true, source: string, bookUrl: string, today: object, later: object, accounts: object[], rounds: object[] }}
 */
export function buildOptimizeRoadmap({
  crsResult = null,
  personal = null,
  // OWNER DECISION, 2026-09-03: "any derogatory deserves a letter, but only if
  // they are in the correct offer path." See the block below `findings`.
  onRepairPath = false
} = {}) {
  const file = crsResult && typeof crsResult === "object" ? crsResult : SAMPLE_STORED_FILE;
  const source = crsResult ? "file" : "sample";
  const client = buildBlackReportClient({
    crsResult: file,
    personal: personal || { name: "You" }
  });
  /* The 38 Metro 2 checks fire only on a reporting DEFECT — two fields that
     contradict each other, a date that cannot be true. A collection reported
     cleanly trips none of them, so this page drew an EMPTY roadmap for a file
     that is nothing but collections and charge-offs.
     ../metro2/diy/derogatory.mjs is the item half of the owner's rule.

     THE OFFER-PATH HALF CANNOT BE ANSWERED HERE, so the caller must answer it.
     This function has no client, no org and no tier: /api/public/optimize is a
     no-auth referral door and calls it with no arguments at all, which means the
     sample file. Defaulting this to false keeps that page exactly as it is —
     a stranger on no offer path is shown no dispute claims, which is the same
     rule that stopped an Academy buyer being asked to authorize disputes (F35).
     A caller that knows the client answers it from clients.outcome_tier, or
     from ../repair/on-repair-path.mjs when it also has the org id. */
  const engineFindings = violationsByBureauFromMergedCrs(file);
  const findings = onRepairPath
    ? mergeDerogatoryClaims(engineFindings, derogatoryClaimsByBureau(file))
    : engineFindings;
  const items = itemsFromFindings(findings);
  const rounds = buildRoundPlan({
    items,
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
      util: client.util_pct || "",
      // buildBlackReportClient forces a missing preapproval to 0
      // (src/underwrite/black-report-client.mjs). A 0 that means "we never had
      // the credit limit" is NOT a number to show anybody — it reads as
      // "you qualify for nothing". NULL means unknown and must survive
      // (CLAUDE.md), so say plainly whether the figure is real.
      preapprovalKnown: hasPreapprovalData(file)
    },
    later: {
      preapproval: money(client.preapproval_after)
    },
    accounts,
    // The findings themselves, not just the round plan built from them. The page
    // needs the reason, the citations and the observed/expected pair to show a
    // person WHY a line is wrong rather than just that it is.
    findings: items,
    rounds: rounds.map((r) => ({
      step: r.round,
      title: r.title,
      when: r.when,
      status: r.status,
      attacks: r.attacks || []
    }))
  };
}

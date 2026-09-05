// The score panels behind GET /api/read/client-progress.
//
// OWNER-SET, 2026-09-05: three personal bureaus PLUS business credit, and the
// business side is an ARRAY with one entry per business, because the panel
// TOGGLES between businesses. A single blended number is the wrong answer and
// businessCredit() in src/http/client-detail.mjs gives exactly that — it reads
// `businesses[0]` and throws the rest away. That function is right for the staff
// detail screen it was written for and wrong here, so this file does the
// per-business version instead of widening it.
//
// NULL MEANS NOT PULLED (CLAUDE.md §12). A bureau with no score is `null`, never
// 0 and never "". The front end renders that as "not pulled yet". A zero here
// would read to a client as a catastrophic score, which is the exact failure the
// rule exists to prevent.
//
// NOTHING IS INVENTED. Every number comes from a stored row:
//   personal → crs_results.result, read through triMerge() so the FICO range
//              check, the score-model check and the sandbox-fixture exclusion
//              are the same ones the staff screens already apply.
//   business → businesses.entity_data, the same key precedence businessCredit()
//              uses, applied per row instead of to the first row only.

import { triMerge } from "../http/client-detail.mjs";

/** The three personal bureaus, in the order the panel draws them. */
export const PERSONAL_BUREAUS = Object.freeze(["experian", "equifax", "transunion"]);

/** The business bureau this repository can actually read a score for. */
export const BUSINESS_BUREAU = "experian_business";

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* An Intelliscore / FSR is 0-100, unlike a FICO. Copied from
   firstScore100() in src/http/client-detail.mjs rather than imported because
   that one is not exported; the bounds are the scale's, not a policy. */
function score100(values) {
  for (const v of values) {
    const n = num(v);
    if (n !== null && n >= 0 && n <= 100) return Math.round(n);
  }
  return null;
}

function asObject(v) {
  if (!v) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return null; }
}

function newestFirst(rows) {
  return [...(rows || [])].sort(
    (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
  );
}

/**
 * ONE crs_results row's three FICOs.
 *
 * triMerge() is asked about a single-row list on purpose. It is the only
 * exported reader of that column shape, and calling it this way inherits its
 * whole contract — the 300-850 bounds, the "the model must say FICO" check, and
 * the refusal to paint a sandbox fixture as somebody's credit file — without
 * copying any of it here or editing a file this lane does not own.
 */
export function scoresOfResult(row) {
  const t = triMerge([row]);
  return { experian: t.experian, equifax: t.equifax, transunion: t.transunion };
}

/**
 * The personal panels: newest non-null score per bureau, each with its OWN
 * pulled date.
 *
 * PER BUREAU, NOT PER PULL. triMerge() picks one result row and reports all
 * three from it, so a bureau that answered last month but not this month reads
 * as null. That is right for a tri-merge — you want the three from one moment —
 * and wrong for a panel, where the honest answer is "651, pulled 12 January"
 * rather than "not pulled". Each bureau therefore walks the rows newest-first
 * and stops at its own first real number, and `pulledAt` says which pull that
 * was, so a stale panel is visibly stale instead of silently current.
 */
export function personalPanels(crsResults = [], { reportDocumentId = null } = {}) {
  const rows = newestFirst(crsResults);
  return PERSONAL_BUREAUS.map((bureau) => {
    for (const row of rows) {
      const s = scoresOfResult(row);
      if (s[bureau] != null) {
        return {
          bureau,
          score: s[bureau],
          pulledAt: isoOrNull(row.created_at),
          reportDocumentId: reportDocumentId || null
        };
      }
    }
    return { bureau, score: null, pulledAt: null, reportDocumentId: null };
  });
}

/**
 * One panel per business row.
 *
 * `businessId` is `businesses.id` — a primary key, so it is stable across
 * requests, which is what the toggle needs. It is NOT the array index and it is
 * NOT the name: F44 in the 2026-09-03 walkthrough was a business fact that never
 * reached the engine, and an ordinal key would break the toggle the first time a
 * second business was added ahead of the first in the sort.
 *
 * A client with no business row gets an EMPTY ARRAY, not a placeholder panel.
 * There is no business to score, which is a different thing from a business
 * whose score has not been pulled — and that second case is the one that gets a
 * panel with `score: null`.
 *
 * `pulledAt` is the business row's own `updated_at` and only when a score was
 * actually found. `businesses` has no per-score timestamp, so a date on a panel
 * with no score would be a date attached to nothing.
 */
export function businessPanels(businesses = [], { reportDocumentId = null } = {}) {
  return (Array.isArray(businesses) ? businesses : []).map((biz) => {
    const entity = asObject(biz && biz.entity_data) || {};
    const scores = asObject(entity.scores) || {};
    const commercial = asObject(entity.commercialScore) || {};
    const score = score100([
      scores.intelliscore, entity.intelliscore, commercial.score
    ]);
    return {
      businessId: biz && biz.id ? String(biz.id) : null,
      name: biz && biz.name ? String(biz.name) : null,
      bureau: BUSINESS_BUREAU,
      score,
      pulledAt: score === null ? null : isoOrNull(biz.updated_at),
      reportDocumentId: score === null ? null : (reportDocumentId || null)
    };
  });
}

/**
 * The middle of three bureau scores.
 *
 * ALL THREE OR NOTHING. "Middle score" is only defined over three numbers. With
 * two on file there is no middle — there is a higher and a lower — and picking
 * one of them would be this file inventing a lending rule that exists nowhere
 * else in this repository. Fewer than three therefore returns null, and null
 * means unknown, which the screen already has words for.
 */
export function middleScore({ experian, equifax, transunion } = {}) {
  const present = [experian, equifax, transunion].filter((v) => v != null);
  if (present.length < 3) return null;
  return present.sort((a, b) => a - b)[1];
}

/**
 * The score series, oldest first — one point per pull that produced at least
 * one score.
 *
 * COSTS NO NEW QUERY. api/read/portal-summary.mjs already loads every
 * crs_results row with no LIMIT and discards all but the newest; this is the
 * mapping function over rows the caller already has.
 *
 * A SHORT SERIES IS NOT A BUG. src/retention/classes.mjs tombstones
 * `crs_results.result` after the configured retention window, so an old row can
 * legitimately come back with nothing in it. Those rows produce no point rather
 * than a point of three nulls, which would draw a hole in the chart where a pull
 * really did happen.
 */
export function scoreSeries(crsResults = []) {
  const out = [];
  for (const row of [...(crsResults || [])].sort(
    (a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0)
  )) {
    const s = scoresOfResult(row);
    if (s.experian == null && s.equifax == null && s.transunion == null) continue;
    out.push({ at: isoOrNull(row.created_at), ...s });
  }
  return out;
}

export function isoOrNull(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

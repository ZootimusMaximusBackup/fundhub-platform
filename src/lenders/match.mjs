/* Match lenders to a client's underwrite profile.
   Structural rules only — no invented approval criteria or lender names.

   Filters:
   1. active lenders only (unless includeInactive)
   2. eligible_states — when both client state and lender states are known,
      client state must appear (case-insensitive token match). Empty lender
      eligible_states = unknown → include (do not invent a restriction).
   3. inquiry sensitivity — skip lenders whose bureaus_pulled intersect
      sensitive bureaus (open/recent inquiries on that bureau).
   4. the credit file — skip a lender whose own stated minimum score is above
      this file's score. See "THE CREDIT FILE" below for why this reads almost
      nothing today.
   5. bureau rotation — rank by how little the planned set already leans on
      each lender's expected bureau(s).

   Returns { matches, skipped, summary } — never fabricates lenders. */

const BUREAU_ALIASES = Object.freeze({
  ex: "EX", experian: "EX",
  eq: "EQ", equifax: "EQ",
  tu: "TU", transunion: "TU", "trans union": "TU",
  "d&b": "D&B", dnb: "D&B", "dun & bradstreet": "D&B",
  "ex biz": "EX Biz", "eq biz": "EQ Biz"
});

/**
 * @param {string|null|undefined} raw
 * @returns {string[]} normalized bureau tokens
 */
export function parseBureaus(raw) {
  if (raw == null || String(raw).trim() === "") return [];
  return String(raw)
    .split(/[/|,;+\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => BUREAU_ALIASES[t.toLowerCase()] || t.toUpperCase());
}

/**
 * Company state first (businesses.entity_data.state), then the old person
 * custom_field keys. Empty stays empty — do not invent a state.
 *
 * @param {object} [customFields]
 * @param {object[]} [businesses]
 * @returns {string|null}
 */
export function resolveMatchState(customFields = {}, businesses = []) {
  for (const biz of Array.isArray(businesses) ? businesses : []) {
    const entity = biz && typeof biz.entity_data === "object" && biz.entity_data
      ? biz.entity_data
      : {};
    const fromBiz = entity.state != null ? String(entity.state).trim() : "";
    if (fromBiz) return fromBiz;
  }
  const cf = customFields && typeof customFields === "object" ? customFields : {};
  return cf.business_state || cf.state || cf.home_state || null;
}

/* ─────────────────────────── THE CREDIT FILE ───────────────────────────
   Funding finding 7, 2026-09-03: this matcher read state, bureau sensitivity
   and the active flag and nothing else, so a 588 repair file and a 780 funding
   file got the identical list and a lender who only takes 700+ matched both.

   MEASURED BEFORE BUILDING, against the load path
   (credentials/lenders-audit/lenders-audited.csv, 313 rows, the CSV import
   that fills this table):

     * there is no minimum-credit-score column on `lenders` at all — see
       db/migrations/138_lenders.sql. The nearest columns,
       minimum_time_in_business_years and minimum_revenue_threshold, are real
       and numeric but are 0/313 filled, and are business facts, not credit;
     * `stated_requirements` is filled on 75 of 313 rows and mentions checking
       accounts, seasoning and business age. Searching EVERY column of all 313
       rows for "fico", "credit score", "score" or an "NNN+" figure returns
       0 rows.

   So no lender in this table states a credit minimum, and this gate therefore
   excludes nobody today. That is the correct outcome and not a bug to route
   around: a guessed credit floor would silently hide real lenders from a real
   client. The pathway below is what the data drops into when it exists —
   either a numeric `minimum_credit_score` column (a migration nobody has
   written) or readable words in `stated_requirements`.

   Reading rule, both directions: a lender we cannot read is a lender we may
   not exclude. Unparseable requirement text keeps the lender and is counted
   as unreadable in the summary, never turned into a number. */

const FICO_MIN = 300;
const FICO_MAX = 850;

function fico(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= FICO_MIN && n <= FICO_MAX ? n : null;
}

/**
 * The credit file as the matcher sees it. Pure — the caller does the reading
 * (store.mjs owns the crs_results query) so this stays testable without a
 * database and cannot be handed a shape it did not ask for.
 *
 * `available` is true only when at least one in-range FICO score is present.
 * A tier or an estimate with no score cannot exclude a lender on score, and
 * saying "available" without one would let a caller believe otherwise.
 *
 * @param {object} [file]
 * @param {{EX?:number|null, EQ?:number|null, TU?:number|null}} [file.scores]
 * @param {number|null} [file.utilizationPct]  revolving card use, percent
 * @param {string|null} [file.tier]            stored outcome tier
 * @param {number|null} [file.fundingEstimate] stored total funding estimate
 * @param {string|Date|null} [file.pulledAt]
 * @returns {object} credit profile
 */
export function resolveCreditProfile({
  scores = {},
  utilizationPct = null,
  tier = null,
  fundingEstimate = null,
  pulledAt = null
} = {}) {
  const s = scores && typeof scores === "object" ? scores : {};
  const byBureau = {
    EX: fico(s.EX ?? s.ex ?? s.experian),
    EQ: fico(s.EQ ?? s.eq ?? s.equifax),
    TU: fico(s.TU ?? s.tu ?? s.transunion)
  };
  const present = Object.values(byBureau).filter((v) => v != null);
  const util = Number(utilizationPct);
  const est = Number(fundingEstimate);
  return {
    available: present.length > 0,
    scores: byBureau,
    /* The best bureau, not the middle or the worst. It is the only score that
       can be compared without over-excluding: a lender is refused only when
       even this client's strongest bureau is under the lender's own floor. */
    best_score: present.length ? Math.max(...present) : null,
    utilization_pct: Number.isFinite(util) ? util : null,
    tier: tier ? String(tier) : null,
    funding_estimate: Number.isFinite(est) ? est : null,
    pulled_at: pulledAt || null
  };
}

/* A three-digit figure only counts as a floor when the words around it say it
   is one AND say it is a credit score. Both halves are required: "2+ years
   business age" has a floor marker and no score, "700 average" has a score and
   no floor. Everything else reads as "no stated minimum". */
const MIN_MARKER = "(?:min(?:imum)?|at\\s+least|requires?|required|no\\s+less\\s+than|floor)";
// Word-bounded so "underscore" and the like are not read as a credit score.
const SCORE_WORD = "\\b(?:fico|credit\\s*score|scores?)\\b";
const GAP = "[^.;\\n]{0,30}?";
const MIN_SCORE_PATTERNS = [
  // "minimum credit score 700", "requires a FICO of 680"
  new RegExp(`\\b${MIN_MARKER}\\b${GAP}${SCORE_WORD}[^.;\\n]{0,15}?\\b([3-8]\\d{2})\\b`, "i"),
  // "minimum 700 FICO"
  new RegExp(`\\b${MIN_MARKER}\\b[^.;\\n]{0,15}?\\b([3-8]\\d{2})\\b[^.;\\n]{0,15}?${SCORE_WORD}`, "i"),
  // "FICO 700+", "credit score 680 or higher"
  new RegExp(`${SCORE_WORD}[^.;\\n]{0,20}?\\b([3-8]\\d{2})\\b\\s*(?:\\+|or\\s+(?:higher|above|better|more))`, "i"),
  // "700+ FICO"
  new RegExp(`\\b([3-8]\\d{2})\\s*\\+\\s*${SCORE_WORD}`, "i")
];

/* "No minimum credit score", "without a 700 FICO" — a negation in front of the
   phrase inverts it, so the number is not a floor. Cheaper and safer to drop
   the whole candidate than to try to read the sentence.

   The window stops at `.` and `;`, so a negation in an earlier clause cannot
   reach across and cancel a real floor in this one. Erring toward "negated"
   errs toward keeping the lender, which is the safe direction. */
const NEGATED = /\b(?:no|not|none|without|regardless\s+of)\b[^.;\n]{0,40}$/i;

/**
 * Does this text mention a credit score at all? Used to separate "states no
 * minimum" from "states one we could not read" in the summary, so a parser
 * that gets worse shows up as a number instead of as silently fewer skips.
 *
 * @param {string|null|undefined} raw
 * @returns {boolean}
 */
export function mentionsCreditScore(raw) {
  const text = String(raw || "");
  if (!text.trim()) return false;
  return new RegExp(`${SCORE_WORD}`, "i").test(text) && /\b[3-8]\d{2}\b/.test(text);
}

/**
 * The lender's own stated credit floor, or null.
 *
 * Numeric column first when one exists — `minimum_credit_score` is the drop-in
 * point for real data and is absent from the schema today. Otherwise a
 * conservative read of `stated_requirements`: when several candidates parse,
 * the LOWEST wins, because the lowest excludes the fewest people.
 *
 * @param {object} lender
 * @returns {{ min: number|null, source: string|null, unreadable: boolean }}
 */
export function lenderMinScore(lender = {}) {
  const column = fico(lender.minimum_credit_score);
  if (column != null) return { min: column, source: "column", unreadable: false };

  const raw = String(lender.stated_requirements || "");
  const found = [];
  for (const re of MIN_SCORE_PATTERNS) {
    const m = re.exec(raw);
    if (!m) continue;
    if (NEGATED.test(raw.slice(0, m.index + m[0].indexOf(m[1])))) continue;
    const n = fico(m[1]);
    if (n != null) found.push(n);
  }
  if (found.length) {
    return { min: Math.min(...found), source: "stated_requirements", unreadable: false };
  }
  return { min: null, source: null, unreadable: mentionsCreditScore(raw) };
}

/**
 * Which of this client's scores this lender would actually see. A lender that
 * names the bureau it pulls is judged on that bureau; one that names none — as
 * 310 of 313 rows do — is judged on the client's best score.
 *
 * @param {string[]} lenderBureaus  normalized codes from parseBureaus
 * @param {object} credit           a resolveCreditProfile result
 * @returns {number|null}
 */
export function scoreForLender(lenderBureaus = [], credit = null) {
  if (!credit || !credit.available) return null;
  const seen = (lenderBureaus || [])
    .map((b) => credit.scores?.[b])
    .filter((v) => v != null);
  if (seen.length) return Math.max(...seen);
  return credit.best_score;
}

/**
 * @param {string|null|undefined} eligibleStates
 * @param {string|null|undefined} clientState
 * @returns {boolean}
 */
export function stateEligible(eligibleStates, clientState) {
  const state = String(clientState || "").trim().toUpperCase();
  if (!state) return true; // unknown client state — do not invent a block
  const raw = String(eligibleStates || "").trim();
  if (!raw) return true; // unknown lender coverage — include
  if (/^all(\s+states)?$/i.test(raw) || raw === "*") return true;
  const tokens = raw
    .split(/[,;/|\n]+/)
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);
  if (!tokens.length) return true;
  return tokens.some((t) => t === state || t.includes(state) || state.includes(t));
}

const TERMINAL_CASE_STATUSES = new Set([
  "Completed", "Canceled", "Cancelled", "Cleared", "Closed"
]);

/**
 * Active inquiry_removal_case rows mark their bureau hot, unless an owner
 * override is present (gate_override_by + gate_override_at).
 * Pure — pass case rows in; no queries.
 *
 * @param {object[]} cases
 * @returns {Set<string>}
 */
export function bureausFromActiveCases(cases = []) {
  const out = new Set();
  for (const row of Array.isArray(cases) ? cases : []) {
    if (!row) continue;
    const status = String(row.case_status || row.status || "Queued");
    if (TERMINAL_CASE_STATUSES.has(status)) continue;
    if (/complete|cancel|clear|close/i.test(status)) continue;
    if (row.gate_override_by && row.gate_override_at) continue;
    const raw = row.selected_bureaus_raw || row.bureau || "";
    for (const c of parseBureaus(raw)) out.add(c);
  }
  return out;
}

/**
 * @param {object[]} inquiryLog  rows with { bureau, status?, created_at? }
 * @param {{ sensitiveStatuses?: string[], recentDays?: number, now?: Date,
 *           cases?: object[] }} [opts]
 * @returns {Set<string>} normalized bureau codes that should be avoided
 */
export function sensitiveBureaus(inquiryLog, opts = {}) {
  const statuses = new Set(
    (opts.sensitiveStatuses || ["open", "disputed", "new"]).map((s) => s.toLowerCase())
  );
  const recentDays = opts.recentDays ?? 30;
  const now = opts.now || new Date();
  const out = new Set();
  for (const row of Array.isArray(inquiryLog) ? inquiryLog : []) {
    const codes = parseBureaus(row?.bureau);
    if (!codes.length) continue;
    const st = String(row?.status || "open").toLowerCase();
    let hot = statuses.has(st);
    if (!hot && row?.created_at) {
      const t = new Date(row.created_at).getTime();
      if (Number.isFinite(t) && (now - t) / 86400000 <= recentDays) hot = true;
    }
    if (hot) for (const c of codes) out.add(c);
  }
  for (const c of bureausFromActiveCases(opts.cases || [])) out.add(c);
  return out;
}

function bureauOverlap(lenderBureaus, avoid) {
  return lenderBureaus.filter((b) => avoid.has(b));
}

/**
 * @param {object} opts
 * @param {object[]} opts.lenders
 * @param {string|null} [opts.clientState]
 * @param {object[]} [opts.inquiryLog]
 * @param {string|null} [opts.lenderTable]
 * @param {boolean} [opts.includeInactive]
 * @param {boolean} [opts.includeDemo]  Demo Mode. Default false = exclude.
 * @param {number} [opts.recentInquiryDays]
 * @param {object|null} [opts.credit]   resolveCreditProfile result, or null
 *   when no pull is on file. Null means the score gate does not run — it does
 *   NOT mean everybody passes it silently; `summary.credit.available` says so.
 * @returns {{ matches: object[], skipped: object[], summary: object }}
 */
export function matchLenders({
  lenders = [],
  clientState = null,
  inquiryLog = [],
  cases = [],
  lenderTable = null,
  includeInactive = false,
  includeDemo = false,
  recentInquiryDays = 30,
  credit = null,
  now = new Date()
} = {}) {
  const avoid = sensitiveBureaus(inquiryLog, { recentDays: recentInquiryDays, now, cases });
  const bureauUse = new Map(); // code → count among accepted so far (rotation)
  const matches = [];
  const skipped = [];
  let statedMinimums = 0;   // lenders whose own floor we could read
  let unreadable = 0;       // lenders that talk about a score we could not read
  let excludedOnScore = 0;

  /* DEMO MODE, EXCLUDED BY DEFAULT.

     listLenders() already applies this gate in SQL, so the normal path never
     hands a demo row down here. This is the second layer: matchLenders is
     exported directly and any caller can pass it an array it assembled
     itself, and a real client on a real call must never see a sample lender
     no matter which caller built the list.

     Dropped rows do NOT go into `skipped`. `skipped` is shown on the round
     planner, and a row listed there by name is still a demo lender disclosed
     to a real client. With Demo Mode off they are absent, not refused. */
  const list = (Array.isArray(lenders) ? lenders : [])
    .filter((L) => includeDemo || !L?.is_demo);
  for (const L of list) {
    if (!L) continue;
    if (lenderTable && L.lender_table !== lenderTable) {
      skipped.push({ id: L.id, name: L.name, reason: "wrong_table" });
      continue;
    }
    if (!includeInactive && L.active === false) {
      skipped.push({ id: L.id, name: L.name, reason: "inactive" });
      continue;
    }
    if (!stateEligible(L.eligible_states, clientState)) {
      skipped.push({ id: L.id, name: L.name, reason: "state_ineligible" });
      continue;
    }
    const bureaus = parseBureaus(L.bureaus_pulled);
    const hit = bureauOverlap(bureaus, avoid);
    if (hit.length) {
      skipped.push({
        id: L.id, name: L.name, reason: "inquiry_sensitive",
        bureaus: hit
      });
      continue;
    }

    /* THE CREDIT FILE. Reached only after the structural gates, so a lender
       refused for its state or a hot bureau is never also reported as a credit
       refusal. Order matters on the screen: `skipped` is read out loud. */
    const requirement = lenderMinScore(L);
    if (requirement.min != null) statedMinimums++;
    if (requirement.unreadable) unreadable++;
    const fileScore = scoreForLender(bureaus, credit);
    if (requirement.min != null && fileScore != null && fileScore < requirement.min) {
      excludedOnScore++;
      skipped.push({
        id: L.id, name: L.name, reason: "score_below_minimum",
        minimum_score: requirement.min,
        minimum_source: requirement.source,
        file_score: fileScore
      });
      continue;
    }

    const rotationCost = bureaus.reduce((s, b) => s + (bureauUse.get(b) || 0), 0);
    const tier = L.priority_tier == null ? 99 : Number(L.priority_tier);
    matches.push({
      id: L.id,
      name: L.name,
      lender_table: L.lender_table,
      bureaus_pulled: L.bureaus_pulled,
      bureaus,
      eligible_states: L.eligible_states,
      priority_tier: L.priority_tier,
      application_url: L.application_url,
      typical_approval_range: L.typical_approval_range,
      average_starting_loc: L.average_starting_loc,
      max_known_loc: L.max_known_loc,
      insider_tips: L.insider_tips,
      stated_requirements: L.stated_requirements,
      stated_minimum_score: requirement.min,
      is_demo: !!L.is_demo,
      rotation_cost: rotationCost,
      sort_tier: tier
    });
  }

  matches.sort((a, b) => {
    if (a.sort_tier !== b.sort_tier) return a.sort_tier - b.sort_tier;
    if (a.rotation_cost !== b.rotation_cost) return a.rotation_cost - b.rotation_cost;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  // Recompute rotation in final order so the board can show a spread plan.
  bureauUse.clear();
  for (const m of matches) {
    m.rotation_cost = m.bureaus.reduce((s, b) => s + (bureauUse.get(b) || 0), 0);
    for (const b of m.bureaus) bureauUse.set(b, (bureauUse.get(b) || 0) + 1);
  }
  matches.sort((a, b) => {
    if (a.sort_tier !== b.sort_tier) return a.sort_tier - b.sort_tier;
    if (a.rotation_cost !== b.rotation_cost) return a.rotation_cost - b.rotation_cost;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  return {
    matches,
    skipped,
    summary: {
      lender_count: list.length,
      match_count: matches.length,
      skipped_count: skipped.length,
      sensitive_bureaus: [...avoid],
      client_state: clientState || null,
      /* What the credit file actually did to this count. The three counters
         are the honest answer to "does this number mean anything about this
         client" — with today's data lenders_with_stated_minimum is 0, so the
         answer is no, and the closer screen has to be able to say that rather
         than imply a screen that did not happen. */
      credit: {
        available: !!(credit && credit.available),
        scores: credit && credit.available ? credit.scores : null,
        best_score: credit && credit.available ? credit.best_score : null,
        utilization_pct: credit ? credit.utilization_pct : null,
        tier: credit ? credit.tier : null,
        funding_estimate: credit ? credit.funding_estimate : null,
        pulled_at: credit ? credit.pulled_at : null,
        lenders_with_stated_minimum: statedMinimums,
        lenders_with_unreadable_requirement: unreadable,
        lenders_excluded_on_score: excludedOnScore
      }
    }
  };
}

/** Convenience for deal-funding / closer dashboard. */
export function lenderMatchCount(opts) {
  return matchLenders(opts).summary.match_count;
}

/* Match lenders to a client's underwrite profile.
   Structural rules only — no invented approval criteria or lender names.

   Filters:
   1. active lenders only (unless includeInactive)
   2. eligible_states — when both client state and lender states are known,
      client state must appear (case-insensitive token match). Empty lender
      eligible_states = unknown → include (do not invent a restriction).
   3. inquiry sensitivity — skip lenders whose bureaus_pulled intersect
      sensitive bureaus (open/recent inquiries on that bureau).
   4. bureau rotation — rank by how little the planned set already leans on
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
  now = new Date()
} = {}) {
  const avoid = sensitiveBureaus(inquiryLog, { recentDays: recentInquiryDays, now, cases });
  const bureauUse = new Map(); // code → count among accepted so far (rotation)
  const matches = [];
  const skipped = [];

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
      client_state: clientState || null
    }
  };
}

/** Convenience for deal-funding / closer dashboard. */
export function lenderMatchCount(opts) {
  return matchLenders(opts).summary.match_count;
}

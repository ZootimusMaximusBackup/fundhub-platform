// The derived fields the Closer Dashboard needs and api/dashboard/client.mjs
// did not carry: tier reasoning, tri-merge scores, a utilisation band, and open
// blockers.
//
// Pure functions over rows that endpoint already fetches, so this is testable
// without a database and adds no queries.
//
// NOTHING IS INVENTED. Every value is derived from something the analyzer
// actually stored. crs_results.result is the raw analysis.completed payload
// (src/handlers/client-lifecycle.mjs:135), so `scores` and `utilization` are read
// from there if the analyzer sent them and reported as null if it did not — a
// screen showing "—" is correct; a screen showing a made-up 720 is not.

/* triMerge — the three bureau scores from the most recent CRS result.
   Returns { experian, equifax, transunion, spread, asOf, source } with nulls
   where the analyzer sent nothing. */
export function triMerge(crsResults = []) {
  const empty = { experian: null, equifax: null, transunion: null,
                  spread: null, asOf: null, source: null };
  const latest = latestWithScores(crsResults);
  if (!latest) return empty;

  const s = latest.result.scores || {};
  // The analyzer's own key names, and the long forms in case a later version
  // spells them out. No other guessing: an unrecognised shape reads as null.
  const experian   = num(s.ex ?? s.experian);
  const equifax    = num(s.eq ?? s.equifax);
  const transunion = num(s.tu ?? s.transunion);

  const present = [experian, equifax, transunion].filter((v) => v !== null);
  return {
    experian, equifax, transunion,
    spread: present.length >= 2 ? Math.max(...present) - Math.min(...present) : null,
    asOf: latest.created_at || null,
    source: present.length ? "crs_results" : null
  };
}

function latestWithScores(crsResults) {
  for (const r of [...(crsResults || [])].sort(byNewest)) {
    const result = safeObject(r.result);
    if (result && result.scores && typeof result.scores === "object") {
      return { ...r, result };
    }
  }
  return null;
}

function byNewest(a, b) {
  return new Date(b.created_at || 0) - new Date(a.created_at || 0);
}

function safeObject(v) {
  if (!v) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return null; }
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* UTILISATION BANDS. The thresholds are the standard credit-utilisation bands
   the roadmap is written against; they are a presentation grouping over a number
   the analyzer supplied, not a scoring model of our own. A missing utilisation
   yields band null rather than "unknown" masquerading as a band. */
export const UTILISATION_BANDS = [
  { band: "excellent", max: 10 },
  { band: "good",      max: 30 },
  { band: "high",      max: 50 },
  { band: "severe",    max: Infinity }
];

export function utilisation(crsResults = [], client = {}) {
  const latest = [...(crsResults || [])].sort(byNewest)
    .map((r) => ({ ...r, result: safeObject(r.result) }))
    .find((r) => r.result && r.result.utilization !== undefined);

  const pct = latest ? num(latest.result.utilization)
                     : num(client && client.custom_fields && client.custom_fields.utilization);
  if (pct === null) return { percent: null, band: null, asOf: null };

  const band = UTILISATION_BANDS.find((b) => pct <= b.max).band;
  return { percent: pct, band, asOf: latest ? latest.created_at || null : null };
}

/* TIER REASONING. Why this client landed on this tier, in the words of the data
   that decided it. Deliberately NOT a re-derivation of the tier: re-running the
   decision here could disagree with the stored one, and the stored one is what
   the client was told. This explains, it does not recompute. */
export function tierReasoning(client = {}, crsResults = []) {
  const tier = client.outcome_tier || null;
  const cf = client.custom_fields || {};
  const latest = [...(crsResults || [])].sort(byNewest)
    .map((r) => ({ ...r, result: safeObject(r.result) }))[0];
  const payload = (latest && latest.result) || {};

  const factors = [];
  const scores = triMerge(crsResults);
  if (scores.experian !== null || scores.equifax !== null || scores.transunion !== null) {
    factors.push({
      factor: "tri_merge",
      detail: `EX ${fmt(scores.experian)} · EQ ${fmt(scores.equifax)} · TU ${fmt(scores.transunion)}`
    });
  }
  const util = utilisation(crsResults, client);
  if (util.percent !== null) {
    factors.push({ factor: "utilisation", detail: `${util.percent}% (${util.band})` });
  }
  const estimate = cf.total_funding_estimate ?? payload.fundingEstimate ?? null;
  if (estimate !== null && estimate !== undefined && estimate !== "") {
    factors.push({ factor: "funding_estimate", detail: String(estimate) });
  }
  if (payload.reason) factors.push({ factor: "analyzer_reason", detail: String(payload.reason) });

  return {
    tier,
    decidedAt: latest ? latest.created_at || null : null,
    // A tier with nothing behind it is a real state worth surfacing — it means
    // the tier was set without a CRS result to explain it.
    unexplained: !!tier && factors.length === 0,
    factors
  };
}

function fmt(v) { return v === null ? "—" : String(v); }

/* OPEN BLOCKERS — what is actually stopping this file moving, assembled from
   rows the endpoint already has. Each blocker names its source so a closer can
   act on it rather than guessing what produced it. */
export function openBlockers({ client = {}, tasks = [], fundingRounds = [], invoices = [] } = {}) {
  const cf = client.custom_fields || {};
  const blockers = [];

  for (const t of tasks.filter((t) => !t.done)) {
    blockers.push({
      kind: "task", severity: "normal",
      label: t.title,
      detail: t.assignee_role ? `owned by ${t.assignee_role}` : "unassigned",
      source: t.source_workflow || "task", id: t.id
    });
  }

  for (const r of fundingRounds.filter((r) => r.hold_reason)) {
    blockers.push({
      kind: "funding_hold", severity: "high",
      label: `Round ${r.round_number} on hold`,
      detail: r.hold_reason, source: "funding_rounds", id: r.id
    });
  }

  for (const inv of invoices.filter((i) => Number(i.balance_due || 0) > 0)) {
    const overdue = inv.due_at && new Date(inv.due_at) < new Date();
    blockers.push({
      kind: "balance_due", severity: overdue ? "high" : "normal",
      label: overdue ? "Invoice overdue" : "Balance outstanding",
      detail: `${inv.currency || "USD"} ${inv.balance_due}`,
      source: "invoices", id: inv.id || inv.invoice_id
    });
  }

  // The two gates the journey actually stops on, read from the flags the
  // workflows maintain rather than inferred.
  if (cf.crs_paid === false) {
    blockers.push({ kind: "gate", severity: "high", label: "CRS not paid",
                    detail: "the analysis gate is unpaid", source: "custom_fields.crs_paid" });
  }
  if (cf.deposit_paid === false && cf.sale_closed === true) {
    blockers.push({ kind: "gate", severity: "high", label: "Deposit outstanding",
                    detail: "sale closed with no deposit recorded",
                    source: "custom_fields.deposit_paid" });
  }

  const order = { high: 0, normal: 1 };
  blockers.sort((a, b) => order[a.severity] - order[b.severity]);
  return blockers;
}

/* clientDetailExtras — everything above, in one call, for the endpoint. */
export function clientDetailExtras({ client, crsResults, tasks, fundingRounds, invoices } = {}) {
  return {
    tier_reasoning: tierReasoning(client, crsResults),
    tri_merge: triMerge(crsResults),
    utilisation: utilisation(crsResults, client),
    open_blockers: openBlockers({ client, tasks, fundingRounds, invoices })
  };
}

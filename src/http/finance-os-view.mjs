// Finance OS — the decision logic behind public/app/finance-os.html.
//
// WHY THIS FILE EXISTS AT ALL. The screen is a static page with an inline
// script; there is no browser test harness in this repo and `npm test` globs
// src/** and scripts/** only, so anything that stays inside the HTML is
// untestable by construction. The parts of that screen that can be WRONG —
// what a card's utilization is, which of four different failures a banner is
// describing, and whether a tile is allowed to claim a number at all — live
// here instead, as pure functions over plain values. The HTML keeps the DOM
// plumbing and nothing else.
//
// THE SAME SOURCE RUNS IN THE BROWSER. finance-os.html carries a verbatim copy
// of this file's body between /* ==FHVIEW-BEGIN== */ and /* ==FHVIEW-END== */
// markers, with the word `export ` stripped, wrapped in an IIFE that returns
// VIEW. finance-os-view.test.mjs asserts the copy is exactly that, so the two
// cannot drift: edit THIS file, then paste it across. A second copy that is
// merely "equivalent" is the failure mode AUDIT-FINDINGS.md describes — a fake
// modelling the thing you wish you had, which cannot fail when the real thing
// moves.
//
// THREE RULES THIS FILE ENFORCES, BECAUSE A SCREEN CANNOT BE TRUSTED TO
// REMEMBER THEM ONCE PER TILE:
//
//   1. UTILIZATION WITH AN UNKNOWN LIMIT IS UNKNOWN, NOT ZERO. This is the
//      whole reason the module exists. `tradelines.credit_limit_cents` is
//      NULLABLE and a bureau file that reports a balance with no limit is
//      ordinary. Rendering that card as "0%" tells a consumer their credit is
//      in perfect shape when the truth is that nobody knows. utilization()
//      returns null for it and the screen prints an em dash with a reason.
//      A limit of ZERO is also null — x/0 is undefined, not 0% and not
//      infinity. A limit of 5000 with a balance of 0 IS a real 0%, and that
//      one is not suppressed: unknown and zero are different facts and this
//      function is the only place that distinction is decided.
//
//   2. NOTHING IS INVENTED. §8's v1 field list is issuer, limit, balance and
//      utilization per card, plus subscription tier/status, alerts, the
//      on-demand soft pull and the optimization roadmap. Anything with no
//      table behind it is absent from the view model entirely — not a
//      placeholder, not a zero, not a greyed-out sample. NOT_SOURCED names
//      what was refused and why, so the gap stays visible instead of being
//      rediscovered. Bills, business-vs-personal splits, payment reminders and
//      cash-flow projections are v2 and appear nowhere below.
//
//   3. FOUR FAILURES, FOUR SENTENCES. classify() never collapses "you are
//      signed out" (401) into "your role cannot see this" (403) into "this was
//      never deployed" (404-unrouted) into "the backend broke" (5xx).
//      public/app/data.js maps 401 and 403 onto one "unauthorized" source,
//      which is why this screen does its own fetch and passes the raw status
//      here: a user who reads "not signed in" when the real answer is "the
//      subscriptions table has not shipped" files a support ticket, and a user
//      who reads "backend unavailable" when their session merely expired
//      shrugs and walks away from a working product.

/* ==FHVIEW-BEGIN== */

/* The v1 field list, from the partner-platform addendum §8. Exported so the
   test can assert the screen renders these and only these. */
export const CARD_FIELDS = ["issuer", "limit", "balance", "utilization"];

/* What this screen deliberately does NOT show, and the reason. Every entry is
   a field somebody will ask for; each stays off the screen until a table backs
   it. Mirrors the NOT_SOURCED convention in closer-dashboard-view.mjs. */
export const NOT_SOURCED = {
  bills: "v2 — no bills table exists",
  business_vs_personal: "v2 — tradelines has no ownership column",
  payment_reminders: "v2 — no due-date or reminder table exists",
  cash_flow_projection: "v2 — no income or recurring-payment source exists",
  minimum_payment: "not on tradelines; a bureau file does not always carry it",
  statement_date: "not on tradelines",
  card_last_four: "not on tradelines; account_ref is a bureau id, not a PAN",
  rewards: "no source anywhere in the schema"
};

/* The three tables this screen reads that may not have shipped yet. Keyed by
   the read resource, valued by the migration that creates it. Used only to
   word an honest banner — the screen never asserts a table exists. */
export const PENDING_SOURCES = {
  subscriptions: "075_subscriptions.sql",
  alerts: "078_alerts.sql",
  "soft-pull": "the on-demand soft-pull request path"
};

/* rows — the row array out of a response body, whichever key it arrived under.
 *
 * THE TWO SHAPES ARE REAL AND THIS SCREEN READS BOTH. Endpoints built on
 * src/http/read-api.mjs's readHandler() answer
 * { ok, count, limit, offset, hasMore, items } — the key is `items`.
 * api/read/tradelines.mjs is hand-rolled because it returns rows AND the
 * funding calculator's output, and it answers { ok, data, funding } — the key
 * is `data`. Reading only one of the two silently yields an empty section
 * against a perfectly healthy endpoint, which is what this screen did against
 * /api/read/entitlements until it was run against a real server. */
export function rows(body) {
  if (!body || typeof body !== "object") return [];
  if (Array.isArray(body.items)) return body.items;
  if (Array.isArray(body.data)) return body.data;
  return [];
}

/* num — a number, or null. node-pg hands bigint columns back as strings, so
   "5000" and 5000 must land in the same place. "" and null are both unknown. */
export function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return isFinite(n) ? n : null;
}

export function esc(v) {
  return String(v === null || v === undefined ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* usd — cents to dollars, at the boundary and nowhere else. Integer cents are
   the storage unit (054's comment says why); the screen never divides by 100
   itself. null in, em dash out — never "$0". */
export function usd(cents) {
  const n = num(cents);
  if (n === null) return "—";
  return "$" + Math.round(n / 100).toLocaleString("en-US");
}

/* ── the rule this module exists for ──────────────────────────────────────── */

/* utilization — balance ÷ limit, as a fraction, or NULL.
 *
 * Returns null, meaning UNKNOWN, when:
 *   - the limit is null      — a bureau file without a limit is ordinary
 *   - the balance is null    — same
 *   - the limit is 0 or less — x/0 is undefined; a zero-limit card has no
 *                              utilization, and reporting one is arithmetic
 *                              that happens to produce a number
 *
 * Returns a real 0 when the limit is known and the balance is a known zero.
 * That is a true fact about somebody's credit and suppressing it would be its
 * own lie.
 *
 * Does NOT clamp above 1. An over-limit card is real and common, and a screen
 * that silently reports 100% for a card at 118% is hiding the single worst
 * number on the page.
 */
export function utilization(limitCents, balanceCents) {
  const limit = num(limitCents);
  const balance = num(balanceCents);
  if (limit === null || balance === null) return null;
  if (limit <= 0) return null;
  return balance / limit;
}

/* utilizationText — the fraction as a percentage, or an em dash. Never "0%"
   for an unknown. Rounds to whole percent; 0.185 renders "19%". */
export function utilizationText(fraction) {
  const n = num(fraction);
  if (n === null) return "—";
  return Math.round(n * 100) + "%";
}

/* whyUnknown — the sentence that sits next to an em dash. Rule 3 of the brief:
   show the blank AND say why. Returns null when utilization is knowable, so a
   caller can use it as the presence test. */
export function whyUnknown(limitCents, balanceCents) {
  const limit = num(limitCents);
  const balance = num(balanceCents);
  if (limit === null && balance === null) return "no limit or balance on file";
  if (limit === null) return "no credit limit on file";
  if (balance === null) return "no balance on file";
  if (limit <= 0) return "credit limit is zero";
  return null;
}

/* ── per-card view model ───────────────────────────────────────────────────── */

/* cardRow — one tradelines row → the four §8 fields and nothing else.
 *
 * `issuer` is §8's word for what 054 calls `lender`. The column is NOT NULL,
 * but an empty string survives it, so a blank is named rather than rendered as
 * an empty cell.
 *
 * `source` and `kind` come along because they change what the numbers MEAN,
 * not because §8 lists them as tiles: a 'manual' line was typed by a human and
 * an 'installment' line cannot be drawn against. Both are already on the row;
 * neither is invented.
 */
export function cardRow(row) {
  const r = row || {};
  const limitCents = r.credit_limit_cents;
  const balanceCents = r.balance_cents;
  const util = utilization(limitCents, balanceCents);
  const issuer = r.lender === null || r.lender === undefined || String(r.lender).trim() === ""
    ? "(no issuer recorded)"
    : String(r.lender).trim();

  return {
    id: r.id || null,
    issuer: issuer,
    limitText: usd(limitCents),
    limitKnown: num(limitCents) !== null,
    balanceText: usd(balanceCents),
    balanceKnown: num(balanceCents) !== null,
    utilization: util,
    utilizationText: utilizationText(util),
    utilizationKnown: util !== null,
    whyUnknown: whyUnknown(limitCents, balanceCents),
    // Over 100% is the number a client most needs to see, so it is flagged
    // rather than left for the eye to catch in a column of percentages.
    overLimit: util !== null && util > 1,
    kind: r.kind || null,
    // 'crs' is off a soft pull and machine-written; 'manual' was typed. 054's
    // header is explicit that a reader must always be able to tell which.
    source: r.source || null,
    typedByHand: r.source === "manual",
    asOf: r.as_of || null
  };
}

/* portfolioTotals — the sums, with UNKNOWN PROPAGATED rather than skipped.
 *
 * A total that quietly drops the cards it could not read is worse than no
 * total: it looks authoritative and is short by an unknown amount. So the
 * counts of what was excluded ride along, and the screen prints them.
 *
 * Aggregate utilization is computed only over cards where BOTH numbers are
 * known, and is null when that set is empty. It is not the mean of the
 * per-card percentages — a $50k card at 10% and a $500 card at 100% is 11%
 * utilization overall, not 55%.
 */
export function portfolioTotals(cards) {
  const rows = Array.isArray(cards) ? cards : [];
  let limitSum = 0, balanceSum = 0, counted = 0;
  let missingLimit = 0, missingBalance = 0;

  rows.forEach((c) => {
    const limit = num(c.credit_limit_cents);
    const balance = num(c.balance_cents);
    if (limit === null) missingLimit++;
    if (balance === null) missingBalance++;
    if (limit !== null && balance !== null && limit > 0) {
      limitSum += limit;
      balanceSum += balance;
      counted++;
    }
  });

  const util = counted === 0 ? null : balanceSum / limitSum;
  return {
    cardCount: rows.length,
    countedCount: counted,
    excludedCount: rows.length - counted,
    missingLimit: missingLimit,
    missingBalance: missingBalance,
    limitText: counted === 0 ? "—" : usd(limitSum),
    balanceText: counted === 0 ? "—" : usd(balanceSum),
    utilization: util,
    utilizationText: utilizationText(util),
    // The sentence under the total. Silence here reads as "all cards counted".
    caveat: counted === rows.length
      ? null
      : (rows.length - counted) + " of " + rows.length +
        " cards left out of the total — incomplete limit or balance"
  };
}

/* ── failure classification ────────────────────────────────────────────────── */

/* classify — a raw response → what the banner says.
 *
 * Takes { status, body } as returned by the screen's own fetch, or
 * { transport: true, detail } when there was no answer at all. Deliberately
 * NOT fed from data.js's `source`, which maps 401 and 403 onto one value.
 *
 * `code` is the machine-readable outcome, `tone` picks the banner colour
 * (matching client-control-panel.html's three tones exactly), and `text` is
 * the sentence a non-technical person reads.
 */
export function classify(res, opts) {
  const what = (opts && opts.what) || "data";
  const pending = opts && opts.pending ? String(opts.pending) : null;

  // No answer at all — the request never completed. Distinct from every
  // status-bearing case below because nothing is known about the far end.
  if (!res || res.transport) {
    const detail = res && res.detail ? " (" + res.detail + ")" : "";
    return {
      code: "offline", tone: "error", live: false,
      text: "could not reach the server for " + what + detail
    };
  }

  const status = Number(res.status) || 0;
  const body = res.body && typeof res.body === "object" ? res.body : null;

  if (status === 401) {
    return {
      code: "signedout", tone: "sample", live: false,
      text: "your session has expired — sign in again to see your " + what
    };
  }

  // 403 is NOT 401. The session is valid; this role is not allowed. Telling
  // somebody to sign in again when signing in again cannot help is the exact
  // failure this branch exists to prevent.
  if (status === 403) {
    return {
      code: "forbidden", tone: "sample", live: false,
      text: "your account is not permitted to view " + what
    };
  }

  if (status === 404) {
    // TWO different 404s, and they must not share a sentence. The router's
    // fallthrough answers {error:"not_found", path:"..."} — that means the
    // endpoint is not deployed, which is a build problem. Anything else is a
    // working endpoint honestly reporting no such row.
    const unrouted = body && body.error === "not_found" && typeof body.path === "string";
    if (unrouted) {
      return {
        code: "unrouted", tone: "error", live: false,
        text: pending
          ? what + " — not available yet, " + pending + " has not shipped"
          : what + " — this part of the site is not deployed on this server"
      };
    }
    return {
      code: "notfound", tone: "sample", live: false,
      text: "nothing on file yet for " + what
    };
  }

  if (status === 400) {
    const detail = body && typeof body.error === "string" ? " (" + body.error + ")" : "";
    return {
      code: "badrequest", tone: "sample", live: false,
      text: "could not ask for " + what + detail
    };
  }

  if (status === 503 || (body && body.db === "down")) {
    return {
      code: "nodb", tone: "error", live: false,
      text: "the database is unreachable — could not load " + what
    };
  }

  if (status >= 500) {
    return {
      code: "servererror", tone: "error", live: false,
      text: "the server failed while loading " + what + " (error " + status + ")"
    };
  }

  // A 200 that is not ok:true is a failure wearing a success code.
  if (status === 200 && body && body.ok === true) {
    return { code: "live", tone: "real", live: true, text: null };
  }

  const detail = body && typeof body.error === "string" ? " (" + body.error + ")" : "";
  return {
    code: "badresponse", tone: "sample", live: false,
    text: "could not read " + what + detail
  };
}

/* ── section view models ───────────────────────────────────────────────────── */

/* buildCards — the tradelines response → the card table.
 *
 * Installment loans are carried in the table for round-tripping (054) but are
 * NOT cards. §8's tile is "card management", so they are filtered out and
 * counted, rather than silently dropped or wrongly listed as cards.
 */
export function buildCards(res) {
  const state = classify(res, { what: "your cards" });
  if (!state.live) {
    return { state: state, cards: [], totals: null, installmentCount: 0 };
  }
  const all = rows(res.body);
  const revolving = all.filter((r) => (r && r.kind) !== "installment");
  const installmentCount = all.length - revolving.length;

  return {
    state: state,
    cards: revolving.map(cardRow),
    totals: portfolioTotals(revolving),
    installmentCount: installmentCount
  };
}

/* buildSubscription — tier and status, from the subscriptions table (075).
 *
 * That table does not exist on this branch. The endpoint therefore 404s as
 * unrouted and this returns an unavailable state — which is the CORRECT v1
 * behaviour, not a stub. No tier name, no price and no renewal date is
 * invented; when 075 ships, the only change here is that the response starts
 * arriving. */
export function buildSubscription(res) {
  const state = classify(res, { what: "your subscription details", pending: PENDING_SOURCES.subscriptions });
  if (!state.live) return { state: state, tier: null, status: null };

  const row = rows(res.body)[0] || null;
  if (!row) {
    return {
      state: { code: "empty", tone: "sample", live: false, text: "no subscription on file for this account" },
      tier: null, status: null
    };
  }
  // Only the two fields §8 names. Anything else on the row is not this
  // screen's business until somebody asks for it.
  return {
    state: state,
    tier: row.tier === null || row.tier === undefined || row.tier === "" ? null : String(row.tier),
    status: row.status === null || row.status === undefined || row.status === "" ? null : String(row.status)
  };
}

/* buildAlerts — the alerts table (078). Same shape, same reasoning. */
export function buildAlerts(res) {
  const state = classify(res, { what: "your alerts", pending: PENDING_SOURCES.alerts });
  if (!state.live) return { state: state, alerts: [], count: 0 };

  const list = rows(res.body);
  return {
    state: state,
    alerts: list.map((r) => ({
      id: (r && r.id) || null,
      message: r && r.message ? String(r.message) : "(no message)",
      severity: r && r.severity ? String(r.severity) : null,
      createdAt: (r && r.created_at) || null
    })),
    count: list.length
  };
}

/* buildRoadmap — the monthly optimization report.
 *
 * THIS IS NOT src/optimize/. That module optimises AD SPEND — campaign
 * budgets and platform ceilings — and has nothing to do with a consumer's
 * credit. Wiring this tile to it would produce confident nonsense of exactly
 * the kind HANDOFF.md warns about with `cards`.
 *
 * The real identity is `credit-optimization-roadmap` in entitlement_catalog
 * (032), which client-portal.html already renders as a locking tile. So this
 * reports whether the client HOLDS the deliverable. It does not claim a
 * generation date, a download link or a monthly cadence, because nothing
 * stores a produced report artifact — see NOT_SOURCED.
 */
export const ROADMAP_CODE = "credit-optimization-roadmap";

export function buildRoadmap(res) {
  const state = classify(res, { what: "your optimization roadmap" });
  if (!state.live) return { state: state, held: false, name: null, grantedAt: null };

  const list = rows(res.body);
  let match = null;
  list.forEach((r) => { if (r && r.entitlement_code === ROADMAP_CODE) match = r; });

  if (!match) {
    return {
      state: state, held: false,
      name: null, grantedAt: null,
      note: "not part of your plan yet"
    };
  }
  return {
    state: state,
    held: match.active === true,
    name: match.entitlement_name || null,
    grantedAt: match.granted_at || null,
    note: match.active === true ? null : "included in your plan but not active"
  };
}

/* softPullState — whether the on-demand soft pull button can do anything.
 *
 * W3 owns the request path and it has not merged, so there is no endpoint to
 * POST to. The button is rendered DISABLED with the real reason rather than
 * hidden: §8 lists it as a v1 affordance, and a button that silently does
 * nothing is worse than one that says why it cannot. */
export function softPullState(available) {
  if (available === true) {
    return { enabled: true, label: "Request a credit refresh", reason: null };
  }
  return {
    enabled: false,
    label: "Request a credit refresh",
    reason: "not available yet — " + PENDING_SOURCES["soft-pull"] + " has not shipped"
  };
}

/* summarize — one banner line for the whole screen.
 *
 * The screen makes four independent reads and any subset can fail. One line
 * that names how many worked beats four stacked banners, and the worst tone
 * wins so a single failure is never hidden behind three successes. */
export function summarize(states) {
  const list = (Array.isArray(states) ? states : []).filter(Boolean);
  if (!list.length) return { tone: "sample", text: "nothing loaded" };

  const live = list.filter((s) => s.live);
  const failed = list.filter((s) => !s.live);
  const tone = failed.some((s) => s.tone === "error") ? "error"
    : failed.length ? "sample" : "real";

  if (!failed.length) return { tone: "real", text: "live · " + live.length + " of " + list.length + " sections loaded" };

  return {
    tone: tone,
    text: live.length + " of " + list.length + " sections loaded · " +
      failed.map((s) => s.text).join(" · ")
  };
}

export const VIEW = {
  CARD_FIELDS: CARD_FIELDS,
  NOT_SOURCED: NOT_SOURCED,
  PENDING_SOURCES: PENDING_SOURCES,
  ROADMAP_CODE: ROADMAP_CODE,
  rows: rows,
  num: num,
  esc: esc,
  usd: usd,
  utilization: utilization,
  utilizationText: utilizationText,
  whyUnknown: whyUnknown,
  cardRow: cardRow,
  portfolioTotals: portfolioTotals,
  classify: classify,
  buildCards: buildCards,
  buildSubscription: buildSubscription,
  buildAlerts: buildAlerts,
  buildRoadmap: buildRoadmap,
  softPullState: softPullState,
  summarize: summarize
};
/* ==FHVIEW-END== */

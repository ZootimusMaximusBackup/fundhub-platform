/* finance-os-view — the pure half of public/app/finance-os.html.
 *
 * WHY THIS FILE EXISTS. The screen is browser HTML and `npm test` globs `src/**`
 * and `scripts/**` only, so anything left inside the page is untested by
 * construction. Everything that can be wrong in a way a human would not notice
 * lives here: which fallback a failed read maps to, and how one API response
 * becomes the numbers on the screen. The page keeps only the DOM writes.
 *
 * THE PAGE CARRIES A VERBATIM COPY of these functions between
 * FH-VIEW-BEGIN / FH-VIEW-END, published as window.FHFinanceView — there is no
 * bundler and a <script> cannot import from src/. The copy is not on trust:
 * finance-os-view.test.mjs loads that block out of the HTML in a vm and runs the
 * SAME fixtures through both, asserting deep-equal output. Written in ES5 (var,
 * function, no template literals) so one text runs in both places.
 *
 *
 * THE SEVEN-ROW GRAMMAR. The approved wireframe
 * (client-control-panel-wireframe.md) is NOT present in this repository — see
 * docs/workflows/finance-os-banking.md, W9. The grammar below is therefore
 * RECONSTRUCTED from the two rules that were quoted verbatim in the brief —
 * "blockers only when they exist" and "system facts small and read-only" — and
 * from client-control-panel.html, which is the approved screen closest to this
 * one. It is recorded here so the next person can diff it against the real
 * document when it turns up rather than re-deriving it:
 *
 *   1 identity    who this is, and nothing else
 *   2 blockers    RENDERED ONLY WHEN NON-EMPTY. No empty state, no "no blockers"
 *                 card — an always-present row trains people to ignore it.
 *   3 headline    the few numbers that answer "how are they doing"
 *   4 detail      the rows the headline was computed from
 *   5 timing      what happens next, on a date
 *   6 actions     what a human could do about it
 *   7 system      where the numbers came from and when. Small, read-only.
 *
 * W9 fills rows 1, 3, 4 and 7 from tradelines, leaves 2 and 6 empty, and leaves
 * 5 to W10 — a bureau tradeline carries no due date (see 083's header). Rows
 * are declared with `present:false` rather than omitted, so W10 can fill them in
 * without moving anything.
 *
 *
 * IT COMPUTES NO MONEY. Every dollar and percentage comes from
 * GET /api/read/finance-os, which returns src/calculators/deal-funding.mjs's own
 * output. Two implementations of the same money math that can disagree is the
 * defect class this repo keeps finding.
 */

/* num — a number, or null. Accepts the numeric strings node-pg hands back for
   bigint/numeric columns, so a shape change at the boundary degrades to "—"
   instead of to NaN. */
function num(v) {
  if (v === null || v === undefined || v === "") return null;
  var n = typeof v === "number" ? v : Number(v);
  return isFinite(n) ? n : null;
}

/* The one string this screen uses for "we do not have this". It is a visible
   blank, never a zero: $0.00 is a claim, "—" is an absence. */
export var DASH = "—";

export function esc(v) {
  return String(v === null || v === undefined ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function usd(v) {
  var n = num(v);
  if (n === null) return DASH;
  var neg = n < 0;
  var s = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-$" : "$") + s;
}

export function pctText(v, dp) {
  var n = num(v);
  if (n === null) return DASH;
  return (n * 100).toFixed(dp === undefined ? 1 : dp) + "%";
}

export function dateText(v) {
  if (!v) return DASH;
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  return m ? m[0] : DASH;
}

/* ───────────────────────────────────────────────────────────────────────────
   classify — one read result → which mode the screen paints in.

   The fallback contract: a failed read NEVER blanks the screen. The sample
   markup stays and a banner says exactly what happened. The four HTTP outcomes
   the brief names are kept apart, because they are four different instructions
   to the person reading:

     401  you are signed out            → sign in
     403  signed in, not allowed        → ask for access; signing in again will
                                          not help, and telling them to is a lie
     404  backend fine, no such record  → check the id, NOT an outage
     5xx  backend up, database is not   → nothing you can do; it is being worked on

   data.js folds 401 and 403 into source "unauthorized" and now also carries the
   HTTP `status`, which is the only way to tell them apart.
   ─────────────────────────────────────────────────────────────────────────── */
export function classify(res, opts) {
  var o = opts || {};
  var S = "sample figures — ";

  if (!o.clientId) {
    return { mode: "sample", tone: "sample", httpStatus: null,
      text: S + "open this screen with ?client_id=<uuid> to load a real client" };
  }

  if (!res || res.ok !== true) {
    var source = (res && res.source) || "unknown";
    var detail = (res && res.error) || "no detail";
    var status = (res && res.status) || null;

    if (source === "demo") {
      return { mode: "sample", tone: "sample", httpStatus: null,
        text: S + "demo session, the backend was not queried" };
    }
    if (source === "unauthorized") {
      if (status === 403) {
        return { mode: "sample", tone: "error", httpStatus: 403,
          text: S + "your account is not allowed to read this client's credit lines (403). " +
                "You are signed in — signing in again will not help." };
      }
      return { mode: "sample", tone: "error", httpStatus: 401,
        text: S + "not signed in (401) — sign in to load this client. The backend is up." };
    }
    if (source === "offline") {
      return { mode: "sample", tone: "error", httpStatus: status,
        text: S + "GET /api/read/finance-os did not answer (" + detail +
              ") — the endpoint is not deployed or not routed. This is not a sign-in problem." };
    }
    if (source === "nodb") {
      return { mode: "sample", tone: "error", httpStatus: status,
        text: S + "the API answered but the database did not (" + detail + ")" };
    }
    if (source === "notfound") {
      return { mode: "sample", tone: "sample", httpStatus: 404,
        text: S + "the backend is up and has no client with that id (404)" };
    }
    if (source === "badrequest") {
      return { mode: "sample", tone: "sample", httpStatus: 400,
        text: S + "the request was rejected (" + detail + ")" };
    }
    if (source === "nodata") {
      return { mode: "sample", tone: "sample", httpStatus: null, text: S + "no client id to ask about" };
    }
    return { mode: "sample", tone: "error", httpStatus: status,
      text: S + "the read failed (" + source + ": " + detail + ")" };
  }

  var body = res.data || {};
  var rows = body.tradelines && body.tradelines.rows;
  if (!Array.isArray(rows) || !rows.length) {
    return { mode: "empty", tone: "sample", httpStatus: 200,
      text: "no credit lines on file for this client — every figure on this screen is sample markup" };
  }
  return { mode: "live", tone: "real", httpStatus: 200, text: null };
}

/* ───────────────────────────────────────────────────────────────────────────
   buildView — one API response → the seven rows.
   ─────────────────────────────────────────────────────────────────────────── */
export function buildView(payload) {
  var body = payload || {};
  var tl = body.tradelines || {};
  var rows = Array.isArray(tl.rows) ? tl.rows : [];
  var funding = tl.funding || {};

  var client = body.client || {};
  var name = [client.first_name, client.last_name].filter(Boolean).join(" ").trim();

  /* Row 4 first: the headline is a summary OF these, and building it from the
     same array is the only way the two cannot disagree. */
  var lines = rows.map(function (r) {
    var limit = num(r.credit_limit_cents);
    var balance = num(r.balance_cents);
    return {
      lender: r.lender || DASH,
      kind: r.kind || DASH,
      limitCents: limit,
      balanceCents: balance,
      limitText: limit === null ? DASH : usd(limit / 100),
      balanceText: balance === null ? DASH : usd(balance / 100),
      /* Available is only computable when BOTH sides are known. A null limit
         with a known balance is not "no headroom" and a null balance is not
         "full headroom" — both are unknown, and the dash says so. */
      availableText: (limit === null || balance === null) ? DASH : usd(Math.max(0, limit - balance) / 100),
      aprText: r.apr === null || r.apr === undefined ? DASH : pctText(num(r.apr), 2),
      /* A closer must be able to see which number came off a bureau and which a
         human typed — 054's header. */
      source: r.source || DASH,
      asOf: dateText(r.as_of),
      incomplete: limit === null || balance === null
    };
  });

  var counted = lines.filter(function (l) { return !l.incomplete; });
  var unknownCount = lines.length - counted.length;

  var totalLimit = counted.reduce(function (s, l) { return s + l.limitCents; }, 0);
  var totalBalance = counted.reduce(function (s, l) { return s + l.balanceCents; }, 0);

  /* Utilization over COMPLETE LINES ONLY. Summing known balances over
     known-plus-unknown limits gives a ratio whose numerator and denominator
     come from different populations — not a worse estimate, not a measurement
     of anything. Same rule as src/alerts/evaluate.mjs. */
  var utilization = counted.length && totalLimit > 0 ? totalBalance / totalLimit : null;

  var headline = [
    { label: "Available credit",
      value: funding.totalAvailableCredit === null || funding.totalAvailableCredit === undefined
        ? DASH : usd(funding.totalAvailableCredit),
      note: "from the funding calculator" },
    { label: "Total limit", value: counted.length ? usd(totalLimit / 100) : DASH,
      note: counted.length + " line(s) with complete data" },
    { label: "Total balance", value: counted.length ? usd(totalBalance / 100) : DASH, note: null },
    { label: "Utilization", value: utilization === null ? DASH : pctText(utilization, 1),
      note: unknownCount ? unknownCount + " line(s) not counted" : null }
  ];

  return {
    rows: [
      { id: "identity", present: true,
        client: { name: name || DASH, id: client.id || null, email: client.email || DASH } },

      /* Row 2 — blockers. W9 raises none: a bureau tradeline cannot be overdue
         or past due, because it carries no due date at all (083's header). An
         incomplete line is a gap, reported in row 7, not a blocker. */
      { id: "blockers", present: false, items: [] },

      { id: "headline", present: true, tiles: headline },

      { id: "detail", present: true, lines: lines, unknownCount: unknownCount },

      /* Row 5 — timing. Deliberately empty in W9 and filled by W10: nothing in
         `tradelines` holds a payment date. Declared rather than omitted so the
         grammar does not shift when it is filled. */
      { id: "timing", present: false, items: [],
        absentReason: "Credit lines from a bureau pull carry no payment dates. Connect a bank to see payment timing." },

      { id: "actions", present: false, items: [] },

      { id: "system", present: true, facts: systemFacts(body, lines, unknownCount) }
    ],
    counts: { lines: lines.length, counted: counted.length, unknown: unknownCount }
  };
}

/* Row 7 — where these numbers came from. Small, read-only, and it must include
   the unflattering facts: a screen that reports only what it knows reads as
   complete. */
function systemFacts(body, lines, unknownCount) {
  var tl = body.tradelines || {};
  var facts = [
    { label: "Source", value: "GET /api/read/finance-os" },
    { label: "Credit lines", value: String(lines.length) }
  ];

  var dates = lines.map(function (l) { return l.asOf; })
    .filter(function (d) { return d && d !== DASH; }).sort();
  facts.push({ label: "Oldest figure", value: dates.length ? dates[0] : DASH });
  facts.push({ label: "Newest figure", value: dates.length ? dates[dates.length - 1] : DASH });

  if (unknownCount) {
    facts.push({ label: "Not counted", value: unknownCount + " line(s) missing a limit or a balance" });
  }
  if (tl.funding && tl.funding.guardrail && tl.funding.guardrail.threshold !== undefined) {
    facts.push({ label: "Utilization threshold", value: pctText(num(tl.funding.guardrail.threshold), 0) });
  }
  return facts;
}

/* bannerText — one line under the title. null when the screen is live and
   complete; a screen with nothing to say says nothing. */
export function bannerText(view) {
  if (!view) return null;
  var counts = view.counts || {};
  if (!counts.lines) return null;
  if (counts.unknown) {
    return counts.unknown + " of " + counts.lines +
      " credit line(s) are missing a limit or a balance and are left out of the totals.";
  }
  return null;
}

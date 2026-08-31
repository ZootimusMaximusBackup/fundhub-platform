/* closer-dashboard-view — the pure half of public/app/closer-dashboard.html.
 *
 * WHY THIS FILE EXISTS AT ALL. The screen is browser HTML and `npm test` globs
 * `src/**` and `scripts/**` only, so anything left inside the page is untested
 * by construction. Everything here is the part of the wiring that can be wrong
 * in a way a human would not notice: which fallback a failed read maps to, and
 * how one API response becomes the numbers on the screen. The page keeps only
 * the DOM writes, which are obvious on inspection.
 *
 * THE PAGE CARRIES A VERBATIM COPY of these functions, inside
 * /* FH-VIEW-BEGIN * / … /* FH-VIEW-END * / , published as window.FHCloserView —
 * there is no bundler and a <script> cannot import from src/. The copy is not
 * on trust: closer-dashboard-view.test.mjs loads that block out of the HTML in a
 * vm and runs the SAME fixtures through both, asserting deep-equal output. If
 * the two ever drift the test fails rather than the screen quietly lying. Write
 * it in ES5 (var, function, no template literals) so one text runs in both.
 *
 * WHAT IT DOES NOT DO. It computes no money. Every dollar, percentage and
 * allocation shown on the Closer Dashboard is read out of `funding`, which is
 * src/calculators/deal-funding.mjs's own output as returned by
 * GET /api/read/tradelines. The screen used to re-implement the waterfall in
 * browser JS against numbers scraped out of its own sample table; two
 * implementations of the same money math that can disagree is the defect class
 * this repo keeps finding. The only arithmetic below is:
 *   - headroom left  = totalAvailableCredit − allocation.totalDrawn, a
 *     difference of two totals the API already reported;
 *   - total limit    = sum of allocation.draws[].creditLimit, the denominator
 *     the guardrail's own utilization percentage was taken over.
 * Both are labelled as derived in the report. Nothing else is derived, and
 * anything the response does not carry renders as "—" and is named in the
 * banner rather than being guessed.
 */

/* num — a number, or null. Accepts the numeric strings node-pg hands back for
   bigint/numeric columns, so a shape change at the boundary degrades to "—"
   instead of to NaN. */
function num(v) {
  if (v == null || v === "") return null;
  var n = typeof v === "number" ? v : Number(v);
  return isFinite(n) ? n : null;
}

function round2(n) {
  return n == null ? null : Math.round(n * 100) / 100;
}

export function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** usd — "$47,100", or "—" for anything that is not a number. NULL MEANS
    UNKNOWN AND MUST NOT BECOME $0. */
export function usd(v) {
  var n = num(v);
  return n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US");
}

/** numText — the bare form the waterfall table uses: "15,000". */
export function numText(v) {
  var n = num(v);
  return n == null ? "—" : Math.round(n).toLocaleString("en-US");
}

/** pctText — a FRACTION (0.1499) rendered as a percentage ("14.99%"). APR is
    stored and returned as a fraction in [0,1]; the screen is the only place it
    is ever a percentage, and the conversion happens here once. */
export function pctText(v, dp) {
  var n = num(v);
  return n == null ? "—" : (n * 100).toFixed(dp == null ? 0 : dp) + "%";
}

/* ───────────────────────────────────────────────────────────────────────────
   classify — one failed read → one banner, and the right one.

   The three cases the task calls out are three different problems with three
   different owners, and a single "backend unavailable" for all of them sends
   the wrong person hunting:

     offline      the route is missing or the network is down — nobody's session
     unauthorized 401/403 — sign in; the backend is fine
     nodb         the API answered and the database did not — an outage

   notfound/badrequest are NOT outages: the backend ran and answered honestly
   about a bad id, so they take the "sample" tone (see public/app/data.js).

   Returns { mode, tone, text }:
     mode "live"   paint from the API
     mode "empty"  read succeeded, nothing to paint — keep dashes, do not invent
     mode "sample" read failed — keep dashes, do not invent
   ─────────────────────────────────────────────────────────────────────────── */
export function classify(res, opts) {
  var o = opts || {};
  var clientId = o.clientId;
  var S = "deal calculators — ";

  if (!clientId) {
    return { mode: "sample", tone: "sample",
      text: S + "open this screen with ?client_id=<uuid> to load a real client" };
  }

  if (!res || res.ok !== true) {
    var source = (res && res.source) || "unknown";
    var detail = (res && res.error) || "no detail";
    if (source === "demo") {
      return { mode: "sample", tone: "sample", text: S + "demo session, the backend was not queried" };
    }
    if (source === "unauthorized") {
      return { mode: "sample", tone: "error",
        text: S + "not signed in (401) — sign in to load this client's tradelines. The backend is up." };
    }
    if (source === "offline") {
      return { mode: "sample", tone: "error",
        text: S + "GET /api/read/tradelines did not answer (" + detail +
              ") — the endpoint is not deployed or not routed. This is not a sign-in problem." };
    }
    if (source === "nodb") {
      return { mode: "sample", tone: "error",
        text: S + "the API answered but the database did not (" + detail + ")" };
    }
    if (source === "notfound") {
      return { mode: "sample", tone: "sample",
        text: S + "the backend is up and has no client with that id" };
    }
    if (source === "badrequest") {
      return { mode: "sample", tone: "sample",
        text: S + "the request was rejected (" + detail + ")" };
    }
    if (source === "nodata") {
      return { mode: "sample", tone: "sample", text: S + "no client id to ask about" };
    }
    return { mode: "sample", tone: "error",
      text: S + "the tradeline read failed (" + source + ": " + detail + ")" };
  }

  var body = res.data || {};
  var rows = Array.isArray(body.data) ? body.data : [];
  if (!rows.length) {
    return { mode: "empty", tone: "sample",
      text: "no tradelines on file for this client — funding numbers stay dashes" };
  }

  /* Rows exist but none of them can be drawn against: closed lines and
     installment loans are excluded by src/tradelines/index.mjs, and a line with
     no credit limit is dropped by calcFunding. A waterfall with no cards in it
     is not a screen — keep dashes and say exactly why. */
  var funding = body.funding || {};
  var alloc = funding.allocation || null;
  var drawable = alloc && Array.isArray(alloc.draws) ? alloc.draws.length : null;
  if (drawable === 0) {
    return { mode: "empty", tone: "sample",
      text: rows.length + " tradeline(s) on file for this client, none of them drawable " +
            "(installment, closed, or no credit limit recorded) — funding numbers stay dashes" };
  }

  return { mode: "live", tone: "real", text: null };
}

/* ───────────────────────────────────────────────────────────────────────────
   buildView — one { ok, data, funding } response → everything the page writes.
   ─────────────────────────────────────────────────────────────────────────── */
export function buildView(payload) {
  var body = payload || {};
  var stored = Array.isArray(body.data) ? body.data : [];
  var funding = body.funding || {};
  var alloc = funding.allocation || null;
  var guard = funding.guardrail || null;
  var pm = funding.payMethodComparison || null;
  var draws = alloc && Array.isArray(alloc.draws) ? alloc.draws : [];

  var rows = draws.map(function (d) {
    var apr = num(d.apr);
    var draw = num(d.draw);
    var drawn = draw != null && draw > 0;
    return {
      lender: d.lender == null || d.lender === "" ? "(no lender recorded)" : String(d.lender),
      /* An unpriced card is NOT a 0% card. calcFunding sorts it last precisely
         because the rate is unknown, and printing "0.00% APR" here would make
         the cheapest-first table look like it drew the wrong card first. */
      aprText: apr == null ? "APR not on file" : pctText(apr, 2) + " APR",
      aprOnly: apr == null ? "—" : pctText(apr, 2),
      limitText: numText(d.creditLimit),
      balanceText: numText(d.currentBalance),
      headroomText: numText(d.availableHeadroom),
      drawText: drawn ? numText(draw) : "—",
      unused: !drawn,
      // D-04's third column. No API source: the endpoint takes no minimum
      // payment percentage, so nothing in the response is this number.
      minPaymentText: "—"
    };
  });

  var totalAvailable = num(funding.totalAvailableCredit);
  var totalDrawn = alloc ? num(alloc.totalDrawn) : null;
  var requested = alloc ? num(alloc.requestedAmount) : null;
  var shortfall = alloc ? num(alloc.shortfall) : null;
  var headroomLeft = (totalAvailable != null && totalDrawn != null)
    ? round2(totalAvailable - totalDrawn) : null;

  var totalLimit = null;
  for (var i = 0; i < draws.length; i++) {
    var lim = num(draws[i].creditLimit);
    if (lim != null) totalLimit = (totalLimit == null ? 0 : totalLimit) + lim;
  }

  /* Every value interpolated below is a digits-and-symbols string produced by
     usd()/pctText(), never a lender name or anything else off the record, so
     the page can set this with innerHTML and keep the design's bold numbers. */
  var utilizationHtml = guard
    ? "Utilisation after draw <b>" + pctText(guard.aggregateUtilization, 0) + "</b> of " +
      usd(round2(totalLimit)) + " total limit · threshold " + pctText(guard.threshold, 0)
    : "Utilisation not computed — the response carried no guardrail";

  var guardrail = null;
  if (guard) {
    if (guard.hardStop) {
      guardrail = {
        cls: "alert-box",
        title: "⛔ Pre-Approval Guardrail — Hard Stop",
        bodyHtml: guard.message
          ? esc(guard.message)
          : "This draw crosses the " + pctText(guard.threshold, 0) + " utilisation threshold."
      };
    } else if (guard.message) {
      guardrail = {
        cls: "alert-box warn",
        title: "⚠ Pre-Approval Guardrail — Pre-Existing Utilisation",
        bodyHtml: esc(guard.message)
      };
    } else {
      guardrail = {
        cls: "alert-box clear",
        title: "✓ Pre-Approval Guardrail — Clear",
        bodyHtml: "This draw sits at <b>" + pctText(guard.aggregateUtilization, 0) +
          "</b> utilisation, under the " + pctText(guard.threshold, 0) +
          " threshold. Round 2 is not at risk from this draw."
      };
    }
  }

  /* CD-03. Keyed by horizon rather than by position: the response names its
     own months and a table column must not be filled from whatever happened to
     be third in the array. */
  var payMethods = null;
  if (pm && Array.isArray(pm.horizons)) {
    payMethods = {};
    pm.horizons.forEach(function (h) {
      var months = num(h && h.months);
      if (months == null) return;
      var io = usd(h.interestOnly && h.interestOnly.totalInterest);
      payMethods[months] = {
        lump: usd(h.lumpSum && h.lumpSum.totalInterest),
        min: usd(h.minPayments && h.minPayments.totalInterest),
        // Interest-only leaves the principal owed at the horizon; the design
        // says so on the longest column and the response agrees
        // (interestOnly.remainingBalance === the draw).
        io: months === 36 && io !== "—" ? io + " + balloon" : io
      };
    });
  }

  var cardCount = stored.length;
  var drawableCount = draws.length;

  return {
    cardCount: cardCount,
    drawableCount: drawableCount,
    excludedCount: Math.max(0, cardCount - drawableCount),
    totalAvailable: totalAvailable,
    totalAvailableText: usd(totalAvailable),
    // Two forms of one number, never two numbers: the waterfall's totals cell is
    // bare like the column above it, the banner is money like the rest of its
    // sentence. Both come from allocation.totalDrawn.
    totalDrawnText: numText(totalDrawn),
    totalDrawnUsd: usd(totalDrawn),
    requestedText: requested == null ? null : usd(requested),
    shortfall: shortfall,
    shortfallText: usd(shortfall),
    fullyFunded: alloc ? alloc.fullyFunded === true : null,
    headroomLeftLabel: "Total drawn · " + usd(headroomLeft) + " headroom left",
    rows: rows,
    utilizationHtml: utilizationHtml,
    guardrail: guardrail,
    payMethods: payMethods,
    drawMax: totalAvailable
  };
}

/* NOT_SOURCED — everything on this screen that GET /api/read/tradelines cannot
   answer. Named here, and shown in the banner, because an invented number sitting
   next to live ones is indistinguishable from a real one. Same treatment as the
   "Worked" stat on inquiry-remover. */
/* "today's pipeline" and "the shift stats" were in this sentence until
   2026-08-30. Both tiles were cut from the screen on 2026-08-17 and
   src/http/closer-ui-honest.test.mjs now forbids their return, so naming them
   read as a promise about something that is never coming back. */
export const NOT_SOURCED =
  "not sourced yet: the Deal Math panel " +
  "(net cash, monthly obligation, negative-amortization cliff) and the per-card minimums";

/** bannerText — what the green banner says when real rows are on screen. */
export function bannerText(view) {
  var v = view || {};
  var bits = ["live tradelines · " + v.cardCount + (v.cardCount === 1 ? " line" : " lines") + " on file"];
  if (v.excludedCount > 0) {
    bits.push(v.excludedCount + " not drawable (installment, closed or no limit on file)");
  }
  bits.push(v.totalAvailableText + " available");
  if (v.requestedText) bits.push("requested " + v.requestedText + " · allocated " + v.totalDrawnUsd);
  if (v.shortfall != null && v.shortfall > 0) bits.push("shortfall " + v.shortfallText);
  bits.push(NOT_SOURCED);
  return bits.join(" · ");
}

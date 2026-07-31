/* bank-view — the pure half of public/app/banking-surface.html.
 *
 * Same construction as finance-os-view.mjs: the page carries a verbatim copy of
 * this file between FH-VIEW-BEGIN / FH-VIEW-END, injected by
 * scripts/build-view-blocks.mjs and checked by bank-view.test.mjs, which runs
 * the same fixtures through both. ES5 throughout (var, function, no template
 * literals) so one text runs in Node and in the browser.
 *
 * This screen EXTENDS the Finance OS surface; it does not replace it. It follows
 * the same seven-row grammar, in the same order, with the same row ids. Rows the
 * Finance OS screen leaves empty — blockers, timing, actions — are the ones this
 * screen fills, because they are exactly the ones that need a bank connection.
 *
 *
 * THE THREE RULES THIS FILE EXISTS TO ENFORCE. Each is here rather than in the
 * page because the page is untested by construction — `npm test` globs `src/**`
 * and `scripts/**` only.
 *
 * 1. UNKNOWN IS NOT PERSONAL. bank_accounts.entity_kind has three states
 *    (082) and `unknown` is the default and the common case. It gets its OWN
 *    group on screen. It is never folded into personal, never hidden, and never
 *    silently dropped from a total. Putting somebody's personal account under
 *    their business is the failure that matters — their salary, their rent and
 *    their private spending displayed inside a commercial view — so an
 *    unclassified account says it is unclassified.
 *
 * 2. A GUESS MUST NOT LOOK LIKE A FACT. A recurring bill is inferred (086) and
 *    carries a confidence. A low-confidence bill is rendered differently from a
 *    reported card due date, is labelled, and its occurrence count is shown, so
 *    "based on 2 payments" is visible rather than buried.
 *
 * 3. A PAYMENT DATE IS ADVICE ABOUT SOMEBODY'S MONEY. paymentWindow() returns
 *    either a window or null WITH a reason (src/banking/cashflow.mjs). When it
 *    returns null this screen shows the reason. It never shows a date the engine
 *    did not produce, and it never rounds a null into "the 15th".
 */

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  var n = typeof v === "number" ? v : Number(v);
  return isFinite(n) ? n : null;
}

export var DASH = "—";

/* The three entity groups, in render order, with the wording each uses. Data,
   not a switch, so the vocabulary cannot drift between the grouping and the
   headings — and so `unknown` is impossible to omit by forgetting a branch. */
export var ENTITY_GROUPS = [
  { key: "business", title: "Business", blurb: "Accounts confirmed as the business's." },
  { key: "personal", title: "Personal", blurb: "Accounts confirmed as the client's own." },
  { key: "unknown", title: "Not yet classified",
    blurb: "We could not tell whether these are business or personal. They are counted separately and are in neither total above." }
];

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

/* Cents to a dollar string. Separate from usd() because every money column in
   the banking tables is integer cents, and doing the division at each call site
   is how one of them ends up off by a factor of a hundred. */
export function usdCents(v) {
  var n = num(v);
  return n === null ? DASH : usd(n / 100);
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
   confidence presentation — RULE 2.

   The bands come from src/banking/recurring.mjs's confidenceLabel() and are
   repeated here rather than imported because this file must also run in a
   browser with no module loader. bank-view.test.mjs asserts the two agree, so a
   change to one fails on the other.
   ─────────────────────────────────────────────────────────────────────────── */
export function confidenceView(basis, confidence) {
  if (basis === "reported") {
    return { label: "Reported", tone: "fact", certain: true,
      note: "Reported by the institution.", pct: null };
  }
  var c = num(confidence);
  if (c === null) {
    return { label: "Unverified", tone: "guess", certain: false,
      note: "Detected, with no confidence recorded.", pct: null };
  }
  var band = c < 0.4 ? "low" : c < 0.7 ? "medium" : "high";
  return {
    label: band === "low" ? "Low confidence" : band === "medium" ? "Possible" : "Likely",
    tone: "guess",
    certain: false,
    /* Never "confident". Even the top band is an inference — 086 caps the
       column below 1 precisely so nothing here can claim certainty. */
    note: "Detected from your transactions, not reported by anyone.",
    pct: pctText(c, 0)
  };
}

/* ───────────────────────────────────────────────────────────────────────────
   classify — RULE 3's sibling: fall back, do not blank.

   401 / 403 / 404 / 5xx are four different instructions to the reader and are
   kept apart. data.js folds 401 and 403 into source "unauthorized" and carries
   the HTTP `status`, which is the only way to tell them apart.
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
          text: S + "your account is not allowed to read this client's bank data (403). " +
                "You are signed in — signing in again will not help. Ask an owner for access." };
      }
      return { mode: "sample", tone: "error", httpStatus: 401,
        text: S + "not signed in (401) — sign in to load this client. The backend is up." };
    }
    if (source === "offline") {
      return { mode: "sample", tone: "error", httpStatus: status,
        text: S + "GET /api/read/banking-surface did not answer (" + detail +
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
  var accounts = body.accounts;
  var hasAccounts = Array.isArray(accounts) && accounts.length > 0;

  /* REAL ROWS WIN OVER THE FEATURE FLAG, AND THE ORDER OF THESE TWO CHECKS IS
     THE WHOLE POINT.

     `plaidEnabled` says whether this deployment can SYNC — it is
     isPlaidEnabled(), a check on environment variables. It says nothing about
     whether we already hold data. Testing it first (which this function did,
     and which the live smoke test caught) meant a client with four real
     connected accounts was shown SAMPLE MARKUP, because nobody had set
     PLAID_CLIENT_ID on that box. Hiding somebody's actual balances behind a
     configuration flag is the worst outcome available here: the screen looks
     populated and every number on it is fiction.

     So: if there are rows, paint them. The inability to refresh is a note in
     row 7 (`Bank connection`), not a reason to withhold what we have. */
  if (hasAccounts) return { mode: "live", tone: "real", httpStatus: 200, text: null };

  /* No rows. NOW the flag decides which of two different sentences to say,
     because "nothing is connected" and "this feature was never switched on" send
     a reader to two different places. Neither is an error and neither gets a red
     banner — the seam in src/banking/plaid.mjs being unconfigured is the normal
     state of this system today, not an outage to debug. */
  if (body.plaidEnabled === false) {
    return { mode: "sample", tone: "sample", httpStatus: 200,
      text: "bank connections are not switched on for this deployment — every figure on this screen is sample markup" };
  }
  return { mode: "empty", tone: "sample", httpStatus: 200,
    text: "no bank accounts connected for this client — every figure on this screen is sample markup" };
}

/* ───────────────────────────────────────────────────────────────────────────
   groupByEntity — RULE 1.

   Returns all three groups ALWAYS, in ENTITY_GROUPS order, each with its own
   accounts and its own total. A group with no accounts still comes back, so the
   screen can decide to show "no business accounts" rather than the section
   silently vanishing and the client assuming we looked and found nothing.

   An account whose entity_kind is anything this file does not recognise is put
   in `unknown`, NOT in personal. A fourth value can only arrive from a schema
   change, and the safe destination for something we cannot classify is the
   group that already means "we cannot classify this".
   ─────────────────────────────────────────────────────────────────────────── */
export function groupByEntity(accounts) {
  var rows = Array.isArray(accounts) ? accounts : [];
  var groups = ENTITY_GROUPS.map(function (g) {
    return { key: g.key, title: g.title, blurb: g.blurb, accounts: [], totalCents: null, unknownBalances: 0 };
  });
  var index = {};
  groups.forEach(function (g) { index[g.key] = g; });

  rows.forEach(function (a) {
    var kind = a && a.entity_kind;
    var target = (kind === "business" || kind === "personal") ? index[kind] : index.unknown;
    var balance = num(a && a.balance_current_cents);

    target.accounts.push({
      id: a.id,
      name: a.name || a.official_name || DASH,
      mask: a.mask || null,
      type: a.type || DASH,
      subtype: a.subtype || null,
      entityKind: (kind === "business" || kind === "personal" || kind === "unknown") ? kind : "unknown",
      /* How we came to believe the classification. A human's decision and a
         string match on the word "Business" must not look identical — 082. */
      entitySource: (a && a.entity_kind_source) || "unset",
      balanceCents: balance,
      balanceText: balance === null ? DASH : usdCents(balance),
      /* A balance with no timestamp is a balance nobody should act on. 081
         forbids storing one, so this is a caller that lost it. */
      asOf: dateText(a && a.balance_as_of),
      stale: !(a && a.balance_as_of)
    });

    if (balance === null) target.unknownBalances += 1;
  });

  groups.forEach(function (g) {
    var known = g.accounts.filter(function (a) { return a.balanceCents !== null; });
    /* null, not 0, when nothing is known. A group of three accounts with no
       balances is not a group holding zero dollars. */
    g.totalCents = known.length
      ? known.reduce(function (s, a) { return s + a.balanceCents; }, 0)
      : null;
    g.totalText = g.totalCents === null ? DASH : usdCents(g.totalCents);
    g.count = g.accounts.length;
  });

  return groups;
}

/* ───────────────────────────────────────────────────────────────────────────
   buildView — one API response → the same seven rows as the Finance OS screen.
   ─────────────────────────────────────────────────────────────────────────── */
export function buildView(payload) {
  var body = payload || {};
  var client = body.client || {};
  var name = [client.first_name, client.last_name].filter(Boolean).join(" ").trim();

  var groups = groupByEntity(body.accounts);
  var unknownGroup = groups.filter(function (g) { return g.key === "unknown"; })[0];

  var cards = buildCards(body.cards, body.paymentWindows);
  var bills = buildBills(body.bills);

  return {
    rows: [
      { id: "identity", present: true,
        client: { name: name || DASH, id: client.id || null, email: client.email || DASH } },

      { id: "blockers", present: true, items: blockers(body, groups, cards) },

      { id: "headline", present: true, tiles: tiles(groups, cards, bills) },

      { id: "detail", present: true, groups: groups },

      { id: "timing", present: true, cards: cards, bills: bills },

      { id: "actions", present: true,
        items: unknownGroup.count
          ? [{ kind: "classify_accounts",
               text: "Classify " + unknownGroup.count + " account(s) as business or personal.",
               count: unknownGroup.count }]
          : [] },

      { id: "system", present: true, facts: systemFacts(body, groups, bills) }
    ],
    counts: {
      accounts: groups.reduce(function (s, g) { return s + g.count; }, 0),
      unknown: unknownGroup.count,
      cards: cards.length,
      bills: bills.length
    }
  };
}

/* Row 5, cards — RULE 3. Each card carries either a window or the engine's own
   reason for not producing one. Nothing here computes a date. */
function buildCards(cards, windows) {
  var rows = Array.isArray(cards) ? cards : [];
  var byAccount = {};
  (Array.isArray(windows) ? windows : []).forEach(function (w) {
    if (w && w.bankAccountId) byAccount[w.bankAccountId] = w;
  });

  return rows.map(function (c) {
    var w = byAccount[c.bank_account_id] || null;
    var due = dateText(c.next_payment_due_date);

    return {
      bankAccountId: c.bank_account_id,
      name: c.account_name || DASH,
      mask: c.mask || null,
      entityKind: (c.entity_kind === "business" || c.entity_kind === "personal") ? c.entity_kind : "unknown",
      statementText: usdCents(c.last_statement_balance_cents),
      minimumText: usdCents(c.minimum_payment_cents),
      aprText: c.apr === null || c.apr === undefined ? DASH : pctText(num(c.apr), 2),
      dueDate: due,
      /* A missing due date says so. It is not today and not "soon" — 083. */
      dueUnknown: due === DASH,
      /* Three states, because false and unknown are different answers and only
         one of them is a reassurance — 083's is_overdue. */
      overdue: c.is_overdue === true ? "yes" : c.is_overdue === false ? "no" : "unknown",
      asOf: dateText(c.as_of),

      /* THE PAYMENT WINDOW. Exactly one of `window` and `windowReason` is set. */
      window: w && w.window ? w.window : null,
      windowReason: w && !w.window ? (w.reasonText || w.reason || "No payment window could be worked out.") : null,
      windowReasonCode: w && !w.window ? (w.reason || null) : null,
      /* No entry at all is different from an entry that refused: one means
         nobody asked, the other means the engine answered "I cannot". */
      windowAbsent: !w
    };
  });
}

/* Row 5, bills — RULE 2. Every bill carries its confidence presentation. */
function buildBills(bills) {
  return (Array.isArray(bills) ? bills : []).map(function (b) {
    var basis = b.source === "confirmed" || b.source === "manual" ? "reported" : "inferred";
    var conf = confidenceView(basis, b.confidence);
    var next = dateText(b.next_expected_date);
    return {
      id: b.id,
      merchant: b.merchant_name || DASH,
      amountText: usdCents(b.amount_cents),
      /* A varying bill must not be rendered at one fixed number — 086. */
      varies: num(b.amount_variance_cents) !== null && num(b.amount_variance_cents) > 0,
      varianceText: usdCents(b.amount_variance_cents),
      cadence: b.cadence || "irregular",
      nextDate: next,
      nextUnknown: next === DASH,
      occurrences: num(b.occurrence_count),
      confidence: conf,
      /* The single most useful sentence for a human judging a weak row. */
      basisText: basis === "reported"
        ? "Confirmed"
        : "Based on " + (num(b.occurrence_count) === null ? "an unknown number of" : b.occurrence_count) + " payment(s)"
    };
  });
}

/* Row 2 — blockers, and ONLY when they exist. Each is something that stops the
   screen doing its job, not merely something imperfect. */
function blockers(body, groups, cards) {
  var out = [];

  if (body.itemStatus === "login_required") {
    out.push({ kind: "reconnect",
      text: "Your bank connection needs signing in again. Balances and bills below are from the last successful sync." });
  } else if (body.itemStatus === "error") {
    out.push({ kind: "connection_error",
      text: "The bank connection reported a problem, so these figures may be out of date." });
  }

  var overdue = cards.filter(function (c) { return c.overdue === "yes"; });
  if (overdue.length) {
    out.push({ kind: "overdue",
      text: overdue.length + " card payment(s) are marked overdue by the institution." });
  }

  return out;
}

/* Row 3 — headline. The unknown bucket gets a tile of its own, so it cannot be
   read as a rounding error at the bottom of the screen. */
function tiles(groups, cards, bills) {
  var find = function (key) { return groups.filter(function (g) { return g.key === key; })[0]; };
  var business = find("business");
  var personal = find("personal");
  var unknown = find("unknown");

  var dueSoon = cards.filter(function (c) { return !c.dueUnknown; }).length;

  return [
    { label: "Business balance", value: business.totalText,
      note: business.count + " account(s)" + (business.unknownBalances ? ", " + business.unknownBalances + " with no balance" : ""),
      tone: "normal" },
    { label: "Personal balance", value: personal.totalText,
      note: personal.count + " account(s)" + (personal.unknownBalances ? ", " + personal.unknownBalances + " with no balance" : ""),
      tone: "normal" },
    { label: "Not yet classified", value: unknown.totalText,
      note: unknown.count + " account(s) — in neither total",
      /* Highlighted when non-empty: it is a work queue, not an error list. */
      tone: unknown.count ? "attention" : "normal" },
    { label: "Cards with a due date", value: cards.length ? String(dueSoon) + " of " + String(cards.length) : DASH,
      note: cards.length && dueSoon < cards.length ? (cards.length - dueSoon) + " have no due date on file" : null,
      tone: "normal" },
    { label: "Bills detected", value: bills.length ? String(bills.length) : DASH,
      note: bills.length ? countLowConfidence(bills) + " low confidence" : null,
      tone: "normal" }
  ];
}

function countLowConfidence(bills) {
  return bills.filter(function (b) { return b.confidence.label === "Low confidence"; }).length;
}

/* Row 7 — small, read-only, and it must carry the unflattering facts. A screen
   that reports only what it knows reads as complete. */
function systemFacts(body, groups, bills) {
  var facts = [
    { label: "Source", value: "GET /api/read/banking-surface" },
    { label: "Bank connection", value: body.itemStatus || DASH },
    { label: "Last synced", value: dateText(body.lastSyncedAt) },
    { label: "Accounts", value: String(groups.reduce(function (s, g) { return s + g.count; }, 0)) }
  ];

  var unknown = groups.filter(function (g) { return g.key === "unknown"; })[0];
  if (unknown.count) {
    facts.push({ label: "Unclassified", value: unknown.count + " account(s), excluded from both totals" });
  }
  var noBalance = groups.reduce(function (s, g) { return s + g.unknownBalances; }, 0);
  if (noBalance) facts.push({ label: "No balance on file", value: String(noBalance) + " account(s)" });
  if (bills.length) {
    facts.push({ label: "Bills", value: bills.length + " detected, " + countLowConfidence(bills) + " low confidence" });
  }
  return facts;
}

/* bannerText — one line under the title, or null. The unknown bucket is named
   first because it is the thing a human can actually fix. */
export function bannerText(view) {
  if (!view) return null;
  var c = view.counts || {};
  var parts = [];
  if (c.unknown) {
    parts.push(c.unknown + " of " + c.accounts +
      " account(s) are not yet classified as business or personal, and are in neither total.");
  }
  var low = view.rows.filter(function (r) { return r.id === "timing"; })[0];
  var lowCount = low ? countLowConfidence(low.bills) : 0;
  if (lowCount) {
    parts.push(lowCount + " detected bill(s) rest on very little evidence — check them before relying on the dates.");
  }
  return parts.length ? parts.join(" ") : null;
}

/* Fundhub CRM shell — auth + role gating over the wireframe suite.
   The screens are the product; this file only decides who sees which tabs.
   Session: real API first, demo session (set by /login.html) as fallback.
   Change who sees what in ROLE_TABS — one map, nothing else to edit.

   This file runs from <head>, before the screen paints, and that placement is
   load-bearing. It used to run as the last script in <body>: a screen the role
   may not open was parsed, painted and only then bounced away, once the session
   fetch came back. That is the "it opens the page and then throws me back"
   behaviour. The gate now decides first and the screen paints second. */
(function () {
  // "" when the URL is /app/ — the router page, which is not a screen and is
  // never in ALL. Anything not in the role's list gets sent to its home.
  var PAGE = location.pathname.split("/").pop();

  var ALL = [
    "closer-dashboard.html", "pipeline.html", "client-control-panel.html",
    "messaging.html", "calendar.html", "documents.html",
    "ops-admin.html", "command-center.html", "galaxy.html",
    "agent-editor.html", "automations.html", "products-commissions.html",
    "staff-teams.html", "content-admin.html", "sample-data.html",
    "inquiry-remover.html", "affiliate.html", "client-portal.html", "partner-galaxy.html", "brand-studio.html",
    "campaign-manager.html", "social-studio.html", "creative-factory.html", "hiring.html",
    "finance-os.html", "banking-surface.html",
    /* The Finance OS write surface. Twelve tested modules — subscriptions,
       liabilities, bank accounts, recurring bills, the cash-flow projection,
       alerts and the two deal calculators — had no screen and no route, so the
       owner opened the app and saw a seven-row read-only grid. These six screens
       and the eight /api/finance/* routes registered in
       netlify/functions/api.mjs are the way in. Added to the sidebar in the same
       pass, in every file that carries one: a screen in ALL and nowhere else has
       no way in, and src/http/app-nav-reachability.test.mjs fails when that
       happens (audit M20). */
    "subscriptions.html", "card-stack.html", "bank-accounts.html",
    "bills-cashflow.html", "alerts.html", "deal-model.html",
    /* banking-entry.html is W1's manual-entry screen. It arrived in ALL on its
       own branch with no sidebar row anywhere, which was invisible there because
       app-nav-reachability.test.mjs did not exist yet — it came from the audit
       branch. On main that combination is a failing test and, more to the point,
       a screen with no way in. Added to the Finance group in every sidebar in
       the same commit. */
    "banking-entry.html",
    /* money-map.html is W6 — the one screen an owner opens for a client, over
       what read/finance-os, read/banking-surface and read/tradelines already
       serve. Same treatment as banking-entry above: in ALL, and therefore in
       every sidebar. */
    "money-map.html"
  ];

  /* partner-galaxy.html is the white-label partner's own Galaxy — scoped to
     their book, with staff identities replaced by anonymous team nodes. It is
     the one screen no sidebar links to, and employees get the real Galaxy
     instead, so it stays out of the staff surface. */
  var PRINCIPAL_ONLY = ["partner-galaxy.html"];

  /* NOT PART OF THE SHARED STAFF SURFACE — waiting on a human approval, not on
     a nav decision. banking-surface.html shows a named client's bank balances,
     read from a bank connection. Bank connections are not approved in this
     product: the SOC 2 review of storing bank credentials and the consent
     flow are both open (src/banking/plaid.mjs, docs/workflows/finish-the-build/
     W5.md). api/read/banking-surface.mjs answers this screen only for
     ROLE_SETS.FINANCE for that reason, so leaving it in the shared surface
     would have offered every employee a screen the data behind it refuses.
     Owner and admin have "*" and keep it. Widening this is a decision somebody
     makes after the sign-off, not a tidy-up.

     THE THREE FINANCE OS SCREENS BELOW ARE HERE FOR THE SAME REASON, AND THE
     RULE IS THE ONE THIS LIST ALREADY ENFORCES: the nav must not offer a screen
     whose data refuses the person clicking it.

       subscriptions.html   /api/finance/subscriptions and /api/finance/cards
                            both gate on ROLE_SETS.FINANCE. A subscription row
                            carries a price and a payment instrument, which is
                            the narrowest thing this API serves.
       bank-accounts.html   /api/finance/bank-accounts gates on FINANCE, matching
                            api/read/banking-surface.mjs over the same rows.
       bills-cashflow.html  /api/finance/bills and /api/finance/cashflow gate on
                            FINANCE — both are bank-derived, and the cash-flow
                            thresholds are an operator policy.

     The other three stay in the shared staff surface because their endpoints
     do: card-stack.html reads liabilities (ROLE_SETS.STAFF, the same gate
     api/read/tradelines.mjs carries over the same cards), alerts.html reads the
     queue (STAFF, with trigger CONFIGURATION narrowed to FINANCE inside the
     handler), and deal-model.html is a calculator closers use to do their job.

     MOVE A GATE AND MOVE ITS ROW. If a build agent widens or narrows a role set
     in api/finance/*, this list has to follow in the same commit, or the app
     goes back to offering screens that 403. */
  var OWNER_ADMIN_ONLY = [
    "banking-surface.html",
    "subscriptions.html", "bank-accounts.html", "bills-cashflow.html"
  ];

  /* staffTabs — every screen a signed-in employee may open, which is every row
     the shared sidebar leaves them looking at.

     The sidebar markup itself carries one row more than this: banking-surface
     .html is in it so owner and admin can reach it, and gateLinks() hides that
     row for everybody else. partner-galaxy.html is in no sidebar at all, per
     the note above. Adding a screen to ALL and to nothing else gives it no way
     in — src/http/app-nav-reachability.test.mjs fails when that happens. */
  function staffTabs() {
    return ALL.filter(function (s) {
      return PRINCIPAL_ONLY.indexOf(s) === -1 && OWNER_ADMIN_ONLY.indexOf(s) === -1;
    });
  }

  /* "staff" = the full employee surface; "*" = that plus the partner screen.
     Every staff role gets the whole sidebar deliberately.

     These lists used to be narrow — a setter had 3 of 19 tabs, a closer 6 —
     while all 19 tabs were rendered on every screen regardless. Every tab
     outside your list was a link that loaded the screen and threw you back,
     which is the bug this file exists to have fixed. Narrowing the nav to
     match the map (which is what the gate now does) traded that for a sidebar
     that silently loses two thirds of its contents.

     And it bought no security to begin with: /api/dashboard/* and /api/tasks
     gate on a valid session, not on a role, so a staff member who could not
     see a tab could still read every row behind it. Withholding the screen
     withheld nothing but the screen.

     So the boundary that is real is kept — the three external principals stay
     on their own surface, because a client must not see the CRM — and the
     internal one, which was costing navigation and protecting nothing, is
     dropped. To put a role back on rails, replace "staff" with an explicit
     list here; the gate handles narrow roles correctly now. If the concern is
     specifically commission rates and staff comp (products-commissions.html,
     staff-teams.html), gate those in the API first — that is where the data
     actually is. */
  var ROLE_TABS = {
    owner: "*",
    admin: "*",
    funding_advisor: "staff",
    closer: "staff",
    inquiry_specialist: "staff",
    setter: "staff",
    /* Principal types, not staff roles — they are gated here on staff.role only
       because no principals table exists yet. 'partner' is seeded into the
       staff_roles catalog by db/migrations/036_partner_role.sql purely to make
       brand-studio.html reachable; 'client' and 'affiliate' have no catalog row
       and nothing issues them a session. When the accounts table and its own
       auth land, these three move out of ROLE_TABS and 036 is reverted. */
    client: ["client-portal.html"],
    affiliate: ["affiliate.html"],
    partner: ["partner-galaxy.html", "brand-studio.html"]
  };

  /* Where each role lands when it arrives at /app/ with no screen named, or
     asks for one it may not see. Falls back to the first tab the role has, so
     a role added to ROLE_TABS without a HOME entry still lands somewhere. */
  var HOME = {
    owner: "command-center.html",
    admin: "command-center.html",
    funding_advisor: "command-center.html",
    closer: "closer-dashboard.html",
    inquiry_specialist: "inquiry-remover.html",
    setter: "pipeline.html",
    client: "client-portal.html",
    affiliate: "affiliate.html",
    partner: "partner-galaxy.html"
  };

  /* A role this map has never heard of still has to be able to work.
     staff.role is free text (db/schema/001_init.sql:386) with no constraint,
     and 020_auth.sql backfills its own catalog from whatever staff.role
     already holds — so a role created by hand, spelled differently, or added
     to the catalog later reaches this file as an unknown string. It used to
     resolve to no screens at all, which meant signOut(), which meant the
     login page, which signs straight back in and signs straight back out. A
     lockout loop, on a typo.

     Anyone who reaches this file has authenticated through /api/auth/login,
     which is the staff table — the three principal roles are unbuilt (B4) and
     nothing issues them a session yet. So an unknown role is a staff role
     spelled unexpectedly, and it gets the staff surface. The chip still marks
     it unrecognised, so a genuinely wrong value stays visible rather than
     silently inheriting access. */
  function isKnownRole(role) {
    return Object.prototype.hasOwnProperty.call(ROLE_TABS, role);
  }

  function allowedFor(role) {
    if (!role) return [];
    var m = ROLE_TABS[role];
    if (m === "*") return ALL.slice();
    if (m === "staff" || !m) return staffTabs();
    return m.slice();
  }

  function homeFor(role, ok) {
    var h = HOME[role];
    return h && ok.indexOf(h) !== -1 ? h : ok[0];
  }

  /* screenOf — the screen file a link points at, or "" if it does not point at
     one. It STRIPS A QUERY STRING AND A HASH, and that is a fix, not tidying.

     The old isScreen() tested the whole href against /^[a-z0-9-]+\.html$/, so
     "card-stack.html?client_id=..." was not a screen as far as this file was
     concerned. Two things followed from that, both live on the deployed app:

       1. THE GATE HAD A HOLE. Every link a screen builds in JavaScript carries a
          query — card-stack.html builds finance-os.html?client_id=, deal-model
          builds card-stack.html?client_id=, alerts builds alerts.html?client_id=
          — so the click interceptor below skipped all of them and gateLinks()
          never hid one. A role that may not open a screen could still be handed
          a working link to it by another screen, click it, and be bounced back
          out by pass 2. That bounce is the exact behaviour the header of this
          file says the gate exists to have fixed.
       2. THE CLIENT COULD NOT BE CARRIED. Appending ?client_id= to a sidebar row
          would have taken that row out of the gate entirely, for the same
          reason. Carrying the client safely required fixing this first. */
  function screenOf(href) {
    var h = String(href == null ? "" : href).replace(/^\.\//, "");
    h = h.split("#")[0].split("?")[0];
    /* A LEADING PATH IS STRIPPED TOO, and that is not cosmetic. The redirect
       targets this file builds are absolute — "/app/" + homeFor(...) — so
       without this, withClient() looked at "/app/closer-dashboard.html", failed
       to recognise a screen in it, and silently carried nothing. The bounce-home
       path is exactly where losing the client hurts most: you were sent
       somewhere you did not ask to go, and arriving with nobody open makes it
       look like the app forgot what you were doing. No markup in public/app uses
       an absolute href today, so nothing else changes shape. */
    h = h.slice(h.lastIndexOf("/") + 1);
    return /^[a-z0-9-]+\.html$/i.test(h) ? h : "";
  }

  function isScreen(href) {
    return screenOf(href) !== "";
  }

  /* ── carrying the client from screen to screen ────────────────────────────

     THE PROBLEM THIS SOLVES. Seven screens in this app are about ONE named
     client and every one of them takes that client from the address bar. Until
     this pass nothing put it there: you typed a uuid by hand, and the moment you
     used the sidebar to walk to the next screen it was gone and you typed it
     again. That is what made a finished product feel like a pile of separate
     pages rather than one thing.

     WHAT THIS DOES. gateLinks() appends the current client to every link that
     points at a screen which actually reads one. It never guesses: the id has to
     be a uuid, and a link that already names its own client is left exactly as
     it is, so a "see this other client's alert" link still goes where it says.

     WHAT IT DELIBERATELY DOES NOT DO. It does not decide what any screen SHOWS.
     Screens read their own address bar and nothing else; this only changes where
     links point. And it touches nothing but the screens listed below — putting
     ?client_id= on a link to Hiring or Brand Studio would be noise on a URL that
     means nothing to the page receiving it.

     THE ONE ODD ENTRY. client-control-panel.html calls the same thing `id`, not
     `client_id` (its wiring reads FHData.param("id")). Renaming its parameter
     would break every link and bookmark anybody has to it, so the mapping is
     written here instead — once, where every link in the app is already being
     rewritten — and reported as an inconsistency rather than hidden.
     closer-dashboard.html already accepts either spelling and takes client_id. */
  var CLIENT_SCREENS = {
    "finance-os.html":           "client_id",
    "subscriptions.html":        "client_id",
    "card-stack.html":           "client_id",
    "bank-accounts.html":        "client_id",
    "bills-cashflow.html":       "client_id",
    "alerts.html":               "client_id",
    "deal-model.html":           "client_id",
    "banking-surface.html":      "client_id",
    "closer-dashboard.html":     "client_id",
    "client-control-panel.html": "id",
    // money-map.html and banking-entry.html always read client_id off the URL
    // (money-map.html:358, banking-entry.html:416) but were missing from this
    // map, so gateLinks() never carried a client onto their sidebar links and
    // both landed on a "no client — paste one into the address bar" screen.
    // finance-command.html (roll-up dashboard) and finance-add.html (the one
    // add-anything flow) are new and carry client_id the same way from birth.
    "money-map.html":            "client_id",
    "banking-entry.html":        "client_id",
    "finance-command.html":      "client_id",
    "finance-add.html":          "client_id"
  };

  /* ENTITY_SCREENS — which screens additionally read an entity (personal vs. a
     business, 106_entities.sql) off the URL, and under what key. Same shape and
     same reasoning as CLIENT_SCREENS one block up: keep it here, once, rather
     than duplicated per screen. A screen absent from this map does not filter
     by entity even if a client is carried. */
  var ENTITY_SCREENS = {
    "finance-os.html":      "entity_id",
    "money-map.html":       "entity_id",
    "banking-entry.html":   "entity_id",
    "card-stack.html":      "entity_id",
    "bank-accounts.html":   "entity_id",
    "bills-cashflow.html":  "entity_id",
    "finance-command.html": "entity_id",
    "finance-add.html":     "entity_id"
  };

  var CLIENT_KEY = "fh_client";
  var ENTITY_KEY = "fh_entity";
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /* urlClient — the client this page was opened on, if it is a real id.

     A junk value is treated as no client at all rather than propagated: spraying
     a typo across ten links turns one 400 into ten. `id` is read ONLY on the
     control panel, where `id` IS the client — on agent-editor.html or
     brand-studio.html `id` means something else entirely, and remembering an
     agent's id as a client would send the next click to the wrong record. */
  function urlClient() {
    try {
      var q = new URLSearchParams(location.search);
      var v = q.get("client_id");
      if (!v && CLIENT_SCREENS[PAGE] === "id") v = q.get("id");
      v = String(v == null ? "" : v).trim();
      return UUID_RE.test(v) ? v : "";
    } catch (e) { return ""; }
  }

  /* currentClient — the client to point links at.

     The address bar wins and is remembered; the memory is the fallback so that a
     detour through a screen with no client on it (Command Center, Documents)
     does not lose the person you were working on. The memory NEVER decides what
     a screen displays — only where a link goes — so the worst a stale value can
     do is offer a link to the client you had open last, which is visible in the
     link and in the hub's own "currently open" line. It is cleared on sign-out,
     because the next person at a shared machine must not inherit it. */
  function currentClient() {
    var fromUrl = urlClient();
    if (fromUrl) {
      try { localStorage.setItem(CLIENT_KEY, fromUrl); } catch (e) {}
      return fromUrl;
    }
    try {
      var v = String(localStorage.getItem(CLIENT_KEY) || "").trim();
      return UUID_RE.test(v) ? v : "";
    } catch (e) { return ""; }
  }

  /* withClient — one href, with the client on it if that screen reads one. */
  function withClient(href, cid) {
    var key = CLIENT_SCREENS[screenOf(href)];
    if (!cid || !key) return href;
    var h = String(href);
    var hash = "";
    var i = h.indexOf("#");
    if (i !== -1) { hash = h.slice(i); h = h.slice(0, i); }
    // A link that names its own client already answered this question. The hub
    // builds its cards that way, and an alert row links to the client the alert
    // is about — neither must be rewritten to whoever is "current".
    if (new RegExp("[?&]" + key + "=").test(h)) return href;
    return h + (h.indexOf("?") === -1 ? "?" : "&") +
           key + "=" + encodeURIComponent(cid) + hash;
  }

  /* urlEntity/currentEntity/withEntity — the entity (personal vs. a business)
     equivalent of urlClient/currentClient/withClient directly above. Same
     rules: a junk value is no entity at all, the address bar wins and is
     remembered, and a link naming its own entity already answered the
     question. Kept as a genuinely separate id/key pair rather than folded into
     "client" — a client can have several entities open in different tabs, and
     conflating the two would make switching entities silently switch clients. */
  function urlEntity() {
    try {
      var q = new URLSearchParams(location.search);
      var v = String(q.get("entity_id") || "").trim();
      return UUID_RE.test(v) ? v : "";
    } catch (e) { return ""; }
  }

  function currentEntity() {
    var fromUrl = urlEntity();
    if (fromUrl) {
      try { localStorage.setItem(ENTITY_KEY, fromUrl); } catch (e) {}
      return fromUrl;
    }
    try {
      var v = String(localStorage.getItem(ENTITY_KEY) || "").trim();
      return UUID_RE.test(v) ? v : "";
    } catch (e) { return ""; }
  }

  function withEntity(href, eid) {
    var key = ENTITY_SCREENS[screenOf(href)];
    if (!eid || !key) return href;
    var h = String(href);
    var hash = "";
    var i = h.indexOf("#");
    if (i !== -1) { hash = h.slice(i); h = h.slice(0, i); }
    if (new RegExp("[?&]" + key + "=").test(h)) return href;
    return h + (h.indexOf("?") === -1 ? "?" : "&") +
           key + "=" + encodeURIComponent(eid) + hash;
  }


  /* normRole — the one place a role string is folded to a map key. Matching
     020_auth.sql, which keys its catalog on lower(btrim(staff.role)): the
     column is free text filled by hand (scripts/create-staff.mjs passes argv
     straight through), so "Owner" and "owner " are the same role and only
     trimming makes them resolve as one. Lowercasing alone demoted a trailing
     space to an unrecognised role. */
  function normRole(v) {
    return String(v == null ? "" : v).trim().toLowerCase();
  }

  /* ---------------------------------------------------------------------
     Cached role — the hint that lets the gate answer before the network does.

     The session is the server's to decide, but a role only changes when
     somebody edits a staff record, so the last known one is a safe hint for
     the length of one page load. With it the gate is synchronous: a forbidden
     URL redirects before anything paints, and the nav is drawn already gated.
     It is never the authority — the real session resolves underneath and
     rewrites the cache, so a role changed server-side costs one stale load and
     corrects itself on the next.
     --------------------------------------------------------------------- */
  var ROLE_KEY = "fh_role";

  function readCachedRole() {
    try { return normRole(localStorage.getItem(ROLE_KEY)); }
    catch (e) { return ""; }
  }

  function writeCachedRole(role) {
    try {
      if (role) localStorage.setItem(ROLE_KEY, role);
      else localStorage.removeItem(ROLE_KEY);
    } catch (e) {}
  }

  // routeAway — the screen this role may not open, and where it belongs
  // instead. null when the page is fine, or when the role has no screens at
  // all (that is a config error; only the resolved session acts on it).
  function routeAway(role) {
    var ok = allowedFor(role);
    if (!ok.length) return null;
    if (ok.indexOf(PAGE) !== -1) return null;
    // Bounced off a screen you may not open — but you were working on somebody,
    // and arriving home having silently lost them is the loss this pass exists
    // to stop. currentClient() reads the bar of the page being left.
    return withClient("/app/" + homeFor(role, ok), currentClient());
  }

  /* allowedNow is null until we know the role. Every click on a screen link is
     held until then and dropped if the target is forbidden, so a link the user
     can still see during a cold load cannot start a navigation that would only
     bounce back. */
  var allowedNow = null;
  var pendingHref = null;

  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var t = e.target;
    var a = t && t.closest ? t.closest("a[href]") : null;
    if (!a || a.target === "_blank") return;
    var h = (a.getAttribute("href") || "").replace(/^\.\//, "");
    // screenOf(), not isScreen() on the raw href: a link carrying ?client_id=
    // is still a link to a screen and still has to be gated. See screenOf().
    var file = screenOf(h);
    if (!file) return;
    if (allowedNow === null) {
      // Session still in flight: remember where they wanted to go and take
      // them there the moment we know they may. The WHOLE href is remembered,
      // query and all, so the client on it survives the wait.
      e.preventDefault();
      pendingHref = h;
      return;
    }
    if (allowedNow.indexOf(file) === -1) e.preventDefault();
  }, true);

  function settleClicks(ok) {
    allowedNow = ok;
    var want = pendingHref;
    pendingHref = null;
    if (want && ok.indexOf(screenOf(want)) !== -1) location.href = want;
  }

  /* Without a hint the gate cannot answer before paint, so hold the screen
     back rather than let a forbidden one flash. The timer is the safety net: a
     backend that never answers must not leave a blank page.

     Two layers, because they fail differently. The document hold is the strong
     one and it is what stops a forbidden screen being seen at all; the nav-row
     rule (carried over from the fix on main) outlives it. If a stalled
     /api/auth/session lets HOLD_MS expire, the screen has to come back — but
     the sidebar should still not offer tabs whose permission is unknown, so the
     rows stay hidden until gateLinks() has actually run. Clicks are blocked
     independently in that window either way, so neither layer is load-bearing
     for correctness; this is about not showing a nav we cannot stand behind. */
  var HOLD_MS = 4000;
  var held = false;

  var navStyle = document.createElement("style");
  navStyle.id = "fh-gate-style";
  navStyle.textContent = ".navitem{visibility:hidden}";
  (document.head || document.documentElement).appendChild(navStyle);

  function revealNav() {
    if (navStyle && navStyle.parentNode) navStyle.parentNode.removeChild(navStyle);
  }

  function hold() {
    if (held || !document.documentElement) return;
    held = true;
    document.documentElement.style.visibility = "hidden";
    setTimeout(reveal, HOLD_MS);
  }
  function reveal() {
    if (!held) return;
    held = false;
    document.documentElement.style.visibility = "";
  }

  function getSession() {
    var t = localStorage.getItem("fh_token") || "";
    var real = fetch("/api/auth/session", {
      headers: t ? { authorization: "Bearer " + t } : {}
    }).then(function (r) {
      if (!r.ok) throw 0;
      return r.json();
    }).then(function (d) {
      if (d && d.ok && d.staff) return { staff: d.staff, demo: false };
      throw 0;
    });
    return real.catch(function () {
      try {
        var s = JSON.parse(localStorage.getItem("fh_demo_staff") || "null");
        if (s) return { staff: s, demo: true };
      } catch (e) {}
      return null;
    });
  }

  /* backendState — what is actually answering, as opposed to what the screen
     is drawing. Three distinct failures used to look identical from the
     browser: no function deployed, function up but no DATABASE_URL, and a
     database that is refusing connections. /api/health separates them, so the
     chip can name the real one instead of saying DEMO for all three. */
  function backendState() {
    return fetch("/api/health", { headers: { accept: "application/json" } })
      .then(function (r) {
        if (r.status === 404) return { code: "offline", label: "NO API", hint: "/api/* is not deployed" };
        return r.json().then(function (d) {
          if (d && d.ok && d.db === "up") {
            return { code: "live", label: "LIVE", hint: (d.migrations || 0) + " migrations applied" };
          }
          return { code: "nodb", label: "NO DB", hint: String((d && d.error) || "database unreachable") };
        }).catch(function () {
          return { code: "offline", label: "NO API", hint: "/api/health did not return JSON" };
        });
      })
      .catch(function () {
        return { code: "offline", label: "NO API", hint: "/api/health unreachable" };
      });
  }

  function signOut() {
    /* Tell the SERVER first. This used to clear localStorage and redirect,
       which logs the browser out and leaves the session row live until it
       expires — so "Sign out" did not revoke anything, and a token captured
       from that machine kept working afterwards. /api/auth/logout has existed
       the whole time; nothing called it.

       The local clear happens either way: a network failure must never strand
       someone signed in on a shared machine. */
    var token = "";
    try { token = localStorage.getItem("fh_token") || ""; } catch (e) { token = ""; }

    function finish() {
      try {
        localStorage.removeItem("fh_token");
        localStorage.removeItem("fh_demo");
        localStorage.removeItem("fh_demo_staff");
        // The remembered client goes too. It is not a credential, but it is the
        // name of a real person's file and the next person to sign in at a
        // shared machine must not be handed it on every link.
        localStorage.removeItem(CLIENT_KEY);
        localStorage.removeItem(ENTITY_KEY);
      } catch (e) { /* private mode — the redirect still happens */ }
      writeCachedRole("");
      location.href = "/login.html";
    }

    if (!token) { finish(); return; }
    var done = false;
    var once = function () { if (!done) { done = true; finish(); } };
    // Never hang on the redirect if the API is slow or gone.
    setTimeout(once, 1500);
    try {
      fetch("/api/auth/logout", {
        method: "POST",
        headers: { authorization: "Bearer " + token, accept: "application/json" }
      }).then(once, once);
    } catch (e) { once(); }
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* gateLinks runs twice — once on the cached hint, once on the real session —
     so it has to be idempotent in both directions. A link the hint hid must
     come back if the session turns out to allow it. The original href is kept
     on the element the first time through, because the logo's is rewritten. */
  function gateLinks(ok, role) {
    var home = "/app/" + homeFor(role, ok);
    /* Read ONCE per pass, not once per link: currentClient() writes the address
       bar's client back to localStorage, and doing that inside the loop would
       repeat the same write for every anchor on the page. */
    var cid = currentClient();
    var eid = currentEntity();
    var links = document.querySelectorAll("a[href]");
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (!a.hasAttribute("data-fh-href")) {
        a.setAttribute("data-fh-href", a.getAttribute("href") || "");
      }
      /* EVERY REWRITE BELOW STARTS FROM data-fh-href, THE ORIGINAL. That is what
         makes this idempotent across the two passes — the hint pass and the
         session pass — and it is what stops the client being appended twice. */
      var h = a.getAttribute("data-fh-href").replace(/^\.\//, "");
      var file = screenOf(h);
      if (!file) continue;
      var allowed = ok.indexOf(file) !== -1;
      // The sidebar logo is chrome, not a tab. Every screen points it at
      // command-center.html, which five of the nine roles may not open, so
      // hiding it took the logo off the page for them. Send it home instead.
      if (a.classList.contains("logo")) {
        a.setAttribute("href", withClient(allowed ? h : home, cid));
        continue;
      }
      // THE CLIENT RIDES ALONG. Only on links this role may follow, and only to
      // screens that read a client — see CLIENT_SCREENS. The entity rides the
      // same way, one step later, so a link ends up with both query params
      // when the target screen reads both.
      if (allowed) a.setAttribute("href", withEntity(withClient(h, cid), eid));
      var box = a.closest("li") || a.closest(".card") || a;
      if (!allowed) {
        box.style.display = "none";
        box.setAttribute("data-fh-gated", "1");
      } else if (box.hasAttribute("data-fh-gated")) {
        box.style.display = "";
        box.removeAttribute("data-fh-gated");
      }
    }
    // The nav is now telling the truth, so it can be seen.
    revealNav();
  }

  function mountChip(staff, demo) {
    var el = document.createElement("div");
    el.id = "fh-shell-chip";
    el.style.cssText = "position:fixed;top:12px;right:14px;z-index:2147483000;display:flex;gap:10px;align-items:center;background:#0A0A0A;color:#fff;border:1px solid #26262B;border-radius:10px;padding:8px 12px;font:500 11px/1 'JetBrains Mono',monospace;letter-spacing:.06em;box-shadow:0 10px 30px rgba(0,0,0,.35)";
    /* Name the tab count next to the role. The bounce this shell used to cause
       was invisible in the chip: it said "closer" while the sidebar advertised
       19 tabs, six of which that role cannot open. Saying "closer · 6 tabs"
       makes a narrow role legible instead of something you discover by
       clicking. An unrecognised role says so outright. */
    var role = normRole(staff.role);
    var ok = allowedFor(role);
    var known = isKnownRole(role);
    var roleText = role + " · " + ok.length + (ok.length === 1 ? " tab" : " tabs");
    var roleTitle = known
      ? "role " + role + " — " + ok.length + " of " + ALL.length + " screens. Change the map in shell.js ROLE_TABS."
      : "role \"" + role + "\" is not in shell.js ROLE_TABS — falling back to the shared Work tabs. Add it to the map.";
    el.innerHTML =
      '<span title="' + esc(roleTitle) + '" style="color:' + (known ? "#A1A1AA" : "#F5CE8F") + '">' +
        esc(staff.name || staff.email) + " · " + esc(roleText) + (known ? "" : " ?") + "</span>" +
      '<span id="fh-shell-src" title="checking the backend…" style="background:#3F3F46;color:#E4E4E7;border-radius:6px;padding:3px 7px;font-weight:700">···</span>' +
      '<button id="fh-shell-out" style="background:none;border:1px solid #3F3F46;color:#E4E4E7;border-radius:6px;padding:4px 9px;font:inherit;cursor:pointer">Sign out</button>';
    document.body.appendChild(el);
    document.getElementById("fh-shell-out").addEventListener("click", signOut);

    /* One badge, the truth about this screen's data. A screen drawing its
       built-in sample rows must not look like one reading the database. */
    var TONE = {
      live:    { bg: "#A8D8B0", fg: "#0A0A0A" },   // mint  — real data
      nodb:    { bg: "#F5CE8F", fg: "#0A0A0A" },   // peach — API up, no database
      offline: { bg: "#F2A69B", fg: "#0A0A0A" }    // rose  — no API at all
    };
    backendState().then(function (st) {
      var b = document.getElementById("fh-shell-src");
      if (!b) return;
      // Signed in from localStorage means these rows are sample data whatever
      // the backend says, so demo wins the label.
      var code = demo ? (st.code === "live" ? "nodb" : st.code) : st.code;
      var label = demo ? "DEMO" : st.label;
      var tone = TONE[code] || TONE.offline;
      b.style.background = tone.bg;
      b.style.color = tone.fg;
      b.textContent = label;
      b.title = (demo ? "demo session — screens show built-in sample data. " : "") + st.hint;
    });
  }

  /* applyBrand — a white-label partner's tokens over the CSS custom properties,
     at boot.

     Brand Studio used to save to localStorage and nothing read it, so nothing it
     saved themed anything. This is the read half.

     FALLS BACK TO FUNDHUB. No principal, no partner, no row, or a failed
     request all leave the stylesheet untouched — the default brand is what the
     page already has, so doing nothing IS the fallback. A partner surface must
     never render unstyled because a brand lookup failed.

     Only ink, paper and the six-stop ramp are applied. Font faces are NOT
     injected here: that would need a stylesheet link to fonts.googleapis.com
     built from a partner-supplied string, and the value is validated but the
     link is still a request this file should not be constructing. Left for the
     funnel renderer, which already owns its <head>. */
  function applyBrand(staff) {
    var partnerId = staff && (staff.partner_id || staff.partnerId);
    if (!partnerId) return;                       // fundhub staff — nothing to do

    fetch("/api/partner-brand?partner_id=" + encodeURIComponent(partnerId), {
      headers: { accept: "application/json" }
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.ok || !d.brand) return;
        var b = d.brand;
        var root = document.documentElement;
        var HEX = /^#[0-9a-fA-F]{6}$/;
        // Re-validated here even though 043 has a CHECK: a custom property
        // accepts url() and expressions, so this is the last gate before the
        // value reaches the stylesheet.
        if (HEX.test(String(b.ink || ""))) root.style.setProperty("--ink", b.ink);
        if (HEX.test(String(b.paper || ""))) root.style.setProperty("--paper", b.paper);
        if (Array.isArray(b.ramp) && b.ramp.length === 6) {
          b.ramp.forEach(function (stop, i) {
            if (HEX.test(String(stop))) root.style.setProperty("--brand-" + (i + 1), stop);
          });
        }
        var chip = document.getElementById("fh-shell-chip");
        if (chip && b.entity_name) chip.setAttribute("data-brand", b.entity_name);
      })
      .catch(function () { /* fundhub default stays — see the comment above */ });
  }

  function onReady(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  /* ---- pass 1: the hint, synchronous, before the screen paints ---- */
  var hinted = readCachedRole();
  if (hinted) {
    var away = routeAway(hinted);
    if (away) { location.replace(away); return; }
    var hintedOk = allowedFor(hinted);
    if (hintedOk.length) {
      settleClicks(hintedOk);
      onReady(function () { gateLinks(hintedOk, hinted); });
    }
  } else {
    hold();
  }

  /* ---- pass 2: the session, authoritative ---- */
  getSession().then(function (sess) {
    if (!sess) {
      writeCachedRole("");
      location.href = "/login.html?next=/app/" + PAGE;
      return;
    }
    var role = normRole(sess.staff.role);
    var ok = allowedFor(role);
    writeCachedRole(ok.length ? role : "");
    // A role with no screens at all is a config error, not a blank page:
    // sign out rather than loop the router forever.
    if (!ok.length) { signOut(); return; }
    if (ok.indexOf(PAGE) === -1) {
      // replace(), not href: the router page must not sit in history, or
      // Back from a screen bounces straight forward again. The client rides
      // along for the same reason routeAway() carries it.
      location.replace(withClient("/app/" + homeFor(role, ok), currentClient()));
      return;
    }
    settleClicks(ok);
    onReady(function () {
      gateLinks(ok, role);
      mountChip(sess.staff, sess.demo);
      applyBrand(sess.staff);
      reveal();
    });
  }).catch(function () {
    // Never leave the screen held back on an unexpected failure.
    settleClicks(allowedNow || ALL.slice());
    reveal();
    revealNav();
  });
})();

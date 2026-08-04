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
    "messaging.html", "calendar.html", "documents.html", "company-brain.html",
    "ops-admin.html", "command-center.html", "galaxy.html",
    "agent-editor.html", "automations.html", "products-commissions.html",
    "staff-teams.html", "content-admin.html", "sample-data.html",
    "inquiry-remover.html", "affiliate.html", "client-portal.html", "partner-galaxy.html", "brand-studio.html",
    "campaign-manager.html", "social-studio.html", "creative-factory.html", "hiring.html",
    /* Finance OS is one screen now, not twelve. money-map.html,
       banking-surface.html, card-stack.html, bank-accounts.html,
       bills-cashflow.html, banking-entry.html, finance-command.html and
       finance-add.html — the six-screen write surface plus the two read-only
       roll-ups that came after it — are gone. finance-os.html absorbed all of
       it: one client's whole money picture, read from
       read/money-map, read/underwrite and finance/alerts live, with the same
       /api/finance/* writes those six screens used wired directly into it.
       An owner decision, not a regression — src/http/app-nav-reachability
       .test.mjs no longer has eleven Finance rows to account for, it has one. */
    "finance-os.html",
    /* subscriptions.html is the one Finance-adjacent screen that survived the
       consolidation, because it isn't the client's money — it's Fundhub
       billing THE CLIENT for the service, same kind of thing as
       products-commissions.html one row down in Setup. Moved there instead of
       folded into Finance OS or deleted. Its own role gate (FINANCE, in
       OWNER_ADMIN_ONLY below) did not change, only which sidebar group it
       renders in. */
    "subscriptions.html",
    /* journeys.html is the SMS/email/pipeline automation editor — it writes
       live message copy and stage wiring, so it is owner/admin only (see
       OWNER_ADMIN_ONLY below). Same treatment as every other addition on
       this list: in ALL, and therefore in every sidebar. */
    "journeys.html",
    /* template-editor.html is the message copy editor — the screen that lets
       staff change the wording of an SMS or an email without a developer.

       DELIBERATELY NOT IN OWNER_ADMIN_ONLY, and that is not an oversight. Its
       read (read/message-templates) and its save action are ROLE_SETS.STAFF:
       message copy is what staff say to clients all day, and a template holds
       no client data of any kind. Only APPROVING copy is owner/admin, and the
       screen hides that one card from everybody else — the same
       one-screen-two-gates shape finance-os.html uses and this file already
       documents below. Move that gate in api/message-templates.mjs and this
       row has to move with it. */
    "template-editor.html",
    /* contracts.html is the contract generator — write a contract once, send it
       to any client, watch it come back signed. None of that needs a developer.

       DELIBERATELY NOT IN OWNER_ADMIN_ONLY, and that is not an oversight — it is
       the same call template-editor.html one row up already carries, for the
       same reason. Its read (read/contracts) and its send action are
       ROLE_SETS.STAFF: a closer sending a funding agreement to the client they
       are working is the ordinary case this screen exists for. The narrower
       gates are INSIDE it — writing contract wording and voiding a contract are
       owner/admin in api/contracts.mjs, and the screen hides those controls from
       everybody else, the same one-screen-two-gates shape this file documents
       above. Move a gate there and this row has to move with it. */
    "contracts.html",
    /* lenders.html — funding advisor maintenance surface for the seven Airtable
       lender product tables (+ bureau mismatch review). ROLE_SETS.STAFF at the
       API. Lives under the Funding sidebar group. */
    "lenders.html"
  ];

  /* partner-galaxy.html is the white-label partner's own Galaxy — scoped to
     their book, with staff identities replaced by anonymous team nodes. It is
     the one screen no sidebar links to, and employees get the real Galaxy
     instead, so it stays out of the staff surface. */
  var PRINCIPAL_ONLY = ["partner-galaxy.html"];

  /* NOT PART OF THE SHARED STAFF SURFACE — waiting on a human approval, not on
     a nav decision, or gated narrower than STAFF at the API itself.

     finance-os.html is DELIBERATELY NOT in this list, even though it now reads
     and writes several things that individually gate on ROLE_SETS.FINANCE
     (adding a bank account, editing a bill, saving cash-flow thresholds,
     changing an alert trigger). Most of what it shows — read/money-map,
     read/underwrite, finance/liabilities, finance/alerts' queue, finance/model —
     is ROLE_SETS.STAFF, the same set that already reads a client's tradelines
     everywhere else in this app, so the SCREEN stays on the shared staff
     surface and the finance-os.html wiring itself hides the FINANCE-only
     controls (Load sample data, add/edit an account, edit a bill, save cash-
     flow settings, change a trigger) from anyone who is not owner or admin —
     matching this list's own rule one level down, inside a single screen
     instead of across several.

     subscriptions.html IS here, unchanged by the Finance OS consolidation.
     /api/finance/subscriptions and /api/finance/cards both gate on
     ROLE_SETS.FINANCE — a subscription row carries a price and a payment
     instrument, which is the narrowest thing that API serves. It moved to the
     Setup group in the sidebar (next to products-commissions.html, since this
     is Fundhub billing the client rather than the client's own money), but the
     role gate that put it here never changed.

     MOVE A GATE AND MOVE ITS ROW. If a build agent widens or narrows a role set
     in api/finance/*, this list has to follow in the same commit, or the app
     goes back to offering screens that 403. */
  var OWNER_ADMIN_ONLY = [
    "subscriptions.html",
    /* journeys.html — api/journeys/ask.mjs and api/journeys/store.mjs both
       gate on requireRole("owner", "admin"); the nav row matches. */
    "journeys.html"
  ];

  /* staffTabs — every screen a signed-in employee may open, which is every row
     the shared sidebar leaves them looking at.

     The sidebar markup itself carries one row more than this: subscriptions
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
    /* Sales manager sees the staff surface. The commission screens
       (products-commissions.html, staff-teams.html) are NOT in
       OWNER_ADMIN_ONLY, so the staff surface already includes them — which
       matches the owner decision putting sales_manager in ROLE_SETS.FINANCE.
       Move that gate and move this row, per the rule above. */
    sales_manager: "staff",
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
    // The Sales pipeline is the thing they own, so it is where they land.
    sales_manager: "pipeline.html",
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
    "closer-dashboard.html":     "client_id",
    "client-control-panel.html": "id"
  };

  /* ENTITY_SCREENS — which screens additionally read an entity (personal vs. a
     business, 106_entities.sql) off the URL, and under what key. Same shape and
     same reasoning as CLIENT_SCREENS one block up: keep it here, once, rather
     than duplicated per screen. A screen absent from this map does not filter
     by entity even if a client is carried. */
  var ENTITY_SCREENS = {
    "finance-os.html": "entity_id"
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
          return { code: "nodb", label: "NO DB", hint: String((d && d.message) || "The database is not reachable right now.") };
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

  /* The chip is ~337px wide and sits position:fixed over the top-right corner.
     Every editor screen puts its own header buttons in that same corner
     (justify-content:space-between), and below 1200px there isn't 337px of
     clearance left, so the chip sat on top of them — clickable but invisible.
     This was "half-fixed" per-page (headers got z-index:14, which does nothing
     against a fixed element whose own z-index is astronomically higher and
     which doesn't reserve layout space either way). The real fix has to live
     here, once: below 1200px the chip drops beneath the header instead of
     sitting inside it, so the two can never occupy the same row. */
  // A second step at phone width: several screens have more than just the
  // 44-57px header to clear by then — pipeline.html's rail tabs, messaging
  // .html's search bar, agent-editor.html's wrapped two-row header — and the
  // chip's own ~337px width no longer fits with 10px to spare on a ~390px
  // screen either. 135px clears the tallest of those (agent-editor's header,
  // 125px) with a little to spare; pinned to both edges so it wraps to the
  // available width instead of running off it.
  var CHIP_BREAKPOINT_CSS =
    "@media (max-width:1200px){#fh-shell-chip{top:66px !important;right:10px !important}}" +
    "@media (max-width:480px){#fh-shell-chip{top:135px !important;left:10px !important;right:10px !important;" +
    "flex-wrap:wrap;gap:6px !important;padding:6px 9px !important;font-size:10px !important}}";

  /* Search sits fixed to the LEFT of the Sign-out chip. Pages that put action
     buttons in the topbar (agent editor "+ New", products "+ Add product") must
     clear BOTH. A hard-coded right:360px left Search overlapping those buttons
     after global search shipped — Playwright caught clicks landing on Search.
     layoutShellChrome() measures the real widths and publishes
     --fh-shell-top-clearance so topbars can pad once and stay clear.

     Medium screens used to park Search and the chip on the SAME top/right
     corner (both top:66 right:10) — they stacked and ate clicks. Search now
     sits left of the chip at every breakpoint, measured in layoutShellChrome. */
  function layoutShellChrome() {
    var chip = document.getElementById("fh-shell-chip");
    var search = document.getElementById("fh-shell-search-btn");
    var gap = 10;
    var edge = 14;
    var clear = edge;
    var narrow = window.matchMedia && window.matchMedia("(max-width:1200px)").matches;
    var phone = window.matchMedia && window.matchMedia("(max-width:480px)").matches;
    if (chip) {
      clear += (chip.offsetWidth || 337) + gap;
    }
    if (search && chip) {
      // Always dock Search immediately left of the chip (same row), never on
      // top of it. Phone: chip wraps full width lower; Search stays above chip
      // on the right so it does not cover sidebar / topbar actions.
      if (phone) {
        search.style.top = "135px";
        search.style.left = "auto";
        search.style.right = edge + "px";
        clear = Math.max(clear, edge + (search.offsetWidth || 110) + gap);
      } else if (narrow) {
        search.style.top = "66px";
        search.style.left = "auto";
        search.style.right = (edge + (chip.offsetWidth || 200) + gap) + "px";
        clear += (search.offsetWidth || 110) + gap;
      } else {
        search.style.top = "";
        search.style.left = "auto";
        search.style.right = (edge + (chip.offsetWidth || 337) + gap) + "px";
        clear += (search.offsetWidth || 110) + gap;
      }
    } else if (search) {
      search.style.right = edge + "px";
      search.style.left = "auto";
      clear += (search.offsetWidth || 110) + gap;
    }
    try {
      document.documentElement.style.setProperty("--fh-shell-top-clearance", clear + "px");
      // Pages with a topbar of action buttons: pad the right so Search/chip
      // never cover "+ New" / Save. Harmless if a page has no .topbar.
      var styleId = "fh-shell-clearance-style";
      var st = document.getElementById(styleId);
      if (!st) {
        st = document.createElement("style");
        st.id = styleId;
        (document.head || document.documentElement).appendChild(st);
      }
      st.textContent =
        ".topbar,.top,.page-hd,.hdr-actions,.screen-actions{" +
        "padding-right:max(16px,var(--fh-shell-top-clearance,360px)) !important}";
    } catch (e) { /* ignore */ }
  }

  /* External principals stay on their own surface — search is staff CRM chrome. */
  var SEARCH_SKIP_ROLES = { client: 1, affiliate: 1, partner: 1 };

  /* FH-SEARCH-BEGIN */
  /* Pure helpers for the global search overlay. Extracted so src/http/search-
     screen.test.mjs can drive them without a browser. */
  function searchGroupLabels() {
    return {
      clients: "Clients",
      contracts: "Contracts",
      documents: "Documents",
      conversations: "Conversations",
      cards: "Pipeline"
    };
  }

  function searchGroupOrder() {
    return ["clients", "contracts", "documents", "conversations", "cards"];
  }

  function searchEmptyCopy(q) {
    var term = String(q == null ? "" : q).trim();
    if (!term) return "Type a name, email, phone, or anything else you remember.";
    return "No matches for \u201c" + term + "\u201d.";
  }

  function searchTotal(groups) {
    var g = groups || {};
    var n = 0;
    var order = searchGroupOrder();
    for (var i = 0; i < order.length; i++) {
      var rows = g[order[i]];
      if (Array.isArray(rows)) n += rows.length;
    }
    return n;
  }

  function searchRenderGroups(groups, escFn) {
    var g = groups || {};
    var labels = searchGroupLabels();
    var order = searchGroupOrder();
    var html = "";
    var total = 0;
    for (var i = 0; i < order.length; i++) {
      var key = order[i];
      var rows = Array.isArray(g[key]) ? g[key] : [];
      if (!rows.length) continue;
      total += rows.length;
      html += '<div class="fh-search-group" data-group="' + escFn(key) + '">' +
        '<div class="fh-search-ghead">' + escFn(labels[key] || key) +
        ' <span class="fh-search-n">' + rows.length + "</span></div>";
      for (var j = 0; j < rows.length; j++) {
        var row = rows[j] || {};
        html += '<a class="fh-search-hit" href="' + escFn(row.href || "#") + '">' +
          '<span class="fh-search-title">' + escFn(row.title || "Untitled") + "</span>" +
          '<span class="fh-search-sub">' + escFn(row.subtitle || "") + "</span>" +
          "</a>";
      }
      html += "</div>";
    }
    return { html: html, total: total };
  }

  if (typeof window !== "undefined") {
    window.FHSearch = {
      groupLabels: searchGroupLabels,
      groupOrder: searchGroupOrder,
      emptyCopy: searchEmptyCopy,
      total: searchTotal,
      renderGroups: searchRenderGroups
    };
  }
  /* FH-SEARCH-END */

  function mountSearch(staff, demo) {
    var role = normRole(staff && staff.role);
    if (SEARCH_SKIP_ROLES[role]) return;

    var style = document.createElement("style");
    style.id = "fh-shell-search-style";
    style.textContent =
      "#fh-shell-search-btn{position:fixed;top:12px;right:360px;z-index:2147482500;" +
      "display:flex;align-items:center;gap:8px;background:#fff;color:#0A0A0A;" +
      "border:1px solid #E4E4E7;border-radius:10px;padding:8px 12px;" +
      "font:500 12px/1 Inter,system-ui,sans-serif;cursor:pointer;" +
      "box-shadow:0 8px 24px rgba(0,0,0,.12)}" +
      /* top/right overwritten by layoutShellChrome() once the chip is measured */
      "#fh-shell-search-btn .fh-k{font:600 10px/1 'JetBrains Mono',monospace;" +
      "letter-spacing:.04em;color:#71717A;border:1px solid #E4E4E7;border-radius:5px;" +
      "padding:3px 5px;background:#FAFAFA}" +
      "#fh-shell-search-overlay{position:fixed;inset:0;z-index:2147483600;" +
      "background:rgba(10,10,10,.45);display:none;align-items:flex-start;" +
      "justify-content:center;padding:12vh 16px 24px}" +
      "#fh-shell-search-overlay.open{display:flex}" +
      "#fh-shell-search-panel{width:min(560px,100%);background:#fff;color:#0A0A0A;" +
      "border:1px solid #E4E4E7;border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.28);" +
      "overflow:hidden}" +
      "#fh-shell-search-panel .fh-search-bar{display:flex;align-items:center;gap:10px;" +
      "padding:14px 16px;border-bottom:1px solid #E4E4E7}" +
      "#fh-shell-search-panel input{flex:1;border:0;outline:0;background:transparent;" +
      "font:500 16px/1.3 Inter,system-ui,sans-serif;color:#0A0A0A}" +
      "#fh-shell-search-panel .fh-search-body{max-height:min(52vh,420px);overflow:auto}" +
      "#fh-shell-search-panel .fh-search-empty{padding:28px 18px;color:#71717A;" +
      "font:500 13px/1.45 Inter,system-ui,sans-serif;text-align:center}" +
      "#fh-shell-search-panel .fh-search-group{padding:8px 0 4px;" +
      "border-bottom:1px solid #F4F4F5}" +
      "#fh-shell-search-panel .fh-search-ghead{padding:6px 16px 4px;" +
      "font:600 10px/1 'JetBrains Mono',monospace;letter-spacing:.12em;" +
      "text-transform:uppercase;color:#71717A}" +
      "#fh-shell-search-panel .fh-search-n{opacity:.7}" +
      "#fh-shell-search-panel .fh-search-hit{display:block;padding:9px 16px;" +
      "text-decoration:none;color:inherit}" +
      "#fh-shell-search-panel .fh-search-hit:hover," +
      "#fh-shell-search-panel .fh-search-hit:focus{background:#F4F4F5;outline:0}" +
      "#fh-shell-search-panel .fh-search-title{display:block;font:600 13.5px/1.3 Inter,system-ui,sans-serif}" +
      "#fh-shell-search-panel .fh-search-sub{display:block;margin-top:2px;" +
      "font:500 11.5px/1.35 Inter,system-ui,sans-serif;color:#71717A}";
    (document.head || document.documentElement).appendChild(style);

    var mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");
    var chord = mac ? "\u2318K" : "Ctrl K";

    var btn = document.createElement("button");
    btn.id = "fh-shell-search-btn";
    btn.type = "button";
    btn.setAttribute("aria-label", "Search the CRM");
    btn.innerHTML = "<span>Search</span><span class=\"fh-k\">" + esc(chord) + "</span>";
    document.body.appendChild(btn);

    var overlay = document.createElement("div");
    overlay.id = "fh-shell-search-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Search");
    overlay.innerHTML =
      '<div id="fh-shell-search-panel">' +
        '<div class="fh-search-bar">' +
          '<span aria-hidden="true">\u2315</span>' +
          '<input id="fh-shell-search-input" type="search" autocomplete="off" ' +
            'spellcheck="false" placeholder="Search clients, contracts, messages\u2026">' +
        "</div>" +
        '<div class="fh-search-body" id="fh-shell-search-results">' +
          '<div class="fh-search-empty">' + esc(searchEmptyCopy("")) + "</div>" +
        "</div>" +
      "</div>";
    document.body.appendChild(overlay);

    var input = document.getElementById("fh-shell-search-input");
    var results = document.getElementById("fh-shell-search-results");
    var timer = null;
    var seq = 0;

    function openSearch() {
      overlay.classList.add("open");
      if (input && input.focus) input.focus();
      if (input && input.select) input.select();
    }
    function closeSearch() {
      overlay.classList.remove("open");
    }

    function paintEmpty(q, note) {
      results.innerHTML = '<div class="fh-search-empty">' +
        esc(note || searchEmptyCopy(q)) + "</div>";
    }

    function runSearch(q) {
      var term = String(q || "").trim();
      if (!term) {
        paintEmpty("");
        return;
      }
      var my = ++seq;
      results.innerHTML = '<div class="fh-search-empty">Searching\u2026</div>';

      function done(res) {
        if (my !== seq) return;
        if (!res || !res.ok) {
          var why = (res && res.source === "demo")
            ? "Demo session — search needs a real sign-in."
            : (res && res.source === "unauthorized")
              ? "Not signed in — search needs a real session."
              : "Search could not run. Try again in a moment.";
          paintEmpty(term, why);
          return;
        }
        var groups = (res.data && res.data.groups) || {};
        var painted = searchRenderGroups(groups, esc);
        if (!painted.total) {
          paintEmpty(term);
          return;
        }
        results.innerHTML = painted.html;
      }

      if (window.FHData && typeof window.FHData.search === "function") {
        window.FHData.search({ q: term }).then(done);
        return;
      }
      var t = "";
      try { t = localStorage.getItem("fh_token") || ""; } catch (e) { t = ""; }
      if (demo || t === "demo") {
        done({ ok: false, source: "demo" });
        return;
      }
      fetch("/api/read/search?q=" + encodeURIComponent(term), {
        headers: t
          ? { accept: "application/json", authorization: "Bearer " + t }
          : { accept: "application/json" }
      }).then(function (r) {
        return r.json().then(function (d) {
          if (r.status === 401 || r.status === 403) {
            return { ok: false, source: "unauthorized" };
          }
          if (!d || d.ok !== true) return { ok: false, source: "server", error: d && d.error };
          return { ok: true, source: "api", data: d };
        });
      }).then(done).catch(function () {
        done({ ok: false, source: "offline" });
      });
    }

    btn.addEventListener("click", function (e) {
      e.preventDefault();
      openSearch();
    });
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeSearch();
    });
    input.addEventListener("input", function () {
      var q = input.value;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { runSearch(q); }, 180);
    });

    document.addEventListener("keydown", function (e) {
      var key = e.key || "";
      if ((e.metaKey || e.ctrlKey) && (key === "k" || key === "K")) {
        e.preventDefault();
        if (overlay.classList.contains("open")) closeSearch();
        else openSearch();
        return;
      }
      if (key === "Escape" && overlay.classList.contains("open")) {
        e.preventDefault();
        closeSearch();
      }
    });
  }

  function mountChip(staff, demo) {
    var style = document.createElement("style");
    style.id = "fh-shell-chip-style";
    style.textContent = CHIP_BREAKPOINT_CSS;
    (document.head || document.documentElement).appendChild(style);

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

  /* applyBrand — this company's CRM tokens over the CSS custom properties, at
     boot. See docs/BRAND-THEMING-SPEC.md.

     CRM chrome comes from /api/org-brand, never from partner_brand. A partner
     editing their funnel tokens must not recolor Fundhub staff screens.

     FALLS BACK TO FUNDHUB. No session, no row, or a failed request leave the
     stylesheet untouched — the default brand is what the page already has, so
     doing nothing IS the fallback.

     Applies ink, paper, spectrum (from the six-stop ramp), status stops that
     match the Fundhub ramp order, Google Font faces, and the wordmark. */
  function rampToSpectrum(ramp) {
    return "linear-gradient(90deg," + ramp.map(function (c, i) {
      return c + " " + Math.round(i * 100 / (ramp.length - 1)) + "%";
    }).join(",") + ")";
  }

  function safeWordmark(url) {
    var s = String(url || "").trim();
    if (!s) return null;
    if (/^https:\/\/[^\s"'<>()]+$/i.test(s)) return s;
    if (/^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/.test(s)) return s;
    return null;
  }

  function injectFonts(display, mono) {
    var FACE = /^[A-Za-z0-9 \-]{1,60}$/;
    var d = FACE.test(String(display || "")) ? display : null;
    var m = FACE.test(String(mono || "")) ? mono : null;
    if (!d && !m) return;
    var fams = [];
    if (d) fams.push(d.replace(/ /g, "+") + ":wght@400;500;600;700;800");
    if (m) fams.push(m.replace(/ /g, "+") + ":wght@400;500;600;700");
    var link = document.getElementById("fh-brand-fonts");
    if (!link) {
      link = document.createElement("link");
      link.id = "fh-brand-fonts";
      link.rel = "stylesheet";
      (document.head || document.documentElement).appendChild(link);
    }
    link.href = "https://fonts.googleapis.com/css2?family=" + fams.join("&family=") + "&display=swap";
  }

  function paintBrand(b) {
    if (!b) return;
    var root = document.documentElement;
    var HEX = /^#[0-9a-fA-F]{6}$/;
    // Re-validated here even though the table has a CHECK: a custom property
    // accepts url() and expressions, so this is the last gate before the
    // value reaches the stylesheet.
    if (HEX.test(String(b.ink || ""))) root.style.setProperty("--ink", b.ink);
    if (HEX.test(String(b.paper || ""))) root.style.setProperty("--paper", b.paper);
    if (Array.isArray(b.ramp) && b.ramp.length === 6 &&
        b.ramp.every(function (s) { return HEX.test(String(s)); })) {
      root.style.setProperty("--spectrum", rampToSpectrum(b.ramp));
      // Status stops follow the Fundhub pastel order (spec).
      root.style.setProperty("--alert", b.ramp[0]);
      root.style.setProperty("--warn", b.ramp[1]);
      root.style.setProperty("--ok", b.ramp[3]);
      root.style.setProperty("--info", b.ramp[4]);
      root.style.setProperty("--accent", b.ramp[5]);
    }
    var FACE = /^[A-Za-z0-9 \-]{1,60}$/;
    if (FACE.test(String(b.display_face || ""))) {
      root.style.setProperty("--sans", "'" + b.display_face + "', system-ui, -apple-system, sans-serif");
    }
    if (FACE.test(String(b.mono_face || ""))) {
      root.style.setProperty("--mono", "'" + b.mono_face + "', ui-monospace, SFMono-Regular, monospace");
    }
    injectFonts(b.display_face, b.mono_face);
    var wm = safeWordmark(b.wordmark_url);
    if (wm) root.style.setProperty("--logo", "url(\"" + wm.replace(/"/g, "") + "\")");
    var chip = document.getElementById("fh-shell-chip");
    if (chip && b.entity_name) chip.setAttribute("data-brand", b.entity_name);
  }

  function applyBrand(/* staff */) {
    var t = "";
    try { t = localStorage.getItem("fh_token") || ""; } catch (e) { t = ""; }
    var headers = { accept: "application/json" };
    if (t) headers.authorization = "Bearer " + t;

    fetch("/api/org-brand", { headers: headers })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.ok || !d.brand) return;
        paintBrand(d.brand);
      })
      .catch(function () { /* fundhub default stays — see the comment above */ });
  }

  /* Chat widget — Ask / Knowledge / Message. Spec: docs/CRM-CHAT-WIDGET-SPEC.md.
     Affiliates and partners do not get it in v1 (owner call C-3). */
  var CHAT_SKIP_ROLES = { affiliate: 1, partner: 1 };

  function mountChatWidget(staff, demo) {
    var role = normRole(staff && staff.role);
    if (CHAT_SKIP_ROLES[role]) return;
    var isPortal = role === "client" || PAGE === "client-portal.html";
    function go() {
      if (window.FHChat && typeof window.FHChat.mount === "function") {
        window.FHChat.mount({ portal: isPortal, demo: !!demo });
      }
    }
    if (window.FHChat) { go(); return; }
    var s = document.createElement("script");
    s.src = (location.pathname.indexOf("/app/") === 0 ? "" : "/app/") + "chat-widget.js";
    if (location.pathname.indexOf("/app/") !== 0) s.src = "/app/chat-widget.js";
    else s.src = "chat-widget.js";
    s.async = true;
    s.onload = go;
    (document.head || document.documentElement).appendChild(s);
  }

  // Expose for Brand Studio live preview of CRM chrome.
  window.FHApplyBrand = paintBrand;

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
      mountSearch(sess.staff, sess.demo);
      layoutShellChrome();
      if (window.addEventListener) {
        window.addEventListener("resize", layoutShellChrome);
      }
      applyBrand(sess.staff);
      mountChatWidget(sess.staff, sess.demo);
      reveal();
    });
  }).catch(function () {
    // Never leave the screen held back on an unexpected failure.
    settleClicks(allowedNow || ALL.slice());
    reveal();
    revealNav();
  });
})();

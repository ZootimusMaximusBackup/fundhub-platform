/* Fundhub CRM shell — auth + role gating over the wireframe suite.
   The screens are the product; this file only decides who sees which tabs.
   Session: real API first, demo session (set by /login.html) as fallback.
   Change who sees what in ROLE_TABS — one map, nothing else to edit.

   This file runs from <head>, before the screen paints, and that placement is
   load-bearing. It used to run as the last script in <body>: a screen the role
   may not open was parsed, painted and only then bounced away, once the session
   fetch came back. That is the "it opens the page and then throws me back"
   behaviour. With a cached role the gate still decides first. Without one we
   no longer blank the whole page waiting on the network (owner-set 2026-08-05)
   — nav stays hidden and clicks stay blocked until the session answers. */
(function () {
  // "" when the URL is /app/ — the router page, which is not a screen and is
  // never in ALL. Anything not in the role's list gets sent to its home.
  var PAGE = location.pathname.split("/").pop();

  /* Single source of truth for "not on the money path yet": every screen here
     gets a BETA badge on its nav row (mountSidebar) and a dismissible banner
     on the page itself (mountBetaBanner). Add or remove a screen by editing
     this one list — nothing else to touch, no per-page edits. */
  var BETA_PAGES = [
    "finance-os.html", "subscriptions.html", "company-brain.html",
    "command-center.html", "galaxy.html", "ops-admin.html",
    "agent-editor.html", "journeys.html", "campaign-manager.html",
    "social-studio.html", "creative-factory.html", "content-admin.html",
    "hiring.html", "sample-data.html", "brand-studio.html", "affiliate.html"
  ];

  /* ==SIDEBAR_HTML_START== */
  var SIDEBAR_HTML = "<aside class=\"side\" id=\"side\">\n  <div class=\"side-top\"><a class=\"logo inv\" href=\"command-center.html\" aria-label=\"fundhub\"></a><button class=\"burger\" id=\"burger\" type=\"button\" title=\"Collapse sidebar\">‹‹</button></div>\n  <nav class=\"side-scroll\" id=\"fh-side-nav\">\n\n<div class=\"navgroup\" data-fh-section=\"sales\"><button class=\"navhead\" type=\"button\">Sales<span class=\"chev\">▾</span></button><div class=\"navlist\">\n        <a class=\"navitem\" href=\"pipeline.html\"><span class=\"ico\">▤</span><span class=\"lbl\">Pipeline</span></a>\n        <a class=\"navitem\" href=\"closer-dashboard.html\"><span class=\"ico\">★</span><span class=\"lbl\">Closer Dashboard</span></a>\n        <a class=\"navitem\" href=\"closer-call.html\"><span class=\"ico\">☎</span><span class=\"lbl\">Call cockpit</span></a>\n        <a class=\"navitem\" href=\"my-numbers.html\"><span class=\"ico\">＃</span><span class=\"lbl\">My numbers</span></a>\n        <a class=\"navitem\" href=\"sales-floor.html\"><span class=\"ico\">▣</span><span class=\"lbl\">Sales floor</span></a>\n        <a class=\"navitem\" href=\"calendar.html\"><span class=\"ico\">▦</span><span class=\"lbl\">Calendar</span></a>\n</div></div>\n\n<div class=\"navgroup\" data-fh-section=\"funding\"><button class=\"navhead\" type=\"button\">Funding<span class=\"chev\">▾</span></button><div class=\"navlist\">\n        <a class=\"navitem\" href=\"lenders.html\"><span class=\"ico\">⬡</span><span class=\"lbl\">Lenders</span></a>\n        <a class=\"navitem\" href=\"finance-os.html\"><span class=\"ico\">▩</span><span class=\"lbl\">Finance OS</span></a>\n        <a class=\"navitem\" href=\"contracts.html\"><span class=\"ico\">✒</span><span class=\"lbl\">Contracts</span></a>\n        <a class=\"navitem\" href=\"subscriptions.html\"><span class=\"ico\">◍</span><span class=\"lbl\">Subscriptions</span></a>\n</div></div>\n\n<div class=\"navgroup\" data-fh-section=\"client-ops\"><button class=\"navhead\" type=\"button\">Client ops<span class=\"chev\">▾</span></button><div class=\"navlist\">\n        <a class=\"navitem\" href=\"client-control-panel.html\"><span class=\"ico\">◎</span><span class=\"lbl\">Client Control Panel</span></a>\n        <a class=\"navitem\" href=\"messaging.html\"><span class=\"ico\">✉</span><span class=\"lbl\">Messaging</span></a>\n        <a class=\"navitem\" href=\"documents.html\"><span class=\"ico\">▧</span><span class=\"lbl\">Documents</span></a>\n        <a class=\"navitem\" href=\"inquiry-remover.html\"><span class=\"ico\">⊘</span><span class=\"lbl\">Inquiry Remover</span></a>\n        <a class=\"navitem\" href=\"company-brain.html\"><span class=\"ico\">◎</span><span class=\"lbl\">Company Brain</span></a>\n</div></div>\n\n<div class=\"navgroup\" data-fh-section=\"watch\"><button class=\"navhead\" type=\"button\">Watch<span class=\"chev\">▾</span></button><div class=\"navlist\">\n        <a class=\"navitem\" href=\"command-center.html\"><span class=\"ico\">⌘</span><span class=\"lbl\">Command Center</span></a>\n        <a class=\"navitem\" href=\"galaxy.html\"><span class=\"ico\">✷</span><span class=\"lbl\">Galaxy</span></a>\n        <a class=\"navitem\" href=\"ops-admin.html\"><span class=\"ico\">⚙</span><span class=\"lbl\">Ops &amp; Admin</span></a>\n</div></div>\n\n<div class=\"navgroup\" data-fh-section=\"automation\"><button class=\"navhead\" type=\"button\">Automation<span class=\"chev\">▾</span></button><div class=\"navlist\">\n        <a class=\"navitem\" href=\"agent-editor.html\"><span class=\"ico\">◈</span><span class=\"lbl\">Agent Editor</span></a>\n        <a class=\"navitem\" href=\"automations.html\"><span class=\"ico\">⇄</span><span class=\"lbl\">Workflows</span></a>\n        <a class=\"navitem\" href=\"journeys.html\"><span class=\"ico\">⇝</span><span class=\"lbl\">Journeys</span></a>\n        <a class=\"navitem\" href=\"template-editor.html\"><span class=\"ico\">✎</span><span class=\"lbl\">Message Copy</span></a>\n</div></div>\n\n<div class=\"navgroup\" data-fh-section=\"marketing\"><button class=\"navhead\" type=\"button\">Marketing<span class=\"chev\">▾</span></button><div class=\"navlist\">\n        <a class=\"navitem\" href=\"campaign-manager.html\"><span class=\"ico\">◇</span><span class=\"lbl\">Campaigns</span></a>\n        <a class=\"navitem\" href=\"social-studio.html\"><span class=\"ico\">◉</span><span class=\"lbl\">Social Studio</span></a>\n        <a class=\"navitem\" href=\"creative-factory.html\"><span class=\"ico\">✳</span><span class=\"lbl\">Creative Factory</span></a>\n        <a class=\"navitem\" href=\"content-admin.html\"><span class=\"ico\">▶</span><span class=\"lbl\">Content</span></a>\n</div></div>\n\n<div class=\"navgroup\" data-fh-section=\"admin\"><button class=\"navhead\" type=\"button\">Admin<span class=\"chev\">▾</span></button><div class=\"navlist\">\n        <a class=\"navitem\" href=\"staff-teams.html\"><span class=\"ico\">⚇</span><span class=\"lbl\">Staff &amp; Teams</span></a>\n        <a class=\"navitem\" href=\"hiring.html\"><span class=\"ico\">⊕</span><span class=\"lbl\">Hiring</span></a>\n        <a class=\"navitem\" href=\"products-commissions.html\"><span class=\"ico\">⛁</span><span class=\"lbl\">Products &amp; Commissions</span></a>\n        <a class=\"navitem\" href=\"sample-data.html\"><span class=\"ico\">⌗</span><span class=\"lbl\">Demo Mode</span></a>\n        <a class=\"navitem\" href=\"brand-studio.html\"><span class=\"ico\">◆</span><span class=\"lbl\">Brand Studio</span></a>\n</div></div>\n\n<div class=\"navgroup\" data-fh-section=\"portals\"><button class=\"navhead\" type=\"button\">Portals<span class=\"chev\">▾</span></button><div class=\"navlist\">\n        <a class=\"navitem\" href=\"client-portal.html\"><span class=\"ico\">◐</span><span class=\"lbl\">Client Portal</span></a>\n        <a class=\"navitem\" href=\"affiliate.html\"><span class=\"ico\">⇗</span><span class=\"lbl\">Affiliate</span></a>\n</div></div>\n\n  </nav>\n  <div class=\"side-foot\"><span class=\"pulse\"></span><span class=\"who\">fundhub</span></div>\n</aside>";
  /* ==SIDEBAR_HTML_END== */

  var ALL = [
    "closer-dashboard.html", "closer-call.html", "my-numbers.html", "sales-floor.html",
    "pipeline.html", "client-control-panel.html",
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

  /* Screens that are not part of the shared employee rail. partner-galaxy is
     deliberately unlinked for staff (employees use galaxy.html). brand-studio
     is a partner brand tool — owner/admin still reach it via "*". */
  var PRINCIPAL_ONLY = ["partner-galaxy.html", "brand-studio.html"];

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

  /* Closer desk — call cockpit + personal numbers. In every sidebar so the
     markup stays identical across screens; gateLinks() shows them only to
     closers (and owner/admin via "*"). Funding advisors and setters do not
     get these rows. */
  var CLOSER_DESK_ONLY = ["closer-call.html", "my-numbers.html"];

  /* Sales floor — manager roll-up. Same pattern: in every sidebar, visible to
     sales_manager (and owner/admin via "*"). Matches ROLE_SETS.FINANCE at the
     /api/read/sales-floor gate. */
  var SALES_FLOOR_ONLY = ["sales-floor.html"];

  /* External principal portals — not an employee desk. ROLE_TABS.client /
     .affiliate name the only openers; staffTabs() drops them. */
  var PORTAL_ONLY = ["client-portal.html", "affiliate.html"];

  /* ROLE_SETS.HIRING — applicant PII. owner/admin only (via "*" or this list
     added for those roles — "*" already covers owner/admin). */
  var HIRING_ONLY = ["hiring.html"];

  /* staffTabs — every screen a signed-in employee may open, which is every row
     the shared sidebar leaves them looking at — except the role-narrow
     screens above, which closer / sales_manager pick up in allowedFor().

     The sidebar markup itself carries more rows than this: subscriptions
     .html, closer-call, my-numbers, and sales-floor sit in the markup so
     every screen's sidebar stays identical, and gateLinks() hides the ones
     the role may not open. partner-galaxy.html is in no sidebar at all, per
     the note above. Adding a screen to ALL and to nothing else gives it no way
     in — src/http/app-nav-reachability.test.mjs fails when that happens. */
  function staffTabs() {
    return ALL.filter(function (s) {
      return PRINCIPAL_ONLY.indexOf(s) === -1
        && OWNER_ADMIN_ONLY.indexOf(s) === -1
        && CLOSER_DESK_ONLY.indexOf(s) === -1
        && SALES_FLOOR_ONLY.indexOf(s) === -1
        && PORTAL_ONLY.indexOf(s) === -1
        && HIRING_ONLY.indexOf(s) === -1;
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
    /* Closer gets the shared staff surface plus the closer desk screens.
       "closer" is resolved in allowedFor() — staffTabs() + CLOSER_DESK_ONLY. */
    closer: "closer",
    inquiry_specialist: "staff",
    setter: "staff",
    /* Sales manager gets the shared staff surface plus the sales floor.
       Commission screens stay on the staff surface (not OWNER_ADMIN_ONLY),
       matching ROLE_SETS.FINANCE. "sales_manager" resolves in allowedFor(). */
    sales_manager: "sales_manager",
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
    sales_manager: "sales-floor.html",
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
    if (m === "closer") return staffTabs().concat(CLOSER_DESK_ONLY);
    if (m === "sales_manager") return staffTabs().concat(SALES_FLOOR_ONLY);
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
    "closer-call.html":          "client_id",
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

  /* Without a hint the gate cannot answer before paint. Owner-set 2026-08-05:
     do NOT blank the whole document while /api/auth/session is in flight — that
     was a multi-second empty screen on every cold load. The layers that remain
     are enough for the gate: nav rows stay hidden until gateLinks() runs, and
     clicks on screen links are blocked until the role is known. A cold load
     may briefly show page chrome before a bounce; a blank wait is worse. */
  var navStyle = document.createElement("style");
  navStyle.id = "fh-gate-style";
  navStyle.textContent = ".navitem{visibility:hidden}";
  (document.head || document.documentElement).appendChild(navStyle);

  function revealNav() {
    if (navStyle && navStyle.parentNode) navStyle.parentNode.removeChild(navStyle);
  }

  /* ---- sidebar: one markup, one geometry, owned here ---- */
  function ensureSidebarCss() {
    if (document.getElementById("fh-crm-sidebar-css")) return;
    var link = document.createElement("link");
    link.id = "fh-crm-sidebar-css";
    link.rel = "stylesheet";
    link.href = (location.pathname.indexOf("/app/") === 0 ? "" : "/app/") + "crm-sidebar.css";
    if (location.pathname.indexOf("/app/") === 0) link.href = "crm-sidebar.css";
    (document.head || document.documentElement).appendChild(link);
    var lock = document.createElement("style");
    lock.id = "fh-side-lock";
    lock.textContent =
      "aside.side,.side{position:fixed!important;top:0!important;left:0!important;" +
      "bottom:0!important;width:var(--fh-side-w,228px)!important;flex:none!important;" +
      "margin:0!important;max-height:none!important;z-index:400!important}" +
      ".side.mini{width:var(--fh-side-w-mini,60px)!important}" +
      ".app,.app-shell{padding-left:var(--fh-side-w,228px)!important;box-sizing:border-box}" +
      "html.fh-side-mini .app,html.fh-side-mini .app-shell{padding-left:var(--fh-side-w-mini,60px)!important}" +
      /* MOBILE. This block has to live here, not in crm-sidebar.css.
         This stylesheet is injected at runtime and appended to <head>, so it
         comes after the linked crm-sidebar.css. Both sides use !important at
         the same specificity, so source order decides and this one wins. The
         mobile rules were first written in crm-sidebar.css and silently lost:
         every screen kept 228px of left padding on a 390px phone, leaving
         162px of usable width. Measured, not guessed — the layout check reports
         it. Keep the mobile override in the same sheet as the rule it beats. */
      "@media (max-width:860px){" +
        "aside.side,.side{width:var(--fh-side-w,228px)!important;" +
          "transform:translateX(-100%);transition:transform .22s ease}" +
        "aside.side.open,.side.open{transform:translateX(0)}" +
        ".side.mini{width:var(--fh-side-w,228px)!important}" +
        ".app,.app-shell,html.fh-side-mini .app,html.fh-side-mini .app-shell{" +
          "padding-left:0!important}" +
        /* see setDrawer() — floating chrome outranks the rail on z-index */
        "html.fh-drawer-open #fh-shell-chip," +
        "html.fh-drawer-open #fh-shell-search-btn{display:none!important}" +
        /* The menu button is fixed at top-left, which is exactly where a page
           title sits. Without this the ☰ lands on top of "Hiring", "Pipeline"
           and so on. 58px = 10 left + 40 button + 8 gap. */
        ".topbar,.top,.page-hd{padding-left:58px!important;flex-wrap:wrap!important}" +
        /* The 58px above is real width taken out of a 390px row, which pushed
           the right-hand action group (.topbar-right) off the edge on
           inquiry-remover and ops-admin. Wrapping lets that group drop to a
           second line instead of overflowing. Harmless on a topbar that is not
           a flex row. */
        /* The session chip is NOT positioned from here. It owns its own
           breakpoints in CHIP_BREAKPOINT_CSS — see the note there about why
           setting bottom from a second stylesheet stretches it instead of
           moving it. */
      "}";
    (document.head || document.documentElement).appendChild(lock);
  }

  /* Wide data tables — mobile.
     Ten screens render a <table class="grid"> that is 450-1340px wide. On a
     390px phone each one dragged the whole page sideways.

     Cards were the stated preference and are not used here, deliberately: the
     card pattern needs data-label="" on every <td> to keep the value labelled,
     no cell in the app has one, and most of these rows are built inside JS
     template strings across ten files. Editing all of that to reflow a grid
     nobody reads column-by-column on a phone is a poor trade. Contained
     sideways scroll keeps the columns intact and stops the PAGE moving, which
     is the actual complaint.

     Done here rather than per page because the rows arrive after shell.js runs
     — the observer catches tables that do not exist yet. */
  function wrapWideTables(root) {
    var tables = (root || document).querySelectorAll("table.grid,table.queue");
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i];
      var p = t.parentNode;
      if (!p || (p.classList && p.classList.contains("fh-scroll-x"))) continue;
      var w = document.createElement("div");
      w.className = "fh-scroll-x";
      p.insertBefore(w, t);
      w.appendChild(t);
    }
  }

  function watchWideTables() {
    if (window.__fhTableWatch) return;
    window.__fhTableWatch = 1;
    wrapWideTables(document);
    if (!window.MutationObserver) return;
    var queued = false;
    var obs = new MutationObserver(function () {
      if (queued) return;
      queued = true;
      (window.requestAnimationFrame || setTimeout)(function () {
        queued = false;
        wrapWideTables(document);
      }, 0);
    });
    obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  function mountSidebar() {
    ensureSidebarCss();
    if (!SIDEBAR_HTML) return;
    var existing = document.getElementById("side") || document.querySelector("aside.side");
    if (!existing) return;
    var wrap = document.createElement("div");
    wrap.innerHTML = SIDEBAR_HTML;
    var fresh = wrap.firstElementChild;
    if (!fresh) return;
    existing.parentNode.replaceChild(fresh, existing);
    var page = PAGE || "";
    var links = fresh.querySelectorAll("a.navitem");
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var href = (a.getAttribute("href") || "").split("?")[0];
      if (href === page) a.classList.add("on");
      else a.classList.remove("on");
      if (BETA_PAGES.indexOf(href) !== -1 && !a.querySelector(".beta-badge")) {
        var badge = document.createElement("span");
        badge.className = "beta-badge";
        badge.textContent = "BETA";
        a.appendChild(badge);
      }
    }
    wireSidebarChrome(fresh);
  }

  function wireSidebarChrome(side) {
    if (!side || side.getAttribute("data-fh-wired") === "1") return;
    side.setAttribute("data-fh-wired", "1");
    var burger = side.querySelector("#burger") || document.getElementById("burger");

    function isMobile() {
      return !!(window.matchMedia && window.matchMedia("(max-width:860px)").matches);
    }

    /* The scrim used to be looked up as "side-scrim" while the ten pages that
       shipped one called it "sideScrim", so getElementById always returned null
       and the backdrop never appeared. The other 27 pages had no scrim element
       at all. Own it here instead: one element, created on demand, present on
       every screen. */
    function getScrim() {
      var scrim = document.getElementById("side-scrim") ||
                  document.getElementById("sideScrim") ||
                  document.querySelector(".side-scrim");
      if (!scrim) {
        scrim = document.createElement("div");
        scrim.className = "side-scrim";
        document.body.appendChild(scrim);
      }
      scrim.id = "side-scrim";
      if (!scrim.getAttribute("data-fh-wired")) {
        scrim.setAttribute("data-fh-wired", "1");
        scrim.addEventListener("click", function () { closeMobile(); });
      }
      return scrim;
    }

    /* Below 860px the rail is off-canvas, so it needs a way back in. */
    function getMenuBtn() {
      var btn = document.getElementById("fh-menu-btn");
      if (!btn) {
        btn = document.createElement("button");
        btn.id = "fh-menu-btn";
        btn.className = "fh-menu-btn";
        btn.type = "button";
        btn.setAttribute("aria-label", "Open menu");
        btn.setAttribute("aria-controls", "side");
        btn.textContent = "☰";
        btn.addEventListener("click", function () { openMobile(); });
        if (side.parentNode) side.parentNode.insertBefore(btn, side.nextSibling);
        else document.body.appendChild(btn);
      }
      return btn;
    }

    /* The session chip and the search button are position:fixed at z-index
       ~2147483000, three orders of magnitude above the rail's 400, so with the
       drawer open they sit on top of the navigation and cover menu entries.
       Raising the rail above them would start a z-index war with the search
       overlay, which legitimately has to cover everything. Hiding the two
       floating controls while the drawer is open is the smaller change: they
       are chrome for the screen underneath, which you cannot interact with
       anyway while the scrim is up. */
    function setDrawer(open) {
      side.classList.toggle("open", open);
      getScrim().classList.toggle("show", open);
      getMenuBtn().setAttribute("aria-expanded", open ? "true" : "false");
      document.documentElement.classList.toggle("fh-drawer-open", open);
    }
    function openMobile() { setDrawer(true); }
    function closeMobile() { setDrawer(false); }

    function syncMini() {
      var mini = side.classList.contains("mini");
      document.documentElement.classList.toggle("fh-side-mini", mini && !isMobile());
      if (burger) burger.textContent = isMobile() ? "✕" : (mini ? "››" : "‹‹");
      getMenuBtn();
      if (!isMobile()) closeMobile();
    }

    if (burger) {
      burger.addEventListener("click", function () {
        /* On a phone the same control closes the drawer; on desktop it still
           collapses the rail to the icon strip. */
        if (isMobile()) { closeMobile(); return; }
        side.classList.toggle("mini");
        syncMini();
      });
    }

    /* Tapping a destination should not leave the drawer sitting over it. */
    side.addEventListener("click", function (ev) {
      if (isMobile() && ev.target && ev.target.closest && ev.target.closest("a.navitem")) closeMobile();
    });

    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && side.classList.contains("open")) closeMobile();
    });
    var heads = side.querySelectorAll(".navhead");
    for (var h = 0; h < heads.length; h++) {
      heads[h].addEventListener("click", function (ev) {
        var g = ev.currentTarget.closest(".navgroup");
        if (g) g.classList.toggle("closed");
      });
    }
    if (window.matchMedia) {
      var mq = window.matchMedia("(max-width:860px)");
      function onMq() {
        /* Was: force .mini below 860, which left a 60px unlabelled glyph rail
           permanently docked on a 390px phone. Now the rail is off-canvas and
           starts closed; the ☰ button brings it in. */
        if (mq.matches) {
          /* Drop .mini so a rail collapsed on desktop does not carry over as a
             60px glyph strip after a resize or rotate. Mobile is one state:
             off-canvas, full labels. */
          side.classList.remove("mini");
          document.documentElement.classList.remove("fh-side-mini");
          closeMobile();
        }
        syncMini();
      }
      if (mq.addEventListener) mq.addEventListener("change", onMq);
      else if (mq.addListener) mq.addListener(onMq);
      onMq();
    } else {
      syncMini();
    }
  }

  /* Mount before first paint when possible — head script + documentElement. */
  ensureSidebarCss();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      mountSidebar();
      mountBetaBanner();
      watchWideTables();
    });
  } else {
    mountSidebar();
    mountBetaBanner();
    watchWideTables();
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

  /* Kick the session off as soon as this file can. Sidebar mount and the role
     hint still run below; overlapping them with the network is free speed. */
  var sessionPromise = getSession();

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
    /* Hide a nav group whose every .navitem is gated — otherwise the section
       header sits over an empty list (closer desk / sales floor / Setup). */
    var groups = document.querySelectorAll(".navgroup");
    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];
      var items = group.querySelectorAll(".navitem");
      if (!items.length) continue;
      var any = false;
      for (var j = 0; j < items.length; j++) {
        if (items[j].style.display !== "none" && !items[j].hasAttribute("data-fh-gated")) {
          any = true;
          break;
        }
      }
      if (!any) {
        group.style.display = "none";
        group.setAttribute("data-fh-gated-group", "1");
      } else if (group.hasAttribute("data-fh-gated-group")) {
        group.style.display = "";
        group.removeAttribute("data-fh-gated-group");
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
    /* Phones: dock it to the bottom instead of hanging it at top:135px.
       135px was picked to clear the tallest page header, but it only clears
       the HEADER — on any screen whose content starts right below one (the
       Lenders tab strip, the first row of KPI cards on Hiring) the chip lands
       squarely on top of it. There is nothing at the bottom of these screens.

       top:auto has to be stated here, in this rule. Setting bottom from
       another stylesheet while this rule still pins top:135px !important does
       not move the chip, it STRETCHES it — top 135 and bottom 10 together
       resolve to a ~700px-tall black panel over most of the screen. That was
       tried and reverted before landing here.

       right:110px keeps it clear of the chat launcher in the bottom corner. */
    "@media (max-width:480px){#fh-shell-chip{top:auto !important;bottom:10px !important;" +
    "left:10px !important;right:110px !important;" +
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
        /* The chip is docked to the bottom on phones now (CHIP_BREAKPOINT_CSS),
           so Search no longer has to sit above it. top:135px put this pill on
           top of whatever the screen renders below its header — the Lenders
           notice box, for one. Park it bottom-right, above the chat launcher,
           where the chip and the launcher already live and nothing else does.
           clear stays at the edge: neither control is beside the topbar any
           more, so topbars need no horizontal clearance from them. */
        search.style.top = "auto";
        search.style.bottom = "78px";
        search.style.left = "auto";
        search.style.right = edge + "px";
        clear = edge;
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
        "padding-right:max(16px,var(--fh-shell-top-clearance,360px)) !important}" +
        /* The clearance above reserves room for the floating Search + client
           chip, which is ~360px. On a 390px phone that padding alone is wider
           than the screen, and every topbar on every screen overflowed
           sideways because of it. Below 860px the chip wraps to its own row
           instead of sitting beside the actions, so no clearance is needed. */
        "@media (max-width:860px){" +
        ".topbar,.top,.page-hd,.hdr-actions,.screen-actions{" +
        "padding-right:16px !important}}";
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

  /* Driven by BETA_PAGES above — nothing else decides this. No storage: the
     dismiss button just removes the element, so it is gone for the rest of
     this page view and back the moment the page reloads or is reopened. */
  function mountBetaBanner() {
    if (BETA_PAGES.indexOf(PAGE) === -1) return;
    if (document.getElementById("fh-beta-banner")) return;
    var bar = document.createElement("div");
    bar.id = "fh-beta-banner";
    bar.setAttribute("role", "status");
    bar.setAttribute("data-fh-beta-banner", "1");
    bar.style.cssText = [
      "position:relative", "top:0", "z-index:2147482990", "width:100%",
      "flex:0 0 auto", "box-sizing:border-box", "padding:10px 16px",
      "background:#3A2A0A", "color:#FDE9C4",
      "font:600 13px/1.35 'JetBrains Mono',ui-monospace,monospace",
      "letter-spacing:.04em", "text-align:center",
      "border-bottom:2px solid var(--warn,#F5CE8F)",
      "display:flex", "gap:12px", "align-items:center", "justify-content:center",
      "flex-wrap:wrap"
    ].join(";");
    bar.innerHTML =
      "<span>Beta \u2014 under development. Data may be incomplete or inaccurate. Do not use for client decisions.</span>" +
      "<button type=\"button\" data-fh-beta-dismiss=\"1\" aria-label=\"Dismiss\" style=\"" +
      "background:none;border:1px solid var(--warn,#F5CE8F);color:#FDE9C4;border-radius:3px;" +
      "font:700 11px/1 'JetBrains Mono',ui-monospace,monospace;padding:3px 8px;cursor:pointer\">Dismiss</button>";
    /* Same host-resolution as the demo banner: prefer .shell so Galaxy (and
       any flex-column .app) keeps the canvas. */
    var shell = document.querySelector(".app > .shell") || document.querySelector(".shell");
    var app = document.querySelector(".app");
    var host = shell || app || document.body;
    host.insertBefore(bar, host.firstChild);
    var dismiss = bar.querySelector("[data-fh-beta-dismiss]");
    if (dismiss) {
      dismiss.addEventListener("click", function () {
        bar.remove();
        try { window.dispatchEvent(new Event("resize")); } catch (e) { /* ignore */ }
      });
    }
    try { window.dispatchEvent(new Event("resize")); } catch (e) { /* ignore */ }
  }

  /* Persistent Demo Mode banner — not a chip. Every CRM screen when the org
     toggle is on. Money totals still exclude is_demo rows on the server. */
  function mountDemoBanner(staff) {
    if (!staff || !staff.org_id) return;
    var role = normRole(staff.role);
    if (role === "client" || role === "affiliate" || role === "partner") return;
    var tok = "";
    try { tok = localStorage.getItem("fh_token") || ""; } catch (e) { tok = ""; }
    var demoHeaders = { Accept: "application/json" };
    if (tok && tok !== "demo") demoHeaders.authorization = "Bearer " + tok;
    fetch("/api/demo/mode", { credentials: "same-origin", headers: demoHeaders })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.ok || !d.demo_mode_enabled) {
          var old = document.getElementById("fh-demo-banner");
          if (old) old.remove();
          document.documentElement.classList.remove("fh-demo-mode");
          return;
        }
        document.documentElement.classList.add("fh-demo-mode");
        if (document.getElementById("fh-demo-banner")) return;
        var bar = document.createElement("div");
        bar.id = "fh-demo-banner";
        bar.setAttribute("role", "status");
        bar.setAttribute("data-fh-demo-banner", "1");
        bar.style.cssText = [
          "position:relative", "top:0", "z-index:2147482990", "width:100%",
          "flex:0 0 auto", "box-sizing:border-box", "padding:10px 16px",
          "background:#7A2E0E", "color:#FFF7ED",
          "font:600 13px/1.35 'JetBrains Mono',ui-monospace,monospace",
          "letter-spacing:.04em", "text-align:center",
          "border-bottom:2px solid #FDBA74",
          "display:flex", "gap:12px", "align-items:center", "justify-content:center",
          "flex-wrap:wrap"
        ].join(";");
        bar.innerHTML =
          "<span>DEMO MODE ON — sample data is displayed. Numbers on this screen may be fictional.</span>" +
          "<a href=\"sample-data.html\" style=\"color:#FFEDD5;text-decoration:underline;font-weight:700\">Manage demo data</a>";
        /* Prefer .shell so Galaxy (and any flex-column .app) keeps the canvas.
           Fall back to .app, then body. Never insert beside a row-flex sibling
           in a way that steals the full width from the stage. */
        var shell = document.querySelector(".app > .shell") || document.querySelector(".shell");
        var app = document.querySelector(".app");
        var host = shell || app || document.body;
        host.insertBefore(bar, host.firstChild);
        try { window.dispatchEvent(new Event("resize")); } catch (e) { /* ignore */ }
      })
      .catch(function () { /* no banner if the endpoint is unreachable */ });
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
  }
  /* No document hold on a cold load (owner-set 2026-08-05). Nav stays gated
     and clicks stay blocked until pass 2 settles the role. */

  /* ---- pass 2: the session, authoritative ---- */
  sessionPromise.then(function (sess) {
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
      mountDemoBanner(sess.staff);
    });
  }).catch(function () {
    // Never leave nav permanently gated on an unexpected failure.
    settleClicks(allowedNow || ALL.slice());
    revealNav();
  });
})();

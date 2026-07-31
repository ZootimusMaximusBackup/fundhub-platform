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
    "finance-os.html", "banking-surface.html"
  ];

  /* partner-galaxy.html is the white-label partner's own Galaxy — scoped to
     their book, with staff identities replaced by anonymous team nodes. It is
     the one screen no sidebar links to, and employees get the real Galaxy
     instead, so it stays out of the staff surface. */
  var PRINCIPAL_ONLY = ["partner-galaxy.html"];

  // staffTabs — every screen the sidebar links to, which is every screen a
  // signed-in employee can reach from the chrome they are already looking at.
  function staffTabs() {
    return ALL.filter(function (s) { return PRINCIPAL_ONLY.indexOf(s) === -1; });
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

  function isScreen(href) {
    return /^[a-z0-9-]+\.html$/i.test(href);
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
    return "/app/" + homeFor(role, ok);
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
    if (!isScreen(h)) return;
    if (allowedNow === null) {
      // Session still in flight: remember where they wanted to go and take
      // them there the moment we know they may.
      e.preventDefault();
      pendingHref = h;
      return;
    }
    if (allowedNow.indexOf(h) === -1) e.preventDefault();
  }, true);

  function settleClicks(ok) {
    allowedNow = ok;
    var want = pendingHref;
    pendingHref = null;
    if (want && ok.indexOf(want) !== -1) location.href = want;
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
    var links = document.querySelectorAll("a[href]");
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (!a.hasAttribute("data-fh-href")) {
        a.setAttribute("data-fh-href", a.getAttribute("href") || "");
      }
      var h = a.getAttribute("data-fh-href").replace(/^\.\//, "");
      if (!isScreen(h)) continue;
      var allowed = ok.indexOf(h) !== -1;
      // The sidebar logo is chrome, not a tab. Every screen points it at
      // command-center.html, which five of the nine roles may not open, so
      // hiding it took the logo off the page for them. Send it home instead.
      if (a.classList.contains("logo")) {
        a.setAttribute("href", allowed ? h : home);
        continue;
      }
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
      // Back from a screen bounces straight forward again.
      location.replace("/app/" + homeFor(role, ok));
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

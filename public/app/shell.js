/* Fundhub CRM shell — auth + role gating over the wireframe suite.
   The screens are the product; this file only decides who sees which tabs.
   Session: real API first, demo session (set by /login.html) as fallback.
   Change who sees what in ROLE_TABS — one map, nothing else to edit. */
(function () {
  var PAGE = location.pathname.split("/").pop() || "index.html";

  /* The session lookup is async, so without this the full nav paints and is
     clickable while we are still deciding what the role may see — click a tab
     you are not allowed in that window and you land on it, then get bounced.
     Hide the nav rows up front and reveal them once gateLinks has run.
     REVEAL_MS is a floor, not a deadline: a stalled /api/auth/session must
     degrade to an ungated nav, never to a permanently blank one. */
  var REVEAL_MS = 4000;
  var gateStyle = document.createElement("style");
  gateStyle.id = "fh-gate-style";
  gateStyle.textContent = ".navitem,.idx-item{visibility:hidden}";
  (document.head || document.documentElement).appendChild(gateStyle);

  function revealNav() {
    if (gateStyle && gateStyle.parentNode) gateStyle.parentNode.removeChild(gateStyle);
  }
  setTimeout(revealNav, REVEAL_MS);

  var ALL = [
    "index.html",
    "closer-dashboard.html", "pipeline.html", "client-control-panel.html",
    "messaging.html", "calendar.html", "documents.html",
    "ops-admin.html", "command-center.html", "galaxy.html",
    "agent-editor.html", "automations.html", "products-commissions.html",
    "staff-teams.html", "content-admin.html", "sample-data.html",
    "inquiry-remover.html", "affiliate.html", "client-portal.html", "partner-galaxy.html", "brand-studio.html"
  ];

  var ROLE_TABS = {
    owner: "*",
    admin: "*",
    funding_advisor: ["closer-dashboard.html", "pipeline.html", "client-control-panel.html",
                      "messaging.html", "calendar.html", "documents.html",
                      "ops-admin.html", "command-center.html"],
    closer: ["closer-dashboard.html", "pipeline.html", "client-control-panel.html",
             "messaging.html", "calendar.html", "documents.html"],
    inquiry_specialist: ["inquiry-remover.html", "client-control-panel.html",
                         "messaging.html", "calendar.html"],
    setter: ["pipeline.html", "messaging.html", "calendar.html"],
    /* Future principals (B4) land on a single screen. These are PRINCIPAL TYPES,
       not staff roles — external accounts, not employees — but they are gated
       here on staff.role because no principals table exists yet. 'partner' is
       seeded into the staff_roles catalog by db/migrations/036_partner_role.sql
       purely so the shipped screens are reachable; when principals get their own
       table and auth, these three move out of ROLE_TABS and 036 is reverted. */
    client: ["client-portal.html"],
    affiliate: ["affiliate.html"],
    partner: ["partner-galaxy.html", "brand-studio.html"]
  };

  function allowedFor(role) {
    var m = ROLE_TABS[role];
    if (m === "*") return ALL.slice();
    if (!m) return ["index.html"];
    return ["index.html"].concat(m);
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

  function signOut() {
    localStorage.removeItem("fh_token");
    localStorage.removeItem("fh_demo");
    localStorage.removeItem("fh_demo_staff");
    location.href = "/login.html";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function gateLinks(ok) {
    var links = document.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var h = (a.getAttribute("href") || "").replace(/^\.\//, "");
      if (!/^[a-z0-9-]+\.html$/i.test(h)) continue;
      if (ok.indexOf(h) !== -1) continue;
      /* .idx-item is the index's row wrapper: hiding only the <a> there would
         strand the row's icon and description with no link between them. */
      var box = a.closest("li, .card, .idx-item") || a;
      box.style.display = "none";
    }
  }

  function mountChip(staff, demo) {
    var el = document.createElement("div");
    el.id = "fh-shell-chip";
    el.style.cssText = "position:fixed;top:12px;right:14px;z-index:2147483000;display:flex;gap:10px;align-items:center;background:#0A0A0A;color:#fff;border:1px solid #26262B;border-radius:10px;padding:8px 12px;font:500 11px/1 'JetBrains Mono',monospace;letter-spacing:.06em;box-shadow:0 10px 30px rgba(0,0,0,.35)";
    el.innerHTML =
      '<span style="color:#A1A1AA">' + esc(staff.name || staff.email) + " · " + esc(String(staff.role || "").toLowerCase()) + "</span>" +
      (demo ? '<span style="background:#F5CE8F;color:#0A0A0A;border-radius:6px;padding:3px 7px;font-weight:700">DEMO</span>' : "") +
      '<button id="fh-shell-out" style="background:none;border:1px solid #3F3F46;color:#E4E4E7;border-radius:6px;padding:4px 9px;font:inherit;cursor:pointer">Sign out</button>';
    document.body.appendChild(el);
    document.getElementById("fh-shell-out").addEventListener("click", signOut);
  }

  function boot() {
    getSession().then(function (sess) {
      if (!sess) { location.href = "/login.html?next=/app/" + PAGE; return; }
      var role = String(sess.staff.role || "").toLowerCase();
      var ok = allowedFor(role);
      if (ok.indexOf(PAGE) === -1) {
        location.href = "/app/" + (ok.length > 1 ? ok[1] : ok[0]);
        return;
      }
      gateLinks(ok);
      revealNav();
      mountChip(sess.staff, sess.demo);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

/* When Demo Mode is ON and this screen needs a client id, pick Avery Cobalt
   (primary demo client) so every CRM surface shows populated data — never leave
   sample HTML standing in for a missing id. */
(function () {
  "use strict";
  var PAGE = (location.pathname.split("/").pop() || "").toLowerCase();
  var PARAM =
    PAGE.indexOf("client-control") === 0 ? "id"
      : PAGE.indexOf("documents") === 0 ? "client_id"
        : PAGE.indexOf("finance-os") === 0 ? "client_id"
          : PAGE.indexOf("closer-") === 0 ? "client_id"
            : null;
  if (!PARAM) return;
  var q = new URLSearchParams(location.search);
  if (q.get(PARAM) || q.get("id") || q.get("client_id")) return;

  /* api/demo/mode.mjs is owner/admin only. Every other staff role got a 403 +
     console error here on five screens (Fable audit ticket 1, 2026-08-17).
     Same gate shell.js mountDemoBanner uses; fh_role is written by login.html. */
  var role = "";
  try { role = String(localStorage.getItem("fh_role") || "").trim().toLowerCase(); } catch (e) { role = ""; }
  if (role !== "owner" && role !== "admin") return;

  var headers = { Accept: "application/json" };
  try {
    var t = localStorage.getItem("fh_token");
    if (t) headers.Authorization = "Bearer " + t;
  } catch (e) { /* ignore */ }

  fetch("/api/demo/mode", { credentials: "same-origin", headers: headers })
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
    .then(function (x) {
      if (!x.ok || !x.j || !x.j.demo_mode_enabled || !x.j.primary_client_id) return;
      var next = new URL(location.href);
      next.searchParams.set(PARAM, x.j.primary_client_id);
      location.replace(next.toString());
    })
    .catch(function () { /* leave empty — honest empty better than sample flash */ });
})();

/* Fundhub app data layer — the one place a screen asks for real records.
 *
 * Every call resolves; none reject. A screen that asks for data it cannot get
 * keeps whatever it already rendered, so a backend outage degrades to the
 * built-in sample markup rather than to a blank page.
 *
 * The return shape is always { ok, source, data, error }:
 *   ok:false source:"unauthorized" — signed out, or the session is stale
 *   ok:false source:"nodb"         — API answered, database did not
 *   ok:false source:"offline"      — /api/* is not deployed or unreachable
 *   ok:true  source:"api"          — real rows
 *
 * Screens must branch on `ok` and never assume `data` is populated. See
 * client-control-panel.html for the reference wiring.
 */
window.FHData = (function () {
  "use strict";

  function token() {
    try { return localStorage.getItem("fh_token") || ""; } catch (e) { return ""; }
  }

  // Signing in through demo mode stores a sentinel token; it is not a real
  // credential and must not be presented as one.
  function isDemo() {
    try { return localStorage.getItem("fh_demo") === "1"; } catch (e) { return false; }
  }

  function fail(source, error) {
    return { ok: false, source: source, data: null, error: error };
  }

  function get(path) {
    if (isDemo()) {
      return Promise.resolve(fail("demo", "demo session — no backend read attempted"));
    }
    var t = token();
    return fetch(path, {
      headers: t ? { accept: "application/json", authorization: "Bearer " + t }
                 : { accept: "application/json" }
    }).then(function (r) {
      if (r.status === 404) return fail("offline", "/api/* not deployed");
      if (r.status === 401 || r.status === 403) return fail("unauthorized", "not signed in");
      return r.json().then(function (d) {
        if (r.status === 503 || (d && d.db === "down")) {
          return fail("nodb", (d && d.error) || "database unreachable");
        }
        if (!d || d.ok !== true) return fail("nodb", (d && d.error) || "request failed");
        return { ok: true, source: "api", data: d, error: null };
      }).catch(function () {
        return fail("offline", "response was not JSON");
      });
    }).catch(function (e) {
      return fail("offline", (e && e.message) || "network error");
    });
  }

  return {
    /* GET /api/dashboard/clients → data.clients[] */
    clients: function (limit) {
      return get("/api/dashboard/clients?limit=" + encodeURIComponent(limit || 200));
    },
    /* GET /api/dashboard/client?id= → data.client, .transactions, .crs_results,
       .messages, .tasks */
    client: function (id) {
      if (!id) return Promise.resolve(fail("nodata", "no client id in the URL"));
      return get("/api/dashboard/client?id=" + encodeURIComponent(id));
    },
    /* GET /api/dashboard/pipeline → data.stages[] with .cards[], each stage
       carrying its own count and money so a column can never disagree with
       the cards under it. */
    pipeline: function (key) {
      return get("/api/dashboard/pipeline?key=" + encodeURIComponent(key || "sales"));
    },
    /* GET /api/tasks → data.tasks[] */
    tasks: function (opts) {
      var o = opts || {};
      var q = "?done=" + (o.done === true ? "true" : "false");
      if (o.clientId) q += "&client_id=" + encodeURIComponent(o.clientId);
      return get("/api/tasks" + q);
    },
    /* The query string is how a screen is told which record to show. */
    param: function (name) {
      try { return new URLSearchParams(location.search).get(name); } catch (e) { return null; }
    }
  };
})();

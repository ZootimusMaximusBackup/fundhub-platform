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
    /* GET /api/tasks?role= / ?mine=1 — the role queues from 041. */
    taskQueue: function (opts) {
      var o = opts || {};
      var q = "?done=" + (o.done === true ? "true" : "false");
      if (o.role) q += "&role=" + encodeURIComponent(o.role);
      if (o.mine) q += "&mine=1";
      if (o.unclaimed) q += "&unclaimed=1";
      if (o.limit) q += "&limit=" + encodeURIComponent(o.limit);
      return get("/api/tasks" + q);
    },

    /* The Unit 9 read endpoints. Each returns { ok, items, count, limit,
       offset, hasMore } — read() unwraps to the same { ok, source, data }
       shape as everything else so a screen branches once. */
    read: function (resource, params) {
      var q = [];
      var o = params || {};
      for (var k in o) {
        if (Object.prototype.hasOwnProperty.call(o, k) && o[k] != null && o[k] !== "") {
          q.push(encodeURIComponent(k) + "=" + encodeURIComponent(o[k]));
        }
      }
      return get("/api/read/" + resource + (q.length ? "?" + q.join("&") : ""));
    },

    commissions:     function (p) { return this.read("commissions", p); },
    invoices:        function (p) { return this.read("invoices", p); },
    documents:       function (p) { return this.read("documents", p); },
    fundingRounds:   function (p) { return this.read("funding-rounds", p); },
    affiliates:      function (p) { return this.read("affiliates", p); },
    partners:        function (p) { return this.read("partners", p); },
    messageTemplates:function (p) { return this.read("message-templates", p); },
    staff:           function (p) { return this.read("staff", p); },
    entitlements:    function (p) { return this.read("entitlements", p); },
    failedEvents:    function (p) { return this.read("failed-events", p); },

    /* The query string is how a screen is told which record to show. */
    param: function (name) {
      try { return new URLSearchParams(location.search).get(name); } catch (e) { return null; }
    },

    /* ---------------------------------------------------------------------
       banner — the one place a screen says where its numbers came from.
       Duplicated by hand in the first two wired screens; hoisted here so the
       remaining nineteen cannot drift from it.

         real   mint  — these are database rows
         sample peach — built-in sample markup, backend not queried (demo)
         error  rose  — backend could not answer; sample markup retained

       RULE: a screen NEVER blanks. It keeps its sample markup and says so.
       --------------------------------------------------------------------- */
    _parts: {},
    banner: function (tone, text, key) {
      var TONE = { real: "#A8D8B0", sample: "#F5CE8F", error: "#F2A69B" };
      var el = document.getElementById("fh-data-banner");
      if (!el) {
        el = document.createElement("div");
        el.id = "fh-data-banner";
        el.setAttribute("role", "status");
        document.body.appendChild(el);
      }

      /* A screen can have MORE THAN ONE data source, and the first version of
         this let them overwrite each other — products-commissions reported its
         ledger and silently dropped the product ladder, because whichever
         wire() resolved last won. Each source now keys its own part and the
         banner shows all of them, with the worst tone winning: one failed read
         must not be hidden behind another that succeeded. */
      this._parts[key || text] = { tone: tone, text: text };
      var parts = Object.keys(this._parts).map(function (k) { return this._parts[k]; }, this);
      var RANK = { error: 0, sample: 1, real: 2 };
      var worst = parts.reduce(function (a, p) {
        return RANK[p.tone] < RANK[a] ? p.tone : a; }, "real");
      tone = worst;
      text = parts.map(function (p) { return p.text; }).join("  ·  ");

      el.style.cssText =
        "position:fixed;left:0;right:0;bottom:0;z-index:2147482000;padding:7px 14px;" +
        "background:" + (TONE[tone] || TONE.error) + ";color:#0A0A0A;" +
        "font:600 11px/1.4 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.05em;text-align:center";
      el.textContent = text;
      return el;
    },

    /* explain — turn a failed read into the right banner, once, so nineteen
       screens do not each invent their own wording for "no backend". */
    explain: function (res, what) {
      if (res && res.source === "demo") {
        this.banner("sample", "sample " + what + " — demo session, the backend was not queried", what);
      } else if (res && res.source === "unauthorized") {
        this.banner("error", "sample " + what + " — not signed in for real data", what);
      } else {
        this.banner("error", "sample " + what + " — backend unavailable (" +
          ((res && res.source) || "unknown") + ": " + ((res && res.error) || "no detail") + ")", what);
      }
    },

    /* wire — the whole flow for a screen: fetch, hand rows to paint(), and on
       failure leave the markup alone and say why.

       THREE outcomes, not two, and conflating the last two is a lie the first
       version of this told: a read that SUCCEEDS but returns no rows is not a
       backend failure. An empty documents table on a fresh database is correct,
       and reporting "backend unavailable" for it sends someone hunting a
       connection problem that does not exist.

         paint() returns a string  → real   (rows rendered)
         paint() returns falsy     → empty  (read fine, nothing to show)
         res.ok false / threw      → error/sample (per explain())            */
    wire: function (promise, what, paint) {
      var self = this;
      return promise.then(function (res) {
        if (res && res.ok) {
          var note = null;
          try { note = paint(res.data); }
          catch (e) { self.banner("error", "sample " + what + " — render failed: " + e.message, what); return; }
          if (note) { self.banner("real", note, what); return; }
          // Connected, queried, nothing there. Sample markup stays on screen so
          // the layout still reads, and the banner says exactly that.
          self.banner("sample", "no " + what + " in the database yet — showing sample markup", what);
          return;
        }
        self.explain(res, what);
      }).catch(function (e) {
        self.banner("error", "sample " + what + " — " + (e && e.message ? e.message : "read failed"), what);
      });
    }
  };
})();

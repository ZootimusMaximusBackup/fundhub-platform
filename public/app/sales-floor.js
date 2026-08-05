/* sales-floor.js — manager floor from /api/read/sales-floor + marketing flag */
(function () {
  "use strict";

  function $(sel) { return document.querySelector(sel); }
  function money(cents) {
    if (cents == null || !Number.isFinite(Number(cents))) return "—";
    return (Number(cents) / 100).toLocaleString("en-US", {
      style: "currency", currency: "USD", maximumFractionDigits: 0
    });
  }
  function pct(r) {
    if (r == null || !Number.isFinite(Number(r))) return "—";
    return Math.round(Number(r) * 100) + "%";
  }
  function elapsed(ms) {
    if (!ms) return "";
    var m = Math.floor(ms / 60000);
    var h = Math.floor(m / 60);
    m = m % 60;
    return h ? (h + "h " + m + "m") : (m + "m");
  }

  var state = { data: null };

  function paint(d) {
    state.data = d;
    var onShift = (d.closers || []).filter(function (c) { return c.on_shift; }).length;
    var chip = $("header .hl .chip");
    if (chip) {
      chip.className = "chip on";
      chip.innerHTML = '<span class="cd"></span>' + onShift + " closers on shift";
    }

    var hero = d.hero || {};
    var bigs = document.querySelectorAll(".hero .big");
    if (bigs[0]) bigs[0].textContent = hero.cash_display || money(hero.cash_cents);
    if (bigs[1]) bigs[1].textContent = pct(hero.deposit_to_funded);
    var subs = document.querySelectorAll(".hero .sub");
    if (subs[0]) {
      subs[0].textContent = hero.target_display
        ? ("Target " + hero.target_display)
        : (hero.target_reason || "No team target set");
    }
    if (subs[1]) {
      var n = hero.deposit_to_funded_n || {};
      subs[1].textContent = (n.funded != null ? n.funded + " of " + n.deposits + " deposits funded" : "Of deposits taken this period");
    }
    var bar = $(".hero .bar i");
    if (bar && hero.target_cents) {
      bar.style.width = Math.min(100, Math.round((hero.cash_cents || 0) / hero.target_cents * 100)) + "%";
    } else if (bar) bar.style.width = "0%";

    var funnel = d.funnel || {};
    var fs = document.querySelectorAll(".funnel .f");
    function fset(i, label, val, cv) {
      var el = fs[i]; if (!el) return;
      var lb = el.querySelector(".lb"); var vl = el.querySelector(".vl"); var c = el.querySelector(".cv");
      if (lb) lb.textContent = label;
      if (vl) vl.textContent = val;
      if (c) c.innerHTML = cv || "&nbsp;";
    }
    fset(0, "Booked", String(funnel.booked != null ? funnel.booked : "—"), "");
    fset(1, "Held", String(funnel.held != null ? funnel.held : "—"),
      funnel.show_rate != null ? ('<span class="' + (funnel.show_rate < 0.75 ? "dn" : "") + '">' + pct(funnel.show_rate) + " show</span>") : "");
    fset(2, "Deposits", String(funnel.deposits != null ? funnel.deposits : "—"),
      funnel.close_rate != null ? (pct(funnel.close_rate) + " of held") : "");
    fset(3, "Funded", String(funnel.funded != null ? funnel.funded : "—"),
      funnel.funded_of_deposits != null ? ('<span class="' + (funnel.funded_of_deposits < 0.7 ? "dn" : "") + '">' + pct(funnel.funded_of_deposits) + " of deposits</span>") : "");
    fset(4, "Downsells", String(funnel.downsells != null ? funnel.downsells : "—"),
      funnel.downsell_cash_display || money(funnel.downsell_cash_cents));

    var say = document.querySelector(".sec .say");
    if (say && funnel.deposits != null && funnel.funded != null) {
      var gap = funnel.deposits - funnel.funded;
      say.innerHTML = gap > 0
        ? ("<b>The leak is after the sale, not before it.</b> " + gap +
          " deposits haven't funded. Deposit-to-funded is the failure mode this screen exists to catch.")
        : "<b>Deposits are funding.</b> Keep pressure on show rate and belief spikes below.";
    }

    // Roster
    var rost = $(".rost");
    if (rost) {
      var head = rost.querySelector(".rhead");
      var rows = (d.closers || []).map(function (c) {
        return '<div class="rrow">' +
          '<span class="nm"><b>' + (c.name || "Closer") + "</b><em>" +
          (c.on_shift ? ("On shift · " + elapsed(c.shift_elapsed_ms)) : "Off shift") +
          "</em></span>" +
          '<span class="num c2">' + (c.calls != null ? c.calls : "—") + "</span>" +
          '<span class="num">' + pct(c.close_rate) + "</span>" +
          '<span class="num c4">' + pct(c.funded_rate) + "</span>" +
          '<span class="num c5">' + (c.cash_display || money(c.cash_cents)) + "</span>" +
          '<span class="act"><b>' + (c.action || "") + "</b></span></div>";
      }).join("") || '<div class="rrow"><span class="nm"><b>No active closers</b><em>Staff with role=closer will appear here</em></span></div>';
      rost.querySelectorAll(".rrow").forEach(function (n) { n.remove(); });
      if (head) head.insertAdjacentHTML("afterend", rows);
    }

    // Beliefs
    var beliefs = (d.beliefs && d.beliefs.beliefs) || [];
    var beliefPanel = null;
    document.querySelectorAll(".panel h3").forEach(function (h) {
      if (/belief failed/i.test(h.textContent || "")) beliefPanel = h.parentElement;
    });
    if (beliefPanel) {
      var max = Math.max(1, ...beliefs.map(function (b) { return b.this_count || 0 }));
      var html = beliefs.map(function (b) {
        var hot = (b.this_count || 0) > (b.last_count || 0) && (b.this_count || 0) >= 3;
        var w = Math.round(((b.this_count || 0) / max) * 100);
        return '<div class="ob"><div class="obt"><span>' + (b.label || b.belief) +
          "</span><em>" + (b.this_count || 0) + " · was " + (b.last_count || 0) +
          '</em></div><div class="obb' + (hot ? " hot" : "") + '"><i style="width:' + w + '%"></i></div></div>';
      }).join("") || '<p class="note">No belief_failed values logged yet — dispositions with a belief will fill this.</p>';
      beliefPanel.querySelectorAll(".ob, .say").forEach(function (n) { n.remove(); });
      beliefPanel.insertAdjacentHTML("beforeend", html);
      beliefPanel.insertAdjacentHTML("beforeend",
        '<p class="say"><b>This period vs last period.</b> A count alone is not a trend — the second number is last period.</p>');
    }

    // Sources
    var sourcePanel = null;
    document.querySelectorAll(".panel h3").forEach(function (h) {
      if (/coming from/i.test(h.textContent || "")) sourcePanel = h.parentElement;
    });
    if (sourcePanel) {
      var sources = (d.beliefs && d.beliefs.sources) || [];
      var headHtml = '<div class="rhead" style="grid-template-columns:1.5fr 60px 60px 62px;border-radius:7px;margin-bottom:2px">' +
        "<span>Source</span><span class=\"num\">Held</span><span class=\"num\">Close</span><span class=\"num\">Desire</span></div>";
      var rowsHtml = sources.slice(0, 8).map(function (s) {
        return '<div class="rrow" style="grid-template-columns:1.5fr 60px 60px 62px;padding:10px 0">' +
          '<span class="nm"><b>' + (s.lead_source || "unknown") + "</b><em>setter " + (s.setter_key || "—") +
          "</em></span>" +
          '<span class="num">' + (s.held || 0) + "</span>" +
          '<span class="num">' + pct(s.close_rate) + "</span>" +
          '<span class="num">' + (s.desire || 0) + "</span></div>";
      }).join("") || '<p class="note">No source cuts yet — need dispositions joined to utm_campaign / setter.</p>';
      // Clear dynamic bits but keep flag button area rebuilt
      sourcePanel.querySelectorAll(".rhead, .rrow, .flagbox, button, p.note, p.say").forEach(function (n) {
        if (n.tagName === "H3") return;
        n.remove();
      });
      // Remove everything after h3
      while (sourcePanel.children.length > 1) sourcePanel.removeChild(sourcePanel.lastChild);
      sourcePanel.insertAdjacentHTML("beforeend", headHtml + rowsHtml);
      sourcePanel.insertAdjacentHTML("beforeend",
        '<div class="flagbox" style="background:rgba(245,206,143,.14);border-left-color:var(--warn)">' +
        "<b>Flag a belief × source pattern to marketing.</b> Stores a row only — nothing is sent externally.</div>" +
        '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">' +
        '<button type="button" id="fh-flag-mkt" style="font-family:var(--sans);font-size:12.5px;padding:7px 13px;border:1px solid var(--ink);background:var(--ink);color:var(--paper);border-radius:7px;cursor:pointer">Flag to marketing</button>' +
        '<button type="button" disabled title="Recordings do not exist yet" style="font-family:var(--sans);font-size:12.5px;padding:7px 13px;border:1px solid var(--line);background:var(--paper);border-radius:7px;opacity:.5">Pull call recordings</button>' +
        "</div>");
      var btn = $("#fh-flag-mkt");
      if (btn) btn.addEventListener("click", flagMarketing);
    }

    // Compliance honest empty
    document.querySelectorAll(".panel h3").forEach(function (h) {
      if (!/Compliance/i.test(h.textContent || "")) return;
      var panel = h.parentElement;
      var reason = (d.compliance && d.compliance.reason) ||
        "Call recording and transcription do not exist yet.";
      panel.innerHTML = "<h3>Compliance</h3><p class=\"note\">" + reason + "</p>" +
        "<p class=\"note\">Table <code>call_compliance_flags</code> is ready for flagged phrases and missed disclosures.</p>";
    });

    // Cold deals
    document.querySelectorAll(".panel h3").forEach(function (h) {
      if (!/going cold/i.test(h.textContent || "")) return;
      var panel = h.parentElement;
      var cold = d.cold_deals || [];
      var rows = cold.map(function (c) {
        return '<div class="row"><span class="l"><b>' + (c.name || "Client") +
          "</b><em>" + (c.detail || "") + '</em></span><span class="r">' +
          (c.quiet_days || "?") + "d</span></div>";
      }).join("") || '<p class="note">No cold deposits (7+ days quiet, not funded).</p>';
      panel.innerHTML = "<h3>Deals going cold</h3>" + rows;
    });

    // Discipline
    document.querySelectorAll(".panel h3").forEach(function (h) {
      if (!/Floor discipline/i.test(h.textContent || "")) return;
      var panel = h.parentElement;
      var disc = d.discipline || {};
      panel.innerHTML = "<h3>Floor discipline</h3>" +
        '<div class="row"><span class="l"><b>Calls not logged</b><em>Past-due closer tasks without a disposition</em></span>' +
        '<span class="r"><span class="chip ' + ((disc.unlogged_calls || 0) > 0 ? "bad" : "on") +
        '"><span class="cd"></span>' + (disc.unlogged_calls != null ? disc.unlogged_calls : "—") +
        "</span></span></div>" +
        '<div class="row"><span class="l"><b>Shifts started late</b><em>' +
        (disc.shifts_detail && disc.shifts_detail.reason ? disc.shifts_detail.reason :
          (typeof disc.shifts_started_late === "number" ? "" : (disc.shifts_started_late === null ?
            "Needs scheduled shift times — not on shifts table" : ""))) +
        '</em></span><span class="r">—</span></div>' +
        '<div class="row"><span class="l"><b>Follow-ups overdue</b><em>' +
        (disc.followups_reason || "") + '</em></span><span class="r">—</span></div>' +
        '<div class="row"><span class="l"><b>Avg time to log after a call</b><em>' +
        (disc.avg_log_lag_reason || "") + '</em></span><span class="r">—</span></div>';
    });
  }

  async function flagMarketing() {
    var d = state.data;
    if (!d || !window.FHData) return;
    var beliefs = (d.beliefs && d.beliefs.beliefs) || [];
    var top = beliefs[0];
    var sources = (d.beliefs && d.beliefs.sources) || [];
    var src = sources[0];
    if (!top || !top.belief) {
      alert("No belief data to flag yet.");
      return;
    }
    var body = {
      belief: top.belief,
      lead_source: src && src.lead_source,
      setter_label: src && src.setter_key,
      outcome_count: top.this_count || 0,
      period_start: d.period && d.period.start,
      period_end: d.period && d.period.end,
      note: "Flagged from sales floor — " + (top.label || top.belief) +
        " this period " + (top.this_count || 0) + " vs last " + (top.last_count || 0)
    };
    var r = await window.FHData.write("/api/marketing-flags", body);
    if (!r.ok) {
      alert((r.error && (r.error.message || r.error)) || "Could not store flag");
      return;
    }
    alert("Stored for marketing routing. Nothing was sent externally.");
  }

  async function boot() {
    if (!window.FHData) return;
    var r = await window.FHData.read("sales-floor");
    if (!r.ok) {
      var stage = document.querySelector(".shell") || document.body;
      var note = document.createElement("p");
      note.className = "note";
      note.setAttribute("data-fh-gate", "sales-floor");
      note.style.padding = "16px 22px";
      note.textContent = r.source === "unauthorized"
        ? "Forbidden — the sales floor is for sales managers and owners. Closers are refused."
        : ((r.error && (r.error.message || r.error)) ||
          ("Could not load sales floor (" + r.source + ")."));
      stage.prepend(note);
      return;
    }
    paint(r.data);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

/* closer-call.js — wire the call cockpit to /api/read/closer-call + disposition POST. */
(function () {
  "use strict";

  var clientId = window.__FH_CLIENT_ID;
  var state = {
    outcome: null,
    belief: null,
    taskId: null,
    transactionId: null,
    saving: false,
    data: null
  };

  function $(sel) { return document.querySelector(sel); }
  function text(el, v) { if (el) el.textContent = v == null || v === "" ? "—" : String(v); }
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

  function setEmpty(reason) {
    var main = $(".stage main") || $(".stage");
    if (!main) return;
    var note = document.createElement("p");
    note.className = "note";
    note.style.cssText = "padding:16px 22px;color:#52525B";
    note.textContent = reason;
    main.prepend(note);
  }

  function paint(data) {
    state.data = data;
    var staff = data.staff || {};
    var kpis = data.kpis || {};
    var client = data.client || {};
    var credit = data.credit || {};
    var precall = data.precall || {};
    var deal = data.deal || {};

    text($("header .hl .eyebrow"), "C-01 / Closer");
    var shiftChip = $("header .hl .chip");
    if (shiftChip) {
      if (staff.shift && staff.shift.on_shift) {
        shiftChip.className = "chip on";
        shiftChip.innerHTML = '<span class="cd"></span>On shift · ' + elapsed(staff.shift.elapsed_ms);
      } else {
        shiftChip.className = "chip";
        shiftChip.innerHTML = '<span class="cd"></span>' + (staff.shift && staff.shift.reason ? staff.shift.reason : "Off shift");
      }
    }
    var nameChip = $("header .hr .chip");
    if (nameChip) nameChip.innerHTML = '<span class="cd" style="background:var(--info)"></span>' + (staff.name || "Closer");

    var kpiEls = document.querySelectorAll(".kpis .kpi");
    function kpi(i, label, value, sub) {
      var el = kpiEls[i];
      if (!el) return;
      var lb = el.querySelector(".lb"); var vl = el.querySelector(".vl"); var sb = el.querySelector(".sb");
      if (lb) lb.textContent = label;
      if (vl) vl.textContent = value;
      if (sb) sb.textContent = sub || "";
    }
    var today = kpis.cash_today_cents || {};
    kpi(0, "Cash today", today.display || money(today.cents), (today.deposits || 0) + " deposits");
    kpi(1, "Calls held", String(kpis.calls_held != null ? kpis.calls_held : "—"), (kpis.no_shows || 0) + " no-shows");
    kpi(2, "Close rate", pct(kpis.close_rate), "this month");
    kpi(3, "Commission MTD", "—", kpis.commission_reason || "see My numbers");
    kpi(4, "Pace to target", "—", "target from staff_targets on My numbers");
    kpi(5, "Unlogged", String(kpis.unlogged != null ? kpis.unlogged : "—"), "clear before next call");
    if (kpiEls[5] && kpis.unlogged > 0) kpiEls[5].querySelector(".vl").style.color = "#C25B4E";

    text($(".who h1"), client.name);
    var meta = client.business_name || "";
    if (client.age_months != null) meta += (meta ? " · " : "") + client.age_months + " mo in business";
    if (client.pipeline) meta += (meta ? " · " : "") + (client.pipeline.stage_name || client.pipeline.stage_key);
    text($(".who .meta"), meta || "—");

    // Funding bands — filled from underwrite live fetch below; placeholders honest.
    var bands = document.querySelectorAll(".bands .band");
    bands.forEach(function (b) {
      var bv = b.querySelector(".bv");
      var bn = b.querySelector(".bn");
      if (bv) bv.textContent = "—";
      if (bn) bn.textContent = "Waiting on UnderwriteIQ";
    });
    var lever = $(".lever");
    if (lever) lever.textContent = "Projections load from /api/read/underwrite. Matched lenders: " +
      (data.underwrite && data.underwrite.matched_lenders != null ? data.underwrite.matched_lenders : "—") +
      (data.underwrite && data.underwrite.lenders_reason ? " — " + data.underwrite.lenders_reason : "");

    // Credit panel
    var tables = document.querySelectorAll(".panel table");
    if (tables[0]) {
      if (!credit.available) {
        tables[0].innerHTML = "<tr><td colspan='2'>" + (credit.reason || "No credit pull") + "</td></tr>";
      } else {
        var rows = "";
        if (credit.scores) rows += "<tr><td>Scores</td><td class='hi'>" + JSON.stringify(credit.scores).slice(0, 80) + "</td></tr>";
        rows += "<tr><td>Utilization</td><td>" + (credit.utilization != null ? credit.utilization + "%" : "—") + "</td></tr>";
        rows += "<tr><td>Inquiries · 6mo</td><td>" + (credit.inquiries_6mo != null ? credit.inquiries_6mo : "—") + "</td></tr>";
        rows += "<tr><td>Derogatories</td><td>" + (credit.derogatories != null ? credit.derogatories : "—") + "</td></tr>";
        rows += "<tr><td>Pulled</td><td>" + (credit.pulled_at ? new Date(credit.pulled_at).toLocaleString() : "—") + "</td></tr>";
        tables[0].innerHTML = rows;
      }
    }
    if (tables[1]) {
      var pay = deal.latest_payment;
      state.transactionId = pay && pay.transaction_id;
      tables[1].innerHTML =
        "<tr><td>Latest payment on file</td><td class='hi'>" + (pay ? pay.amount_display : "—") + "</td></tr>" +
        "<tr><td>Product</td><td>" + (pay && pay.product_name ? pay.product_name : "—") + "</td></tr>" +
        "<tr><td>Success fee</td><td>" + ((deal.success_fee_percent || 0.1) * 100) + "%</td></tr>" +
        "<tr><td colspan='2' style='text-align:left;color:var(--gray)'>" + (deal.success_fee_note || "") + "</td></tr>";
    }

    // Precall
    var ctx = $(".ctx");
    if (ctx) {
      var h3 = ctx.querySelector("h3");
      if (h3) h3.textContent = (precall.conversation_count || 0) + " messages on file";
      var p = ctx.querySelector("p");
      if (p) p.textContent = precall.summary || "No conversation summary on file yet.";
      var cells = ctx.querySelectorAll(".ctxg div b");
      if (cells[0]) cells[0].textContent = precall.wants != null ? String(precall.wants) : "—";
      if (cells[1]) cells[1].textContent = precall.purpose || "—";
      if (cells[2]) cells[2].textContent = precall.guessed_fico || "—";
      if (cells[3]) cells[3].textContent = precall.last_message_at
        ? new Date(precall.last_message_at).toLocaleString() : "—";
      var flag = ctx.querySelector(".flag");
      if (flag) {
        flag.textContent = precall.lead_source
          ? ("Lead source: " + precall.lead_source + (precall.setter_key ? " · setter " + precall.setter_key : ""))
          : "Lead source not on file.";
      }
    }

    // Up next / gone quiet
    var sections = document.querySelectorAll("aside.rail section");
    if (sections[0]) {
      var next = (data.up_next || []).map(function (u) {
        var t = u.due_at ? new Date(u.due_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—";
        return '<div class="q"><span class="t">' + t + "</span><div><b>" + (u.name || "Client") +
          "</b><em>" + (u.title || "") + "</em></div></div>";
      }).join("") || '<div class="q"><span class="t">—</span><div><b>No upcoming booked calls</b><em>Calendar tasks with due times will show here</em></div></div>';
      sections[0].querySelectorAll(".q").forEach(function (n) { n.remove(); });
      sections[0].insertAdjacentHTML("beforeend", next);
    }
    if (sections[1]) {
      var quiet = ((data.gone_quiet && data.gone_quiet.quiet_deposits) || []).map(function (u) {
        return '<div class="q"><span class="t">' + (u.quiet_days || "?") + "d</span><div><b>" + (u.name || "Client") +
          "</b><em>" + money(u.cash_collected_cents) + " deposit</em></div></div>";
      }).join("") || '<div class="q"><span class="t">—</span><div><b>None quiet</b><em>Deposits over 7 days without funding</em></div></div>';
      sections[1].querySelectorAll(".q").forEach(function (n) { n.remove(); });
      sections[1].insertAdjacentHTML("beforeend", quiet);
    }

    // Remap objection row to seven beliefs
    var logrows = document.querySelectorAll(".logbar .logrow");
    if (logrows[1]) {
      logrows[1].innerHTML =
        '<span class="lbl">Belief failed</span>' +
        ["pain", "doubt", "cost", "desire", "money", "support", "trust"].map(function (b) {
          return '<button type="button" data-belief="' + b + '">' + b + "</button>";
        }).join("") +
        '<button type="button" data-belief="none">None</button>';
    }
    // Outcome hotkeys
    var outcomes = ["deposit", "downsell", "callback", "no_show", "not_a_fit"];
    var labels = ["Deposit", "Downsell", "Callback", "No show", "Not a fit"];
    if (logrows[0]) {
      logrows[0].innerHTML = '<span class="lbl">Outcome</span>' +
        outcomes.map(function (o, i) {
          return '<button type="button" data-outcome="' + o + '"><span class="hk">' + (i + 1) +
            "</span>" + labels[i] + "</button>";
        }).join("");
    }
    var foot = $(".logbar .foot");
    if (foot) {
      foot.innerHTML = "<span>Cash comes from the payment record — never typed. Recording/transcript not available yet.</span>" +
        '<button class="k" type="button" id="fh-save-next">Save · next call</button>';
    }

    wireDisposition();
  }

  function wireDisposition() {
    document.querySelectorAll("[data-outcome]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.outcome = btn.getAttribute("data-outcome");
        document.querySelectorAll("[data-outcome]").forEach(function (b) { b.classList.remove("k"); });
        btn.classList.add("k");
      });
    });
    document.querySelectorAll("[data-belief]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.belief = btn.getAttribute("data-belief");
        document.querySelectorAll("[data-belief]").forEach(function (b) { b.classList.remove("k"); });
        btn.classList.add("k");
      });
    });
    var save = $("#fh-save-next");
    if (save) save.addEventListener("click", saveOutcome);
    document.addEventListener("keydown", function (ev) {
      if (ev.target && /input|textarea|select/i.test(ev.target.tagName)) return;
      var n = Number(ev.key);
      if (n >= 1 && n <= 5) {
        var btn = document.querySelector('[data-outcome]')
          ? document.querySelectorAll("[data-outcome]")[n - 1] : null;
        if (btn) btn.click();
      }
    });
  }

  async function saveOutcome() {
    if (state.saving) return;
    if (!clientId) { alert("No client on this call."); return; }
    if (!state.outcome) { alert("Pick an outcome (keys 1–5) before the next call."); return; }
    state.saving = true;
    try {
      var body = {
        client_id: clientId,
        outcome: state.outcome,
        belief_failed: state.belief === "none" ? null : state.belief,
        task_id: state.taskId,
        transaction_id: state.transactionId
      };
      var r = await window.FHData.write("/api/call-outcomes", body);
      if (!r.ok) {
        alert((r.error && r.error.message) || r.error || "Could not save outcome");
        return;
      }
      try { sessionStorage.removeItem("fh_pending_disposition"); } catch (e) {}
      var next = (state.data && state.data.up_next && state.data.up_next[0]);
      if (next && next.client_id) {
        location.href = "closer-call.html?client_id=" + encodeURIComponent(next.client_id) +
          (next.task_id ? "&task_id=" + encodeURIComponent(next.task_id) : "");
      } else {
        location.href = "my-numbers.html";
      }
    } finally {
      state.saving = false;
    }
  }

  async function loadUnderwrite() {
    if (!clientId || !window.FHData) return;
    var r = await window.FHData.read("underwrite", { client_id: clientId });
    if (!r.ok || !r.data) return;
    var d = r.data;
    var bands = document.querySelectorAll(".bands .band");
    // Engine report shapes vary — prefer named projection fields when present.
    var cons = d.conservative_cents || d.projections && d.projections.conservative;
    var real = d.realistic_cents || d.projections && d.projections.realistic;
    var opt = d.optimized_cents || d.projections && d.projections.optimized;
    function setBand(i, cents, note) {
      var b = bands[i]; if (!b) return;
      var bv = b.querySelector(".bv"); var bn = b.querySelector(".bn");
      if (cents == null) {
        if (bv) bv.textContent = "—";
        if (bn) bn.textContent = note || "Not in UnderwriteIQ response";
      } else {
        if (bv) bv.textContent = money(typeof cents === "number" && cents > 100000 ? cents : Number(cents) * (cents < 1000 ? 100 : 1));
        // If already cents (>1000 typically for funding), money() expects cents.
        if (bv && typeof cents === "number") bv.textContent = money(cents > 1000 ? cents : Math.round(cents * 100));
        if (bn) bn.textContent = note || "";
      }
    }
    // Prefer report suggestion numbers if present as dollars in strings — else honest empty.
    var report = d;
    var has = report.funding || report.capacity || report.projections;
    if (!has) {
      setBand(0, null, "UnderwriteIQ loaded — no conservative band field");
      setBand(1, null, "Open Client Control Panel for the full report");
      setBand(2, null, "Optimization path not a numbered field on this payload");
      var lever = $(".lever");
      if (lever && Array.isArray(report.suggestions)) {
        lever.textContent = report.suggestions.slice(0, 2).map(function (s) {
          return typeof s === "string" ? s : (s.text || s.sentence || "");
        }).filter(Boolean).join(" ") || "See underwrite suggestions on the client file.";
      }
      return;
    }
    setBand(0, cons, "Conservative");
    setBand(1, real, "Realistic");
    setBand(2, opt, "After optimization");
  }

  async function boot() {
    if (!window.FHData) { setEmpty("data.js failed to load"); return; }
    if (!clientId) {
      setEmpty("Pick a client from the pipeline to open the call cockpit.");
      return;
    }
    try { sessionStorage.setItem("fh_pending_disposition", clientId); } catch (e) {}
    var q = new URLSearchParams(location.search);
    state.taskId = q.get("task_id") || null;

    var r = await window.FHData.read("closer-call", { client_id: clientId });
    if (!r.ok) {
      setEmpty((r.error && (r.error.message || r.error)) || ("Could not load cockpit (" + r.source + ")"));
      return;
    }
    paint(r.data);
    loadUnderwrite();

    var join = document.querySelector(".who button.k");
    if (join) {
      join.addEventListener("click", function () {
        var next = (state.data && state.data.up_next && state.data.up_next[0]);
        // Prefer meeting_url on current task if we had one — open calendar otherwise.
        location.href = "calendar.html?client_id=" + encodeURIComponent(clientId);
      });
    }
    var present = document.getElementById("fh-present");
    if (present && clientId) {
      present.addEventListener("click", function () {
        location.href = "present.html?contact=" + encodeURIComponent(clientId);
      });
    } else if (present) {
      present.remove();
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

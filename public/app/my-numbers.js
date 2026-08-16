/* my-numbers.js — closer personal performance from /api/read/my-numbers */
(function () {
  "use strict";

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

  function paint(d) {
    var shiftChip = $("#shiftChip") || $("header .hl .chip");
    if (shiftChip) {
      if (d.shift && d.shift.on_shift) {
        shiftChip.className = "chip on";
        shiftChip.innerHTML = '<span class="cd"></span>On shift · ' + elapsed(d.shift.elapsed_ms);
      } else {
        shiftChip.className = "chip";
        shiftChip.innerHTML = '<span class="cd"></span>Off shift';
      }
    }

    var pace = d.pace || {};
    var bigs = document.querySelectorAll(".pace .big");
    if (bigs[0]) bigs[0].textContent = pace.cash_display || money(pace.cash_cents);
    if (bigs[1]) {
      bigs[1].innerHTML = (pace.rank != null ? pace.rank : "—") +
        '<span style="font-size:20px;color:var(--gray2)">/' + (pace.team_size || "—") + "</span>";
    }
    var subs = document.querySelectorAll(".pace .sub");
    if (subs[0]) {
      subs[0].textContent = pace.target_display
        ? ("Target " + pace.target_display)
        : (pace.target_reason || "No monthly target set");
    }
    var bar = $(".pace .bar i");
    if (bar && pace.target_cents) {
      var pctFill = Math.min(100, Math.round((pace.cash_cents || 0) / pace.target_cents * 100));
      bar.style.width = pctFill + "%";
    } else if (bar) {
      bar.style.width = "0%";
    }

    var month = d.month || {};
    var cells = document.querySelectorAll(".grid .m");
    function mset(i, label, val, cmp) {
      var el = cells[i]; if (!el) return;
      var lb = el.querySelector(".lb"); var vl = el.querySelector(".vl"); var c = el.querySelector(".cmp");
      if (lb) lb.textContent = label;
      if (vl) vl.textContent = val;
      if (c) c.innerHTML = cmp || "";
    }
    mset(0, "Deposits closed", String(month.deposits_closed != null ? month.deposits_closed : "—"), "");
    mset(1, "Close rate", pct(month.close_rate), "");
    mset(2, "Show rate", pct(month.show_rate), "");
    mset(3, "Downsells", String(month.downsells != null ? month.downsells : "—"), "");
    mset(4, "Deposit → funded", pct(month.deposit_to_funded), "First-class metric");
    mset(5, "Avg funded", "—", month.avg_funded_reason || "");
    mset(6, "Calls held", String(month.calls_held != null ? month.calls_held : "—"),
      (month.no_shows || 0) + " no-shows");
    mset(7, "Unlogged", String(month.unlogged != null ? month.unlogged : "—"),
      month.unlogged > 0 ? '<span class="dn">Log before the next call</span>' : "");
    if (cells[7] && month.unlogged > 0) cells[7].querySelector(".vl").style.color = "#C25B4E";

    var moneyBox = d.money || {};
    var mos = document.querySelectorAll(".money .mo");
    function mo(i, label, val, sb) {
      var el = mos[i]; if (!el) return;
      text(el.querySelector(".lb"), label);
      text(el.querySelector(".vl"), val);
      text(el.querySelector(".sb"), sb);
    }
    mo(0, "Paid out", moneyBox.paid_display || money(moneyBox.paid_cents), "commission_ledger · paid");
    mo(1, "Pending funding", moneyBox.pending_display || money(moneyBox.pending_cents), "earned/approved");
    mo(2, "At risk", "—", moneyBox.at_risk_reason || "Not computed yet");

    var streakNote = document.querySelectorAll(".sec .note");
    streakNote.forEach(function (n) {
      if (/last 9|record of|streak is not stored/i.test(n.textContent || "")) {
        n.textContent = (d.streak && d.streak.reason) || "Daily close streak is not stored yet.";
      }
    });
    var days = document.querySelector(".days");
    if (days) {
      days.innerHTML = '<div class="d" style="flex:2;justify-content:flex-start;padding:0 10px">' +
        ((d.streak && d.streak.reason) || "Streak needs a working-day calendar — not built") + "</div>";
    }

    var team = d.team || [];
    var panel = document.querySelectorAll(".panel")[0];
    if (panel) {
      var rows = team.map(function (t, i) {
        var me = t.staff_id === d.staff_id;
        return '<div class="lb-row' + (me ? " me" : "") + '">' +
          '<span class="rk' + (i === 0 ? " one" : "") + '">' + String(t.rank).padStart(2, "0") + "</span>" +
          '<span class="nm"><b>' + (me ? "You" : (t.name || "—")) + "</b><em>" +
          (t.deposits || 0) + " deposits</em></span>" +
          '<span class="num">' + (t.cash_display || money(t.cash_cents)) + "</span>" +
          '<span class="num hide">' + pct(t.close_rate) + "</span>" +
          '<span class="num hide">—</span></div>';
      }).join("") || '<p class="note">No closer dispositions logged this month yet.</p>';
      panel.querySelectorAll(".lb-row").forEach(function (n) { n.remove(); });
      panel.querySelectorAll(".note").forEach(function (n) { n.remove(); });
      var h = panel.querySelector("h3");
      if (h) h.insertAdjacentHTML("afterend", rows);
    }

    var qualPanel = document.querySelectorAll(".panel")[1];
    if (qualPanel) {
      var reason = (d.call_quality && d.call_quality.reason) ||
        "Call recording and transcription do not exist yet.";
      qualPanel.innerHTML = "<h3>Call quality</h3><p class=\"note\">" + reason + "</p>" +
        "<p class=\"note\">Compliance phrase counts use the same gate — schema call_compliance_flags is ready.</p>";
    }

    document.querySelectorAll(".todo").forEach(function (n) { n.remove(); });
    var owed = d.owed || [];
    var owedHost = null;
    document.querySelectorAll(".sech .eyebrow").forEach(function (e) {
      if (/Owed/i.test(e.textContent || "")) owedHost = e.closest(".sec");
    });
    if (owedHost) {
      var html = owed.map(function (o) {
        return '<div class="todo"><span class="t">' + (o.urgency || "Now") + "</span><div><b>" +
          (o.title || "") + "</b><em>" + (o.detail || "") + "</em></div></div>";
      }).join("") || '<div class="todo"><span class="t">—</span><div><b>Nothing owed</b><em>Unlogged calls and quiet deposits will land here</em></div></div>';
      var p = owedHost.querySelector(".panel");
      if (p) p.innerHTML = html;
    }
  }

  function paintWho() {
    var nameChip = document.getElementById("staffChip") || $("header .hr .chip");
    if (!nameChip) return;
    var token = "";
    try { token = localStorage.getItem("fh_token") || ""; } catch (e) {}
    fetch("/api/auth/session", {
      headers: token
        ? { accept: "application/json", authorization: "Bearer " + token }
        : { accept: "application/json" }
    }).then(function (r) { return r.json(); }).then(function (s) {
      var name = (s && s.staff && s.staff.name) || "";
      nameChip.innerHTML = '<span class="cd" style="background:var(--info)"></span>' + (name || "—");
    }).catch(function () {
      nameChip.innerHTML = '<span class="cd" style="background:var(--info)"></span>—';
    });
  }

  async function boot() {
    paintWho();
    if (!window.FHData) return;
    var r = await window.FHData.read("my-numbers");
    if (!r.ok) {
      var stage = document.querySelector(".shell") || document.body;
      var note = document.createElement("p");
      note.className = "note";
      note.style.padding = "16px 22px";
      note.textContent = (r.error && (r.error.message || r.error)) ||
        ("Could not load my numbers (" + r.source + ")");
      stage.prepend(note);
      return;
    }
    paint(r.data);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

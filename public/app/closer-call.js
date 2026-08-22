/* closer-call.js — wire Closer Dashboard's live-call tools to the fixed read + disposition POST. */
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
  function paintStaff(staff) {
    var staffName = (staff && staff.name) || "";
    var initials = staffName.trim().split(/\s+/).filter(Boolean).slice(0, 2)
      .map(function (part) { return part.charAt(0).toUpperCase(); }).join("") || "—";
    text(document.getElementById("whoAv"), initials);
    text(document.getElementById("whoName"), staffName);
    text(document.getElementById("whoRole"), (staff && staff.role) || "closer");
  }
  function loadSessionStaff() {
    return fetch("/api/auth/session", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (body) { if (body && body.ok) paintStaff(body.staff || {}); })
      .catch(function () {});
  }
  function money(cents) {
    if (cents == null || !Number.isFinite(Number(cents))) return "—";
    return (Number(cents) / 100).toLocaleString("en-US", {
      style: "currency", currency: "USD", maximumFractionDigits: 0
    });
  }
  function elapsed(ms) {
    if (!ms) return "";
    var m = Math.floor(ms / 60000);
    var h = Math.floor(m / 60);
    m = m % 60;
    return h ? (h + "h " + m + "m") : (m + "m");
  }

  function hideLiveControls() {
    var logbar = document.querySelector(".logbar");
    if (logbar) logbar.hidden = true;
    var present = document.getElementById("fh-present");
    if (present) present.hidden = true;
    var sendBtn = document.getElementById("fh-send-contract");
    if (sendBtn) sendBtn.hidden = true;
  }

  function showLiveControls() {
    var logbar = document.querySelector(".logbar");
    if (logbar) logbar.hidden = false;
    var present = document.getElementById("fh-present");
    if (present) present.hidden = false;
    var sendBtn = document.getElementById("fh-send-contract");
    if (sendBtn) sendBtn.hidden = false;
  }

  function setEmpty(reason, kind) {
    hideLiveControls();
    var h1 = document.getElementById("ccp-who-name");
    var meta = document.getElementById("ccp-who-meta");
    if (h1) h1.textContent = kind === "error" ? "Could not load" : "No call right now";
    if (meta) meta.textContent = reason || "No booked call right now.";
    var sendBtn = document.getElementById("fh-send-contract");
    var sendPanel = document.getElementById("fh-contract-panel");
    if (sendBtn) sendBtn.remove();
    if (sendPanel) sendPanel.remove();
  }

  function paint(data) {
    state.data = data;
    var staff = data.staff || {};
    var client = data.client || {};
    var credit = data.credit || {};
    var precall = data.precall || {};
    var deal = data.deal || {};

    text($("[data-fh-call-head] .eyebrow"), "Live call");
    var shiftChip = $("[data-fh-call-head] .chip");
    if (shiftChip) {
      if (staff.shift && staff.shift.on_shift) {
        shiftChip.className = "chip on";
        shiftChip.innerHTML = '<span class="cd"></span>On shift · ' + elapsed(staff.shift.elapsed_ms);
      } else {
        shiftChip.className = "chip";
        shiftChip.innerHTML = '<span class="cd"></span>' + (staff.shift && staff.shift.reason ? staff.shift.reason : "Off shift");
      }
    }
    var nameChip = $("[data-fh-call-staff]");
    if (nameChip) nameChip.innerHTML = '<span class="cd" style="background:var(--info)"></span>' + (staff.name || "Closer");
    paintStaff(staff);

    text($(".who h1"), client.name);
    var meta = client.business_name || "";
    if (client.age_months != null) meta += (meta ? " · " : "") + client.age_months + " mo in business";
    if (client.pipeline) meta += (meta ? " · " : "") + (client.pipeline.stage_name || client.pipeline.stage_key);
    text($(".who .meta"), meta || "—");
    var calcClient = document.getElementById("calcClientName");
    if (calcClient) {
      text(calcClient, client.name);
      calcClient.hidden = false;
    }
    var dashboardSub = document.querySelector(".topbar .sub");
    if (dashboardSub && client.name) dashboardSub.textContent = "Closer Dashboard · " + client.name;

    // Funding bands come from this same canonical cockpit payload.
    var bands = document.querySelectorAll(".bands .band");
    bands.forEach(function (b) {
      var bv = b.querySelector(".bv");
      var bn = b.querySelector(".bn");
      if (bv) bv.textContent = "—";
      if (bn) bn.textContent = "Waiting on UnderwriteIQ";
    });
    var lever = $(".lever");
    if (lever) {
      var n = data.underwrite && data.underwrite.matched_lenders;
      lever.textContent = (n == null)
        ? "Funding bands stay a dash until the report has a number."
        : (n === 0
          ? "No lenders match this file yet."
          : n + " lender" + (n === 1 ? "" : "s") + " match this file.");
    }
    paintUnderwrite(data.underwrite || {});

    // Credit panel
    var tables = document.querySelectorAll(".panel table");
    if (tables[0]) {
      if (!credit.available) {
        tables[0].innerHTML = "<tr><td colspan='2'>" + (credit.reason || "No credit pull") + "</td></tr>";
      } else {
        var rows = "";
        if (credit.scores && typeof credit.scores === "object") {
          var ex = credit.scores.experian != null ? credit.scores.experian : credit.scores.EX;
          var eq = credit.scores.equifax != null ? credit.scores.equifax : credit.scores.EQ;
          var tu = credit.scores.transunion != null ? credit.scores.transunion : credit.scores.TU;
          if (ex != null || eq != null || tu != null) {
            rows += "<tr><td>Scores</td><td class='hi'>EX " + (ex == null ? "—" : ex) +
              " · EQ " + (eq == null ? "—" : eq) +
              " · TU " + (tu == null ? "—" : tu) + "</td></tr>";
          } else {
            rows += "<tr><td>Scores</td><td class='hi'>—</td></tr>";
          }
        } else {
          rows += "<tr><td>Scores</td><td class='hi'>—</td></tr>";
        }
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

    // Up next
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
    if (logrows.length < 3) {
      var extra = document.createElement("div");
      extra.className = "logrow";
      extra.innerHTML = '<span class="lbl">Repair referral</span>' +
        '<label for="fh-repair-referral"><input type="checkbox" id="fh-repair-referral"> Yes — send to credit repair</label>';
      var logbar = document.querySelector(".logbar");
      var footEl = logbar && logbar.querySelector(".foot");
      if (logbar && footEl) logbar.insertBefore(extra, footEl);
      else if (logbar) logbar.appendChild(extra);
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

  function wireContractSend() {
    var btn = document.getElementById("fh-send-contract");
    var panel = document.getElementById("fh-contract-panel");
    var sel = document.getElementById("fh-contract-tpl");
    var blanks = document.getElementById("fh-contract-blanks");
    var go = document.getElementById("fh-contract-go");
    var copy = document.getElementById("fh-contract-copy");
    var link = document.getElementById("fh-contract-link");
    var msg = document.getElementById("fh-contract-msg");
    if (!btn || !panel) return;
    if (!clientId) {
      btn.remove();
      panel.remove();
      return;
    }
    var wordings = [];
    var lastLink = "";
    function esc(s) {
      return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    }

    function setMsg(t) { if (msg) msg.textContent = t || ""; }

    function selected() {
      var id = sel && sel.value;
      for (var i = 0; i < wordings.length; i++) if (wordings[i].id === id) return wordings[i];
      return null;
    }

    function paintBlanks() {
      if (!blanks) return;
      var t = selected();
      var fields = (t && t.manual_fields) || [];
      if (!fields.length) { blanks.innerHTML = ""; return; }
      blanks.innerHTML = fields.map(function (f) {
        return '<div style="margin-top:10px"><label for="fh-blank-' + esc(f.key) + '" style="display:block;font-family:var(--mono);font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--gray);margin-bottom:5px">' +
          esc(f.label || f.key) + (f.required ? " *" : "") + "</label>" +
          '<input id="fh-blank-' + esc(f.key) + '" data-blank="' + esc(f.key) + '" type="text" style="width:100%;border:1px solid var(--line);border-radius:7px;padding:7px 9px"></div>';
      }).join("");
    }

    function blankValues() {
      var out = {};
      if (!blanks) return out;
      Array.prototype.forEach.call(blanks.querySelectorAll("[data-blank]"), function (el) {
        out[el.getAttribute("data-blank")] = el.value;
      });
      return out;
    }

    function fillSelect(items) {
      wordings = items || [];
      if (!sel) return;
      if (!wordings.length) {
        sel.innerHTML = '<option value="">No wordings in use</option>';
        return;
      }
      sel.innerHTML = wordings.map(function (t) {
        return '<option value="' + esc(t.id) + '">' + esc(t.name || t.template_key || "Wording") + "</option>";
      }).join("");
      paintBlanks();
    }

    btn.addEventListener("click", function () {
      var open = panel.hasAttribute("hidden");
      if (!open) { panel.setAttribute("hidden", ""); return; }
      panel.removeAttribute("hidden");
      setMsg("Loading wordings…");
      if (!window.FHContractSend) { setMsg("Send helper failed to load."); return; }
      window.FHContractSend.listWordings().then(function (r) {
        if (!r.ok) { setMsg(r.error || "Could not load wordings."); return; }
        fillSelect(r.items);
        setMsg(r.items.length ? "Pick a wording, then Send. Copy the link after." : "No wordings in use. Make one on the Contracts page.");
      });
    });
    if (sel) sel.addEventListener("change", paintBlanks);
    if (go) go.addEventListener("click", function () {
      var t = selected();
      if (!t) { setMsg("Pick a wording first."); return; }
      go.disabled = true;
      setMsg("Sending…");
      window.FHContractSend.sendToClient({
        clientId: clientId, templateId: t.id, values: blankValues()
      }).then(function (r) {
        go.disabled = false;
        if (!r.ok) { setMsg(r.error || "Could not send."); return; }
        lastLink = r.link || "";
        if (link) {
          link.value = lastLink;
          link.style.display = lastLink ? "block" : "none";
        }
        if (copy) copy.disabled = !lastLink;
        setMsg(r.message || "Sent. Copy the link and give it to them.");
        if (lastLink) window.FHContractSend.copyText(lastLink);
      });
    });
    if (copy) copy.addEventListener("click", function () {
      if (!lastLink) return;
      window.FHContractSend.copyText(lastLink).then(function (ok) {
        copy.textContent = ok ? "Copied" : "Copy failed";
        setTimeout(function () { copy.textContent = "Copy link"; }, 1400);
      });
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
        transaction_id: state.transactionId,
        checklist: {
          call_recorded: !!(document.getElementById("d1") && document.getElementById("d1").checked),
          personal_guarantee: !!(document.getElementById("d2") && document.getElementById("d2").checked),
          month_14_cliff: !!(document.getElementById("d3") && document.getElementById("d3").checked),
          bank_decides: !!(document.getElementById("d4") && document.getElementById("d4").checked)
        },
        repair_referral: !!(document.getElementById("fh-repair-referral") && document.getElementById("fh-repair-referral").checked)
      };
      var r = await window.FHData.write("/api/call-outcomes", body);
      if (!r.ok) {
        alert((r.error && r.error.message) || r.error || "Could not save outcome");
        return;
      }
      try { sessionStorage.removeItem("fh_pending_disposition"); } catch (e) {}
      var next = (state.data && state.data.up_next && state.data.up_next[0]);
      if (next && next.client_id) {
        location.href = "closer-dashboard.html?client_id=" + encodeURIComponent(next.client_id) +
          (next.task_id ? "&task_id=" + encodeURIComponent(next.task_id) : "");
      } else {
        location.href = "my-numbers.html";
      }
    } finally {
      state.saving = false;
    }
  }

  function paintUnderwrite(uw) {
    var bands = document.querySelectorAll(".bands .band");
    var personal = uw.personal || {};
    var totals = uw.totals || {};
    function dollarsToCents(v) {
      if (v == null || !Number.isFinite(Number(v))) return null;
      return Math.round(Number(v) * 100);
    }
    var cons = dollarsToCents(uw.lite_banner_funding);
    var realDollars = totals.total_personal_funding != null
      ? totals.total_personal_funding
      : personal.total_personal_funding;
    var real = dollarsToCents(realDollars);
    var opt = dollarsToCents(
      totals.total_combined_funding != null ? totals.total_combined_funding : realDollars
    );
    function setBand(i, cents, note) {
      var b = bands[i];
      if (!b) return;
      var bv = b.querySelector(".bv");
      var bn = b.querySelector(".bn");
      if (bv) bv.textContent = cents == null ? "—" : money(cents);
      if (bn) bn.textContent = cents == null ? "Not in UnderwriteIQ response" : note;
    }
    setBand(0, cons, "Conservative");
    setBand(1, real, "Realistic · round 1");
    setBand(2, opt, "After optimization");
  }

  async function resolveClient() {
    if (clientId) return clientId;
    var nowR = await window.FHData.read("closer-now");
    if (!nowR.ok) {
      setEmpty((nowR.error && (nowR.error.message || nowR.error)) ||
        ("Could not load current call (" + nowR.source + ")"), "error");
      return null;
    }
    var cur = nowR.data && nowR.data.current;
    if (!cur || !cur.client_id) {
      setEmpty("No booked call right now.");
      return null;
    }
    clientId = cur.client_id;
    window.__FH_CLIENT_ID = clientId;
    if (cur.task_id && !state.taskId) state.taskId = cur.task_id;
    return clientId;
  }

  async function boot() {
    if (!window.FHData) { setEmpty("data.js failed to load", "error"); return; }
    loadSessionStaff();
    hideLiveControls();
    var q = new URLSearchParams(location.search);
    state.taskId = q.get("task_id") || null;
    var who = await resolveClient();
    if (!who) return;
    try { sessionStorage.setItem("fh_pending_disposition", clientId); } catch (e) {}

    var r = await window.FHData.read("closer-call", { client_id: clientId });
    if (!r.ok) {
      setEmpty((r.error && (r.error.message || r.error)) || ("Could not load cockpit (" + r.source + ")"), "error");
      return;
    }
    paint(r.data);
    showLiveControls();

    var join = document.getElementById("fh-join");
    if (join) {
      var url = (r.data && r.data.join_url) || "";
      if (url) {
        join.disabled = false;
        join.removeAttribute("title");
        join.addEventListener("click", function () {
          window.open(url, "_blank", "noopener");
        });
      } else {
        join.disabled = true;
        join.title = "No call link on this appointment";
      }
    }
    var present = document.getElementById("fh-present");
    if (present && clientId) {
      present.addEventListener("click", function () {
        // New tab so the closer keeps the cockpit and can split-screen the deck.
        window.open(
          "present.html?contact=" + encodeURIComponent(clientId),
          "_blank",
          "noopener,noreferrer"
        );
      });
    } else if (present) {
      present.remove();
    }
    wireContractSend();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

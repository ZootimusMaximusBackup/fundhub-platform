/* partner-training.js — the $10,000 curriculum, read from
   /api/read/partner-training.

   COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): this screen prints whether a partner
   holds the two compliance certifications that stand between them and selling
   under FundHub's brand.

   READ-ONLY, ON PURPOSE. There is not one write on this screen and there must not
   be one. docs/specs/W7-curriculum.md puts a written exam that must miss zero on
   G2, a FundHub closer's score on G3 and roll call on every live session — a
   partner who could tick their own module is a partner with no certification.
   FundHub records progress through /api/training-progress, which is owner/admin
   only.

   WHY IT DOES NOT USE FHData. window.FHData.get() collapses every 401 and 403
   into fail("unauthorized", "not signed in"), and the whole point of this
   endpoint's 403 is that it carries a REASON a partner has to be able to read —
   "your agreement has not been signed yet" is not "you are not signed in". So the
   fetch is written out here, with the same bearer-token handling data.js uses,
   and the body of a refusal is rendered rather than swallowed. */
(function () {
  "use strict";

  function $(sel) { return document.querySelector(sel); }

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function token() {
    try { return localStorage.getItem("fh_token") || ""; } catch (e) { return ""; }
  }

  /* A staff caller must name whose record they are looking at — the endpoint
     answers 400 without it. A PARTNER session is pinned to its own id server
     side and this parameter is ignored for them, so forwarding it is safe. */
  function partnerIdFromUrl() {
    try {
      return new URLSearchParams(location.search).get("partner_id") || "";
    } catch (e) { return ""; }
  }

  /* Arizona, like every other clock in this app (docs/workflows/arizona-time-2026-08-28.md). */
  function whenText(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-US", {
      timeZone: "America/Phoenix", month: "short", day: "numeric", year: "numeric"
    });
  }

  /* THE FIVE STATES A GATE CAN BE IN, AND WHY THERE ARE FIVE.
     "Never assessed" and "sat it and did not clear" are different facts about a
     partner. Merging them into one grey pill would tell somebody who failed an
     exam that they simply had not taken it yet. */
  function gatePill(gate) {
    if (gate.passed) return { cls: "on", label: "Passed" };
    if (gate.outcome === "failed") return { cls: "bad", label: "Not passed yet" };
    if (gate.outcome === "revoked") return { cls: "bad", label: "Taken back" };
    return { cls: "wip", label: "Not assessed" };
  }

  function moduleStatus(m) {
    if (m.status === "complete") return { cls: "on", label: "Done" };
    if (m.status === "attended") return { cls: "wip", label: "Sat, not finished" };
    return { cls: "", label: "Not started" };
  }

  function gateCard(gate) {
    var pill = gatePill(gate);
    return '<div class="gate' + (gate.passed ? " done" : "") + '">' +
      '<div class="gt">' +
        '<span class="gcode">' + esc(gate.code) + "</span>" +
        '<span class="chip ' + pill.cls + '"><span class="cd"></span>' + esc(pill.label) + "</span>" +
      "</div>" +
      "<h4>" + esc(gate.title) + "</h4>" +
      '<p class="gwk">' + (gate.week_due ? "Week " + esc(gate.week_due) : "") +
        (gate.decided_at ? " · " + esc(whenText(gate.decided_at)) : "") + "</p>" +
      // blocks is null when the curriculum has not been seeded for this company.
      // The sentence is W7's and lives in the database, so an empty one prints
      // nothing rather than a sentence this file made up.
      (gate.blocks ? '<p class="gbl">' + esc(gate.blocks) + "</p>" : "") +
      "</div>";
  }

  function moduleRow(m) {
    var st = moduleStatus(m);
    return '<div class="mrow">' +
      '<span class="mno">' + esc(m.code.toUpperCase()) + "</span>" +
      "<span><b>" + esc(m.title) + "</b>" +
        (m.certified ? '<em class="cert">Certified — exam or scored mock</em>' : "") +
      "</span>" +
      // A null week is W7 not saying which week this module runs in. It prints
      // as a dash, never as week 0 or week 1.
      '<span class="mwk" data-l="Week">' + (m.week_no ? "Week " + esc(m.week_no) : "—") + "</span>" +
      '<span class="mgate" data-l="Gate">' + (m.gate_code ? esc(m.gate_code) : "—") + "</span>" +
      '<span class="mst" data-l="Status"><span class="chip ' + st.cls + '">' +
        '<span class="cd"></span>' + esc(st.label) + "</span></span>" +
      "</div>";
  }

  function renderRefusal(message) {
    var box = $("#trBlocked");
    if (box) {
      box.hidden = false;
      box.querySelector(".msg").textContent =
        message || "The training is not open on this account.";
    }
    var body = $("#trBody");
    if (body) body.hidden = true;
  }

  function render(d) {
    $("#trBlocked").hidden = true;
    $("#trBody").hidden = false;

    var done = Number(d.modules_complete || 0);
    var total = Number(d.modules_total || 0);
    $("#trCount").textContent = total ? done + " of " + total + " modules done" : "No curriculum yet";

    var gatesPassed = (d.gates || []).filter(function (g) { return g.passed; }).length;
    $("#trGateCount").textContent = gatesPassed + " of 4 gates passed";

    $("#trGates").innerHTML = (d.gates || []).map(gateCard).join("");

    if (!d.curriculum_seeded) {
      /* "Nobody has set this up" and "you have not started" are different
         messages to send somebody who paid $10,000. */
      $("#trModules").innerHTML =
        '<div class="mmsg">No modules are set up for your company yet. ' +
        "This is FundHub's to fix, not yours.</div>";
    } else {
      $("#trModules").innerHTML = (d.modules || []).map(moduleRow).join("");
    }

    var nm = d.next_module;
    var ng = d.next_gate;
    $("#trNextModule").textContent = nm
      ? nm.title + (nm.week_no ? " · week " + nm.week_no : "")
      : (total ? "Every module is done." : "—");
    $("#trNextGate").textContent = ng
      ? ng.code + " · " + ng.title
      : (d.gates && d.gates.length ? "All four gates are passed." : "—");
    $("#trNextGateBlocks").textContent = ng && ng.blocks ? ng.blocks : "";

    // The one sentence this screen exists to be able to say out loud.
    $("#trSelling").textContent = d.may_sell_unsupervised
      ? "You are released to sell on your own."
      : d.may_sell_supervised
        ? "You may sell on supervised calls. G4 releases you to sell on your own."
        : "You may not sell under FundHub's brand yet. Gates still open: " +
          (d.gates_outstanding || []).join(", ");
  }

  function load() {
    var pid = partnerIdFromUrl();
    var url = "/api/read/partner-training" + (pid ? "?partner_id=" + encodeURIComponent(pid) : "");
    var t = token();
    var headers = t
      ? { accept: "application/json", authorization: "Bearer " + t }
      : { accept: "application/json" };

    fetch(url, { headers: headers })
      .then(function (r) {
        return r.json().then(function (d) { return { status: r.status, body: d }; })
          .catch(function () { return { status: r.status, body: null }; });
      })
      .then(function (res) {
        var d = res.body;
        if (res.status === 200 && d && d.ok) return render(d);
        if (res.status === 403 && d && d.error === "not_entitled") {
          return renderRefusal(d.message);
        }
        if (res.status === 400 && d && d.error === "partner_id_required") {
          // A staff session opened the page with no partner named. Say which
          // thing is missing rather than "not signed in".
          return renderRefusal(
            "Add ?partner_id= to the address to see one partner's training."
          );
        }
        if (res.status === 401) {
          return renderRefusal("You are not signed in.");
        }
        return renderRefusal(
          (d && (d.message || d.error)) || "The training did not load. Try again in a moment."
        );
      })
      .catch(function () {
        renderRefusal("The training did not load. Try again in a moment.");
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }

  /* Exported for src/http/partner-training-screen.test.mjs, which drives these
     against a stub rather than a browser. Same pattern as the other screens
     whose view logic is tested without a page. */
  window.FHTraining = { gatePill: gatePill, moduleStatus: moduleStatus, whenText: whenText };
})();

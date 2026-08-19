/* Fundhub Apply — Oxylabs residential proxy door.
   Shared by lenders (client-scoped), pipeline Card Stacking matches,
   and client control panel funding section.

   Never claims browser routing is active unless the Chrome extension
   confirms it. Manual fallback shows the verified proxy string. */
(function (global) {
  "use strict";

  var SOURCE = "fundhub-proxy-apply";
  var EXT_TIMEOUT_MS = 1500;
  var extensionPresent = false;
  var activeSessionId = null;
  var pending = {};

  function tokenHeaders() {
    var t = "";
    try { t = localStorage.getItem("fh_token") || ""; } catch (e) { /* ignore */ }
    var h = { "accept": "application/json", "content-type": "application/json" };
    if (t) h.authorization = "Bearer " + t;
    return h;
  }

  function rid() {
    return "r" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function extRequest(type, payload) {
    return new Promise(function (resolve) {
      var requestId = rid();
      var timer = setTimeout(function () {
        delete pending[requestId];
        resolve({ ok: false, error: "extension_timeout" });
      }, EXT_TIMEOUT_MS);
      pending[requestId] = function (msg) {
        clearTimeout(timer);
        delete pending[requestId];
        resolve(msg);
      };
      try {
        global.postMessage({
          source: SOURCE,
          direction: "page-to-extension",
          type: type,
          requestId: requestId,
          payload: payload || {}
        }, global.location.origin);
      } catch (e) {
        clearTimeout(timer);
        delete pending[requestId];
        resolve({ ok: false, error: "postmessage_failed" });
      }
    });
  }

  global.addEventListener("message", function (event) {
    if (event.source !== global) return;
    var data = event.data;
    if (!data || data.source !== SOURCE || data.direction !== "extension-to-page") return;
    if (data.type === "ready" || data.type === "pong") {
      extensionPresent = !!(data.ok !== false);
    }
    if (data.requestId && pending[data.requestId]) {
      pending[data.requestId](data);
    }
  });

  function detectExtension() {
    return extRequest("ping").then(function (res) {
      extensionPresent = !!(res && res.ok && res.type === "pong");
      return extensionPresent;
    });
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function ensureModal() {
    var el = document.getElementById("fh-proxy-apply-modal");
    if (el) return el;
    el = document.createElement("div");
    el.id = "fh-proxy-apply-modal";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.style.cssText =
      "display:none;position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.45);" +
      "align-items:center;justify-content:center;padding:16px;";
    el.innerHTML =
      '<div style="background:#fff;color:#18181B;max-width:520px;width:100%;border-radius:12px;' +
      "border:1px solid #E4E4E7;box-shadow:0 20px 60px rgba(0,0,0,.25);padding:18px 20px;" +
      'font:13px/1.45 system-ui,sans-serif">' +
      '<div style="font:700 11px/1 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:#71717A">Apply · residential proxy</div>' +
      '<div id="fh-proxy-title" style="font-weight:700;font-size:16px;margin-top:8px"></div>' +
      '<div id="fh-proxy-body" style="margin-top:12px"></div>' +
      '<div id="fh-proxy-actions" style="margin-top:16px;display:flex;flex-wrap:wrap;gap:8px"></div>' +
      "</div>";
    el.addEventListener("click", function (ev) {
      if (ev.target === el) el.style.display = "none";
    });
    document.body.appendChild(el);
    return el;
  }

  function showModal(title, bodyHtml, actions) {
    var el = ensureModal();
    el.style.display = "flex";
    el.querySelector("#fh-proxy-title").textContent = title;
    el.querySelector("#fh-proxy-body").innerHTML = bodyHtml;
    var act = el.querySelector("#fh-proxy-actions");
    act.innerHTML = "";
    (actions || []).forEach(function (a) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = a.label;
      b.style.cssText =
        "border:1px solid #D4D4D8;background:" + (a.primary ? "#18181B" : "#fff") +
        ";color:" + (a.primary ? "#fff" : "#18181B") +
        ";border-radius:8px;padding:8px 12px;font:600 12px/1 system-ui;cursor:pointer";
      b.addEventListener("click", function () { a.onClick && a.onClick(); });
      act.appendChild(b);
    });
  }

  function hideModal() {
    var el = document.getElementById("fh-proxy-apply-modal");
    if (el) el.style.display = "none";
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return Promise.reject(new Error("clipboard_unavailable"));
  }

  function fieldRow(label, value, copyable) {
    var v = value == null ? "" : String(value);
    return (
      '<div style="margin:8px 0;padding:8px 10px;background:#FAFAFA;border:1px solid #E4E4E7;border-radius:8px">' +
      '<div style="font:700 10px/1 ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:#71717A">' +
      esc(label) + "</div>" +
      '<div style="margin-top:4px;word-break:break-all;font-family:ui-monospace,monospace;font-size:12px" data-copy="' +
      esc(v) + '">' + esc(v) + "</div>" +
      (copyable
        ? '<button type="button" data-copy-btn="' + esc(v) +
          '" style="margin-top:6px;border:0;background:transparent;color:#2563EB;font:600 11px/1 system-ui;cursor:pointer;padding:0">Copy</button>'
        : "") +
      "</div>"
    );
  }

  function bindCopyButtons(root) {
    root.querySelectorAll("[data-copy-btn]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var t = btn.getAttribute("data-copy-btn") || "";
        copyText(t).then(function () {
          btn.textContent = "Copied";
          setTimeout(function () { btn.textContent = "Copy"; }, 1200);
        }).catch(function () {
          btn.textContent = "Copy failed";
        });
      });
    });
  }

  function verificationBlock(v) {
    var level = v.targeting_level === "city" ? "city" : "state";
    var warn = level === "state"
      ? '<p style="margin:8px 0 0;color:#B45309"><b>State-level exit.</b> The exact city was unavailable; the exit is in the client\'s state. Confirm that is acceptable before submitting.</p>'
      : "";
    return (
      '<div style="margin-top:10px;padding:10px 12px;border-radius:8px;background:#ECFDF5;border:1px solid #A7F3D0">' +
      "<div><b>Verified exit — check before you submit</b></div>" +
      "<div style=\"margin-top:6px\">IP <code>" + esc(v.exit_ip) + "</code> · " +
      esc(v.city || "—") + (v.region ? ", " + esc(v.region) : "") +
      " · targeting: <b>" + esc(level) + "</b></div>" +
      "<div style=\"margin-top:4px;color:#52525B;font-size:12px\">Requested " +
      esc(v.requested_city || "—") + ", " + esc(v.requested_state || "—") + "</div>" +
      warn +
      "</div>"
    );
  }

  function endSession() {
    if (!activeSessionId) return Promise.resolve();
    var sid = activeSessionId;
    return fetch("/api/proxy/end", {
      method: "POST",
      headers: tokenHeaders(),
      body: JSON.stringify({ session_id: sid })
    }).then(function () {
      return extRequest("end");
    }).then(function () {
      activeSessionId = null;
    }).catch(function () {
      activeSessionId = null;
    });
  }

  /**
   * Launch Apply for a lender/application.
   * opts: { clientId, lenderId?, applicationId?, lenderName? }
   */
  function applyToLender(opts) {
    var clientId = opts.clientId;
    var lenderId = opts.lenderId || null;
    var applicationId = opts.applicationId || null;
    var lenderName = opts.lenderName || "Lender";

    showModal("Starting proxy…", "<p>Verifying a residential exit near the client…</p>", [
      { label: "Cancel", onClick: hideModal }
    ]);

    return detectExtension().then(function (hasExt) {
      return fetch("/api/proxy/launch", {
        method: "POST",
        headers: tokenHeaders(),
        body: JSON.stringify({
          client_id: clientId,
          lender_id: lenderId,
          application_id: applicationId
        })
      }).then(function (r) { return r.json().then(function (d) { return { http: r.status, d: d }; }); })
        .then(function (pack) {
          var d = pack.d;
          if (!d || !d.ok) {
            // Failure fallback. There are no working proxy settings to show here —
            // the session never came up — so do NOT print a host, username or
            // password that was never geo-verified. Show what to do instead.
            var nextStep = (d && d.next_step) || null;
            showModal(
              "Could not start Apply proxy",
              "<p>" + esc((d && (d.message || d.error)) || ("HTTP " + pack.http)) + "</p>" +
              (nextStep
                ? '<p style="margin:8px 0 0;padding:8px 10px;background:#FEF3C7;' +
                  'border:1px solid #FCD34D;border-radius:8px"><b>What to do next:</b> ' +
                  esc(nextStep) + "</p>"
                : "") +
              '<p style="color:#71717A;margin-top:8px">Browser routing is <b>NOT</b> active and the ' +
              "bank application was <b>not</b> opened. Do not apply from your normal internet " +
              "connection — the bank will see the wrong location.</p>",
              [{ label: "Close", onClick: hideModal, primary: true }]
            );
            return;
          }

          activeSessionId = d.session_id;
          var v = d.verification || {};
          var c = d.connection || {};
          var url = d.application_url;

          function openManualUi(routingNote) {
            var body =
              '<p style="margin:0 0 8px;padding:8px 10px;background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px">' +
              esc(routingNote) + "</p>" +
              verificationBlock(v) +
              "<p style=\"margin:12px 0 4px\">Manual proxy settings (use only if the extension is not active):</p>" +
              fieldRow("Host", c.host, true) +
              fieldRow("Port", c.port, true) +
              fieldRow("Username (includes city + sessid)", c.username, true) +
              fieldRow("Password", c.password, true) +
              fieldRow("Application URL", url, true) +
              '<p style="margin-top:10px;color:#71717A;font-size:12px">Set these in your system/browser proxy, confirm the exit city matches above, then open the application URL. Click <b>End session</b> when finished so normal browsing is not affected.</p>';

            showModal(lenderName, body, [
              {
                label: "Open application URL",
                primary: true,
                onClick: function () { global.open(url, "_blank", "noopener"); }
              },
              {
                label: "End session",
                onClick: function () {
                  endSession().then(hideModal);
                }
              },
              { label: "Close", onClick: hideModal }
            ]);
            bindCopyButtons(document.getElementById("fh-proxy-body"));
          }

          if (!hasExt) {
            openManualUi(
              "Chrome extension not detected. Browser routing is NOT active. Use the copyable proxy settings below, or install the Fundhub Proxy extension (see extension/README.md)."
            );
            return;
          }

          return extRequest("launch", {
            sessionId: d.session_id,
            username: c.username,
            password: c.password,
            applicationUrl: url,
            grantedCity: v.city || v.region || "ON",
            timeoutMs: (c.sesstime || 30) * 60 * 1000
          }).then(function (extRes) {
            if (!extRes || !extRes.ok || !extRes.routing_active) {
              openManualUi(
                "Extension is installed but did not activate routing (" +
                esc((extRes && extRes.error) || "unknown") +
                "). Browser routing is NOT active — use the manual settings."
              );
              return;
            }

            var body =
              '<p style="margin:0 0 8px;padding:8px 10px;background:#ECFDF5;border:1px solid #A7F3D0;border-radius:8px">' +
              "<b>Extension ACTIVE.</b> Badge should show " + esc((v.city || "ON").toString().toUpperCase()) +
              ". Only the lender host is PAC-routed; Chrome’s proxy API is still browser-wide — end the session when done." +
              "</p>" +
              verificationBlock(v) +
              "<p style=\"margin-top:10px\">The lender application tab should be open. Confirm the exit city above <b>before</b> you submit the bank form.</p>";

            showModal(lenderName, body, [
              {
                label: "Re-open application",
                primary: true,
                onClick: function () { global.open(url, "_blank", "noopener"); }
              },
              {
                label: "End proxy session",
                onClick: function () {
                  endSession().then(hideModal);
                }
              },
              { label: "Close", onClick: hideModal }
            ]);
          });
        });
    }).catch(function (err) {
      showModal(
        "Could not start Apply proxy",
        "<p>" + esc(err && err.message ? err.message : "Network error") + "</p>",
        [{ label: "Close", onClick: hideModal, primary: true }]
      );
    });
  }

  // Wire: buttons with data-fh-apply attributes
  function bindApplyButtons(root) {
    var scope = root || document;
    scope.querySelectorAll("[data-fh-apply]").forEach(function (btn) {
      if (btn.__fhApplyBound) return;
      btn.__fhApplyBound = true;
      btn.addEventListener("click", function (ev) {
        ev.preventDefault();
        applyToLender({
          clientId: btn.getAttribute("data-client-id"),
          lenderId: btn.getAttribute("data-lender-id"),
          applicationId: btn.getAttribute("data-application-id"),
          lenderName: btn.getAttribute("data-lender-name") || btn.textContent || "Lender"
        });
      });
    });
  }

  // Probe once DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      detectExtension();
      bindApplyButtons(document);
    });
  } else {
    detectExtension();
    bindApplyButtons(document);
  }

  global.FHProxyApply = {
    applyToLender: applyToLender,
    detectExtension: detectExtension,
    bindApplyButtons: bindApplyButtons,
    endSession: endSession,
    isExtensionPresent: function () { return extensionPresent; }
  };
})(window);

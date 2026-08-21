/* Shared send helper for Present and Closer Dashboard.
 *
 * Reuses POST /api/contracts { create_draft, then send }. That path already
 * emails through notifySigners (compose/dispatch) when mail is on. This file
 * does not add a provider. It returns the sign link so the closer can copy it.
 */
(function (root) {
  "use strict";

  function errText(r) {
    if (!r) return "Could not send.";
    var e = r.error;
    if (e && typeof e === "object") return e.message || e.error || "Could not send.";
    if (typeof e === "string" && e) return e;
    return "Could not send.";
  }

  function linkUrl(data) {
    var links = (data && data.links) || [];
    if (links[0]) return links[0].url || links[0].path || "";
    var link = data && data.link;
    if (!link) return "";
    if (typeof link === "string") return link;
    return link.url || link.path || "";
  }

  function listWordings() {
    if (!root.FHData) {
      return Promise.resolve({ ok: false, error: "data.js failed to load", items: [] });
    }
    return root.FHData.read("contracts", { view: "templates", active_only: "1" }).then(function (r) {
      if (!r.ok) return { ok: false, error: errText(r), items: [] };
      var items = (r.data && (r.data.items || r.data.templates)) || [];
      return {
        ok: true,
        items: items.filter(function (t) { return t && t.active !== false; })
      };
    });
  }

  function pickTemplate(items, templateKey) {
    if (!items || !items.length || !templateKey) return null;
    for (var i = 0; i < items.length; i++) {
      if (items[i].template_key === templateKey) return items[i];
    }
    return null;
  }

  function fillBlankInputs(values) {
    values = values || {};
    Array.prototype.forEach.call(document.querySelectorAll("[data-blank]"), function (el) {
      var k = el.getAttribute("data-blank");
      if (k && values[k] != null && values[k] !== "") el.value = values[k];
    });
  }

  function sendToClient(opts) {
    opts = opts || {};
    if (!root.FHData) {
      return Promise.resolve({ ok: false, error: "data.js failed to load" });
    }
    if (!opts.clientId) {
      return Promise.resolve({ ok: false, error: "Open this from a client." });
    }
    if (!opts.templateId) {
      return Promise.resolve({ ok: false, error: "Pick a wording first." });
    }
    return root.FHData.write("/api/contracts", {
      action: "create_draft",
      client_id: opts.clientId,
      template_id: opts.templateId,
      values: opts.values || {}
    }).then(function (r) {
      if (!r.ok) return { ok: false, error: errText(r) };
      var id = r.data && r.data.contract && r.data.contract.id;
      if (!id) return { ok: false, error: "The draft did not save." };
      return root.FHData.write("/api/contracts", { action: "send", id: id }).then(function (r2) {
        if (!r2.ok) return { ok: false, error: errText(r2) };
        var links = (r2.data && r2.data.links) || [];
        return {
          ok: true,
          link: linkUrl(r2.data),
          links: links,
          message: (r2.data && r2.data.message) || "Sent. Copy the link and give it to the client."
        };
      });
    });
  }

  function copyText(text) {
    if (!text) return Promise.resolve(false);
    if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
      return root.navigator.clipboard.writeText(text).then(function () { return true; })
        .catch(function () { return false; });
    }
    return Promise.resolve(false);
  }

  root.FHContractSend = {
    listWordings: listWordings,
    pickTemplate: pickTemplate,
    fillBlankInputs: fillBlankInputs,
    sendToClient: sendToClient,
    copyText: copyText,
    linkUrl: linkUrl
  };
})(window);

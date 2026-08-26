// Bridge between the Fundhub CRM page and the extension service worker.
//
// CHOICE: window.postMessage (page ↔ content script) + chrome.runtime.sendMessage
// (content script ↔ background). More robust for unpacked installs than
// externally_connectable, because the page does not need the extension's
// generated ID. The CRM pings on load; if it hears a pong, the extension is
// present.

(function () {
  const SOURCE = "fundhub-proxy-apply";

  function reply(requestId, payload) {
    window.postMessage(
      {
        source: SOURCE,
        direction: "extension-to-page",
        requestId: requestId || null,
        ...payload
      },
      window.location.origin
    );
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== SOURCE || data.direction !== "page-to-extension") return;

    const type = data.type;
    const requestId = data.requestId;

    if (type === "ping") {
      chrome.runtime.sendMessage({ type: "fh-proxy-ping" }, (res) => {
        if (chrome.runtime.lastError) {
          reply(requestId, { type: "pong", ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        reply(requestId, { ...(res || { ok: false }), type: "pong" });
      });
      return;
    }

    if (type === "launch") {
      chrome.runtime.sendMessage(
        { type: "fh-proxy-launch", payload: data.payload || {} },
        (res) => {
          if (chrome.runtime.lastError) {
            reply(requestId, { type: "launch-result", ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          reply(requestId, { type: "launch-result", ...(res || { ok: false }) });
        }
      );
      return;
    }

    if (type === "end") {
      chrome.runtime.sendMessage({ type: "fh-proxy-end" }, (res) => {
        if (chrome.runtime.lastError) {
          reply(requestId, { type: "end-result", ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        reply(requestId, { type: "end-result", ...(res || { ok: false }) });
      });
      return;
    }

    if (type === "status") {
      chrome.runtime.sendMessage({ type: "fh-proxy-status" }, (res) => {
        if (chrome.runtime.lastError) {
          reply(requestId, { type: "status-result", ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        reply(requestId, { type: "status-result", ...(res || { ok: false }) });
      });
    }
  });

  // Announce presence early so the CRM can flip out of manual-fallback mode.
  try {
    chrome.runtime.sendMessage({ type: "fh-proxy-ping" }, (res) => {
      if (chrome.runtime.lastError || !res) return;
      reply(null, { ...(res || {}), type: "ready" });
    });
  } catch {
    /* ignore */
  }
})();

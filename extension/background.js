// Fundhub Proxy Apply — MV3 service worker.
//
// LIMITATION (documented in README + CRM UI): Chrome's proxy API is browser-wide.
// We mitigate with a PAC script that only sends the lender application host
// (and the Oxylabs verify host) through the proxy. Other hosts stay DIRECT.
// Auth is handled via onAuthRequired so the advisor is never prompted.

const PROXY_HOST = "pr.oxylabs.io";
const PROXY_PORT = 7777;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

let active = null; // { sessionId, username, password, applicationUrl, grantedCity, hostAllow, endsAt }
let endTimer = null;

function hostFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function buildPac(hosts) {
  const list = [...new Set(hosts.filter(Boolean))].map((h) => JSON.stringify(h));
  return `function FindProxyForURL(url, host) {
  var H = [${list.join(",")}];
  for (var i = 0; i < H.length; i++) {
    if (host === H[i] || dnsDomainIs(host, "." + H[i])) {
      return "PROXY ${PROXY_HOST}:${PROXY_PORT}";
    }
  }
  return "DIRECT";
}`;
}

async function setBadge(text, color) {
  try {
    await chrome.action.setBadgeText({ text: text || "" });
    if (color) await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setTitle({
      title: text
        ? `Fundhub Proxy ACTIVE — ${text}`
        : "Fundhub Proxy — idle (not routing)"
    });
  } catch {
    /* badge APIs can fail in tests / odd hosts */
  }
}

async function clearProxy() {
  if (endTimer) {
    clearTimeout(endTimer);
    endTimer = null;
  }
  active = null;
  await chrome.storage.session.remove(["fh_proxy_active"]);
  return new Promise((resolve) => {
    chrome.proxy.settings.clear({ scope: "regular" }, async () => {
      await setBadge("", "#666666");
      resolve({ ok: true, cleared: true });
    });
  });
}

async function activateProxy(payload) {
  const username = String(payload.username || "");
  const password = String(payload.password || "");
  const applicationUrl = String(payload.applicationUrl || payload.application_url || "");
  const grantedCity = payload.grantedCity || payload.granted_city || "ON";
  const sessionId = payload.sessionId || payload.session_id || null;
  const timeoutMs = Number(payload.timeoutMs) || DEFAULT_TIMEOUT_MS;

  if (!username || !password || !applicationUrl) {
    return { ok: false, error: "missing_connection_fields" };
  }

  const appHost = hostFromUrl(applicationUrl);
  if (!appHost) return { ok: false, error: "bad_application_url" };

  const hostAllow = [appHost, "ip.oxylabs.io", PROXY_HOST];
  const pac = buildPac(hostAllow);

  active = {
    sessionId,
    username,
    password,
    applicationUrl,
    grantedCity,
    hostAllow,
    endsAt: Date.now() + timeoutMs
  };
  await chrome.storage.session.set({ fh_proxy_active: active });

  await new Promise((resolve, reject) => {
    chrome.proxy.settings.set(
      {
        value: {
          mode: "pac_script",
          pacScript: { data: pac }
        },
        scope: "regular"
      },
      () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve();
      }
    );
  });

  const badge = String(grantedCity).slice(0, 8).toUpperCase();
  await setBadge(badge || "ON", "#B45309");

  if (endTimer) clearTimeout(endTimer);
  endTimer = setTimeout(() => {
    clearProxy();
  }, timeoutMs);

  let tabId = null;
  try {
    const tab = await chrome.tabs.create({ url: applicationUrl, active: true });
    tabId = tab?.id ?? null;
  } catch {
    /* opener may still window.open from the page */
  }

  return {
    ok: true,
    routing_active: true,
    granted_city: grantedCity,
    application_url: applicationUrl,
    tab_id: tabId,
    limitation:
      "Chrome MV3 proxy settings are browser-wide. PAC limits proxy use to the lender host + verify host; other sites stay direct. Badge shows ACTIVE until session end."
  };
}

chrome.webRequest.onAuthRequired.addListener(
  (details) => {
    if (!active) return {};
    const challenger = details.challenger?.host || details.url || "";
    if (!String(challenger).includes(PROXY_HOST) && details.isProxy !== true) {
      return {};
    }
    return {
      authCredentials: {
        username: active.username,
        password: active.password
      }
    };
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const type = msg?.type;
  if (type === "fh-proxy-ping") {
    sendResponse({
      ok: true,
      type: "fh-proxy-pong",
      extension: "fundhub-proxy-apply",
      version: chrome.runtime.getManifest().version,
      active: Boolean(active),
      granted_city: active?.grantedCity || null,
      session_id: active?.sessionId || null
    });
    return true;
  }
  if (type === "fh-proxy-launch") {
    activateProxy(msg.payload || msg)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message || "launch_failed" }));
    return true;
  }
  if (type === "fh-proxy-end") {
    clearProxy().then(sendResponse);
    return true;
  }
  if (type === "fh-proxy-status") {
    sendResponse({
      ok: true,
      active: Boolean(active),
      session: active
        ? {
            session_id: active.sessionId,
            granted_city: active.grantedCity,
            application_url: active.applicationUrl,
            ends_at: active.endsAt
          }
        : null
    });
    return true;
  }
  return false;
});

chrome.runtime.onStartup.addListener(() => {
  clearProxy();
});
chrome.runtime.onInstalled.addListener(() => {
  clearProxy();
});

// Personal Gmail API client (read/list/modify via gmail.modify scope).
// Uses the same desktop OAuth token as Company Brain Drive when env is shared.

import { fetchOAuthAccessToken } from "../company-brain/auth.mjs";
import { GMAIL_API_BASE } from "./config.mjs";

const MESSAGE_META_HEADERS = ["Subject", "From", "Date", "To"];

export function decodeGmailBodyData(data) {
  if (!data) return "";
  return Buffer.from(String(data).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Prefer text/plain. Fall back to stripped HTML, then the snippet. */
export function plainTextFromMessage(message) {
  const plains = [];
  const htmls = [];
  function walk(part) {
    if (!part) return;
    const mime = String(part.mimeType || "").toLowerCase();
    if (part.body?.data) {
      const text = decodeGmailBodyData(part.body.data);
      if (mime.startsWith("text/plain")) plains.push(text);
      else if (mime.startsWith("text/html")) htmls.push(text);
    }
    for (const child of part.parts || []) walk(child);
  }
  walk(message?.payload);
  if (plains.length) return plains.join("\n");
  if (htmls.length) return htmls.map(stripHtml).join("\n");
  return String(message?.snippet || "");
}

/**
 * Create a Gmail client bound to personal OAuth credentials.
 * Token is refreshed lazily and cached until near expiry.
 */
export function createGmailClient({
  oauthCredentials,
  userId = "me",
  fetchImpl = globalThis.fetch,
  apiBase = GMAIL_API_BASE
} = {}) {
  if (!oauthCredentials?.refreshToken) {
    throw new Error("createGmailClient requires oauthCredentials");
  }

  let cached = null; // { accessToken, expiresAtMs }

  async function accessToken() {
    const now = Date.now();
    if (cached && cached.expiresAtMs > now + 60_000) return cached.accessToken;
    const tok = await fetchOAuthAccessToken({ ...oauthCredentials, fetchImpl });
    cached = {
      accessToken: tok.accessToken,
      expiresAtMs: now + (tok.expiresIn * 1000)
    };
    return cached.accessToken;
  }

  async function gmailFetch(path, { query, method = "GET", body } = {}) {
    const token = await accessToken();
    const url = new URL(path.startsWith("http") ? path : `${apiBase}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        if (Array.isArray(v)) {
          for (const item of v) url.searchParams.append(k, String(item));
        } else {
          url.searchParams.set(k, String(v));
        }
      }
    }
    const headers = { authorization: `Bearer ${token}` };
    const init = { method, headers };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = typeof body === "string" ? body : JSON.stringify(body);
    }
    return fetchImpl(url.toString(), init);
  }

  async function getProfile() {
    const res = await gmailFetch(`/users/${encodeURIComponent(userId)}/profile`);
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`gmail profile non-json (${res.status})`);
    }
    if (!res.ok) {
      throw new Error(`gmail profile failed (${res.status}): ${json.error?.message || text.slice(0, 200)}`);
    }
    return json;
  }

  /**
   * List message ids.
   * Default labelIds=INBOX only when there is no free-text `q`.
   * A query like `in:anywhere` / `in:spam` must not also AND INBOX
   * (Gmail API treats labelIds + q as intersection — that false-zeroed
   * self-loop proves on 2026-08-25).
   */
  async function listMessages({ maxResults = 10, labelIds, q } = {}) {
    const resolvedLabels = labelIds !== undefined
      ? labelIds
      : (q ? undefined : ["INBOX"]);
    const res = await gmailFetch(`/users/${encodeURIComponent(userId)}/messages`, {
      query: {
        maxResults,
        labelIds: resolvedLabels,
        q: q || undefined
      }
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`gmail messages.list non-json (${res.status})`);
    }
    if (!res.ok) {
      throw new Error(`gmail messages.list failed (${res.status}): ${json.error?.message || text.slice(0, 200)}`);
    }
    return {
      messages: json.messages || [],
      resultSizeEstimate: json.resultSizeEstimate ?? null
    };
  }

  /**
   * Fetch one message (metadata by default — no body bytes).
   */
  async function getMessage(messageId, { format = "metadata" } = {}) {
    const res = await gmailFetch(`/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}`, {
      query: {
        format,
        metadataHeaders: format === "metadata" ? MESSAGE_META_HEADERS : undefined
      }
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`gmail messages.get non-json (${res.status})`);
    }
    if (!res.ok) {
      throw new Error(`gmail messages.get failed (${res.status}): ${json.error?.message || text.slice(0, 200)}`);
    }
    return json;
  }

  function headerValue(message, name) {
    const headers = message?.payload?.headers || [];
    const hit = headers.find((h) => String(h.name).toLowerCase() === String(name).toLowerCase());
    return hit?.value || null;
  }

  let labelCache = new Map();

  async function listLabels() {
    const res = await gmailFetch(`/users/${encodeURIComponent(userId)}/labels`);
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`gmail labels.list non-json (${res.status})`);
    }
    if (!res.ok) {
      throw new Error(`gmail labels.list failed (${res.status}): ${json.error?.message || text.slice(0, 200)}`);
    }
    return json.labels || [];
  }

  async function getOrCreateLabel(name) {
    const key = String(name || "").trim();
    if (!key) throw new Error("getOrCreateLabel requires a name");
    if (labelCache.has(key)) return labelCache.get(key);
    const existing = (await listLabels()).find((l) => l.name === key);
    if (existing?.id) {
      labelCache.set(key, existing.id);
      return existing.id;
    }
    const res = await gmailFetch(`/users/${encodeURIComponent(userId)}/labels`, {
      method: "POST",
      body: {
        name: key,
        labelListVisibility: "labelHide",
        messageListVisibility: "hide"
      }
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`gmail labels.create non-json (${res.status})`);
    }
    if (!res.ok) {
      throw new Error(`gmail labels.create failed (${res.status}): ${json.error?.message || text.slice(0, 200)}`);
    }
    labelCache.set(key, json.id);
    return json.id;
  }

  async function addLabels(messageId, labelIds) {
    const res = await gmailFetch(
      `/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}/modify`,
      { method: "POST", body: { addLabelIds: labelIds } }
    );
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`gmail messages.modify non-json (${res.status})`);
    }
    if (!res.ok) {
      throw new Error(`gmail messages.modify failed (${res.status}): ${json.error?.message || text.slice(0, 200)}`);
    }
    return json;
  }

  return {
    getProfile,
    listMessages,
    getMessage,
    headerValue,
    getOrCreateLabel,
    addLabels,
    /** test helper */
    _clearTokenCache() { cached = null; }
  };
}

/** Build a Gmail client from gmailConfigFromEnv output. */
export function createGmailClientFromConfig(config, { fetchImpl = globalThis.fetch, userId = "me" } = {}) {
  return createGmailClient({
    oauthCredentials: config.oauthCredentials,
    userId,
    fetchImpl
  });
}

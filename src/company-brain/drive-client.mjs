// Read-only Google Drive API client.
// Scope is drive.readonly — this module never writes, deletes, or moves.

import { DRIVE_API_BASE } from "./config.mjs";
import { fetchAccessToken } from "./auth.mjs";

const FILE_FIELDS = "id,name,mimeType,parents,modifiedTime,md5Checksum,size,webViewLink,trashed";

/**
 * Create a Drive client bound to a service account + delegate.
 * Token is refreshed lazily and cached until near expiry.
 */
export function createDriveClient({
  serviceAccount,
  delegateEmail,
  fetchImpl = globalThis.fetch,
  apiBase = DRIVE_API_BASE
} = {}) {
  if (!serviceAccount?.clientEmail || !serviceAccount?.privateKey || !delegateEmail) {
    throw new Error("createDriveClient requires serviceAccount and delegateEmail");
  }

  let cached = null; // { accessToken, expiresAtMs }

  async function accessToken() {
    const now = Date.now();
    if (cached && cached.expiresAtMs > now + 60_000) return cached.accessToken;
    const tok = await fetchAccessToken({
      clientEmail: serviceAccount.clientEmail,
      privateKey: serviceAccount.privateKey,
      delegateEmail,
      fetchImpl
    });
    cached = {
      accessToken: tok.accessToken,
      expiresAtMs: now + (tok.expiresIn * 1000)
    };
    return cached.accessToken;
  }

  async function driveFetch(path, { query, accept } = {}) {
    const token = await accessToken();
    const url = new URL(path.startsWith("http") ? path : `${apiBase}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    const headers = { authorization: `Bearer ${token}` };
    if (accept) headers.accept = accept;
    const res = await fetchImpl(url.toString(), { method: "GET", headers });
    return res;
  }

  /**
   * List non-trashed files. Yields pages; does not recurse folders itself —
   * Drive files.list already returns all files the account can see when
   * corpora=user (default). H-2: no folder filter.
   */
  async function* listAllFiles({ pageSize = 1000 } = {}) {
    let pageToken = null;
    do {
      const res = await driveFetch("/files", {
        query: {
          pageSize,
          pageToken: pageToken || undefined,
          q: "trashed = false",
          fields: `nextPageToken,files(${FILE_FIELDS})`,
          supportsAllDrives: "true",
          includeItemsFromAllDrives: "true"
        }
      });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`files.list non-json (${res.status})`);
      }
      if (!res.ok) {
        throw new Error(`files.list failed (${res.status}): ${json.error?.message || text.slice(0, 200)}`);
      }
      for (const f of json.files || []) yield f;
      pageToken = json.nextPageToken || null;
    } while (pageToken);
  }

  async function getFile(fileId) {
    const res = await driveFetch(`/files/${encodeURIComponent(fileId)}`, {
      query: { fields: FILE_FIELDS, supportsAllDrives: "true" }
    });
    const text = await res.text();
    const json = JSON.parse(text);
    if (!res.ok) {
      throw new Error(`files.get failed (${res.status}): ${json.error?.message || text.slice(0, 200)}`);
    }
    return json;
  }

  /** Download binary/media content (alt=media). */
  async function downloadMedia(fileId) {
    const res = await driveFetch(`/files/${encodeURIComponent(fileId)}`, {
      query: { alt: "media", supportsAllDrives: "true" }
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`files.get media failed (${res.status}): ${text.slice(0, 200)}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return buf;
  }

  /** Export a Google Docs/Sheets/Slides file to a mime type. */
  async function exportFile(fileId, exportMime) {
    const res = await driveFetch(`/files/${encodeURIComponent(fileId)}/export`, {
      query: { mimeType: exportMime }
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`files.export failed (${res.status}): ${text.slice(0, 200)}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async function getStartPageToken() {
    const res = await driveFetch("/changes/startPageToken", {
      query: { supportsAllDrives: "true" }
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`changes.startPageToken non-json (${res.status})`);
    }
    if (!res.ok || !json.startPageToken) {
      throw new Error(
        `changes.startPageToken failed (${res.status}): ${json.error?.message || text.slice(0, 200)}`
      );
    }
    return String(json.startPageToken);
  }

  /**
   * One page of changes.list. Caller loops on nextPageToken until null,
   * then persists newStartPageToken.
   */
  async function listChangesPage(pageToken, { pageSize = 1000 } = {}) {
    if (!pageToken) throw new Error("listChangesPage requires pageToken");
    const res = await driveFetch("/changes", {
      query: {
        pageToken: String(pageToken),
        pageSize,
        includeRemoved: "true",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
        fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`
      }
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`changes.list non-json (${res.status})`);
    }
    if (res.status === 410) {
      const err = new Error(`changes.list token expired (410): ${json.error?.message || text.slice(0, 200)}`);
      err.code = "PAGE_TOKEN_EXPIRED";
      err.status = 410;
      throw err;
    }
    if (!res.ok) {
      throw new Error(`changes.list failed (${res.status}): ${json.error?.message || text.slice(0, 200)}`);
    }
    const changes = (json.changes || []).map((ch) => ({
      fileId: ch.fileId || ch.file?.id || null,
      removed: !!ch.removed || !!ch.file?.trashed,
      file: ch.file || null
    }));
    return {
      changes,
      nextPageToken: json.nextPageToken || null,
      newStartPageToken: json.newStartPageToken || null
    };
  }

  /** Drain all change pages from pageToken; returns { changes, newStartPageToken }. */
  async function listAllChanges(pageToken, opts = {}) {
    const all = [];
    let token = pageToken;
    let newStartPageToken = null;
    while (token) {
      const page = await listChangesPage(token, opts);
      all.push(...page.changes);
      if (page.nextPageToken) token = page.nextPageToken;
      else {
        newStartPageToken = page.newStartPageToken;
        token = null;
      }
    }
    return { changes: all, newStartPageToken };
  }

  return {
    listAllFiles,
    getFile,
    downloadMedia,
    exportFile,
    getStartPageToken,
    listChangesPage,
    listAllChanges,
    /** test helper */
    _clearTokenCache() { cached = null; }
  };
}

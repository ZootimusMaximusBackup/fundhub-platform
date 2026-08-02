// Incremental Drive pickup via changes.list + stored page token.
// Step 3 of docs/COMPANY-BRAIN-BUILD-SPEC.md.
//
// Bootstrap (no token): full walk → extract → upsert → seed startPageToken.
// Incremental (has token): changes.list → upsert / delete → save newStartPageToken.
// Expired token (410): clear token, full walk again.

import { driveConfigFromEnv } from "./config.mjs";
import { createDriveClient } from "./drive-client.mjs";
import { classifyMime, GOOGLE_FOLDER } from "./mime.mjs";
import { extractFromDriveFile } from "./extract.mjs";
import { walkDriveAndExtract } from "./walk.mjs";
import { upsertExtractedFile, deleteByDriveFileId } from "./store.mjs";

export async function getSyncState(db, orgId) {
  const res = await db.query(
    `SELECT org_id, page_token, last_sync_at, last_error
       FROM brain_drive_sync WHERE org_id = $1`,
    [orgId]
  );
  return res.rows?.[0] || null;
}

export async function saveSyncState(db, {
  orgId,
  pageToken = null,
  lastError = null
} = {}) {
  await db.query(
    `INSERT INTO brain_drive_sync (org_id, page_token, last_sync_at, last_error)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (org_id) DO UPDATE SET
       page_token = EXCLUDED.page_token,
       last_sync_at = now(),
       last_error = EXCLUDED.last_error,
       updated_at = now()`,
    [orgId, pageToken, lastError]
  );
}

async function extractOne(client, meta, foldersById = new Map()) {
  if (!meta || meta.mimeType === GOOGLE_FOLDER) {
    return { ok: false, reason: "skipped:folder", fileId: meta?.id || null };
  }
  const classified = classifyMime(meta.mimeType);
  const parentNames = (meta.parents || [])
    .map((id) => foldersById.get(id))
    .filter(Boolean);
  return extractFromDriveFile(meta, {
    parentNames,
    download: classified.action === "download"
      ? () => client.downloadMedia(meta.id)
      : undefined,
    exportTo: classified.action === "export"
      ? (mime) => client.exportFile(meta.id, mime)
      : undefined
  });
}

/**
 * Run one sync cycle for an org.
 * @param {object} opts
 * @param {boolean} [opts.forceFull=false] — ignore stored token and rebuild
 */
export async function syncDriveIncremental(db, {
  orgId,
  env = process.env,
  fetchImpl = globalThis.fetch,
  client: injectedClient = null,
  forceFull = false,
  upsert = upsertExtractedFile,
  remove = deleteByDriveFileId,
  walk = walkDriveAndExtract
} = {}) {
  if (!orgId) return { ok: false, reason: "org_id_required" };

  const config = driveConfigFromEnv(env);
  if (!injectedClient && !config.ready) {
    return { ok: false, reason: "not_configured", missing: config.missing };
  }

  const client = injectedClient || createDriveClient({
    serviceAccount: config.serviceAccount,
    delegateEmail: config.delegateEmail,
    fetchImpl
  });

  const state = await getSyncState(db, orgId);
  const haveToken = !!(state && state.page_token) && !forceFull;

  try {
    if (!haveToken) {
      const walked = await walk({ env, fetchImpl, client });
      if (!walked.ok) {
        await saveSyncState(db, { orgId, pageToken: null, lastError: walked.reason });
        return { ok: false, reason: walked.reason, mode: "full", missing: walked.missing };
      }

      let upserted = 0;
      for (const extracted of walked.files || []) {
        if (String(extracted.reason || "").startsWith("skipped:")) continue;
        const up = await upsert(db, { orgId, extracted, env, fetchImpl });
        if (up.ok) upserted += 1;
      }

      const startToken = await client.getStartPageToken();
      await saveSyncState(db, { orgId, pageToken: startToken, lastError: null });
      return {
        ok: true,
        mode: "full",
        pageToken: startToken,
        summary: walked.summary,
        upserted,
        deleted: 0
      };
    }

    const { changes, newStartPageToken } = await client.listAllChanges(state.page_token);
    let upserted = 0;
    let deleted = 0;
    let failed = 0;

    for (const ch of changes) {
      if (!ch.fileId) continue;
      if (ch.removed) {
        const del = await remove(db, { orgId, driveFileId: ch.fileId });
        deleted += del.deleted || 0;
        continue;
      }
      if (!ch.file || ch.file.mimeType === GOOGLE_FOLDER) continue;

      const extracted = await extractOne(client, ch.file);
      if (String(extracted.reason || "").startsWith("skipped:")) continue;
      const up = await upsert(db, { orgId, extracted, env, fetchImpl });
      if (up.ok) upserted += 1;
      else failed += 1;
    }

    if (!newStartPageToken) {
      // Google always returns newStartPageToken on the last page when caught up.
      // If missing, keep the old token and surface an error rather than losing the cursor.
      await saveSyncState(db, {
        orgId,
        pageToken: state.page_token,
        lastError: "missing_new_start_page_token"
      });
      return {
        ok: false,
        reason: "missing_new_start_page_token",
        mode: "incremental",
        upserted,
        deleted,
        failed
      };
    }

    await saveSyncState(db, { orgId, pageToken: newStartPageToken, lastError: null });
    return {
      ok: true,
      mode: "incremental",
      pageToken: newStartPageToken,
      upserted,
      deleted,
      failed,
      changeCount: changes.length
    };
  } catch (err) {
    if (err && err.code === "PAGE_TOKEN_EXPIRED") {
      await saveSyncState(db, { orgId, pageToken: null, lastError: "page_token_expired" });
      return syncDriveIncremental(db, {
        orgId, env, fetchImpl, client: injectedClient, forceFull: true,
        upsert, remove, walk
      });
    }
    const msg = err && err.message ? err.message : String(err);
    await saveSyncState(db, {
      orgId,
      pageToken: state?.page_token || null,
      lastError: msg.slice(0, 500)
    });
    return { ok: false, reason: msg, mode: haveToken ? "incremental" : "full" };
  }
}

// Full Drive walk — list every non-trashed file and extract text where possible.
// Full walk only. Incremental pickup lives in sync.mjs (step 3).
// H-2 owner-set 2026-08-02: no folder exclusions.

import { driveConfigFromEnv } from "./config.mjs";
import { createDriveClient } from "./drive-client.mjs";
import { classifyMime, GOOGLE_FOLDER, needsMediaDownload } from "./mime.mjs";
import { extractFromDriveFile } from "./extract.mjs";

/**
 * Walk Drive and extract. Returns a summary + per-file results.
 * Inject `client` / `fetchImpl` in tests; production builds client from env.
 */
export async function walkDriveAndExtract({
  env = process.env,
  fetchImpl = globalThis.fetch,
  client: injectedClient = null,
  onFile = null, // optional async (result) => {}
  maxFiles = Infinity
} = {}) {
  const config = driveConfigFromEnv(env);
  if (!injectedClient && !config.ready) {
    return {
      ok: false,
      reason: "not_configured",
      missing: config.missing,
      files: [],
      summary: emptySummary()
    };
  }

  const client = injectedClient || createDriveClient({
    serviceAccount: config.serviceAccount,
    delegateEmail: config.delegateEmail,
    fetchImpl
  });

  // First pass: collect metadata + folder name map for parent sniffing.
  const files = [];
  const foldersById = new Map();
  let seen = 0;

  for await (const meta of client.listAllFiles()) {
    if (meta.mimeType === GOOGLE_FOLDER) {
      foldersById.set(meta.id, meta.name || "");
      continue;
    }
    files.push(meta);
    seen += 1;
    if (seen >= maxFiles) break;
  }

  const results = [];
  const summary = emptySummary();

  for (const meta of files) {
    const classified = classifyMime(meta.mimeType);
    summary.seen += 1;
    summary.byKind[classified.kind] = (summary.byKind[classified.kind] || 0) + 1;

    const parentNames = (meta.parents || [])
      .map((id) => foldersById.get(id))
      .filter(Boolean);

    const extracted = await extractFromDriveFile(meta, {
      parentNames,
      download: needsMediaDownload(classified)
        ? () => client.downloadMedia(meta.id)
        : undefined,
      exportTo: classified.action === "export"
        ? (mime) => client.exportFile(meta.id, mime)
        : undefined
    });

    if (extracted.ok) summary.extracted += 1;
    else if (String(extracted.reason || "").startsWith("skipped:")) summary.skipped += 1;
    else summary.failed += 1;

    if (extracted.needsTranscription) summary.needsTranscription += 1;
    if (extracted.needsOcr) summary.needsOcr += 1;

    results.push(extracted);
    if (typeof onFile === "function") await onFile(extracted);
  }

  return { ok: true, reason: null, missing: [], files: results, summary };
}

function emptySummary() {
  return {
    seen: 0,
    extracted: 0,
    skipped: 0,
    failed: 0,
    needsTranscription: 0,
    needsOcr: 0,
    byKind: {}
  };
}

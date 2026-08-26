// Attach words from a Meet recording already indexed in Company Brain.
// Prefer the sibling Drive transcript doc (Google Meet Transcript / Gemini notes).
// Do not invent a call or a tape.

import { upsertExtractedFile } from "./store.mjs";
import { attachDriveRecording, stampCallTranscript } from "../sales/recordings.mjs";
import { meetTitleStem, looksLikeTranscriptName } from "./meet-title.mjs";

export {
  meetTitleStem,
  looksLikeTranscriptName
};

async function fileText(db, fileId) {
  const res = await db.query(
    `SELECT content FROM brain_chunks
      WHERE file_id = $1
      ORDER BY chunk_index`,
    [fileId]
  );
  return (res.rows || []).map((r) => r.content).filter(Boolean).join("\n\n").trim();
}

export async function applyMeetWords(db, {
  orgId,
  extracted,
  text,
  env = process.env,
  fetchImpl,
  upsert = upsertExtractedFile
} = {}) {
  const words = String(text || "").trim();
  if (!orgId || !extracted?.fileId || !words) {
    return { ok: false, reason: "missing_args" };
  }
  const up = await upsert(db, {
    orgId,
    extracted: {
      ...extracted,
      text: words,
      needsTranscription: false,
      reason: null
    },
    env,
    fetchImpl
  });
  let clientId = extracted.clientId || null;
  if (!clientId) {
    const attached = await attachDriveRecording(db, {
      orgId,
      fileName: extracted.name,
      url: extracted.webViewLink || null
    });
    clientId = attached.clientId || null;
  }
  if (clientId) {
    await stampCallTranscript(db, {
      orgId,
      clientId,
      url: extracted.webViewLink || null,
      transcript: words
    });
  }
  return { ok: !!up.ok, reason: up.reason || null, fileId: up.fileId || null };
}

/**
 * Pair pending recordings with already-extracted transcript docs.
 */
export async function pairMeetTranscripts(db, {
  orgId,
  env = process.env,
  fetchImpl,
  upsert = upsertExtractedFile
} = {}) {
  if (!orgId) return { applied: 0, reason: "org_id_required" };

  const pendingRes = await db.query(
    `SELECT id, drive_file_id, name, mime_type, web_view_link, client_id
       FROM brain_files
      WHERE org_id = $1 AND needs_transcription = true`,
    [orgId]
  );
  const pending = pendingRes.rows || [];
  if (!pending.length) return { applied: 0, reason: null };

  const sourceRes = await db.query(
    `SELECT id, name
       FROM brain_files
      WHERE org_id = $1 AND needs_transcription = false`,
    [orgId]
  );
  const sources = [];
  for (const row of sourceRes.rows || []) {
    if (!looksLikeTranscriptName(row.name)) continue;
    const text = await fileText(db, row.id);
    if (!text) continue;
    sources.push({ ...row, text, stem: meetTitleStem(row.name) });
  }

  let applied = 0;
  for (const rec of pending) {
    const stem = meetTitleStem(rec.name);
    if (!stem) continue;
    const hits = sources.filter((s) => s.stem && s.stem === stem);
    if (hits.length !== 1) continue;
    const out = await applyMeetWords(db, {
      orgId,
      extracted: {
        fileId: rec.drive_file_id,
        name: rec.name,
        mimeType: rec.mime_type,
        webViewLink: rec.web_view_link,
        clientId: rec.client_id || null,
        unattached: !rec.client_id
      },
      text: hits[0].text,
      env,
      fetchImpl,
      upsert
    });
    if (out.ok) applied += 1;
  }
  return { applied, reason: null };
}

export async function processOrgMeetWords(db, {
  orgId,
  env = process.env,
  fetchImpl,
  upsert = upsertExtractedFile
} = {}) {
  if (!orgId) return { ok: false, paired: 0, reason: "org_id_required" };
  const paired = await pairMeetTranscripts(db, { orgId, env, fetchImpl, upsert });
  return {
    ok: true,
    paired: paired.applied || 0,
    reason: paired.reason || null
  };
}

export async function sweepMeetTranscripts(db, {
  env = process.env,
  fetchImpl,
  upsert = upsertExtractedFile
} = {}) {
  const orgs = await db.query(
    `SELECT DISTINCT org_id FROM brain_files WHERE needs_transcription = true`
  );
  const summary = { orgs: 0, paired: 0, reason: null };
  for (const row of orgs.rows || []) {
    const out = await processOrgMeetWords(db, {
      orgId: row.org_id,
      env,
      fetchImpl,
      upsert
    });
    summary.orgs += 1;
    summary.paired += out.paired || 0;
  }
  return summary;
}

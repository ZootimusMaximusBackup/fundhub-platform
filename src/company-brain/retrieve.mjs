// Owner-only retrieval. Filter by access_tier BEFORE ranking — the model
// never sees a chunk the asker is not cleared for.

import { assertOwnerOnlyRole } from "./access.mjs";
import { embedTexts, toVectorLiteral } from "./embed.mjs";

/**
 * Semantic search over brain_chunks.
 *
 * @param {object} args
 * @param {string} args.orgId
 * @param {string} args.role — from session, never from the request body
 * @param {string} args.query
 * @param {number} [args.limit=8]
 */
export async function retrieveChunks(db, {
  orgId,
  role,
  query,
  limit = 8,
  env = process.env,
  fetchImpl,
  embed = embedTexts
} = {}) {
  const gate = assertOwnerOnlyRole(role);
  if (!gate.ok) {
    return { ok: false, reason: gate.reason, chunks: [] };
  }
  if (!orgId) return { ok: false, reason: "org_id_required", chunks: [] };
  const q = String(query || "").trim();
  if (!q) return { ok: false, reason: "query_required", chunks: [] };

  const embedded = await embed([q], { env, fetchImpl });
  if (!embedded.ok || !embedded.embeddings[0]) {
    return { ok: false, reason: embedded.error || "embed_failed", chunks: [] };
  }

  const vec = toVectorLiteral(embedded.embeddings[0]);
  const lim = Math.max(1, Math.min(50, Number(limit) || 8));

  // Tier filter is in the WHERE clause — never fetch then drop.
  const res = await db.query(
    `SELECT
       c.id AS chunk_id,
       c.content,
       c.access_tier,
       c.chunk_index,
       f.id AS file_id,
       f.drive_file_id,
       f.name AS file_name,
       f.web_view_link,
       f.client_id,
       f.mime_type,
       (c.embedding <=> $3::vector) AS distance
     FROM brain_chunks c
     JOIN brain_files f ON f.id = c.file_id
     WHERE c.org_id = $1
       AND c.access_tier = ANY($2::brain_access_tier[])
       AND c.embedding IS NOT NULL
     ORDER BY c.embedding <=> $3::vector
     LIMIT $4`,
    [orgId, gate.tiers, vec, lim]
  );

  return {
    ok: true,
    reason: null,
    chunks: (res.rows || []).map((row) => ({
      chunkId: row.chunk_id,
      content: row.content,
      accessTier: row.access_tier,
      chunkIndex: row.chunk_index,
      fileId: row.file_id,
      driveFileId: row.drive_file_id,
      fileName: row.file_name,
      webViewLink: row.web_view_link,
      clientId: row.client_id,
      mimeType: row.mime_type,
      distance: row.distance == null ? null : Number(row.distance)
    }))
  };
}

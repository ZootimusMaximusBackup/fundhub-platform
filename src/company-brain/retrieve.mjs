// Role-gated retrieval. Filter by access_tier BEFORE ranking.
//
// Staff path: ROLE_SETS tiers via assertBrainAccess — never affiliate.
// External path: ONLY affiliate tier AND brain_affiliate_allowlist membership.
// Role comes from the session, never the request body.

import {
  assertBrainAccess,
  assertAffiliateBrainAccess,
  isExternalBrainRole
} from "./access.mjs";
import { embedTexts, toVectorLiteral } from "./embed.mjs";

function mapRows(rows) {
  return (rows || []).map((row) => ({
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
  }));
}

async function embedQuery(query, { env, fetchImpl, embed }) {
  const q = String(query || "").trim();
  if (!q) return { ok: false, reason: "query_required" };
  const embedded = await embed([q], { env, fetchImpl });
  if (!embedded.ok || !embedded.embeddings[0]) {
    return { ok: false, reason: embedded.error || "embed_failed" };
  }
  return { ok: true, vec: toVectorLiteral(embedded.embeddings[0]), query: q };
}

/**
 * Staff/internal semantic search.
 * Refuses external roles — they must use retrieveAffiliateChunks.
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
  if (isExternalBrainRole(role)) {
    return { ok: false, reason: "use_affiliate_path", chunks: [] };
  }
  const gate = assertBrainAccess(role);
  if (!gate.ok) return { ok: false, reason: gate.reason, chunks: [] };
  if (!orgId) return { ok: false, reason: "org_id_required", chunks: [] };

  const emb = await embedQuery(query, { env, fetchImpl, embed });
  if (!emb.ok) return { ok: false, reason: emb.reason, chunks: [] };

  const lim = Math.max(1, Math.min(50, Number(limit) || 8));
  const res = await db.query(
    `SELECT
       c.id AS chunk_id, c.content, c.access_tier, c.chunk_index,
       f.id AS file_id, f.drive_file_id, f.name AS file_name,
       f.web_view_link, f.client_id, f.mime_type,
       (c.embedding <=> $3::vector) AS distance
     FROM brain_chunks c
     JOIN brain_files f ON f.id = c.file_id
     WHERE c.org_id = $1
       AND c.access_tier = ANY($2::brain_access_tier[])
       AND c.access_tier <> 'affiliate'
       AND c.embedding IS NOT NULL
     ORDER BY c.embedding <=> $3::vector
     LIMIT $4`,
    [orgId, gate.tiers, emb.vec, lim]
  );

  return { ok: true, reason: null, chunks: mapRows(res.rows) };
}

/**
 * External (affiliate/partner) semantic search.
 * Hits ONLY allowlisted files with access_tier = 'affiliate'.
 * No fallback to internal tiers — ever.
 */
export async function retrieveAffiliateChunks(db, {
  orgId,
  role,
  query,
  limit = 8,
  env = process.env,
  fetchImpl,
  embed = embedTexts
} = {}) {
  const gate = assertAffiliateBrainAccess(role);
  if (!gate.ok) return { ok: false, reason: gate.reason, chunks: [] };
  if (!orgId) return { ok: false, reason: "org_id_required", chunks: [] };

  const emb = await embedQuery(query, { env, fetchImpl, embed });
  if (!emb.ok) return { ok: false, reason: emb.reason, chunks: [] };

  const lim = Math.max(1, Math.min(50, Number(limit) || 8));

  // Double gate: allowlist membership AND access_tier = affiliate.
  const res = await db.query(
    `SELECT
       c.id AS chunk_id, c.content, c.access_tier, c.chunk_index,
       f.id AS file_id, f.drive_file_id, f.name AS file_name,
       f.web_view_link, f.client_id, f.mime_type,
       (c.embedding <=> $3::vector) AS distance
     FROM brain_chunks c
     JOIN brain_files f ON f.id = c.file_id
     JOIN brain_affiliate_allowlist a
       ON a.file_id = f.id AND a.org_id = c.org_id
     WHERE c.org_id = $1
       AND c.access_tier = 'affiliate'
       AND c.access_tier = ANY($2::brain_access_tier[])
       AND c.embedding IS NOT NULL
     ORDER BY c.embedding <=> $3::vector
     LIMIT $4`,
    [orgId, gate.tiers, emb.vec, lim]
  );

  return { ok: true, reason: null, chunks: mapRows(res.rows) };
}

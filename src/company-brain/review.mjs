// Apply classification results and owner-only review decisions.
// Live access_tier stays `owner` until auto-assigned or owner-approved (fail closed).
// Step 7: approving `affiliate` also upserts brain_affiliate_allowlist;
// reject / non-affiliate approve removes any allowlist row.

import {
  classifyHeuristic,
  classifyWithModel,
  canApproveClassification,
  normalizeProposedTier,
  AUTO_TIERS,
  REVIEW_TIERS
} from "./classify.mjs";

/** Set live access_tier on file + all its chunks. */
export async function setFileAccessTier(db, { fileId, orgId, tier } = {}) {
  const t = normalizeProposedTier(tier);
  await db.query(
    `UPDATE brain_files SET access_tier = $3, updated_at = now()
      WHERE id = $1 AND org_id = $2`,
    [fileId, orgId, t]
  );
  await db.query(
    `UPDATE brain_chunks SET access_tier = $3
      WHERE file_id = $1 AND org_id = $2`,
    [fileId, orgId, t]
  );
}

export async function enqueueClassificationReview(db, {
  orgId,
  fileId,
  driveFileId,
  proposedTier,
  rationale = ""
} = {}) {
  const tier = normalizeProposedTier(proposedTier);
  if (!REVIEW_TIERS.has(tier)) {
    return { ok: false, reason: "not_a_review_tier" };
  }

  // Close any prior pending row for this file, then insert fresh.
  await db.query(
    `UPDATE brain_classification_reviews
        SET status = 'rejected', decided_at = now(), updated_at = now()
      WHERE file_id = $1 AND status = 'pending'`,
    [fileId]
  );

  const ins = await db.query(
    `INSERT INTO brain_classification_reviews
       (org_id, file_id, drive_file_id, proposed_tier, rationale, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     RETURNING id`,
    [orgId, fileId, driveFileId, tier, String(rationale || "").slice(0, 1000)]
  );
  const reviewId = ins.rows?.[0]?.id;
  if (!reviewId) return { ok: false, reason: "enqueue_failed" };

  await db.query(
    `UPDATE brain_files SET
       classification_status = 'pending',
       proposed_tier = $3,
       classification_rationale = $4,
       updated_at = now()
     WHERE id = $1 AND org_id = $2`,
    [fileId, orgId, tier, String(rationale || "").slice(0, 1000)]
  );

  return { ok: true, reviewId, proposedTier: tier };
}

/**
 * Classify a stored file and either auto-assign or enqueue review.
 * Always leaves live tier at owner when not auto-assigning.
 */
export async function classifyAndApply(db, {
  orgId,
  fileId,
  driveFileId,
  name,
  path,
  text,
  parentNames,
  env = process.env,
  fetchImpl,
  classify = null
} = {}) {
  const result = classify
    ? await classify({ name, path, text, parentNames })
    : await classifyWithModel({ name, path, text, parentNames }, { env, fetchImpl });

  const proposedTier = normalizeProposedTier(result.proposedTier);
  const rationale = result.rationale || "";

  if (result.autoAssignable && AUTO_TIERS.has(proposedTier)) {
    await setFileAccessTier(db, { fileId, orgId, tier: proposedTier });
    await db.query(
      `UPDATE brain_files SET
         classification_status = 'auto',
         proposed_tier = $3,
         classification_rationale = $4,
         updated_at = now()
       WHERE id = $1 AND org_id = $2`,
      [fileId, orgId, proposedTier, rationale.slice(0, 1000)]
    );
    // Cancel stray pending reviews if content was reclassified to auto.
    await db.query(
      `UPDATE brain_classification_reviews
          SET status = 'rejected', decided_at = now(), updated_at = now()
        WHERE file_id = $1 AND status = 'pending'`,
      [fileId]
    );
    return {
      ok: true,
      mode: "auto",
      accessTier: proposedTier,
      proposedTier,
      rationale,
      source: result.source || "heuristic"
    };
  }

  // Fail closed: ensure live tier is owner while queued.
  await setFileAccessTier(db, { fileId, orgId, tier: "owner" });
  const queued = await enqueueClassificationReview(db, {
    orgId,
    fileId,
    driveFileId,
    proposedTier: REVIEW_TIERS.has(proposedTier) ? proposedTier : "owner",
    rationale
  });

  return {
    ok: true,
    mode: "queued",
    accessTier: "owner",
    proposedTier: queued.proposedTier || "owner",
    reviewId: queued.reviewId || null,
    rationale,
    source: result.source || "heuristic"
  };
}

export async function listPendingReviews(db, { orgId, limit = 50 } = {}) {
  const lim = Math.max(1, Math.min(200, Number(limit) || 50));
  const res = await db.query(
    `SELECT r.id, r.org_id, r.file_id, r.drive_file_id, r.proposed_tier,
            r.rationale, r.status, r.created_at,
            f.name AS file_name, f.web_view_link, f.mime_type, f.access_tier
       FROM brain_classification_reviews r
       JOIN brain_files f ON f.id = r.file_id
      WHERE r.org_id = $1 AND r.status = 'pending'
      ORDER BY r.created_at ASC
      LIMIT $2`,
    [orgId, lim]
  );
  return { ok: true, reviews: res.rows || [] };
}

/**
 * Owner-only approve/reject. Role must come from the session.
 */
export async function decideClassificationReview(db, {
  orgId,
  reviewId,
  role,
  decision, // 'approve' | 'reject'
  decidedBy = null
} = {}) {
  if (!canApproveClassification(role)) {
    return { ok: false, reason: "forbidden_role" };
  }
  const dec = String(decision || "").toLowerCase();
  if (dec !== "approve" && dec !== "reject") {
    return { ok: false, reason: "invalid_decision" };
  }

  const found = await db.query(
    `SELECT r.id, r.file_id, r.proposed_tier, r.status, f.drive_file_id
       FROM brain_classification_reviews r
       JOIN brain_files f ON f.id = r.file_id
      WHERE r.id = $1 AND r.org_id = $2`,
    [reviewId, orgId]
  );
  const row = found.rows?.[0];
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status !== "pending") return { ok: false, reason: "not_pending" };

  if (dec === "approve") {
    await setFileAccessTier(db, {
      fileId: row.file_id,
      orgId,
      tier: row.proposed_tier
    });
    await db.query(
      `UPDATE brain_files SET
         classification_status = 'approved',
         proposed_tier = $3,
         updated_at = now()
       WHERE id = $1 AND org_id = $2`,
      [row.file_id, orgId, row.proposed_tier]
    );
    await db.query(
      `UPDATE brain_classification_reviews SET
         status = 'approved', decided_by = $2, decided_at = now(), updated_at = now()
       WHERE id = $1`,
      [reviewId, decidedBy]
    );

    // Step 7: affiliate visibility requires an explicit allowlist row.
    if (row.proposed_tier === "affiliate") {
      await db.query(
        `INSERT INTO brain_affiliate_allowlist
           (org_id, file_id, drive_file_id, review_id, approved_by, approved_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (org_id, file_id) DO UPDATE SET
           drive_file_id = EXCLUDED.drive_file_id,
           review_id = EXCLUDED.review_id,
           approved_by = EXCLUDED.approved_by,
           approved_at = now()`,
        [orgId, row.file_id, row.drive_file_id, reviewId, decidedBy]
      );
    } else {
      await db.query(
        `DELETE FROM brain_affiliate_allowlist
          WHERE org_id = $1 AND file_id = $2`,
        [orgId, row.file_id]
      );
    }

    return {
      ok: true,
      decision: "approved",
      accessTier: row.proposed_tier,
      fileId: row.file_id,
      affiliateAllowlisted: row.proposed_tier === "affiliate"
    };
  }

  // reject — stay owner; never leave an allowlist entry
  await setFileAccessTier(db, { fileId: row.file_id, orgId, tier: "owner" });
  await db.query(
    `UPDATE brain_files SET
       classification_status = 'rejected',
       proposed_tier = 'owner',
       updated_at = now()
     WHERE id = $1 AND org_id = $2`,
    [row.file_id, orgId]
  );
  await db.query(
    `UPDATE brain_classification_reviews SET
       status = 'rejected', decided_by = $2, decided_at = now(), updated_at = now()
     WHERE id = $1`,
    [reviewId, decidedBy]
  );
  await db.query(
    `DELETE FROM brain_affiliate_allowlist
      WHERE org_id = $1 AND file_id = $2`,
    [orgId, row.file_id]
  );
  return {
    ok: true,
    decision: "rejected",
    accessTier: "owner",
    fileId: row.file_id,
    affiliateAllowlisted: false
  };
}

export { classifyHeuristic, classifyWithModel, canApproveClassification };

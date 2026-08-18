// Upload approval gating — board §3.6 (W5).
//
// The rule being proved here: a staff-uploaded document must not appear in ANY
// answer until the owner approves it. The gate is brain_files.approval_status,
// applied in SQL before ranking, so a pending or rejected document never
// reaches the model at all.
//
// The fake database below deliberately honours the WHERE clauses that the real
// SQL carries. If someone deletes `AND f.approval_status = 'approved'` from
// retrieve.mjs, the fake stops filtering and these tests go red — which is the
// whole point. A test that only string-matched the SQL would not catch a filter
// that was moved somewhere ineffective.

import test from "node:test";
import assert from "node:assert/strict";

import { ROLE_SETS } from "../http/read-api.mjs";
import { retrieveChunks, retrieveAffiliateChunks } from "./retrieve.mjs";
import {
  classifyAndApply,
  enqueueClassificationReview,
  decideClassificationReview,
  listPendingReviews
} from "./review.mjs";
import reviewsHandler from "../../api/company-brain/reviews.mjs";

const ORG = "org-1";
const EMBED = async () => ({ ok: true, embeddings: [new Array(1536).fill(0)] });

/** Every role that may call the staff Company Brain path — owner included. */
const STAFF_ROLES = [...ROLE_SETS.STAFF];

/** Roles that must never be able to decide a review (H-3). admin is here on purpose. */
const NON_DECIDER_ROLES = [
  "admin", "closer", "setter", "sales_manager", "funding_advisor",
  "inquiry_specialist", "affiliate", "partner", "client", "", null, undefined
];

/**
 * Fake Postgres for brain_files / brain_chunks / brain_classification_reviews.
 * Applies the filters the SQL actually asks for.
 */
function brainDb() {
  const files = new Map();   // fileId -> row
  const chunks = [];         // chunk rows
  const reviews = new Map(); // reviewId -> row
  const allowlist = new Map(); // fileId -> row
  let seq = 1;

  const api = {
    files,
    chunks,
    reviews,
    allowlist,
    lastRetrievalSql: null,

    addFile(row) {
      const f = {
        org_id: ORG,
        name: `${row.id}.pdf`,
        mime_type: "application/pdf",
        web_view_link: null,
        drive_file_id: `drive-${row.id}`,
        client_id: null,
        access_tier: "owner",
        approval_status: "approved",
        source: "drive",
        size_bytes: null,
        original_name: null,
        ...row
      };
      files.set(f.id, f);
      return f;
    },

    addChunk(fileId, { tier, content = "text", index = 0 } = {}) {
      const c = {
        id: `chunk-${seq++}`,
        org_id: ORG,
        file_id: fileId,
        chunk_index: index,
        content,
        access_tier: tier
      };
      chunks.push(c);
      return c;
    },

    tiersOfChunksFor(fileId) {
      return chunks.filter((c) => c.file_id === fileId).map((c) => c.access_tier);
    },

    async query(sql, params) {
      // ---- retrieval ------------------------------------------------------
      if (/FROM brain_chunks c/i.test(sql)) {
        api.lastRetrievalSql = sql;
        const [orgId, tiers] = params;
        const external = /brain_affiliate_allowlist/i.test(sql);
        const requiresApproved = /f\.approval_status = 'approved'/i.test(sql);
        const excludesAffiliate = /c\.access_tier <> 'affiliate'/i.test(sql);
        const affiliateOnly = /c\.access_tier = 'affiliate'/i.test(sql);

        let rows = chunks.filter((c) => c.org_id === orgId && tiers.includes(c.access_tier));
        if (excludesAffiliate) rows = rows.filter((c) => c.access_tier !== "affiliate");
        if (affiliateOnly) rows = rows.filter((c) => c.access_tier === "affiliate");
        if (external) rows = rows.filter((c) => allowlist.has(c.file_id));
        if (requiresApproved) {
          rows = rows.filter((c) => files.get(c.file_id)?.approval_status === "approved");
        }
        return {
          rows: rows.map((c) => {
            const f = files.get(c.file_id) || {};
            return {
              chunk_id: c.id,
              content: c.content,
              access_tier: c.access_tier,
              chunk_index: c.chunk_index,
              file_id: c.file_id,
              drive_file_id: f.drive_file_id ?? null,
              file_name: f.name ?? null,
              web_view_link: f.web_view_link ?? null,
              client_id: f.client_id ?? null,
              mime_type: f.mime_type ?? null,
              distance: 0.1
            };
          })
        };
      }

      // ---- tier writes ----------------------------------------------------
      if (/UPDATE brain_files SET access_tier/i.test(sql)) {
        const [fileId, , tier] = params;
        const f = files.get(fileId);
        if (f) f.access_tier = tier;
        return { rows: [] };
      }
      if (/UPDATE brain_chunks SET access_tier/i.test(sql)) {
        const [fileId, , tier] = params;
        for (const c of chunks) if (c.file_id === fileId) c.access_tier = tier;
        return { rows: [] };
      }

      // ---- brain_files status writes --------------------------------------
      if (/UPDATE brain_files SET/i.test(sql)) {
        const f = files.get(params[0]);
        if (f) {
          if (/classification_status = 'approved'/i.test(sql)) f.classification_status = "approved";
          if (/classification_status = 'rejected'/i.test(sql)) f.classification_status = "rejected";
          if (/classification_status = 'pending'/i.test(sql)) f.classification_status = "pending";
          if (/classification_status = 'auto'/i.test(sql)) f.classification_status = "auto";
          if (/approval_status = 'approved'/i.test(sql)) f.approval_status = "approved";
          if (/approval_status = 'rejected'/i.test(sql)) f.approval_status = "rejected";
          if (/proposed_tier = 'owner'/i.test(sql)) f.proposed_tier = "owner";
          else if (/proposed_tier = \$3/i.test(sql)) f.proposed_tier = params[2];
        }
        return { rows: [] };
      }

      // ---- reviews ---------------------------------------------------------
      if (/UPDATE brain_classification_reviews[\s\S]*status = 'rejected'/i.test(sql)
        && /WHERE file_id = \$1 AND status = 'pending'/i.test(sql)) {
        for (const r of reviews.values()) {
          if (r.file_id === params[0] && r.status === "pending") r.status = "rejected";
        }
        return { rows: [] };
      }
      if (/INSERT INTO brain_classification_reviews/i.test(sql)) {
        const id = `review-${seq++}`;
        reviews.set(id, {
          id,
          org_id: params[0],
          file_id: params[1],
          drive_file_id: params[2],
          proposed_tier: params[3],
          rationale: params[4],
          kind: params[5],
          status: "pending"
        });
        return { rows: [{ id }] };
      }
      if (/UPDATE brain_classification_reviews SET\s+status = 'approved'/i.test(sql)) {
        const r = reviews.get(params[0]);
        if (r) { r.status = "approved"; r.decided_by = params[1]; }
        return { rows: [] };
      }
      if (/UPDATE brain_classification_reviews SET\s+status = 'rejected'/i.test(sql)) {
        const r = reviews.get(params[0]);
        if (r) { r.status = "rejected"; r.decided_by = params[1]; }
        return { rows: [] };
      }
      if (/r\.id = \$1/i.test(sql) && /FROM brain_classification_reviews r/i.test(sql)) {
        const r = reviews.get(params[0]);
        if (!r || r.org_id !== params[1]) return { rows: [] };
        const f = files.get(r.file_id) || {};
        return { rows: [{ ...r, drive_file_id: f.drive_file_id ?? r.drive_file_id }] };
      }
      if (/FROM brain_classification_reviews r/i.test(sql)) {
        const rows = [...reviews.values()]
          .filter((r) => r.org_id === params[0] && r.status === "pending")
          .map((r) => {
            const f = files.get(r.file_id) || {};
            return {
              ...r,
              file_name: f.name ?? null,
              web_view_link: f.web_view_link ?? null,
              mime_type: f.mime_type ?? null,
              access_tier: f.access_tier ?? "owner",
              source: f.source ?? "drive",
              approval_status: f.approval_status ?? "approved",
              size_bytes: f.size_bytes ?? null,
              original_name: f.original_name ?? null
            };
          });
        return { rows };
      }

      // ---- allowlist -------------------------------------------------------
      if (/INSERT INTO brain_affiliate_allowlist/i.test(sql)) {
        allowlist.set(params[1], { org_id: params[0], file_id: params[1] });
        return { rows: [] };
      }
      if (/DELETE FROM brain_affiliate_allowlist/i.test(sql)) {
        allowlist.delete(params[1]);
        return { rows: [] };
      }

      return { rows: [] };
    }
  };
  return api;
}

/**
 * One approved Drive file plus one upload in the given approval state.
 * Both carry `public` chunks, the tier every staff role can read — so the ONLY
 * thing that can keep the upload out of an answer is its approval status.
 */
function seedWithUpload(approvalStatus, { tier = "public" } = {}) {
  const db = brainDb();
  db.addFile({ id: "drive-file", name: "Drive SOP.pdf", access_tier: tier, source: "drive", approval_status: "approved" });
  db.addChunk("drive-file", { tier, content: "Drive answer" });
  db.addFile({
    id: "upload-file",
    name: "Uploaded Script.pdf",
    access_tier: tier,
    source: "upload",
    approval_status: approvalStatus,
    size_bytes: 184213,
    original_name: "Uploaded Script.pdf",
    drive_file_id: "upload:abc"
  });
  db.addChunk("upload-file", { tier, content: "Uploaded answer" });
  return db;
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

/* ------------------------------------------------------------------ */
/* 1. pending uploads are invisible to every staff role, owner included */
/* ------------------------------------------------------------------ */

test("pending upload is excluded from retrieveChunks for EVERY staff role", async () => {
  assert.ok(STAFF_ROLES.includes("owner"), "owner must be covered");
  assert.ok(STAFF_ROLES.includes("admin"), "admin must be covered");

  for (const role of STAFF_ROLES) {
    const db = seedWithUpload("pending");
    const out = await retrieveChunks(db, {
      orgId: ORG, role, query: "script", embed: EMBED
    });
    assert.equal(out.ok, true, role);
    const fileIds = out.chunks.map((c) => c.fileId);
    assert.ok(!fileIds.includes("upload-file"), `${role} must not see a pending upload`);
    assert.ok(fileIds.includes("drive-file"), `${role} should still see approved Drive content`);
  }
});

test("owner cannot see a pending upload even at the owner tier", async () => {
  const db = seedWithUpload("pending", { tier: "owner" });
  const out = await retrieveChunks(db, {
    orgId: ORG, role: "owner", query: "script", embed: EMBED
  });
  assert.equal(out.ok, true);
  assert.deepEqual(out.chunks.map((c) => c.fileId), ["drive-file"]);
});

test("staff retrieval SQL carries the approval filter before ranking", async () => {
  const db = seedWithUpload("pending");
  await retrieveChunks(db, { orgId: ORG, role: "closer", query: "script", embed: EMBED });
  const sql = db.lastRetrievalSql;
  assert.match(sql, /f\.approval_status = 'approved'/i);
  // The filter must sit in WHERE, ahead of ORDER BY — not applied after ranking.
  assert.ok(
    sql.indexOf("approval_status") < sql.indexOf("ORDER BY"),
    "approval filter must run before ranking"
  );
});

/* ------------------------------------------------------------------ */
/* 2. affiliate path is gated too                                      */
/* ------------------------------------------------------------------ */

test("pending upload is excluded from retrieveAffiliateChunks even when allowlisted", async () => {
  for (const role of ["affiliate", "partner"]) {
    const db = seedWithUpload("pending", { tier: "affiliate" });
    // Worst case on purpose: both files are allowlisted and both are affiliate tier.
    db.allowlist.set("drive-file", { org_id: ORG, file_id: "drive-file" });
    db.allowlist.set("upload-file", { org_id: ORG, file_id: "upload-file" });

    const out = await retrieveAffiliateChunks(db, {
      orgId: ORG, role, query: "partner kit", embed: EMBED
    });
    assert.equal(out.ok, true, role);
    const fileIds = out.chunks.map((c) => c.fileId);
    assert.ok(!fileIds.includes("upload-file"), `${role} must not see a pending upload`);
    assert.ok(fileIds.includes("drive-file"), `${role} should still see approved content`);
    assert.match(db.lastRetrievalSql, /f\.approval_status = 'approved'/i);
  }
});

/* ------------------------------------------------------------------ */
/* 3. rejected is never returned, ever                                 */
/* ------------------------------------------------------------------ */

test("rejected upload is never returned on the staff path, at any tier", async () => {
  for (const tier of ["public", "sales", "staff", "owner"]) {
    for (const role of STAFF_ROLES) {
      const db = seedWithUpload("rejected", { tier });
      const out = await retrieveChunks(db, {
        orgId: ORG, role, query: "script", embed: EMBED
      });
      assert.equal(out.ok, true, `${role}/${tier}`);
      assert.ok(
        !out.chunks.map((c) => c.fileId).includes("upload-file"),
        `${role} must never see a rejected upload at tier ${tier}`
      );
    }
  }
});

test("rejected upload is never returned on the affiliate path", async () => {
  const db = seedWithUpload("rejected", { tier: "affiliate" });
  db.allowlist.set("drive-file", { org_id: ORG, file_id: "drive-file" });
  db.allowlist.set("upload-file", { org_id: ORG, file_id: "upload-file" });
  const out = await retrieveAffiliateChunks(db, {
    orgId: ORG, role: "affiliate", query: "kit", embed: EMBED
  });
  assert.equal(out.ok, true);
  assert.deepEqual(out.chunks.map((c) => c.fileId), ["drive-file"]);
});

/* ------------------------------------------------------------------ */
/* 4. enqueue — uploads may queue at any tier, Drive path unchanged     */
/* ------------------------------------------------------------------ */

test("an upload may be queued at any of the five tiers", async () => {
  for (const tier of ["public", "sales", "staff", "owner", "affiliate"]) {
    const db = brainDb();
    db.addFile({ id: "u1", source: "upload", approval_status: "pending", access_tier: "owner" });
    const out = await enqueueClassificationReview(db, {
      orgId: ORG,
      fileId: "u1",
      driveFileId: "upload:u1",
      proposedTier: tier,
      kind: "upload"
    });
    assert.equal(out.ok, true, tier);
    assert.equal(out.proposedTier, tier);
    assert.equal(db.reviews.get(out.reviewId).kind, "upload");
  }
});

test("the Drive classification path still refuses public/sales/staff", async () => {
  for (const tier of ["public", "sales", "staff"]) {
    const db = brainDb();
    db.addFile({ id: "d1" });
    const out = await enqueueClassificationReview(db, {
      orgId: ORG, fileId: "d1", driveFileId: "drive-d1", proposedTier: tier
    });
    assert.equal(out.ok, false, tier);
    assert.equal(out.reason, "not_a_review_tier");
    assert.equal(db.reviews.size, 0);
  }
  for (const tier of ["owner", "affiliate"]) {
    const db = brainDb();
    db.addFile({ id: "d2" });
    const out = await enqueueClassificationReview(db, {
      orgId: ORG, fileId: "d2", driveFileId: "drive-d2", proposedTier: tier
    });
    assert.equal(out.ok, true, tier);
    assert.equal(db.reviews.get(out.reviewId).kind, "classification");
  }
});

/* ------------------------------------------------------------------ */
/* 5. approve — file and every chunk carry the approved tier + status   */
/* ------------------------------------------------------------------ */

test("approve sets approval_status and the approved tier on file AND all chunks", async () => {
  const db = brainDb();
  db.addFile({
    id: "u2", name: "Closer Script v4.pdf", source: "upload",
    approval_status: "pending", access_tier: "owner", size_bytes: 184213
  });
  db.addChunk("u2", { tier: "owner", index: 0, content: "one" });
  db.addChunk("u2", { tier: "owner", index: 1, content: "two" });
  db.addChunk("u2", { tier: "owner", index: 2, content: "three" });

  const queued = await enqueueClassificationReview(db, {
    orgId: ORG, fileId: "u2", driveFileId: "upload:u2",
    proposedTier: "sales", kind: "upload"
  });
  assert.equal(queued.ok, true);

  // Before approval nothing is answerable, not even for the owner.
  const before = await retrieveChunks(db, {
    orgId: ORG, role: "owner", query: "script", embed: EMBED
  });
  assert.equal(before.chunks.length, 0);

  const decided = await decideClassificationReview(db, {
    orgId: ORG, reviewId: queued.reviewId, role: "owner",
    decision: "approve", decidedBy: "staff-owner"
  });
  assert.equal(decided.ok, true);
  assert.equal(decided.decision, "approved");
  assert.equal(decided.approvalStatus, "approved");
  assert.equal(decided.accessTier, "sales");
  assert.equal(decided.kind, "upload");

  const file = db.files.get("u2");
  assert.equal(file.approval_status, "approved");
  assert.equal(file.access_tier, "sales");
  assert.deepEqual(db.tiersOfChunksFor("u2"), ["sales", "sales", "sales"]);

  // Now a closer can read it — and only now.
  const after = await retrieveChunks(db, {
    orgId: ORG, role: "closer", query: "script", embed: EMBED
  });
  assert.equal(after.chunks.length, 3);
});

test("reject leaves the tier at owner and the document unanswerable", async () => {
  const db = brainDb();
  db.addFile({ id: "u3", source: "upload", approval_status: "pending", access_tier: "owner" });
  db.addChunk("u3", { tier: "owner" });

  const queued = await enqueueClassificationReview(db, {
    orgId: ORG, fileId: "u3", driveFileId: "upload:u3",
    proposedTier: "public", kind: "upload"
  });
  const out = await decideClassificationReview(db, {
    orgId: ORG, reviewId: queued.reviewId, role: "owner", decision: "reject"
  });
  assert.equal(out.ok, true);
  assert.equal(out.approvalStatus, "rejected");
  assert.equal(out.accessTier, "owner");

  const file = db.files.get("u3");
  assert.equal(file.approval_status, "rejected");
  assert.equal(file.access_tier, "owner");
  assert.deepEqual(db.tiersOfChunksFor("u3"), ["owner"]);
  assert.equal(db.allowlist.has("u3"), false);

  for (const role of STAFF_ROLES) {
    const got = await retrieveChunks(db, { orgId: ORG, role, query: "x", embed: EMBED });
    assert.equal(got.chunks.length, 0, `${role} must not read a rejected upload`);
  }
});

/* ------------------------------------------------------------------ */
/* 6. only the owner decides — admin explicitly included in the check   */
/* ------------------------------------------------------------------ */

test("approve and reject are refused for every role except owner", async () => {
  for (const decision of ["approve", "reject"]) {
    for (const role of NON_DECIDER_ROLES) {
      const db = brainDb();
      db.addFile({ id: "u4", source: "upload", approval_status: "pending", access_tier: "owner" });
      db.addChunk("u4", { tier: "owner" });
      const queued = await enqueueClassificationReview(db, {
        orgId: ORG, fileId: "u4", driveFileId: "upload:u4",
        proposedTier: "sales", kind: "upload"
      });

      const out = await decideClassificationReview(db, {
        orgId: ORG, reviewId: queued.reviewId, role, decision
      });
      assert.equal(out.ok, false, `${role} / ${decision}`);
      assert.equal(out.reason, "forbidden_role", `${role} / ${decision}`);

      // Nothing moved: the document is still pending and still owner-tier.
      assert.equal(db.files.get("u4").approval_status, "pending");
      assert.equal(db.files.get("u4").access_tier, "owner");
      assert.equal(db.reviews.get(queued.reviewId).status, "pending");
    }
  }
});

test("admin is refused specifically — H-3 owner-set, do not widen", async () => {
  const db = brainDb();
  db.addFile({ id: "u5", source: "upload", approval_status: "pending", access_tier: "owner" });
  const queued = await enqueueClassificationReview(db, {
    orgId: ORG, fileId: "u5", driveFileId: "upload:u5",
    proposedTier: "staff", kind: "upload"
  });
  const denied = await decideClassificationReview(db, {
    orgId: ORG, reviewId: queued.reviewId, role: "admin", decision: "approve"
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, "forbidden_role");
  assert.equal(db.files.get("u5").approval_status, "pending");

  const allowed = await decideClassificationReview(db, {
    orgId: ORG, reviewId: queued.reviewId, role: "owner", decision: "approve"
  });
  assert.equal(allowed.ok, true);
  assert.equal(db.files.get("u5").approval_status, "approved");
});

test("the reviews endpoint refuses admin on GET and POST", async () => {
  const getRes = mockRes();
  await reviewsHandler({ method: "GET" }, getRes, {
    requireAuth: async () => ({ id: "s1", org_id: ORG, role: "admin" })
  });
  assert.equal(getRes.statusCode, 403);

  const postRes = mockRes();
  await reviewsHandler(
    { method: "POST", body: { review_id: "550e8400-e29b-41d4-a716-446655440000", decision: "approve" } },
    postRes,
    { requireAuth: async () => ({ id: "s1", org_id: ORG, role: "admin" }) }
  );
  assert.equal(postRes.statusCode, 403);
});

/* ------------------------------------------------------------------ */
/* 7. the owner queue shows uploads next to Drive classifications       */
/* ------------------------------------------------------------------ */

test("reviews GET lists uploads with name, kind, tier and size — old fields intact", async () => {
  const db = brainDb();
  db.addFile({
    id: "u6", name: "Closer Script v4.pdf", mime_type: "application/pdf",
    source: "upload", approval_status: "pending", access_tier: "owner",
    size_bytes: 184213, original_name: "Closer Script v4.pdf",
    drive_file_id: "upload:u6"
  });
  db.addFile({
    id: "d6", name: "Operating agreement.pdf", source: "drive",
    approval_status: "approved", access_tier: "owner",
    web_view_link: "https://drive.google.com/file/d/d6"
  });
  await enqueueClassificationReview(db, {
    orgId: ORG, fileId: "u6", driveFileId: "upload:u6",
    proposedTier: "sales", kind: "upload"
  });
  await enqueueClassificationReview(db, {
    orgId: ORG, fileId: "d6", driveFileId: "drive-d6", proposedTier: "owner"
  });

  const listed = await listPendingReviews(db, { orgId: ORG });
  assert.equal(listed.reviews.length, 2);

  const res = mockRes();
  await reviewsHandler({ method: "GET" }, res, {
    db,
    requireAuth: async () => ({ id: "s1", org_id: ORG, role: "owner" })
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.reviews.length, 2);
  assert.equal(res.body.uploadCount, 1);

  const upload = res.body.reviews.find((r) => r.file_id === "u6");
  assert.equal(upload.kind, "upload");
  assert.equal(upload.isUpload, true);
  assert.equal(upload.source, "upload");
  assert.equal(upload.fileName, "Closer Script v4.pdf");
  assert.equal(upload.proposedTier, "sales");
  assert.equal(upload.sizeBytes, 184213);
  assert.equal(upload.approvalStatus, "pending");

  const drive = res.body.reviews.find((r) => r.file_id === "d6");
  assert.equal(drive.kind, "classification");
  assert.equal(drive.isUpload, false);
  assert.equal(drive.sizeBytes, null);

  // Every field the existing screen already reads is still present, unrenamed.
  for (const row of res.body.reviews) {
    for (const key of [
      "id", "org_id", "file_id", "drive_file_id", "proposed_tier",
      "rationale", "status", "file_name", "web_view_link", "mime_type", "access_tier"
    ]) {
      assert.ok(key in row, `existing field ${key} must survive`);
    }
  }
});

/* ------------------------------------------------------------------ */
/* 8. classifyAndApply must never auto-assign an upload (board §3.6)    */
/* ------------------------------------------------------------------ */

test("an upload proposing sales still queues — it is never auto-assigned", async () => {
  const db = brainDb();
  db.addFile({ id: "u7", source: "upload", approval_status: "pending", access_tier: "owner" });
  db.addChunk("u7", { tier: "owner" });

  const out = await classifyAndApply(db, {
    orgId: ORG,
    fileId: "u7",
    driveFileId: "upload:u7",
    name: "Closer objection script.pdf",
    kind: "upload",
    classify: async () => ({
      proposedTier: "sales", autoAssignable: true, rationale: "sales", source: "test"
    })
  });

  assert.equal(out.mode, "queued", "an upload must queue, not auto-assign");
  assert.equal(out.kind, "upload");
  assert.equal(out.proposedTier, "sales");
  assert.ok(out.reviewId, "an upload must get a review row");
  assert.equal(db.files.get("u7").access_tier, "owner", "live tier stays owner while queued");
  assert.equal(db.files.get("u7").approval_status, "pending");
  assert.equal(db.reviews.get(out.reviewId).kind, "upload");

  // Still unreadable by anyone, including the owner.
  for (const role of STAFF_ROLES) {
    const got = await retrieveChunks(db, { orgId: ORG, role, query: "x", embed: EMBED });
    assert.equal(got.chunks.length, 0, `${role} must not read a queued upload`);
  }
});

test("the Drive path still auto-assigns sales — behaviour unchanged", async () => {
  const db = brainDb();
  db.addFile({ id: "d7", source: "drive", approval_status: "approved", access_tier: "owner" });
  db.addChunk("d7", { tier: "owner" });

  const out = await classifyAndApply(db, {
    orgId: ORG,
    fileId: "d7",
    driveFileId: "drive-d7",
    name: "Closer objection script.pdf",
    classify: async () => ({
      proposedTier: "sales", autoAssignable: true, rationale: "sales", source: "test"
    })
  });

  assert.equal(out.mode, "auto");
  assert.equal(db.files.get("d7").access_tier, "sales");
  assert.deepEqual(db.tiersOfChunksFor("d7"), ["sales"]);
  assert.equal(db.reviews.size, 0, "the Drive auto path must not queue a review");

  // And an approved Drive file is readable straight away — no new gate on Drive.
  const got = await retrieveChunks(db, { orgId: ORG, role: "closer", query: "x", embed: EMBED });
  assert.equal(got.chunks.length, 1);
});

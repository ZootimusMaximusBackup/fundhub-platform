import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyHeuristic,
  canApproveClassification,
  AUTO_TIERS
} from "./classify.mjs";
import {
  classifyAndApply,
  decideClassificationReview,
  listPendingReviews,
  setFileAccessTier
} from "./review.mjs";

test("heuristic auto-assigns sales/staff/public", () => {
  const sales = classifyHeuristic({ name: "Closer objection script.docx", text: "rebuttal" });
  assert.equal(sales.proposedTier, "sales");
  assert.equal(sales.autoAssignable, true);

  const staff = classifyHeuristic({ name: "SOP — onboarding.md", text: "standard operating process" });
  assert.equal(staff.proposedTier, "staff");
  assert.equal(staff.autoAssignable, true);

  const pub = classifyHeuristic({ name: "VSL landing page copy", text: "marketing published" });
  assert.equal(pub.proposedTier, "public");
  assert.equal(pub.autoAssignable, true);
});

test("heuristic queues owner and affiliate — never auto", () => {
  const owner = classifyHeuristic({ name: "LLC operating agreement.pdf", text: "cap table" });
  assert.equal(owner.proposedTier, "owner");
  assert.equal(owner.autoAssignable, false);

  const aff = classifyHeuristic({ name: "Affiliate partner kit", text: "white-label portal" });
  assert.equal(aff.proposedTier, "affiliate");
  assert.equal(aff.autoAssignable, false);

  const unk = classifyHeuristic({ name: "notes.txt", text: "misc thoughts" });
  assert.equal(unk.proposedTier, "owner");
  assert.equal(unk.autoAssignable, false);
});

test("H-3: only owner role can approve", () => {
  assert.equal(canApproveClassification("owner"), true);
  assert.equal(canApproveClassification("admin"), false);
  assert.equal(canApproveClassification("closer"), false);
});

function reviewDb() {
  const files = new Map();
  const chunks = new Map(); // fileId -> tier
  const reviews = new Map();
  let seq = 1;
  return {
    files,
    chunks,
    reviews,
    async query(sql, params) {
      if (/UPDATE brain_files SET access_tier/i.test(sql)) {
        const [fileId, orgId, tier] = params;
        const f = files.get(fileId) || { id: fileId, org_id: orgId };
        f.access_tier = tier;
        files.set(fileId, f);
        return { rows: [] };
      }
      if (/UPDATE brain_chunks SET access_tier/i.test(sql)) {
        chunks.set(params[0], params[2]);
        return { rows: [] };
      }
      if (/UPDATE brain_files SET\s+classification_status = 'auto'/i.test(sql)
        || /classification_status = 'auto'/i.test(sql)) {
        const f = files.get(params[0]) || { id: params[0] };
        f.classification_status = "auto";
        f.proposed_tier = params[2];
        files.set(params[0], f);
        return { rows: [] };
      }
      if (/UPDATE brain_files SET\s+classification_status = 'pending'/i.test(sql)
        || /classification_status = 'pending'/i.test(sql)) {
        const f = files.get(params[0]) || { id: params[0] };
        f.classification_status = "pending";
        f.proposed_tier = params[2];
        files.set(params[0], f);
        return { rows: [] };
      }
      if (/UPDATE brain_files SET\s+classification_status = 'approved'/i.test(sql)
        || /classification_status = 'approved'/i.test(sql)) {
        const f = files.get(params[0]) || { id: params[0] };
        f.classification_status = "approved";
        f.proposed_tier = params[2];
        files.set(params[0], f);
        return { rows: [] };
      }
      if (/UPDATE brain_files SET\s+classification_status = 'rejected'/i.test(sql)
        || /classification_status = 'rejected'/i.test(sql)) {
        const f = files.get(params[0]) || { id: params[0] };
        f.classification_status = "rejected";
        f.proposed_tier = "owner";
        files.set(params[0], f);
        return { rows: [] };
      }
      if (/UPDATE brain_classification_reviews[\s\S]*status = 'rejected'/i.test(sql)
          && /status = 'pending'/i.test(sql)) {
        for (const [id, r] of reviews) {
          if (r.file_id === params[0] && r.status === "pending") {
            r.status = "rejected";
            reviews.set(id, r);
          }
        }
        return { rows: [] };
      }
      if (/INSERT INTO brain_classification_reviews/i.test(sql)) {
        const id = `rev-${seq++}`;
        reviews.set(id, {
          id,
          org_id: params[0],
          file_id: params[1],
          drive_file_id: params[2],
          proposed_tier: params[3],
          rationale: params[4],
          status: "pending"
        });
        return { rows: [{ id }] };
      }
      if (/FROM brain_classification_reviews r/i.test(sql)) {
        const rows = [...reviews.values()]
          .filter((r) => r.org_id === params[0] && r.status === "pending")
          .map((r) => ({
            ...r,
            file_name: "f",
            web_view_link: null,
            mime_type: "text/plain",
            access_tier: files.get(r.file_id)?.access_tier || "owner"
          }));
        return { rows };
      }
      if (/FROM brain_classification_reviews\s+WHERE id/i.test(sql)
        || /SELECT id, file_id, proposed_tier, status/i.test(sql)) {
        const r = reviews.get(params[0]);
        if (!r || r.org_id !== params[1]) return { rows: [] };
        return { rows: [r] };
      }
      if (/UPDATE brain_classification_reviews SET\s+status = 'approved'/i.test(sql)) {
        const r = reviews.get(params[0]);
        if (r) { r.status = "approved"; r.decided_by = params[1]; }
        return { rows: [] };
      }
      if (/UPDATE brain_classification_reviews SET\s+status = 'rejected'/i.test(sql)
          && /decided_by/i.test(sql)) {
        const r = reviews.get(params[0]);
        if (r) { r.status = "rejected"; r.decided_by = params[1]; }
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
}

test("classifyAndApply auto-assigns sales and updates live tier", async () => {
  const db = reviewDb();
  db.files.set("f1", { id: "f1", org_id: "org", access_tier: "owner" });
  const out = await classifyAndApply(db, {
    orgId: "org",
    fileId: "f1",
    driveFileId: "d1",
    name: "Closer objection handling",
    text: "roleplay rebuttal",
    classify: async () => ({
      proposedTier: "sales",
      autoAssignable: true,
      rationale: "sales",
      source: "test"
    })
  });
  assert.equal(out.mode, "auto");
  assert.equal(out.accessTier, "sales");
  assert.equal(db.files.get("f1").access_tier, "sales");
  assert.equal(db.chunks.get("f1"), "sales");
  assert.ok(AUTO_TIERS.has("sales"));
});

test("classifyAndApply queues affiliate and keeps live tier owner", async () => {
  const db = reviewDb();
  db.files.set("f2", { id: "f2", org_id: "org", access_tier: "owner" });
  const out = await classifyAndApply(db, {
    orgId: "org",
    fileId: "f2",
    driveFileId: "d2",
    name: "Affiliate kit",
    classify: async () => ({
      proposedTier: "affiliate",
      autoAssignable: false,
      rationale: "external",
      source: "test"
    })
  });
  assert.equal(out.mode, "queued");
  assert.equal(out.accessTier, "owner");
  assert.equal(out.proposedTier, "affiliate");
  assert.equal(db.files.get("f2").access_tier, "owner");
  const listed = await listPendingReviews(db, { orgId: "org" });
  assert.equal(listed.reviews.length, 1);
  assert.equal(listed.reviews[0].proposed_tier, "affiliate");
});

test("decideClassificationReview approve is owner-only", async () => {
  const db = reviewDb();
  db.files.set("f3", { id: "f3", org_id: "org", access_tier: "owner" });
  const queued = await classifyAndApply(db, {
    orgId: "org",
    fileId: "f3",
    driveFileId: "d3",
    classify: async () => ({
      proposedTier: "owner",
      autoAssignable: false,
      rationale: "legal",
      source: "test"
    })
  });

  const denied = await decideClassificationReview(db, {
    orgId: "org",
    reviewId: queued.reviewId,
    role: "admin",
    decision: "approve"
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, "forbidden_role");

  const ok = await decideClassificationReview(db, {
    orgId: "org",
    reviewId: queued.reviewId,
    role: "owner",
    decision: "approve",
    decidedBy: "staff-1"
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.accessTier, "owner");
  assert.equal(db.files.get("f3").classification_status, "approved");
});

test("decideClassificationReview reject keeps owner", async () => {
  const db = reviewDb();
  db.files.set("f4", { id: "f4", org_id: "org", access_tier: "owner" });
  const queued = await classifyAndApply(db, {
    orgId: "org",
    fileId: "f4",
    driveFileId: "d4",
    classify: async () => ({
      proposedTier: "affiliate",
      autoAssignable: false,
      rationale: "maybe",
      source: "test"
    })
  });
  const out = await decideClassificationReview(db, {
    orgId: "org",
    reviewId: queued.reviewId,
    role: "owner",
    decision: "reject"
  });
  assert.equal(out.ok, true);
  assert.equal(out.accessTier, "owner");
  assert.equal(db.files.get("f4").access_tier, "owner");
  assert.equal(db.files.get("f4").classification_status, "rejected");
});

test("setFileAccessTier updates file and chunks", async () => {
  const db = reviewDb();
  db.files.set("f5", { id: "f5", org_id: "org", access_tier: "owner" });
  await setFileAccessTier(db, { fileId: "f5", orgId: "org", tier: "staff" });
  assert.equal(db.files.get("f5").access_tier, "staff");
  assert.equal(db.chunks.get("f5"), "staff");
});

import test from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/company-brain/upload.mjs";
import { ingestUploadedFile, listUploads, uploadDriveFileId } from "../company-brain/upload.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const STAFF = "22222222-2222-4222-8222-222222222222";

const PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n", "ascii");
const ELF_BYTES = Buffer.from([
  0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
]);

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

function multipartReq(file, { method = "POST", fields = {} } = {}) {
  return {
    method,
    body: {
      fields,
      files: file ? [{ field: "file", filename: file.filename, mimeType: file.mimeType, buffer: file.buffer, size: file.buffer.length }] : []
    }
  };
}

function staffDeps(over = {}) {
  return {
    requireAuth: async () => ({ id: STAFF, org_id: ORG, role: "closer" }),
    db: { query: async () => ({ rows: [] }) },
    env: {},
    ...over
  };
}

/* ---- the endpoint, §3.1 ------------------------------------------------ */

test("upload refuses a method that is neither GET nor POST", async () => {
  const res = mockRes();
  await handler({ method: "DELETE" }, res, staffDeps());
  assert.equal(res.statusCode, 405);
  assert.equal(res.body.error, "method_not_allowed");
  assert.equal(res.headers.allow, "GET, POST");
});

test("upload with no file is a 400 no_file", async () => {
  const res = mockRes();
  await handler(multipartReq(null), res, staffDeps());
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "no_file");
});

test("upload with an empty file is a 400 empty_file", async () => {
  const res = mockRes();
  await handler(
    multipartReq({ filename: "blank.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(0) }),
    res,
    staffDeps()
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "empty_file");
});

test("upload over the size limit is a 413 file_too_large", async () => {
  const res = mockRes();
  await handler(
    multipartReq({ filename: "big.pdf", mimeType: "application/pdf", buffer: PDF_BYTES }),
    res,
    staffDeps({ env: { COMPANY_BRAIN_UPLOAD_MAX_BYTES: "8" } })
  );
  assert.equal(res.statusCode, 413);
  assert.equal(res.body.error, "file_too_large");
});

test("a renamed executable is a 415 unsupported_file_type, whatever it claims", async () => {
  const res = mockRes();
  let ingested = false;
  await handler(
    multipartReq({ filename: "policy.pdf", mimeType: "application/pdf", buffer: ELF_BYTES }),
    res,
    staffDeps({ ingestUploadedFile: async () => { ingested = true; return { ok: true }; } })
  );
  assert.equal(res.statusCode, 415);
  assert.equal(res.body.error, "unsupported_file_type");
  assert.equal(ingested, false, "nothing should reach the pipeline");
});

test("a non-staff role cannot upload", async () => {
  const res = mockRes();
  let ingested = false;
  await handler(
    multipartReq({ filename: "kit.pdf", mimeType: "application/pdf", buffer: PDF_BYTES }),
    res,
    staffDeps({
      requireAuth: async () => ({ id: "a1", org_id: ORG, role: "affiliate" }),
      ingestUploadedFile: async () => { ingested = true; return { ok: true }; }
    })
  );
  assert.equal(res.statusCode, 403);
  assert.equal(ingested, false);
});

test("a session with no company is a 403 no_org_scope", async () => {
  const res = mockRes();
  await handler(
    multipartReq({ filename: "sop.pdf", mimeType: "application/pdf", buffer: PDF_BYTES }),
    res,
    staffDeps({ requireAuth: async () => ({ id: STAFF, org_id: null, role: "owner" }) })
  );
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "no_org_scope");
});

test("a good upload returns the §3.1 body and lands pending", async () => {
  const res = mockRes();
  let seen = null;
  await handler(
    multipartReq(
      { filename: "Closer Script v4.pdf", mimeType: "application/pdf", buffer: PDF_BYTES },
      { fields: { thread_id: "44444444-4444-4444-8444-444444444444" } }
    ),
    res,
    staffDeps({
      ingestUploadedFile: async (_db, args) => {
        seen = args;
        return {
          ok: true,
          fileId: "33333333-3333-4333-8333-333333333333",
          driveFileId: "upload:abc",
          chunkCount: 12,
          approvalStatus: "pending",
          accessTier: "owner",
          proposedTier: "sales",
          reviewId: "55555555-5555-4555-8555-555555555555",
          uploadedAt: "2026-08-17T00:00:00.000Z"
        };
      }
    })
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.file, {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Closer Script v4.pdf",
    mimeType: "application/pdf",
    sizeBytes: PDF_BYTES.length,
    source: "upload",
    approvalStatus: "pending",
    chunkCount: 12,
    proposedTier: "sales",
    reviewId: "55555555-5555-4555-8555-555555555555",
    uploadedAt: "2026-08-17T00:00:00.000Z"
  });
  // Org and staff come from the session, never from the request.
  assert.equal(seen.orgId, ORG);
  assert.equal(seen.staffId, STAFF);
  assert.equal(seen.mimeType, "application/pdf");
});

test("an embedding failure is a 502 embed_failed", async () => {
  const res = mockRes();
  await handler(
    multipartReq({ filename: "sop.pdf", mimeType: "application/pdf", buffer: PDF_BYTES }),
    res,
    staffDeps({ ingestUploadedFile: async () => ({ ok: false, reason: "embed_failed" }) })
  );
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, "embed_failed");
});

/* ---- the list, §3.2 ---------------------------------------------------- */

test("GET returns the org's uploads and the pending count", async () => {
  const res = mockRes();
  await handler(
    { method: "GET" },
    res,
    staffDeps({
      listUploads: async (_db, args) => {
        assert.equal(args.orgId, ORG);
        return {
          ok: true,
          uploads: [{ id: "f1", name: "Closer Script v4.pdf", approvalStatus: "pending" }],
          pendingCount: 1
        };
      }
    })
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.uploads.length, 1);
  assert.equal(res.body.pendingCount, 1);
});

/* ---- the pipeline ------------------------------------------------------ */

function fakeDb() {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/INSERT INTO brain_files/i.test(sql)) {
        return { rows: [{ id: "file-1", created_at: "2026-08-17T00:00:00.000Z" }] };
      }
      return { rows: [] };
    }
  };
}

test("uploadDriveFileId is namespaced so it cannot collide with a Drive id", () => {
  assert.match(uploadDriveFileId(), /^upload:[0-9a-f-]{36}$/i);
  assert.equal(uploadDriveFileId("abc"), "upload:abc");
});

test("ingestUploadedFile stores source=upload, approval_status=pending and tier owner", async () => {
  const db = fakeDb();
  const out = await ingestUploadedFile(db, {
    orgId: ORG,
    staffId: STAFF,
    buffer: Buffer.from("Closer script. ".repeat(200), "utf8"),
    mimeType: "text/plain",
    originalName: "Closer Script v4.md",
    embed: async (chunks) => ({ ok: true, embeddings: chunks.map(() => [0.1, 0.2, 0.3]) }),
    applyClassification: async () => ({
      ok: true, mode: "queued", accessTier: "owner", proposedTier: "sales", reviewId: "rev-1"
    })
  });

  assert.equal(out.ok, true);
  assert.equal(out.approvalStatus, "pending");
  assert.equal(out.accessTier, "owner");
  assert.equal(out.proposedTier, "sales");
  assert.ok(out.chunkCount >= 1);
  assert.match(out.driveFileId, /^upload:/);

  const insert = db.queries.find((q) => /INSERT INTO brain_files/i.test(q.sql));
  assert.ok(insert, "a brain_files row was written");
  assert.match(insert.sql, /source, approval_status, original_name, size_bytes, uploaded_by/);
  assert.match(insert.sql, /'upload','pending'/);
  assert.equal(insert.params[0], ORG);
  assert.equal(insert.params[8], STAFF);

  const chunkInserts = db.queries.filter((q) => /INSERT INTO brain_chunks/i.test(q.sql));
  assert.equal(chunkInserts.length, out.chunkCount);
  // Every chunk is written at the fail-closed tier, not the proposed one.
  assert.match(chunkInserts[0].sql, /'owner'/);
});

test("ingestUploadedFile writes nothing when the embedding call fails", async () => {
  const db = fakeDb();
  const out = await ingestUploadedFile(db, {
    orgId: ORG,
    buffer: Buffer.from("some text to chunk", "utf8"),
    mimeType: "text/plain",
    originalName: "note.txt",
    embed: async () => ({ ok: false, error: "embed_http_500:boom" }),
    applyClassification: async () => ({ ok: true })
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "embed_failed");
  assert.equal(db.queries.length, 0, "no half-indexed row left behind");
});

test("ingestUploadedFile refuses a file it cannot read", async () => {
  const db = fakeDb();
  const out = await ingestUploadedFile(db, {
    orgId: ORG,
    buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]),
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    originalName: "broken.docx",
    embed: async () => ({ ok: true, embeddings: [] }),
    applyClassification: async () => ({ ok: true })
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "extract_failed");
  assert.equal(db.queries.length, 0);
});

test("listUploads returns only uploaded rows and keeps an unknown size as null", async () => {
  const seen = [];
  const db = {
    async query(sql, params) {
      seen.push(sql);
      if (/count\(\*\)::int AS pending/i.test(sql)) return { rows: [{ pending: 2 }] };
      assert.equal(params[0], ORG);
      return {
        rows: [{
          id: "f1",
          name: "Closer Script v4.pdf",
          original_name: "Closer Script v4.pdf",
          mime_type: "application/pdf",
          size_bytes: null,
          approval_status: "pending",
          access_tier: "owner",
          proposed_tier: "sales",
          created_at: "2026-08-17T00:00:00.000Z",
          uploaded_by_name: "Chris",
          chunk_count: 12
        }]
      };
    }
  };

  const out = await listUploads(db, { orgId: ORG });
  assert.equal(out.ok, true);
  assert.equal(out.pendingCount, 2);
  assert.equal(out.uploads.length, 1);
  assert.equal(out.uploads[0].sizeBytes, null, "unknown size must not become 0");
  assert.equal(out.uploads[0].uploadedByName, "Chris");
  assert.equal(out.uploads[0].chunkCount, 12);
  assert.match(seen[0], /f\.source = 'upload'/);
});

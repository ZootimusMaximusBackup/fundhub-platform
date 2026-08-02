import test from "node:test";
import assert from "node:assert/strict";

import { chunkText } from "./chunk.mjs";
import { tiersForRole, assertOwnerOnlyRole } from "./access.mjs";
import { embedTexts, toVectorLiteral, EMBEDDING_DIMS } from "./embed.mjs";
import { upsertExtractedFile } from "./store.mjs";
import { retrieveChunks } from "./retrieve.mjs";

function fakeEmbedding(seed = 1) {
  const v = new Array(EMBEDDING_DIMS).fill(0);
  v[0] = seed;
  v[1] = 1 / seed;
  return v;
}

test("chunkText splits with overlap and skips empty", () => {
  assert.deepEqual(chunkText("  "), []);
  const text = "a".repeat(5000);
  const parts = chunkText(text, { size: 1000, overlap: 100 });
  assert.ok(parts.length >= 5);
  assert.ok(parts.every((p) => p.length <= 1000));
});

test("tiersForRole is owner-only in step 2", () => {
  assert.deepEqual(tiersForRole("closer"), []);
  assert.deepEqual(tiersForRole("funding_advisor"), []);
  assert.ok(assertOwnerOnlyRole("owner").ok);
  assert.ok(assertOwnerOnlyRole("admin").ok);
  assert.equal(assertOwnerOnlyRole("closer").ok, false);
  assert.ok(!tiersForRole("owner").includes("affiliate"));
});

test("embedTexts uses providers/http postJson via mocked fetch", async () => {
  const emb = fakeEmbedding(3);
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({ data: [{ index: 0, embedding: emb }] });
    },
    async json() {
      return { data: [{ index: 0, embedding: emb }] };
    }
  });
  // postJson expects res.json/text - check http.mjs - it uses text then JSON.parse
  const fetchImpl2 = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    async text() {
      return JSON.stringify({ data: [{ index: 0, embedding: emb }] });
    }
  });

  const out = await embedTexts(["hello"], {
    env: { OPENAI_API_KEY: "sk-test" },
    fetchImpl: fetchImpl2
  });
  assert.equal(out.ok, true);
  assert.equal(out.embeddings[0].length, EMBEDDING_DIMS);
  assert.match(toVectorLiteral(out.embeddings[0]), /^\[/);
  void fetchImpl;
});

test("upsertExtractedFile writes file + chunks through db mock", async () => {
  const rows = { files: [], chunks: [], queries: [] };
  const db = {
    async query(sql, params) {
      rows.queries.push({ sql, params });
      if (/SELECT id, content_sha256 FROM brain_files/i.test(sql)) {
        return { rows: [] };
      }
      if (/INSERT INTO brain_files/i.test(sql)) {
        return { rows: [{ id: "file-1" }] };
      }
      if (/DELETE FROM brain_chunks/i.test(sql)) {
        return { rows: [] };
      }
      if (/INSERT INTO brain_chunks/i.test(sql)) {
        rows.chunks.push(params);
        return { rows: [] };
      }
      return { rows: [] };
    }
  };

  const embed = async (texts) => ({
    ok: true,
    embeddings: texts.map((_, i) => fakeEmbedding(i + 1))
  });

  const out = await upsertExtractedFile(db, {
    orgId: "org-1",
    extracted: {
      fileId: "drive-1",
      name: "SOP.md",
      mimeType: "text/plain",
      text: "Do the thing. ".repeat(50),
      webViewLink: "https://drive.google.com/file/d/drive-1",
      ok: true
    },
    embed,
    classify: false
  });

  assert.equal(out.ok, true);
  assert.equal(out.fileId, "file-1");
  assert.ok(out.chunkCount >= 1);
  assert.ok(rows.chunks.length >= 1);
  assert.equal(rows.chunks[0][4], "owner"); // access_tier
});

test("retrieveChunks refuses non-owner before any db call", async () => {
  let called = false;
  const db = {
    async query() {
      called = true;
      return { rows: [] };
    }
  };
  const out = await retrieveChunks(db, {
    orgId: "org-1",
    role: "closer",
    query: "scripts",
    embed: async () => ({ ok: true, embeddings: [fakeEmbedding(1)] })
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "forbidden_role");
  assert.equal(called, false);
});

test("retrieveChunks filters by tier in SQL and returns rows", async () => {
  const seen = [];
  const db = {
    async query(sql, params) {
      seen.push({ sql, params });
      return {
        rows: [{
          chunk_id: "c1",
          content: "Closer script",
          access_tier: "owner",
          chunk_index: 0,
          file_id: "f1",
          drive_file_id: "d1",
          file_name: "script.doc",
          web_view_link: "https://drive.google.com/file/d/d1",
          client_id: null,
          mime_type: "application/vnd.google-apps.document",
          distance: 0.12
        }]
      };
    }
  };

  const out = await retrieveChunks(db, {
    orgId: "org-1",
    role: "owner",
    query: "closer script",
    embed: async () => ({ ok: true, embeddings: [fakeEmbedding(1)] })
  });

  assert.equal(out.ok, true);
  assert.equal(out.chunks.length, 1);
  assert.equal(out.chunks[0].fileName, "script.doc");
  assert.match(seen[0].sql, /access_tier = ANY/i);
  assert.ok(seen[0].params[1].includes("owner"));
  assert.ok(!seen[0].params[1].includes("affiliate"));
});

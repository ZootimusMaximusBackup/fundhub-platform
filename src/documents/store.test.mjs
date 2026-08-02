import { test } from "node:test";
import assert from "node:assert";
import {
  createStore, memoryProvider, vercelBlobProvider, netlifyBlobsProvider, providerFromEnv, storeFromEnv,
  checksumOf, toBytes, buildStoragePath, extensionFor
} from "./store.mjs";

const PUT = { orgId: "org-1", clientId: "client-1", kind: "deliverable", mimeType: "application/pdf" };

// ---------------------------------------------------------------------------
// bytes + checksums
// ---------------------------------------------------------------------------
test("checksumOf is algorithm-prefixed (the schema CHECK requires it)", () => {
  const sum = checksumOf("hello");
  assert.match(sum, /^sha256:[0-9a-f]{64}$/);
});

test("checksumOf is stable across Buffer / Uint8Array / string", () => {
  const a = checksumOf("hello");
  assert.strictEqual(checksumOf(Buffer.from("hello")), a);
  assert.strictEqual(checksumOf(new Uint8Array(Buffer.from("hello"))), a);
});

test("toBytes rejects a body it cannot store", () => {
  assert.throws(() => toBytes({ pdf: true }), /must be a Buffer/);
});

// ---------------------------------------------------------------------------
// key construction
// ---------------------------------------------------------------------------
test("storage path is content-addressed and carries the file extension", () => {
  const path = buildStoragePath({
    ...PUT, checksum: checksumOf("x"), mimeType: "application/pdf"
  });
  assert.match(path, /^documents\/org-1\/client-1\/deliverable\/[0-9a-f]{64}\.pdf$/);
});

test("different bytes produce different keys — a put can never clobber other content", () => {
  const a = buildStoragePath({ ...PUT, checksum: checksumOf("one") });
  const b = buildStoragePath({ ...PUT, checksum: checksumOf("two") });
  assert.notStrictEqual(a, b);
});

test("identical bytes produce an identical key — put is idempotent", () => {
  const a = buildStoragePath({ ...PUT, checksum: checksumOf("same") });
  const b = buildStoragePath({ ...PUT, checksum: checksumOf("same") });
  assert.strictEqual(a, b);
});

test("path components are sanitized (no traversal out of the prefix)", () => {
  const path = buildStoragePath({
    orgId: "../../etc", clientId: "a/b", kind: "deliverable", checksum: checksumOf("x")
  });
  assert.ok(!path.includes(".."), `traversal survived: ${path}`);
  assert.ok(path.startsWith("documents/"), path);
});

test("extensionFor prefers an explicit filename over the mime table", () => {
  assert.strictEqual(extensionFor("application/pdf"), ".pdf");
  assert.strictEqual(extensionFor("application/pdf", "letters.zip"), ".zip");
  assert.strictEqual(extensionFor("application/x-unknown"), "");
});

// ---------------------------------------------------------------------------
// store round-trip
// ---------------------------------------------------------------------------
test("put returns everything the registry needs to record the object", async () => {
  const store = createStore({ provider: memoryProvider() });
  const out = await store.put({ ...PUT, body: "letter bytes" });

  assert.ok(out.storageKey.startsWith("memory://documents/org-1/"));
  assert.strictEqual(out.checksum, checksumOf("letter bytes"));
  assert.strictEqual(out.byteSize, Buffer.byteLength("letter bytes"));
  assert.strictEqual(out.mimeType, "application/pdf");
});

test("get returns the bytes that were put", async () => {
  const store = createStore({ provider: memoryProvider() });
  const { storageKey } = await store.put({ ...PUT, body: "letter bytes" });
  const got = await store.get(storageKey);
  assert.strictEqual(got.body.toString("utf8"), "letter bytes");
  assert.strictEqual(got.byteSize, 12);
});

test("get verifies the checksum when one is supplied", async () => {
  const provider = memoryProvider();
  const store = createStore({ provider });
  const { storageKey, checksum } = await store.put({ ...PUT, body: "original" });

  assert.ok(await store.get(storageKey, { expectedChecksum: checksum }));

  // simulate bit-rot / a tampered object behind the same key
  provider._objects.set(storageKey, { body: Buffer.from("tampered"), contentType: null });
  await assert.rejects(
    () => store.get(storageKey, { expectedChecksum: checksum }), /checksum mismatch/);
});

test("get returns null for an unknown key", async () => {
  const store = createStore({ provider: memoryProvider() });
  assert.strictEqual(await store.get("memory://nope"), null);
});

test("re-putting identical bytes reuses the object (one object, not two)", async () => {
  const provider = memoryProvider();
  const store = createStore({ provider });
  const a = await store.put({ ...PUT, body: "same" });
  const b = await store.put({ ...PUT, body: "same" });
  assert.strictEqual(a.storageKey, b.storageKey);
  assert.strictEqual(provider._objects.size, 1);
});

test("put refuses an empty document", async () => {
  const store = createStore({ provider: memoryProvider() });
  await assert.rejects(() => store.put({ ...PUT, body: "" }), /empty document/);
});

test("put requires the identifying fields and a mime type", async () => {
  const store = createStore({ provider: memoryProvider() });
  await assert.rejects(() => store.put({ ...PUT, orgId: null, body: "x" }), /requires orgId/);
  await assert.rejects(() => store.put({ ...PUT, mimeType: null, body: "x" }), /requires mimeType/);
});

test("del removes an object (orphan cleanup only — see the doc comment)", async () => {
  const store = createStore({ provider: memoryProvider() });
  const { storageKey } = await store.put({ ...PUT, body: "orphan" });
  assert.strictEqual(await store.exists(storageKey), true);
  await store.del(storageKey);
  assert.strictEqual(await store.exists(storageKey), false);
});

// ---------------------------------------------------------------------------
// provider abstraction — the point of the interface
// ---------------------------------------------------------------------------
test("createStore rejects an object that is not a provider", () => {
  assert.throws(() => createStore({ provider: { name: "broken" } }), /requires a provider/);
});

test("a third-party provider drops in with no changes above it", async () => {
  const calls = [];
  const s3ish = {
    name: "pretend-s3",
    async put(pathname, bytes) { calls.push(["put", pathname]); return `s3://bucket/${pathname}`; },
    async get(key) { calls.push(["get", key]); return { body: Buffer.from("from s3") }; },
    async del(key) { calls.push(["del", key]); }
  };
  const store = createStore({ provider: s3ish });
  const put = await store.put({ ...PUT, body: "bytes" });

  assert.strictEqual(store.name, "pretend-s3");
  assert.ok(put.storageKey.startsWith("s3://bucket/documents/"));
  assert.strictEqual((await store.get(put.storageKey)).body.toString(), "from s3");
  assert.deepStrictEqual(calls.map((c) => c[0]), ["put", "get"]);
});

// ---------------------------------------------------------------------------
// vercel blob provider — lazily loaded, never hardcoded
// ---------------------------------------------------------------------------
test("vercel blob provider stores the returned blob url as the storage key", async () => {
  const seen = [];
  const provider = vercelBlobProvider({
    token: "vercel_blob_rw_test",
    loadSdk: async () => ({
      put: async (pathname, bytes, opts) => {
        seen.push({ pathname, opts });
        return { url: `https://store.public.blob.vercel-storage.com/${pathname}` };
      }
    })
  });
  const store = createStore({ provider });
  const out = await store.put({ ...PUT, body: "pdf bytes" });

  assert.ok(out.storageKey.startsWith("https://store.public.blob.vercel-storage.com/documents/"));
  // content addressing only holds if the SDK is told not to add a random suffix
  assert.strictEqual(seen[0].opts.addRandomSuffix, false);
  assert.strictEqual(seen[0].opts.access, "public");
  assert.strictEqual(seen[0].opts.contentType, "application/pdf");
  assert.strictEqual(seen[0].opts.token, "vercel_blob_rw_test");
});

test("vercel blob provider reads through the injected fetch", async () => {
  const provider = vercelBlobProvider({
    loadSdk: async () => ({ put: async () => ({ url: "https://blob/x" }) }),
    fetchImpl: async (url) => ({
      ok: true, status: 200,
      arrayBuffer: async () => new TextEncoder().encode(`bytes of ${url}`).buffer,
      headers: { get: () => "application/pdf" }
    })
  });
  const got = await createStore({ provider }).get("https://blob/x");
  assert.strictEqual(got.body.toString("utf8"), "bytes of https://blob/x");
  assert.strictEqual(got.contentType, "application/pdf");
});

test("vercel blob provider returns null on a 404 rather than throwing", async () => {
  const provider = vercelBlobProvider({
    loadSdk: async () => ({}),
    fetchImpl: async () => ({ ok: false, status: 404 })
  });
  assert.strictEqual(await createStore({ provider }).get("https://blob/gone"), null);
});

test("a missing @vercel/blob package fails with an actionable message, not a module crash", async () => {
  const provider = vercelBlobProvider({
    loadSdk: async () => { throw new Error("Cannot find module '@vercel/blob'"); }
  });
  await assert.rejects(
    () => createStore({ provider }).put({ ...PUT, body: "x" }),
    /npm i @vercel\/blob.*BLOB_READ_WRITE_TOKEN|BLOB_READ_WRITE_TOKEN/s);
});

// ---------------------------------------------------------------------------
// netlify blobs provider — the storage decision for client uploads
// ---------------------------------------------------------------------------
function fakeNetlifyBlobsSdk() {
  const blobs = new Map();
  const meta = new Map();
  const store = {
    async set(key, bytes, opts) {
      blobs.set(key, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
      meta.set(key, (opts && opts.metadata) || null);
    },
    async get(key, opts) {
      const hit = blobs.get(key);
      if (hit === undefined) return null;
      if (opts && opts.type === "arrayBuffer") {
        return hit.buffer.slice(hit.byteOffset, hit.byteOffset + hit.byteLength);
      }
      return hit;
    },
    async getMetadata(key) {
      if (!blobs.has(key)) throw new Error("not found");
      return { metadata: meta.get(key) || {} };
    },
    async delete(key) { blobs.delete(key); meta.delete(key); }
  };
  return { getStore: () => store, _blobs: blobs };
}

test("netlify blobs provider round-trips bytes and the declared content type", async () => {
  const sdk = fakeNetlifyBlobsSdk();
  const provider = netlifyBlobsProvider({ storeName: "documents", loadSdk: async () => sdk });
  const store = createStore({ provider });

  const put = await store.put({ ...PUT, body: "pdf bytes" });
  assert.strictEqual(put.storageKey, `netlify-blob://documents/${put.pathname}`);

  const got = await store.get(put.storageKey, { expectedChecksum: put.checksum });
  assert.strictEqual(got.body.toString(), "pdf bytes");
  assert.strictEqual(got.contentType, "application/pdf");
});

test("netlify blobs provider round-trips binary bytes intact (a jpg, not just text)", async () => {
  const sdk = fakeNetlifyBlobsSdk();
  const provider = netlifyBlobsProvider({ storeName: "documents", loadSdk: async () => sdk });
  const store = createStore({ provider });
  const jpgBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

  const put = await store.put({ ...PUT, mimeType: "image/jpeg", body: jpgBytes });
  const got = await store.get(put.storageKey);
  assert.deepStrictEqual(got.body, jpgBytes);
});

test("netlify blobs provider returns null for a key it never wrote", async () => {
  const sdk = fakeNetlifyBlobsSdk();
  const provider = netlifyBlobsProvider({ storeName: "documents", loadSdk: async () => sdk });
  assert.strictEqual(await createStore({ provider }).get("netlify-blob://documents/nope"), null);
});

test("netlify blobs provider refuses a storage key from a different provider/store", async () => {
  const sdk = fakeNetlifyBlobsSdk();
  const provider = netlifyBlobsProvider({ storeName: "documents", loadSdk: async () => sdk });
  await assert.rejects(
    () => createStore({ provider }).get("https://blob.vercel-storage.com/x"),
    /was not written by the netlify-blobs provider/);
});

test("netlify blobs provider exists()/del() round-trip", async () => {
  const sdk = fakeNetlifyBlobsSdk();
  const provider = netlifyBlobsProvider({ storeName: "documents", loadSdk: async () => sdk });
  const store = createStore({ provider });
  const put = await store.put({ ...PUT, body: "x" });

  assert.strictEqual(await store.exists(put.storageKey), true);
  await store.del(put.storageKey);
  assert.strictEqual(await store.exists(put.storageKey), false);
});

test("a missing @netlify/blobs package fails with an actionable message, not a module crash", async () => {
  const provider = netlifyBlobsProvider({
    loadSdk: async () => { throw new Error("Cannot find module '@netlify/blobs'"); }
  });
  await assert.rejects(
    () => createStore({ provider }).put({ ...PUT, body: "x" }),
    /npm i @netlify\/blobs/);
});

// ---------------------------------------------------------------------------
// selection
// ---------------------------------------------------------------------------
test("memory is the default provider — nothing needs a vendor configured", () => {
  assert.strictEqual(providerFromEnv({}).name, "memory");
  assert.strictEqual(storeFromEnv({}).name, "memory");
});

test("DOCUMENT_STORE_PROVIDER selects the provider", () => {
  assert.strictEqual(providerFromEnv({ DOCUMENT_STORE_PROVIDER: "vercel-blob" }).name, "vercel-blob");
  assert.strictEqual(providerFromEnv({ DOCUMENT_STORE_PROVIDER: "netlify-blobs" }).name, "netlify-blobs");
});

test("an unknown provider name fails loudly instead of silently using memory", () => {
  assert.throws(
    () => providerFromEnv({ DOCUMENT_STORE_PROVIDER: "dropbox" }),
    /unknown DOCUMENT_STORE_PROVIDER "dropbox"/);
});

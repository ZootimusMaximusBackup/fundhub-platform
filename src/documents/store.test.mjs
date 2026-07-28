import { test } from "node:test";
import assert from "node:assert";
import {
  createStore, memoryProvider, vercelBlobProvider, providerFromEnv, storeFromEnv,
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
// selection
// ---------------------------------------------------------------------------
test("memory is the default provider — nothing needs a vendor configured", () => {
  assert.strictEqual(providerFromEnv({}).name, "memory");
  assert.strictEqual(storeFromEnv({}).name, "memory");
});

test("DOCUMENT_STORE_PROVIDER selects the provider", () => {
  assert.strictEqual(providerFromEnv({ DOCUMENT_STORE_PROVIDER: "vercel-blob" }).name, "vercel-blob");
});

test("an unknown provider name fails loudly instead of silently using memory", () => {
  assert.throws(
    () => providerFromEnv({ DOCUMENT_STORE_PROVIDER: "dropbox" }),
    /unknown DOCUMENT_STORE_PROVIDER "dropbox"/);
});

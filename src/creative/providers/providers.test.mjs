// Provider adapter tests — the invariants that hold regardless of vendor.
//
// The one that matters most is credential hygiene. Provider errors land in
// generation_jobs.error, which is partner-readable through the job-status
// endpoint, so a provider that echoes its Authorization header into an error body
// would be handing a partner fundhub's vendor key. That is tested directly rather
// than assumed.

import { test, describe } from "node:test";
import assert from "node:assert";
import { MODULES, PROVIDER_KEYS, assertAdapter, resolve } from "./index.mjs";
import { scrub, requireKey, callProvider } from "./_http.mjs";
import * as ugc from "./ugc-video.mjs";
import * as resizeProvider from "./resize.mjs";
import * as staticProvider from "./static.mjs";

const KEY = "sk-live-abcdef0123456789";
const env = {
  CREATIVE_STATIC_API_KEY: KEY,
  CREATIVE_UGC_API_KEY: KEY,
  CREATIVE_RESIZE_API_KEY: KEY
};
const jsonRes = (body, { ok = true, status = 200 } = {}) =>
  ({ ok, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });

describe("the adapter interface", () => {
  test("every provider exports generate()", () => {
    for (const key of PROVIDER_KEYS) assertAdapter(MODULES[key], key);
  });

  test("resolve throws rather than defaulting to some provider", async () => {
    const db = { query: async () => ({ rows: [] }) };
    await assert.rejects(() => resolve(db, { orgId: "o", assetKind: "static" }),
      /no active provider configured/);
  });

  test("resolve rejects a config row naming a module that does not exist", async () => {
    const db = { query: async () => ({ rows: [{ provider_key: "midjourney", config: {} }] }) };
    await assert.rejects(() => resolve(db, { orgId: "o", assetKind: "static" }), /has no module/);
  });
});

describe("credentials never leak", () => {
  test("scrub removes the key from an error body", () => {
    const out = scrub(`{"error":"bad key ${KEY}"}`, KEY);
    assert.ok(!out.includes(KEY));
    assert.ok(out.includes("[redacted]"));
  });

  test("scrub removes bearer tokens it was not given", () => {
    const out = scrub("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9xxxx", null);
    assert.ok(!out.includes("eyJhbGciOiJIUzI1NiJ9xxxx"));
  });

  test("a provider error echoing the key does not carry it out", async () => {
    // The realistic leak: the vendor 401s and quotes the credential back.
    const err = await callProvider({
      url: "https://x", key: KEY, body: {},
      ctx: { fetch: async () => jsonRes(`{"message":"invalid key ${KEY}"}`, { ok: false, status: 401 }) }
    }).catch((e) => e);
    assert.ok(!err.message.includes(KEY), `key leaked into: ${err.message}`);
  });

  test("requireKey names the env var, never a value", () => {
    try {
      requireKey("CREATIVE_MISSING_KEY", { env: {} });
      assert.fail("should have thrown");
    } catch (e) {
      assert.ok(e.message.includes("CREATIVE_MISSING_KEY"));
      assert.ok(!e.message.includes(KEY));
    }
  });
});

describe("retryability", () => {
  test("a network failure is retryable", async () => {
    const err = await callProvider({
      url: "https://x", key: KEY, ctx: { fetch: async () => { throw new Error("ECONNRESET"); } }
    }).catch((e) => e);
    assert.strictEqual(err.retryable, true);
  });

  test("429 and 5xx are retryable", async () => {
    for (const status of [429, 500, 503]) {
      const err = await callProvider({
        url: "https://x", key: KEY,
        ctx: { fetch: async () => jsonRes("nope", { ok: false, status }) }
      }).catch((e) => e);
      assert.strictEqual(err.retryable, true, `${status} should retry`);
    }
  });

  test("400 is NOT retryable — retrying burns a slot to fail identically", async () => {
    const err = await callProvider({
      url: "https://x", key: KEY,
      ctx: { fetch: async () => jsonRes("bad request", { ok: false, status: 400 }) }
    }).catch((e) => e);
    assert.strictEqual(err.retryable, false);
  });
});

describe("disclosure flags", () => {
  test("ugc-video always sets synthetic_performer, even when the spec omits it", async () => {
    // Not caller-supplied: there is no configuration of this provider that
    // produces a video without an AI human likeness in it.
    const out = await ugc.generate(
      { formats: ["9x16"], variants: 1, script: "hello" },
      { env, fetch: async () => jsonRes({ video: { id: "v1", url: "u", duration_sec: 12 } }) });
    assert.strictEqual(out.assets[0].synthetic_performer, true);
    assert.strictEqual(out.assets[0].ai_generated, true);
  });

  test("ugc-video sets it even when the spec explicitly says false", async () => {
    const out = await ugc.generate(
      { formats: ["9x16"], variants: 1, syntheticPerformer: false },
      { env, fetch: async () => jsonRes({ video: { id: "v1", url: "u" } }) });
    assert.strictEqual(out.assets[0].synthetic_performer, true);
  });

  test("resize INHERITS both flags from the parent rather than re-deriving them", async () => {
    // A crop of a synthetic presenter still shows one, so the disclosure follows
    // the pixels. Re-deriving would drop both flags on every derived asset.
    const out = await resizeProvider.generate(
      { parentAsset: { id: "p1", kind: "video", format: "9x16", storage_key: "partners/x/a.mp4",
                       ai_generated: true, synthetic_performer: true },
        formats: ["1x1", "9x16"] },
      { env, fetch: async () => jsonRes({ asset: { id: "r1", url: "u" } }) });

    assert.strictEqual(out.assets.length, 1, "the parent's own format is skipped");
    assert.strictEqual(out.assets[0].synthetic_performer, true);
    assert.strictEqual(out.assets[0].ai_generated, true);
    assert.strictEqual(out.assets[0].parent_asset_id, "p1");
  });

  test("resize with nothing to derive returns empty rather than calling out", async () => {
    let called = false;
    const out = await resizeProvider.generate(
      { parentAsset: { id: "p1", kind: "static", format: "1x1" }, formats: ["1x1"] },
      { env, fetch: async () => { called = true; return jsonRes({}); } });
    assert.deepStrictEqual(out.assets, []);
    assert.strictEqual(called, false);
  });
});

describe("no silent empty results", () => {
  test("a 200 with no asset throws rather than returning zero assets", async () => {
    // The service turns this into a queued retry. Returning [] would look like a
    // working generation that simply produced nothing.
    await assert.rejects(
      () => staticProvider.generate({ formats: ["1x1"], variants: 1 },
        { env, fetch: async () => jsonRes({ data: [] }) }),
      /returned no asset/);
  });

  test("a batch asks for one call per format+variant", async () => {
    let calls = 0;
    const out = await staticProvider.generate(
      { formats: ["1x1", "9x16"], variants: 2, prompt: "p", angles: ["a", "b"] },
      { env, fetch: async () => { calls++; return jsonRes({ data: [{ id: "i" + calls, url: "u" }] }); } });
    assert.strictEqual(calls, 4);
    assert.strictEqual(out.assets.length, 4);
  });

  test("variants vary the ANGLE, not just the canvas", async () => {
    // Diversity means different hooks and angles, not N crops of one image.
    const prompts = [];
    await staticProvider.generate(
      { formats: ["1x1"], variants: 2, prompt: "base", angles: ["angle-one", "angle-two"] },
      { env, fetch: async (_u, init) => {
        prompts.push(JSON.parse(init.body).prompt);
        return jsonRes({ data: [{ id: "i", url: "u" }] });
      } });
    assert.notStrictEqual(prompts[0], prompts[1]);
    assert.ok(prompts[0].includes("angle-one"));
    assert.ok(prompts[1].includes("angle-two"));
  });
});

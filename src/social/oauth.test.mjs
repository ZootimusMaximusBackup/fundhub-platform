import { test } from "node:test";
import assert from "node:assert";
import {
  signState, verifyState, metaAuthUrl, linkedinAuthUrl
} from "./oauth.mjs";
import { linkedinPost } from "./adapters.mjs";
import { encryptToken } from "../adplatforms/tokens.mjs";

const env = { AD_TOKEN_ENC_KEY: Buffer.alloc(32, 9).toString("base64") };

test("sign/verify state round-trip", () => {
  const s = signState({ partnerId: "p1", channel: "facebook", exp: Date.now() + 60_000 }, env);
  const v = verifyState(s, env);
  assert.equal(v.partnerId, "p1");
  assert.equal(v.channel, "facebook");
});

test("verifyState rejects tampered", () => {
  const s = signState({ partnerId: "p1", exp: Date.now() + 60_000 }, env);
  assert.equal(verifyState(s + "x", env), null);
});

test("verifyState rejects an expired state", () => {
  const s = signState({ partnerId: "p1", exp: Date.now() - 1 }, env);
  assert.equal(verifyState(s, env), null);
});

test("signState fails closed with no secret rather than a guessable default", () => {
  assert.equal(signState({ partnerId: "p1", exp: Date.now() + 60_000 }, {}), null);
});

test("verifyState fails closed with no secret, even for a state signed elsewhere", () => {
  const s = signState({ partnerId: "p1", exp: Date.now() + 60_000 }, env);
  assert.equal(verifyState(s, {}), null);
});

test("metaAuthUrl: missing app id", () => {
  const r = metaAuthUrl({ redirectUri: "https://x/cb", state: "s" });
  assert.equal(r.ok, false);
  assert.ok(r.missing.includes("META_APP_ID"));
});

test("metaAuthUrl: builds dialog url", () => {
  const r = metaAuthUrl({ appId: "123", redirectUri: "https://x/cb", state: "abc" });
  assert.equal(r.ok, true);
  assert.match(r.url, /facebook\.com/);
  assert.match(r.url, /client_id=123/);
});

test("linkedinAuthUrl: missing client id", () => {
  const r = linkedinAuthUrl({ redirectUri: "https://x/cb", state: "s" });
  assert.equal(r.ok, false);
});

test("linkedinAuthUrl: builds auth url", () => {
  const r = linkedinAuthUrl({ clientId: "li", redirectUri: "https://x/cb", state: "s" });
  assert.equal(r.ok, true);
  assert.match(r.url, /linkedin\.com/);
});

test("linkedinPost dry-run", async () => {
  process.env.SOCIAL_PUBLISH_DRY_RUN = "1";
  try {
    const r = await linkedinPost({ id: "post-1", caption: "hi" });
    assert.match(r.external_post_id, /^dryrun:linkedin:/);
  } finally {
    delete process.env.SOCIAL_PUBLISH_DRY_RUN;
  }
});

test("linkedinPost refuses without a token rather than inventing one", async () => {
  await assert.rejects(
    () => linkedinPost({ id: "post-1", caption: "hi", encrypted_access_token: null }),
    /no access token/
  );
});

test("linkedinPost posts to the organization UGC endpoint with the org URN as author", async () => {
  // adapters.mjs decrypts with process.env (same as facebookPost/instagramPost),
  // so the encryption key has to live there for the duration of this test.
  const prevKey = process.env.AD_TOKEN_ENC_KEY;
  process.env.AD_TOKEN_ENC_KEY = env.AD_TOKEN_ENC_KEY;
  const partnerId = "11111111-1111-4111-8111-111111111111";
  try {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ id: "urn:li:share:123" }) };
    };
    const r = await linkedinPost({
      id: "post-1",
      caption: "hello world",
      channel_partner_id: partnerId,
      external_account_id: "90447122",
      encrypted_access_token: encryptToken("li-token", { partnerId })
    }, { fetchImpl });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.linkedin.com/v2/ugcPosts");
    assert.equal(calls[0].init.headers.Authorization, "Bearer li-token");
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.author, "urn:li:organization:90447122");
    assert.equal(body.specificContent["com.linkedin.ugc.ShareContent"].shareCommentary.text, "hello world");
    assert.equal(r.external_post_id, "urn:li:share:123");
  } finally {
    if (prevKey === undefined) delete process.env.AD_TOKEN_ENC_KEY;
    else process.env.AD_TOKEN_ENC_KEY = prevKey;
  }
});

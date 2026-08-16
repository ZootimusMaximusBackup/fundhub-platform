import { test } from "node:test";
import assert from "node:assert/strict";
import {
  signSoftPullApproveUrl,
  verifySoftPullApproveToken,
  APPROVE_TTL_SECONDS
} from "../consent/approve-token.mjs";

const SECRET = "a".repeat(32);
const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";

test("signed soft-pull approve URL verifies", () => {
  const signed = signSoftPullApproveUrl({
    orgId: ORG,
    clientId: CLIENT,
    secret: SECRET,
    baseUrl: "https://fundhub.ai"
  });
  assert.match(signed.url, /^https:\/\/fundhub\.ai\/app\/soft-pull-approve\.html\?/);
  const u = new URL(signed.url);
  const ok = verifySoftPullApproveToken({
    orgId: u.searchParams.get("org"),
    clientId: u.searchParams.get("client"),
    exp: u.searchParams.get("exp"),
    sig: u.searchParams.get("sig"),
    secret: SECRET
  });
  assert.ok(ok);
  assert.equal(ok.clientId, CLIENT);
});

test("tampered soft-pull approve sig is refused", () => {
  const signed = signSoftPullApproveUrl({
    orgId: ORG, clientId: CLIENT, secret: SECRET
  });
  const u = new URL(signed.url, "https://x.test");
  assert.equal(verifySoftPullApproveToken({
    orgId: u.searchParams.get("org"),
    clientId: u.searchParams.get("client"),
    exp: u.searchParams.get("exp"),
    sig: "deadbeef",
    secret: SECRET
  }), null);
});

test("expired soft-pull approve token is refused", () => {
  const now = () => 1_700_000_000_000;
  const signed = signSoftPullApproveUrl({
    orgId: ORG, clientId: CLIENT, secret: SECRET, ttlSeconds: 60, now
  });
  const u = new URL(signed.url, "https://x.test");
  assert.equal(verifySoftPullApproveToken({
    orgId: u.searchParams.get("org"),
    clientId: u.searchParams.get("client"),
    exp: u.searchParams.get("exp"),
    sig: u.searchParams.get("sig"),
    secret: SECRET,
    now: () => now() + (APPROVE_TTL_SECONDS + 120) * 1000
  }), null);
});

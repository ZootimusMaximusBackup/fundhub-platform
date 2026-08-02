import { test } from "node:test";
import assert from "node:assert/strict";
import { siteVerifyToken, expectedTxtHost, checkDomainTxt } from "./domain-verify.mjs";

test("siteVerifyToken embeds the partner id", () => {
  const id = "11111111-1111-1111-1111-111111111111";
  assert.equal(siteVerifyToken(id), `fundhub-site-verify=${id}`);
});

test("expectedTxtHost prefixes _fundhub", () => {
  assert.equal(expectedTxtHost("Example.COM."), "_fundhub.example.com");
  assert.equal(expectedTxtHost(""), null);
});

test("checkDomainTxt succeeds when injected resolver returns the token", async () => {
  const id = "22222222-2222-2222-2222-222222222222";
  const expected = siteVerifyToken(id);
  const out = await checkDomainTxt("partner.test", expected, {
    resolveTxt: async () => [[expected]]
  });
  assert.equal(out.ok, true);
  assert.equal(out.host, "_fundhub.partner.test");
});

test("checkDomainTxt fails closed on mismatch", async () => {
  const out = await checkDomainTxt("partner.test", "fundhub-site-verify=x", {
    resolveTxt: async () => [["something-else"]]
  });
  assert.equal(out.ok, false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("portal-contracts route is registered", () => {
  const api = readFileSync(path.join(ROOT, "netlify/functions/api.mjs"), "utf8");
  assert.match(api, /read\/portal-contracts/);
  assert.match(api, /readPortalContracts/);
});

test("portal-contracts handler admits client principals", () => {
  const src = readFileSync(path.join(ROOT, "api/read/portal-contracts.mjs"), "utf8");
  assert.match(src, /requirePrincipal\(req, res, \["staff", "client"\]/);
  assert.match(src, /principal\.kind === "client"/);
});

test("client portal loads agreements from portal-contracts", () => {
  const html = readFileSync(path.join(ROOT, "public/app/client-portal.html"), "utf8");
  assert.match(html, /portalContracts/);
  assert.match(html, /agreements-card/);
  assert.match(html, /tp-agree/);
});

test("present deck reads contractTemplateKey from offers", () => {
  const js = readFileSync(path.join(ROOT, "public/app/present.js"), "utf8");
  assert.match(js, /resolveContractTemplateKey/);
  assert.match(js, /contractTemplateKey/);
});

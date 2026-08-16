// Source tests for the shared send helper and where Send now lives.
//
// The contracts API is already covered by src/http/contracts-endpoints.pg.test.mjs.
// This file only proves the CRM screens call that API — they do not invent a
// second email path.

import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROUTES } from "../../netlify/functions/api.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, "../../public");
const HELPER = fs.readFileSync(path.join(PUBLIC, "app/contract-send.js"), "utf8");
const CRM = fs.readFileSync(path.join(PUBLIC, "app/contracts.html"), "utf8");
const CLOSER = fs.readFileSync(path.join(PUBLIC, "app/closer-call.html"), "utf8");
const PRESENT = fs.readFileSync(path.join(PUBLIC, "app/present.html"), "utf8");
const PRESENT_JS = fs.readFileSync(path.join(PUBLIC, "app/present.js"), "utf8");

describe("FHContractSend (public/app/contract-send.js)", () => {
  test("reuses the existing contracts write API — create_draft then send", () => {
    assert.ok(HELPER.includes('action: "create_draft"'));
    assert.ok(HELPER.includes('action: "send"'));
    assert.match(HELPER, /FHData\.write\("\/api\/contracts"/);
    assert.match(HELPER, /FHData\.read\("contracts"/);
  });

  test("does not invent a mail provider", () => {
    assert.equal(/\bmailgun\b|\bsendgrid\b|\bnodemailer\b|api\.mailgun/i.test(HELPER), false);
    assert.equal(/composeAndSend/.test(HELPER), false);
  });

  test("returns a copyable sign link", () => {
    assert.match(HELPER, /function linkUrl/);
    assert.match(HELPER, /function copyText/);
    assert.match(HELPER, /data\.links/);
  });

  test("the write path it calls is routed", () => {
    assert.ok(Object.prototype.hasOwnProperty.call(ROUTES, "contracts"));
    assert.ok(Object.prototype.hasOwnProperty.call(ROUTES, "read/contracts"));
  });
});

describe("where Send lives after the split", () => {
  test("the wording page does not pick a client or send", () => {
    assert.equal(/id="selClient"/.test(CRM), false);
    assert.equal(/<h2>Send a contract<\/h2>/.test(CRM), false);
    assert.equal(/action: "create_draft"/.test(CRM), false);
  });

  test("the call cockpit and Present load the helper and offer Send", () => {
    assert.match(CLOSER, /src="contract-send\.js"/);
    assert.match(CLOSER, /id="fh-send-contract"/);
    assert.match(PRESENT, /src="contract-send\.js"/);
    assert.match(PRESENT_JS, /Send contract/);
    assert.match(PRESENT_JS, /FHContractSend\.sendToClient/);
  });
});

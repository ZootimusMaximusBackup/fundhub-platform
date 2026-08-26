import test from "node:test";
import assert from "node:assert/strict";
import { monitorInboxDomain, mintMonitorAddress } from "./monitor-address.mjs";

test("monitor inbox uses the Mailgun send domain already in the house", () => {
  assert.equal(monitorInboxDomain({ MAILGUN_SEND_DOMAIN: "mg.fundhub.ai" }), "mg.fundhub.ai");
  assert.equal(mintMonitorAddress("cl-1", { MAILGUN_SEND_DOMAIN: "mg.fundhub.ai" }), "monitor+cl-1@mg.fundhub.ai");
});

test("blank env still mints on mg.fundhub.ai, not @fundhub.ai", () => {
  assert.equal(monitorInboxDomain({}), "mg.fundhub.ai");
  assert.equal(mintMonitorAddress("cl-9", {}), "monitor+cl-9@mg.fundhub.ai");
});

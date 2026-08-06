import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeMailServiceLevel,
  DEFAULT_MAIL_SERVICE_LEVEL,
  sendLetter
} from "./lob-letter.mjs";

test("normalizeMailServiceLevel defaults to priority_express", () => {
  assert.equal(normalizeMailServiceLevel(null), "priority_express");
  assert.equal(normalizeMailServiceLevel("nope"), DEFAULT_MAIL_SERVICE_LEVEL);
  assert.equal(normalizeMailServiceLevel("priority"), "priority");
  assert.equal(normalizeMailServiceLevel("PRIORITY_EXPRESS"), "priority_express");
});

test("sendLetter passes service level to Lob body", async () => {
  let posted = null;
  const sent = await sendLetter({
    env: { LOB_API_KEY: "test-key" },
    serviceLevel: "priority",
    to: {
      name: "Experian",
      address_line1: "PO Box 1",
      address_city: "Allen",
      address_state: "TX",
      address_zip: "75013"
    },
    file: "<html>hi</html>",
    fetchImpl: async (_url, init) => {
      posted = JSON.parse(init.body);
      return {
        ok: true,
        async json() { return { id: "ltr_1" }; }
      };
    }
  });
  assert.equal(sent.ok, true);
  assert.equal(posted.service, "priority");
  assert.equal(sent.serviceLevel, "priority");
});

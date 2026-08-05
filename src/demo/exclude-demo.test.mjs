import { test } from "node:test";
import assert from "node:assert/strict";
import { andNotDemo, crmDemoFilterSQL } from "./exclude-demo.mjs";
test("andNotDemo", () => assert.match(andNotDemo("c"), /is_demo/));
test("crmDemoFilterSQL", () => {
  assert.match(crmDemoFilterSQL("c", { demoMode: false }), /is_demo/);
  assert.equal(crmDemoFilterSQL("c", { demoMode: true }), "");
});

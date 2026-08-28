// public/start.html must send affiliate refs to the FundHub /apply funnel,
// not the bare apply.fundhub.ai/ origin (that 302s to the wrong CF theme).
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const START = path.resolve(HERE, "../../public/start.html");

test("start.html lands on apply.fundhub.ai/apply with a1+ref, not the CF root", () => {
  const html = fs.readFileSync(START, "utf8");
  assert.match(
    html,
    /var APPLY = "https:\/\/apply\.fundhub\.ai\/apply"/,
    "must target the canonical /apply funnel path"
  );
  assert.match(
    html,
    /dest \+= "\?a1=" \+ encodeURIComponent\(ref\) \+ "&ref=" \+ encodeURIComponent\(ref\)/,
    "must attach affiliate a1 and ref query params"
  );
  assert.match(html, /href="https:\/\/apply\.fundhub\.ai\/apply"/, "fallback button must point at /apply");
  assert.doesNotMatch(
    html,
    /var dest = "https:\/\/apply\.fundhub\.ai\/"/,
    "must not send people to bare apply.fundhub.ai/ (wrong CF theme)"
  );
  assert.ok(html.includes('localStorage.setItem("fh_ref", ref)'), "must stash ref for later attribution");
  assert.match(
    html,
    /fetch\("\/api\/public\/affiliate-click"/,
    "must record the visit before bouncing to apply"
  );
});

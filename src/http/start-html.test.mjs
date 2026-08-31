// public/start.html must send affiliate refs to a funnel path that KEEPS the
// referral code — not the bare apply.fundhub.ai/ origin, which 302s to the
// wrong ClickFunnels theme.
//
// WHY THIS NOW SAYS /watch AND NOT /apply. This test used to require /apply.
// public/start.html's own comment records what was found since: "/apply
// headless-bot-skips and drops query params; /watch keeps a1/ref." A path that
// drops a1 and ref defeats the exact thing the rest of this file checks for, so
// pinning /apply was pinning the destination that loses the attribution. The
// page is right and this test was stale.
//
// What is still pinned, because it is what actually protects the affiliate:
// a SPECIFIC path (never the bare origin), a1 AND ref on the outbound link, the
// code stashed in localStorage, and the click recorded before the bounce.
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
    /var APPLY = "https:\/\/apply\.fundhub\.ai\/watch"/,
    "must target a funnel path that keeps a1 and ref, not the bare origin"
  );
  assert.match(
    html,
    /dest \+= "\?a1=" \+ encodeURIComponent\(ref\) \+ "&ref=" \+ encodeURIComponent\(ref\)/,
    "must attach affiliate a1 and ref query params"
  );
  assert.match(html, /href="https:\/\/apply\.fundhub\.ai\/watch"/,
    "the no-JS fallback button must point at the same path the script uses");
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

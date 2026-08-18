// Default markup + paint path for closer-dashboard and my-numbers.
// Sample people in the seed HTML or the JS that paints it is a fail.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");

const SAMPLE_PEOPLE = /Jordan Blake|Priya Nair|Marcus Webb|Elena Voss|Devon Marsh|Bianca Souza/;

function read(file) {
  return fs.readFileSync(path.join(APP, file), "utf8");
}

test("closer-dashboard.html default markup has no sample people", () => {
  const html = read("closer-dashboard.html");
  assert.ok(!SAMPLE_PEOPLE.test(html), "sample person still in closer-dashboard.html");
  assert.ok(!/Sun Jul 26/.test(html), "July sample clock still in the header");
  assert.match(html, /Open from a client\./);
  assert.match(html, /id="whoName"/);
  assert.match(html, /\/api\/auth\/session/);
  assert.match(html, /\.calc-grid\[hidden\]/);
  // The four shift tiles (Calls Today / Kept / Collected / Pace) were cut from the
  // call surface 2026-08-17 — owner-set. They were `hidden` and never unhidden, so
  // this is stricter than the assertion it replaces: they may not come back at all.
  assert.ok(!/stat-tile/.test(html), "the closer shift tiles are back on the dashboard");
  assert.ok(!/id="todayPipe"/.test(html), "Today's Pipeline is back — the cockpit owns booked calls");
  assert.match(html, /id="calcClientName"/);
  assert.match(html, /FHData\.read\("closer-call"/);
  assert.match(html, /FHData\.read\("deal-math"/);
});

test("closer-dashboard.html binds live clock and session, not a sample who", () => {
  const html = read("closer-dashboard.html");
  assert.match(html, /function tickClock/);
  assert.match(html, /new Date\(\)\.toLocaleString/);
  assert.match(html, /paintStaff/);
  assert.match(html, /FHData\.read\("tradelines"/);
  assert.match(html, /FHData\.read\("lender-matches"/);
  assert.ok(!/SAMPLE —/.test(html), "deal math still labeled SAMPLE");
});

test("my-numbers.html seeds are dashes, not Elena / Devon / Bianca / Marcus", () => {
  const html = read("my-numbers.html");
  assert.ok(!SAMPLE_PEOPLE.test(html), "sample person still in my-numbers.html");
  assert.match(html, /id="staffChip"/);
  assert.ok(!/<b>Elena Voss<\/b>/.test(html));
  assert.ok(!/<b>Devon Marsh<\/b>/.test(html));
  assert.ok(!/Bianca Souza/.test(html));
  assert.ok(!/Marcus Webb/.test(html));
});

test("my-numbers.js replaces every sample row and binds session name or dash", () => {
  const js = read("my-numbers.js");
  assert.ok(!SAMPLE_PEOPLE.test(js), "sample person still in my-numbers.js");
  assert.match(js, /\/api\/auth\/session/);
  assert.match(js, /function paintWho/);
  assert.match(js, /FHData\.read\("my-numbers"\)/);
  assert.match(js, /querySelectorAll\("\.lb-row"\)/);
  assert.match(js, /querySelectorAll\("\.todo"\)/);
  assert.match(js, /name \|\| "—"/);
});

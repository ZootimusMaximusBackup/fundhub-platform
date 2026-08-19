import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* Workflows that exist on disk and are deliberately NOT served.
 *
 * THE POINT OF THIS LIST IS THAT IT IS A LIST. The previous way to switch a
 * workflow off was to leave it out of index.mjs's import block, which is
 * invisible: nothing counted the files, the Automations screen showed the
 * registered set as if it were the whole set, and "53 written / 51 served" was
 * only discoverable by hand. Two jobs sat unserved that way for months — the
 * incomplete-survey nudge, while 400 stalled applications went unchased, and
 * the inquiry call sweeper. Both were switched on by the owner on 2026-08-19.
 *
 * An entry here needs a reason and an owner. An empty list is the healthy state. */
const DELIBERATELY_UNSERVED = {
  // "some-workflow-id": "why, and who decided",
};

/* Every id passed to inngest.createFunction in this directory, read from the
   source rather than by importing — importing every module to count them would
   run each one's module-scope side effects just to answer "does it exist". */
function idsOnDisk() {
  const found = new Map();
  for (const file of fs.readdirSync(HERE)) {
    if (!file.endsWith(".mjs") || file.endsWith(".test.mjs")) continue;
    const src = fs.readFileSync(path.join(HERE, file), "utf8");
    // Strip comments so a createFunction described in prose is not counted.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const re = /inngest\.createFunction\(\s*\{[^}]*?\bid:\s*["']([^"']+)["']/g;
    let m;
    while ((m = re.exec(code))) found.set(m[1], file);
  }
  return found;
}

test("every workflow written on disk is either served or explicitly unserved", async () => {
  const { functions } = await import("./index.mjs");
  const registered = new Set(functions.map((fn) => fn.id()));
  const disk = idsOnDisk();

  const missing = [...disk.keys()]
    .filter((id) => !registered.has(id) && !(id in DELIBERATELY_UNSERVED))
    .map((id) => `${id} (${disk.get(id)})`);

  assert.deepEqual(missing, [],
    "these workflows are written but nothing serves them, so they can never run. " +
    "Either add them to index.mjs's `functions` array, or add them to " +
    "DELIBERATELY_UNSERVED in this file with a reason:\n  " + missing.join("\n  "));
});

test("nothing is listed as unserved that is actually served, or that no longer exists", () => {
  const disk = idsOnDisk();
  for (const [id, reason] of Object.entries(DELIBERATELY_UNSERVED)) {
    assert.ok(disk.has(id), `DELIBERATELY_UNSERVED names "${id}", which is not on disk any more — drop the line`);
    assert.ok(typeof reason === "string" && reason.trim().length > 0, `"${id}" needs a reason`);
  }
});

test("index serves exactly the workflows on disk, and the count is pinned", async () => {
  const { functions } = await import("./index.mjs");
  const disk = idsOnDisk();
  const expected = disk.size - Object.keys(DELIBERATELY_UNSERVED).length;

  /* 53 since the incomplete-survey nudge and the inquiry call sweeper were
     switched on by the owner (2026-08-19). Was pinned at 51, which is the
     number that made the drift look intentional.

     The count stays pinned as well as derived: registering a function is how a
     job starts running, and Inngest executes functions in production today, so
     it should cost somebody a line in a test. */
  assert.equal(functions.length, 53, `expected 53, got ${functions.length}`);
  assert.equal(functions.length, expected,
    `${disk.size} workflows on disk, ${Object.keys(DELIBERATELY_UNSERVED).length} deliberately unserved, ` +
    `so ${expected} should be served — but ${functions.length} are`);

  const ids = functions.map((fn) => fn.id());
  assert.equal(new Set(ids).size, ids.length, "a workflow is registered twice");
  for (const id of ids) {
    assert.ok(disk.has(id), `"${id}" is served but no file in this directory defines it`);
  }
  for (const fn of functions) {
    assert.ok(fn && typeof fn === "object", "each entry should be an Inngest function object");
  }
});

test("api/inngest serve endpoint imports without throwing", async () => {
  // Dynamic import of the serve handler — if the module graph is broken this throws.
  const mod = await import("../../api/inngest.mjs");
  assert.ok(mod.default, "serve handler should be the default export");
  assert.equal(typeof mod.default, "function", "serve handler should be a function");
});

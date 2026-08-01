/* Pins src/journeys/seed-journeys.mjs to public/app/journeys.html.
 *
 * The trees exist in two places and that is a real duplication (see the
 * module's header for why it is not resolved in this ticket). This test is
 * what stops it rotting: it re-extracts the editor's own seed() at test time
 * and deep-compares. Edit the editor without regenerating the module and the
 * suite goes red naming the drift, rather than the runner quietly walking a
 * stale tree and reporting confidently about a journey nobody has.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  SEED_JOURNEYS,
  STEP_TYPES,
  EDITOR_ROLES,
  EDITOR_STAGES,
  EDITOR_PIPELINES,
  EDITOR_DELAYS,
  JOURNEY_ORDER
} from "./seed-journeys.mjs";

const EDITOR = path.join(process.cwd(), "public/app/journeys.html");

/* Evaluates the editor's declaration block — everything from `const TYPES={`
   up to `let J=seed();`. That slice is pure data plus the two constructors
   (nid, N) and touches no DOM, which is why it can run under node at all. */
function extractFromEditor() {
  const src = fs.readFileSync(EDITOR, "utf8");
  const start = src.indexOf("const TYPES={");
  const end = src.indexOf("\nlet J=seed();");
  assert.ok(start > -1, "journeys.html no longer declares `const TYPES={` — the extractor needs updating");
  assert.ok(end > start, "journeys.html no longer contains `let J=seed();` — the extractor needs updating");
  const fn = new Function(
    src.slice(start, end) + "\nreturn { TYPES, ROLES, STAGES, PIPES, DELAYS, seed };"
  );
  return fn();
}

test("the server-side trees are identical to what the editor seeds", () => {
  const editor = extractFromEditor();
  /* Compared through JSON on purpose. The editor's node constructor always
     sets a `branches` key, leaving it undefined on the nine-in-ten nodes that
     are not conditions, and Node's deepEqual counts an own key holding
     undefined as different from no key at all. Every route this tree actually
     travels — the PUT body, the jsonb column, the GET response — is JSON, so
     JSON equality is the equality that matters. */
  const viaJson = JSON.parse(JSON.stringify(editor.seed()));
  assert.deepEqual(
    SEED_JOURNEYS,
    viaJson,
    "src/journeys/seed-journeys.mjs has drifted from public/app/journeys.html — regenerate it"
  );
});

test("the editor's enumerations match the extracted copies", () => {
  const editor = extractFromEditor();
  assert.deepEqual(STEP_TYPES, Object.keys(editor.TYPES));
  assert.deepEqual(EDITOR_ROLES, editor.ROLES);
  assert.deepEqual(EDITOR_STAGES, editor.STAGES);
  assert.deepEqual(EDITOR_PIPELINES, editor.PIPES);
  assert.deepEqual(EDITOR_DELAYS, editor.DELAYS);
});

test("the shape the walker relies on holds across all six journeys", () => {
  assert.deepEqual(Object.keys(SEED_JOURNEYS).sort(), [...JOURNEY_ORDER].sort());

  const seen = { types: new Set(), conditions: 0, nodes: 0 };
  const walk = (nodes, where) => {
    assert.ok(Array.isArray(nodes), `${where}: nodes must be an array`);
    for (const n of nodes) {
      seen.nodes++;
      seen.types.add(n.type);
      assert.ok(n.id, `${where}: every node needs an id`);
      assert.ok(STEP_TYPES.includes(n.type), `${where}: unknown step type ${n.type}`);
      assert.ok(Array.isArray(n.touches), `${where}/${n.id}: touches must be an array`);
      for (const t of n.touches) {
        assert.equal(t.length, 2, `${where}/${n.id}: a touch is a [category, label] pair`);
      }
      if (n.type === "condition") {
        seen.conditions++;
        // The editor hard-indexes branches[0] and branches[1] everywhere, so
        // exactly two lanes is load-bearing, not incidental.
        assert.equal(n.branches.length, 2, `${where}/${n.id}: a condition has exactly two lanes`);
        n.branches.forEach((b, i) => {
          assert.ok(b.label, `${where}/${n.id}: lane ${i} needs a label`);
          walk(b.nodes, `${where}/${n.id}[${b.label}]`);
        });
      } else {
        assert.equal(n.branches, undefined, `${where}/${n.id}: only a condition may carry branches`);
      }
    }
  };
  for (const [key, j] of Object.entries(SEED_JOURNEYS)) {
    assert.ok(j.name && j.start && j.end, `${key}: needs name, start and end`);
    walk(j.nodes, key);
  }

  assert.equal(seen.nodes, 39, "the seeded journeys hold 39 nodes");
  /* Three conditions across six journeys — one each in client, setter and
     closer; advisor, affiliate and partner are straight lines. So the walk is
     nine paths, not the sixteen the ticket's "a journey with four conditions"
     example implies. The branching in the authored data is much shallower than
     the runner is built to handle, and that is itself a finding: three of the
     six journeys never fork at all. */
  assert.equal(seen.conditions, 3, "three condition nodes across the six journeys");
});

test("the touches census matches what the ticket recorded", () => {
  // These six counts are quoted in the ticket as the current state of the data
  // model. Pinning them means the runner's touches coverage cannot quietly
  // start reading fewer declarations than exist.
  const census = {};
  const walk = (nodes) => {
    for (const n of nodes) {
      for (const [category] of n.touches || []) census[category] = (census[category] || 0) + 1;
      for (const b of n.branches || []) walk(b.nodes);
    }
  };
  Object.values(SEED_JOURNEYS).forEach((j) => walk(j.nodes));

  assert.deepEqual(census, { Rule: 17, Screen: 13, Journey: 9, Template: 8, Agent: 5, Rail: 2 });
});

test("the known-unbuilt Screen declaration is present in the data", () => {
  // The canary for the touches checker. This string is already sitting in the
  // editor as a plain-text finding that nothing acts on; a runner that does
  // not surface it is not reading touches at all.
  const found = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      for (const [category, label] of n.touches || []) {
        if (category === "Screen" && /not built yet/i.test(label)) found.push(label);
      }
      for (const b of n.branches || []) walk(b.nodes);
    }
  };
  Object.values(SEED_JOURNEYS).forEach((j) => walk(j.nodes));
  assert.deepEqual(found, ["Affiliate portal — not built yet"]);
});

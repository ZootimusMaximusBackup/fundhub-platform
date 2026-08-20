// The Documents screen, read as source.
//
// Same idea as contracts-screen.test.mjs: public/app/documents.html is imported
// by nothing, so without this file nothing in the suite would notice if it
// started calling an endpoint that does not exist, or quietly dropped a control
// a role depends on.
//
// WHY THIS FILE APPEARED (2026-08-17). Contracts and Documents were doing a
// version of the same job. Owner decision: Contracts is where you BUILD a
// contract template; Documents is where you WATCH a sent contract. The queue,
// its statuses, the download, and the void action moved here from
// public/app/contracts.html — and the assertions that guarded them moved with
// them rather than being deleted. Each one below says where it came from.
//
// It lives under src/ rather than public/ because package.json's test glob only
// walks src/ and scripts/ (CLAUDE.md §12).

import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROUTES } from "../../netlify/functions/api.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, "../../public");
const DOCS = fs.readFileSync(path.join(PUBLIC, "app/documents.html"), "utf8");

/* Every /api/... path the file asks for, deduplicated. Same helper as
   contracts-screen.test.mjs — kept local rather than shared because these two
   files are the only callers and a shared import would be one more thing to
   keep in step for no gain. */
function apiPaths(src) {
  const out = new Set();
  const re = /["'`](\/api\/[a-z0-9/_-]+)/gi;
  let m;
  while ((m = re.exec(src))) out.add(m[1]);
  return [...out];
}

describe("the Documents screen (public/app/documents.html)", () => {
  test("is a CRM screen: it loads the shell and the shared data layer", () => {
    assert.match(DOCS, /<script(?:\s+defer)?\s+src="shell\.js"><\/script>/);
    assert.match(DOCS, /<script(?:\s+defer)?\s+src="data\.js"><\/script>/);
  });

  /* A handler file is not a route — CLAUDE.md §12. This has shipped broken
     twice, and a Documents screen that 404s on void or remind would be the
     third time. */
  test("every endpoint it calls is really routed", () => {
    const called = apiPaths(DOCS);
    assert.ok(called.length >= 1, `expected the screen to call the API, found ${called.length}`);
    for (const p of called) {
      const key = p.replace(/^\/api\//, "");
      assert.ok(Object.prototype.hasOwnProperty.call(ROUTES, key),
        `documents.html calls ${p}, which is not in the ROUTES map — it would 404`);
    }
  });

  /* The list itself goes through data.js's own FHData.documents() helper
     rather than a raw read("documents") — that is what wires the sample-data
     banner to the same call. The contract decoration below uses read()
     directly because no helper exists for it. */
  test("it reads the document list through the shared documents helper", () => {
    assert.match(DOCS, /FHData\.documents\(/);
    assert.match(DOCS, /FHData\.wire\(/);
  });
});

describe("the Documents screen — sent contracts (moved here from Contracts)", () => {
  /* FROM contracts-screen.test.mjs, "it shows the status of every contract,
     which the brief required". The five states are the contract lifecycle in
     db/migrations/124_contracts.sql; a screen that watches contracts has to be
     able to render all of them. "viewed" is shown to staff as "opened". */
  test("it shows every contract state", () => {
    for (const s of ["draft", "sent", "viewed", "signed", "void"]) {
      assert.ok(new RegExp(`\\b${s}\\b`).test(DOCS),
        `the screen never mentions the "${s}" state`);
    }
    assert.match(DOCS, /var CSTATE=/, "the contract-state badge map is gone");
  });

  /* FROM contracts-screen.test.mjs, "the finished document can be downloaded
     from the CRM". The bytes come back base64 inside JSON — never a URL and
     never a storage key — so the browser has to build its own blob. */
  test("the finished document can be downloaded from the CRM", () => {
    assert.match(DOCS, /file: "contract"/);
    assert.match(DOCS, /a\.download = res\.data\.filename/);
  });

  /* FROM contracts-screen.test.mjs, "void is offered only to an owner or
     admin, matching the endpoint's gate". api/contracts.mjs answers 403 to a
     narrower role, and UI-STANDARDS §4 says a role does not render a control
     it cannot use — so the button must be gated in the markup too, not merely
     refused after the click. */
  test("void is offered only to an owner or admin, matching the endpoint's gate", () => {
    assert.match(DOCS, /ctAdmin&&c\.status!=='signed'&&c\.status!=='void'/);
    assert.ok(DOCS.includes('action: "void"'), "the screen cannot void a contract");
  });

  /* NEW with this batch. The old Send-reminders button was an org-wide sweep
     that skipped anything touched in the last three days, so on a single row it
     usually answered "nothing to chase". This is the per-contract action that
     replaced it. It is ordinary STAFF work, deliberately — the batch sweep
     stays owner/admin. */
  test("one signer can be chased from the row, and staff are shown the server's own words", () => {
    assert.ok(DOCS.includes('action: "remind"'), "the screen cannot send a reminder");
    assert.match(DOCS, /data-ct="remind"/);
    assert.match(DOCS, /res\.data && res\.data\.message|res\.data\.message/,
      "the reminder result must show the server's message — it reports mail that was queued but not sent");
  });

  /* THE N+1 RULE. A documents row does not know its contract, so the screen
     has to join them. Doing that per row turns a 200-row page into 201
     requests — the same failure read/documents' own client_name join exists to
     avoid. One call for the whole page, capped at 200 ids by the endpoint. */
  test("contract state is fetched once for the page, not once per row", () => {
    assert.match(DOCS, /document_id/, "the batched document_id lookup is gone");
    assert.match(DOCS, /byDoc/, "the client-side document → contract map is gone");
  });

  /* Rows that are not contracts must be untouched by any of the above. Four of
     the five document kinds are not contracts at all. */
  test("a document that is not a contract gets no contract controls", () => {
    assert.match(DOCS, /byDoc\[/, "rows are decorated by lookup, so a miss leaves them plain");
  });

  /* Owner split, 2026-08-17: Documents watches four classes. A fifth kind
     (client_upload) and a blank uploaded template must not be invented into
     one of those four. */
  test("it watches the four named classes and does not invent a fifth", () => {
    assert.match(DOCS, /n:'Soft-pull authorizations'/);
    assert.match(DOCS, /n:'Contracts'/);
    assert.match(DOCS, /n:'Invoices'/);
    assert.match(DOCS, /n:'UnderwriteIQ deliverables'/);
    assert.match(DOCS, /subtype === "template_source"/,
      "blank uploaded templates must leave this list — they are not sent or received");
    assert.equal(/cls = "auth"; unmapped\+\+/.test(DOCS), false,
      "an unknown kind must not be filed as a soft-pull authorization");
  });

  test("it never paints a sample banner or duplicate record count over real rows", () => {
    assert.match(DOCS, /return "live documents"/);
    assert.doesNotMatch(DOCS, /live documents · " \+ mapped\.length \+ " records/);
    assert.equal(/if \(!rows\.length\) return null/.test(DOCS), false);
  });
});

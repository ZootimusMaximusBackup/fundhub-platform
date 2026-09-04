/* NO CREDIT PULL, NO LENDER COUNT (F10, owner-set 2026-09-03).
 *
 * On 2026-09-03 the closer screen read "307 lenders match this file" three
 * lines under "No credit pull on file yet" and "No crs_results row for this
 * client yet". A client with zero credit data matched 307 lenders, and that is
 * a number a closer could repeat to a customer on a live call. Chris: "we
 * didn't pull their fucking credit yet, so there shouldn't be any matched banks
 * at all."
 *
 * Never a number before the pull. Not 307, and not zero — zero is itself an
 * answer about this client, and there is no answer yet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gateLenderMatch } from "./cockpit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const closerJs = fs.readFileSync(
  path.resolve(HERE, "../../public/app/closer-call.js"), "utf8"
);

const NO_PULL = { available: false, reason: "No crs_results row for this client yet" };
const PULLED = { available: true, scores: { experian: 762 } };

test("no credit pull means no count and no lender list", () => {
  const out = gateLenderMatch({
    credit: NO_PULL,
    // The live shape: the matcher happily returned 307 rows for an empty file.
    lenders: { match_count: 307, matches: new Array(307).fill({ id: "x" }) }
  });
  assert.equal(out.matched_lenders, null, "a number was shown before the pull");
  assert.deepEqual(out.lenders, [], "the lender list leaked before the pull");
  assert.equal(out.lenders_gated_on, "credit_pull");
  assert.match(out.lenders_reason, /pull credit/i);
});

test("zero is not the answer either — it is still a number about this client", () => {
  const out = gateLenderMatch({ credit: NO_PULL, lenders: { match_count: 0, matches: [] } });
  assert.equal(out.matched_lenders, null);
});

test("after a pull the count is reported, with what it was matched on", () => {
  const out = gateLenderMatch({
    credit: PULLED,
    lenders: { match_count: 2, matches: [{ id: "a" }, { id: "b" }] }
  });
  assert.equal(out.matched_lenders, 2);
  assert.equal(out.lenders.length, 2);
  assert.equal(out.lenders_gated_on, null);
  /* Funding finding 7: the matcher reads state and bureau sensitivity only —
     no score, no tier, no card use, no estimate. Until src/lenders/match.mjs
     reads the credit file, the payload has to say so rather than let the count
     be read as an assessment of this client. */
  assert.match(out.lenders_basis, /not score, tier or card use/i);
});

test("a pulled file with nothing matched still says so", () => {
  const out = gateLenderMatch({ credit: PULLED, lenders: { match_count: 0, matches: [] } });
  assert.equal(out.matched_lenders, 0);
  assert.match(out.lenders_reason, /No lenders matched/i);
});

test("the closer screen prints the reason, never a number, with no pull", () => {
  assert.ok(closerJs.includes("uw.lenders_reason"),
    "closer-call.js must show why there is no count");
  assert.ok(closerJs.includes("lender\" + (n === 1"),
    "the count line is still there for a pulled file");
});

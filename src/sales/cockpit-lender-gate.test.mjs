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

/* REWRITTEN 2026-09-03 (funding finding 7). This test used to assert
   lenders_basis matched /not score, tier or card use/. That sentence pinned the
   defect: the matcher genuinely ignored the credit file, so the payload said so.
   matchLenders() now takes the file, and a fixed sentence claiming it does not
   would be a lie the moment lender minimums are recorded. The basis is now
   derived from summary.credit, so these cases pin the derivation instead. */
test("after a pull the count is reported, with what it was matched on", () => {
  const out = gateLenderMatch({
    credit: PULLED,
    lenders: {
      match_count: 2,
      matches: [{ id: "a" }, { id: "b" }],
      summary: {
        credit: {
          available: true,
          lenders_with_stated_minimum: 4,
          lenders_excluded_on_score: 1,
          lenders_with_unreadable_requirement: 0
        }
      }
    }
  });
  assert.equal(out.matched_lenders, 2);
  assert.equal(out.lenders.length, 2);
  assert.equal(out.lenders_gated_on, null);
  assert.match(out.lenders_basis, /this file's score/i);
  assert.match(out.lenders_basis, /4 lenders record a minimum score/i);
  assert.match(out.lenders_basis, /1 was ruled out/i);
});

/* TODAY'S DATA. 0 of 313 lender rows in the CSV load path state a credit
   minimum, so the score gate excludes nobody. The count must not be dressed up
   as an assessment it did not perform. */
test("with no lender minimums recorded, the basis says the score ruled nobody out", () => {
  const out = gateLenderMatch({
    credit: PULLED,
    lenders: {
      match_count: 307,
      matches: new Array(307).fill({ id: "x" }),
      summary: {
        credit: {
          available: true,
          lenders_with_stated_minimum: 0,
          lenders_excluded_on_score: 0,
          lenders_with_unreadable_requirement: 0
        }
      }
    }
  });
  assert.match(out.lenders_basis, /No lender on the list records a minimum score/i);
  assert.doesNotMatch(out.lenders_basis, /ruled out on this file/i);
});

test("unreadable requirement wording is reported, not hidden", () => {
  const out = gateLenderMatch({
    credit: PULLED,
    lenders: {
      match_count: 5,
      matches: [],
      summary: {
        credit: {
          available: true,
          lenders_with_stated_minimum: 2,
          lenders_excluded_on_score: 0,
          lenders_with_unreadable_requirement: 3
        }
      }
    }
  });
  assert.match(out.lenders_basis, /3 more mention a score in wording we could not read/i);
  assert.match(out.lenders_basis, /kept rather than dropped/i);
});

test("a match that carried no credit summary never claims the file was weighed", () => {
  const out = gateLenderMatch({
    credit: PULLED,
    lenders: { match_count: 2, matches: [{ id: "a" }, { id: "b" }] }
  });
  assert.match(out.lenders_basis, /credit file was not read into this match/i);
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

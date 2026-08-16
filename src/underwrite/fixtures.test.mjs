// UnderwriteIQ Lite — THE PINNED FIXTURES. Known input -> known sentences.
//
// THIS IS THE EARLY-WARNING SYSTEM FOR THE VENDORED ENGINE. src/underwrite/vendor
// holds byte-for-byte copies of somebody else's code at one commit. When that
// code is refreshed, the thing that must not change silently is what a client is
// TOLD. These fixtures assert the exact sentences, so a refresh that reworded,
// dropped, added or re-ordered advice fails here instead of shipping.
//
// ═══════════════════════════════════════════════════════════════════════════════
// WHY THESE FIXTURES CANNOT ROT — READ BEFORE ADDING ONE
//
// `computeUnderwrite` READS THE SYSTEM CLOCK. It ages every tradeline through
// monthsSince(tl.opened) and calls a line "seasoned" at >= 24 months, and
// seasoning gates every funding figure. A fixture with `opened` set to a date a
// couple of years back would pass today and fail on its own two years from now,
// with a diff that looks exactly like upstream drift. That false alarm would
// destroy the value of this file.
//
// So every `opened` value here is in the CLOCK-STABLE region, and there are only
// two safe choices:
//
//   opened: null        -> monthsSince returns null -> never seasoned. Stable
//                          forever, and it is also what fundhub actually supplies
//                          (no open date is stored anywhere — see ./adapter.mjs).
//   opened: "1990-01"   -> ~35 years old -> seasoned. Stays seasoned for
//                          centuries.
//
// NEVER use a date near the 24-month boundary, and never compute one from the
// current date. If you need an unseasoned-but-dated line, use null.
// ═══════════════════════════════════════════════════════════════════════════════

import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { UPSTREAM, computeUnderwrite, buildSuggestions, normalizeBureau, getNumberField } from "./engine.mjs";
import { SUGGESTION_CATALOGUE, DEPENDENCY_FIELDS, annotateSuggestions } from "./report.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENDOR = path.join(HERE, "vendor");

/* ─────────────── the vendored files are intact and self-contained ─────────────── */

describe("vendored engine — provenance", () => {
  test("the recorded upstream commit is a full 40-character sha", () => {
    assert.match(UPSTREAM.commit, /^[0-9a-f]{40}$/,
      "src/underwrite/engine.mjs must record the exact upstream commit it was vendored from");
  });

  test("both vendored files are present under vendor/", () => {
    for (const f of ["underwriter.cjs", "suggestions.cjs"]) {
      assert.ok(fs.existsSync(path.join(VENDOR, f)), `missing vendored file: ${f}`);
    }
  });

  test("THE ENGINE MAKES NO NETWORK CALL AND TOUCHES NO DATABASE", () => {
    // The reason these two files were safe to vendor while parse-report,
    // switchboard, ai-gatekeeper and google-ocr were not: those need an OpenAI
    // key and upload live PDFs. If a refresh ever pulls a fetch into this
    // directory, that has to stop the build rather than start making outbound
    // calls from a credit read.
    for (const f of ["underwriter.cjs", "suggestions.cjs"]) {
      const src = fs.readFileSync(path.join(VENDOR, f), "utf8");
      for (const forbidden of ["fetch(", "require(", "XMLHttpRequest", "https.", "http.", "child_process", "process.env"]) {
        assert.ok(!src.includes(forbidden),
          `${f} contains "${forbidden}" — the vendored engine must stay pure and dependency-free`);
      }
    }
  });

  test("the boundary is one module — nothing outside src/underwrite imports vendor/", () => {
    // The single-file-update promise in engine.mjs's header is only true while
    // this holds. Walks the repo rather than trusting the convention.
    const roots = ["src", "api", "netlify", "scripts"].map((d) => path.resolve(HERE, "../..", d));
    const offenders = [];
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!/\.(mjs|js|cjs)$/.test(e.name)) continue;
        if (full.startsWith(path.join(HERE, "vendor"))) continue;
        if (full === path.join(HERE, "engine.mjs")) continue;
        // Matches a real module specifier — `from "./vendor/x.cjs"` or
        // `require("...vendor/x")` — not a mention of the path in prose. This
        // file talks about vendor/ constantly and reads it with fs; neither is
        // an import and neither breaks the single-file-update promise.
        const src = fs.readFileSync(full, "utf8");
        if (/(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)["'][^"']*vendor\/(?:underwriter|suggestions)/.test(src)) {
          offenders.push(path.relative(path.resolve(HERE, "../.."), full));
        }
      }
    };
    roots.forEach(walk);
    assert.deepEqual(offenders, [],
      "only src/underwrite/engine.mjs may import the vendored files — otherwise an upstream " +
      "refresh stops being a single-file update");
  });
});

/* ─────────────── the catalogue matches the engine, exactly ─────────────── */

describe("suggestion catalogue — the drift detector", () => {
  test("every catalogued sentence appears verbatim in the vendored source", () => {
    // Catches BOTH failure directions: a typo in report.mjs's catalogue (so a
    // real sentence would never match and would be returned unlabelled), and an
    // upstream reword (so a labelled sentence would quietly become unlabelled).
    // Note "You’re approved" uses a curly apostrophe upstream while "You're
    // close to approval" uses a straight one — retyping loses that.
    const src = fs.readFileSync(path.join(VENDOR, "suggestions.cjs"), "utf8");
    const missing = Object.keys(SUGGESTION_CATALOGUE).filter((s) => !src.includes(s));
    assert.deepEqual(missing, [],
      "these catalogue strings are not in the vendored engine — either the catalogue has a " +
      "typo or upstream changed the wording");
  });

  test("the catalogue covers every sentence the engine can emit", () => {
    // The other direction: upstream ADDED a sentence and nobody catalogued it.
    // Such a line would still be returned to the caller, but with id: null and
    // recognised: false — visible, not silently mislabelled. This test is what
    // turns that from a surprise in production into a failing build.
    const src = fs.readFileSync(path.join(VENDOR, "suggestions.cjs"), "utf8");
    const emitted = [...src.matchAll(/out\.push\(\s*("(?:[^"\\]|\\.)*")\s*\)/g)]
      .map((m) => JSON.parse(m[1]));
    assert.ok(emitted.length > 0, "found no out.push() strings — the extraction regex needs updating");
    const uncatalogued = emitted.filter((s) => !(s in SUGGESTION_CATALOGUE));
    assert.deepEqual(uncatalogued, [],
      "the vendored engine can emit sentences the catalogue does not know about");
    assert.equal(emitted.length, Object.keys(SUGGESTION_CATALOGUE).length,
      "catalogue size and engine sentence count disagree");
  });

  test("every dependsOn names a field the adapter actually reports on", () => {
    for (const [text, entry] of Object.entries(SUGGESTION_CATALOGUE)) {
      for (const dep of entry.dependsOn) {
        assert.ok(DEPENDENCY_FIELDS.includes(dep),
          `"${entry.id}" depends on "${dep}", which is not in DEPENDENCY_FIELDS (${text.slice(0, 40)}...)`);
      }
    }
  });

  test("catalogue ids are unique", () => {
    const ids = Object.values(SUGGESTION_CATALOGUE).map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate catalogue id");
  });
});

/* ─────────────── the pinned fixtures ─────────────── */

/* FIXTURE 1 — a real file: high utilization, many inquiries, several negatives,
   and one seasoned $20k card to anchor on. Exercises the top band of three
   separate rules at once. Both `opened` values are 1990, so seasoning is fixed. */
const FIXTURE_MAXED = {
  experian: {
    score: 720,
    utilization_pct: 85,          // PERCENT UNITS. 85 means 85%.
    inquiries: 14,
    negatives: 6,
    late_payment_events: 2,
    tradelines: [
      { type: "revolving", status: "open", limit: 20000, balance: 17000, opened: "1990-01" },
      { type: "revolving", status: "open", limit: 5000, balance: 4000, opened: "1990-02" },
      { type: "installment", status: "open", limit: 30000, balance: 12000, opened: "1990-03" }
    ]
  }
};

/* FIXTURE 2 — THE HONESTY FIXTURE, AND THE MOST IMPORTANT ONE IN THIS FILE.
   A client where a score is the ONLY thing anybody entered. Utilization,
   inquiries, negatives and late payments are all null, and there are no lines.

   Product rule (vendored measuredCount): unknown counts stay null — never 0.
   `fundable` requires `neg === 0` (strict). So this client — about whom almost
   nothing is known — is NOT fundable. That is the pin: unknown must not read
   as a clean file.

   ./adapter.mjs still records every unentered field and ./report.mjs marks any
   sentence resting on one. The LLC "not fundable / repair" line is what ships. */
const FIXTURE_EMPTY_BUT_SCORED = {
  experian: {
    score: 700,
    utilization_pct: null,
    inquiries: null,
    negatives: null,
    late_payment_events: null,
    tradelines: []
  }
};

/* FIXTURE 3 — no bureau data at all. The state of every client before a pull. */
const FIXTURE_NO_BUREAUS = {};

describe("pinned fixtures — known input, known sentences", () => {

  test("FIXTURE 1: maxed out, many inquiries, several negatives, seasoned anchor", () => {
    const uw = computeUnderwrite(FIXTURE_MAXED, 30);

    assert.equal(uw.fundable, false, "85% utilization fails the <=30 condition");
    assert.equal(uw.primary_bureau, "experian");
    assert.equal(uw.metrics.score, 720);
    assert.equal(uw.metrics.utilization_pct, 85);
    assert.equal(uw.metrics.negative_accounts, 6);
    assert.deepEqual(uw.metrics.inquiries, { ex: 14, eq: 0, tu: 0, total: 14 });

    // The seasoned $20k card is found, so no "add an anchor card" advice.
    assert.equal(uw.personal.highest_revolving_limit, 20000);
    assert.equal(uw.personal.can_card_stack, true);
    assert.equal(uw.personal.card_funding, 110000, "20000 * 5.5");
    // Loan stacking needs zero late payments; there are two.
    assert.equal(uw.personal.can_loan_stack, false);
    assert.equal(uw.optimization.needs_new_primary_revolving, false);
    assert.equal(uw.optimization.needs_file_buildout, false);

    assert.deepEqual(buildSuggestions(uw), [
      "Your utilization is extremely high (80%+). Paying balances down aggressively will unlock a large jump in scores and approvals.",
      "You have a high number of recent hard inquiries. Cleaning these up will prevent auto-declines and open up better approvals.",
      "You have multiple negative accounts. Prioritize charge-offs and collections first to unlock the biggest score gains.",
      "You don’t have an LLC yet. Form an LLC now so it can season while your credit is being repaired."
    ]);
  });

  test("FIXTURE 2: a score and nothing else is NOT fundable — unknown stays null", () => {
    const uw = computeUnderwrite(FIXTURE_EMPTY_BUT_SCORED, null);

    // Product rule: counts that gate fundable stay null when unknown.
    assert.equal(uw.metrics.negative_accounts, null, "null negatives stay null — never 0");
    assert.equal(uw.metrics.late_payment_events, null, "null late payments stay null");
    assert.equal(uw.metrics.inquiries.total, null, "null inquiries stay null in total");
    assert.equal(uw.metrics.utilization_pct, null, "utilization null survives");

    assert.equal(uw.fundable, false,
      "THIS IS THE PIN: a client with only a score is not fundable, because unknown " +
      "negatives stay null and fundable requires neg === 0");

    assert.deepEqual(buildSuggestions(uw), [
      "Add a strong primary revolving account (not AU) with a $5,000+ limit to anchor your profile before stacking.",
      "Your file is thin. Add at least one primary credit card and one small installment loan to establish depth.",
      "You don’t have an LLC yet. Form an LLC now so it can season while your credit is being repaired."
    ]);

    // ── containment still applies to the LLC / thin-file sentences ──
    const missing = {
      experian: [
        { field: "negatives", source: "clients.custom_fields.crs_negative_items_count", reason: "not entered" },
        { field: "inquiries", source: "clients.custom_fields.crs_inquiries_ex", reason: "not entered" },
        { field: "tradelines", source: "tradelines rows", reason: "no lines stored for this client" }
      ],
      client: [{ field: "hasLLC", source: "(not stored anywhere in fundhub)", reason: "no LLC field exists" }]
    };
    const annotated = annotateSuggestions(buildSuggestions(uw), uw, missing);

    const notFundable = annotated.find((a) => a.id === "llc_absent_not_fundable");
    assert.ok(notFundable, "the not-fundable LLC sentence must be recognised and labelled");
    assert.equal(notFundable.restsOnMissingData, true,
      "the LLC line must never be presented as a measured result when hasLLC is absent");
    assert.deepEqual(notFundable.missingFields.map((f) => f.field), ["hasLLC"]);

    const thinFile = annotated.find((a) => a.id === "file_thin_empty");
    assert.equal(thinFile.restsOnMissingData, true);
    assert.ok(thinFile.missingFields.some((f) => f.field === "tradelines"));

    // Every sentence is recognised — none falls through to the unlabelled path.
    assert.deepEqual(annotated.filter((a) => !a.recognised), []);
    // And no sentence text was altered on the way through.
    assert.deepEqual(annotated.map((a) => a.text), buildSuggestions(uw));
  });

  test("FIXTURE 3: no bureau data at all", () => {
    const uw = computeUnderwrite(FIXTURE_NO_BUREAUS, null);

    assert.equal(uw.fundable, false);
    for (const b of ["experian", "equifax", "transunion"]) {
      assert.equal(uw.per_bureau[b].available, false, `${b} must report unavailable`);
    }
    // ⚠️ PINNED BECAUSE IT IS A TRAP: an unavailable bureau reports score 0, not
    // null. Any screen printing metrics.score directly would show this client a
    // credit score of zero. api/read/underwrite.mjs ships the bureausAssessed /
    // bureausUnavailable lists alongside precisely so a caller can tell 0-because-
    // unknown from a real number.
    assert.equal(uw.metrics.score, 0, "an unavailable bureau's score is 0, NOT null");

    assert.equal(uw.lite_banner_funding, null,
      "no card funding computed — null, not a made-up display floor");

    assert.deepEqual(buildSuggestions(uw), [
      "Add a strong primary revolving account (not AU) with a $5,000+ limit to anchor your profile before stacking.",
      "Your file is thin. Add at least one primary credit card and one small installment loan to establish depth.",
      "You don’t have an LLC yet. Form an LLC now so it can season while your credit is being repaired."
    ]);
  });

  test("fixtures are clock-stable: no `opened` value sits near the 24-month line", () => {
    // The guard on this whole file. Runs the same fixture twice with the seasoned
    // dates and asserts the seasoning-derived figures are what a 1990 open date
    // must always produce, so a future test run cannot drift.
    const uw = computeUnderwrite(FIXTURE_MAXED, 30);
    assert.equal(uw.personal.highest_revolving_limit, 20000,
      "a 1990 open date must read as seasoned in any year this test is ever run");

    const src = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
    const dates = [...src.matchAll(/opened:\s*"(\d{4})-(\d{2})"/g)].map((m) => Number(m[1]));
    for (const year of dates) {
      assert.ok(year <= 2000,
        `fixture open year ${year} is not clock-stable — use a pre-2000 date or null`);
    }
  });
});

/* ─────────────── the two smaller exports ─────────────── */

describe("normalizeBureau and getNumberField", () => {
  test("a missing bureau is unavailable with all-null measures and empty arrays", () => {
    for (const input of [undefined, null, "nope", 42]) {
      const b = normalizeBureau(input);
      assert.equal(b.available, false, JSON.stringify(input));
      assert.deepEqual(
        [b.score, b.utilization_pct, b.inquiries, b.negatives, b.late_payment_events],
        [null, null, null, null, null]);
      assert.deepEqual([b.names, b.addresses, b.employers, b.tradelines], [[], [], [], []]);
    }
  });

  test("available:true means an object was supplied, NOT that anything is in it", () => {
    // The reason ./adapter.mjs withholds a bureau that has no score rather than
    // passing an empty object: this would call it available.
    const b = normalizeBureau({});
    assert.equal(b.available, true);
    assert.equal(b.score, null);
  });

  test("getNumberField reads plain values and the [value] shape, and refuses the rest", () => {
    assert.equal(getNumberField({ business_age_months: 18 }, "business_age_months"), 18);
    assert.equal(getNumberField({ business_age_months: ["24"] }, "business_age_months"), 24);
    assert.equal(getNumberField({ business_age_months: "abc" }, "business_age_months"), null);
    assert.equal(getNumberField({}, "business_age_months"), null);
    assert.equal(getNumberField(null, "business_age_months"), null);
  });
});

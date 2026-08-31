// THE PRICE IN THE CATALOGUE AND THE FEE IN THE CONTRACT MUST SAY THE SAME
// THING. This file fails when they stop.
//
// WHAT WENT WRONG, so the shape of these assertions makes sense.
// src/config/offers.mjs priced REPAIR_DFY at 100000 integer cents — $1,000,
// charged once. The contract wording seeded by
// db/migrations/169_contract_template_placeholders.sql read "You pay
// {{field.monthly_fee}} per month while services are active", and
// defaultContractValues() filled that blank with the SAME $1,000, alongside a
// 180-day term. Every repair client therefore signed for $1,000 a month for six
// months — $6,000 — against a $1,000 product. Nothing failed. Both halves were
// individually correct; only their meeting was wrong, and nothing was looking
// at the meeting. This file is what looks at it.
// db/migrations/273_repair_fee_charged_once.sql is the fix.
//
// FOUR CLASSES OF DRIFT ARE CAUGHT HERE:
//
//   1. The number disagrees. The blank a contract states a fee in no longer
//      carries the catalogue's priceCents.
//   2. The words disagree. The copy describes a repeating charge for a product
//      that is billed once.
//   3. The rename went half way. offers.mjs fills a blank the template does not
//      declare, or the template declares a required blank offers.mjs does not
//      fill — either way a client reads a fee line with nothing in it.
//   4. A new fee blank appears and nobody says what it is. Every money-shaped
//      blank has to be registered below as either a catalogue price or a
//      deliberate non-price.
//
// WHY THIS READS db/*.sql RATHER THAN A DATABASE. The .pg.test.mjs files skip
// without DATABASE_URL, and a guard that skips is not a guard — the same
// reasoning src/subscriptions/partner-subscriptions.test.mjs states. The SQL
// under db/ is what every environment is built from, so it is the honest
// source. It is read in db/migrate.mjs's own order (schema, migrations, seed;
// filenames sorted), and a later file superseding an earlier one is exactly
// what a later definition here does.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OFFERS,
  formatCents,
  resolveContractTemplateKey,
  defaultContractValues
} from "../config/offers.mjs";
import { tagsIn, missingRequired, normaliseManualFields } from "./render.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/* ───────────────────────────────────────────────────────────────────────────
   The registry. Every blank in a contract that holds money is named here, on
   purpose, so that adding one is a decision somebody wrote down.

   FEE_BLANKS — this blank must equal that offer's priceCents, formatted.
   NON_PRICE_BLANKS — money-shaped, but not a catalogue price, with the reason.
   ─────────────────────────────────────────────────────────────────────────── */

const FEE_BLANKS = Object.freeze({
  "SOFT-PULL-CONSENT": [],            // an authorization; it states no fee at all
  "REPAIR-TRIAL-AGREEMENT": [{ field: "trial_fee", offer: "REPAIR_TRIAL" }],
  "CREDIT-REPAIR-AGREEMENT": [{ field: "one_time_fee", offer: "REPAIR_DFY" }],
  "FUNDING-AGREEMENT": [{ field: "deposit", offer: "FUNDING_DFY" }],
  "REPAIR-AND-FUNDING-AGREEMENT": [
    { field: "deposit", offer: "FUNDING_DFY" },
    { field: "repair_fee", offer: "REPAIR_DFY" }
  ],
  "FUNDING-MASTERY-AGREEMENT": [{ field: "program_fee", offer: "FUNDING_MASTERY" }]
});

const NON_PRICE_BLANKS = Object.freeze({
  // A percentage of an amount nobody knows at signing, and the date it falls
  // due. Neither is a number this catalogue holds, so neither can be checked
  // against one.
  "FUNDING-AGREEMENT": ["success_fee", "fee_due"],
  "REPAIR-AND-FUNDING-AGREEMENT": ["success_fee", "fee_due"]
});

/* A blank whose name or label reads like money. Anything matching has to be in
   one of the two lists above. */
const MONEY_SHAPED = /(fee|price|cost|deposit|amount|payment|charge)/i;

/* Words that describe a charge that repeats. None of them may appear anywhere
   in a contract reachable from this catalogue, because every offer in it is a
   single charge — see the test that holds that premise. Negations are not
   special-cased on purpose: the copy is written to avoid the vocabulary
   altogether, which is a rule with no edge to argue about. */
const RECURRING =
  /(per\s+month|monthly|each\s+month|every\s+month|a\s+month|per\s+week|weekly|per\s+year|yearly|annually|annual|recurring|subscription|per\s+quarter|quarterly)/i;

/* ───────────────────────────────────────────────────────────────────────────
   Reading the contract copy out of db/.
   ─────────────────────────────────────────────────────────────────────────── */

/** Full-line `--` comments only. A trailing one would need a string-aware
 *  scanner, and db/ has none inside these statements. */
const stripComments = (sql) =>
  sql.split("\n").filter((line) => !/^\s*--/.test(line)).join("\n");

/** Decode what Postgres' E'…' escape-string syntax means, for the parts db/
 *  actually uses: \n, \t, \\ and a doubled quote. */
function decodeEscapeLiteral(raw) {
  return raw
    .replace(/''/g, "'")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");
}

/** Every E'…' literal in a statement, concatenated. In db/ these are only ever
 *  used for a template body, so the concatenation IS the body. */
function bodyFrom(block) {
  const parts = [];
  for (let i = 0; i < block.length; i++) {
    const isStart =
      (block[i] === "E" || block[i] === "e") &&
      block[i + 1] === "'" &&
      !/[\w.]/.test(block[i - 1] || "");
    if (!isStart) continue;
    let j = i + 2;
    let buf = "";
    while (j < block.length) {
      const c = block[j];
      if (c === "\\") { buf += c + (block[j + 1] ?? ""); j += 2; continue; }
      if (c === "'") {
        if (block[j + 1] === "'") { buf += "''"; j += 2; continue; }
        break;
      }
      buf += c;
      j++;
    }
    parts.push(decodeEscapeLiteral(buf));
    i = j;
  }
  return parts.length ? parts.join("") : null;
}

/** The manual_fields array — the only '[ … ]'::jsonb literal in a statement. */
function fieldsFrom(block) {
  const m = [...block.matchAll(/'(\[[\s\S]*?\])'\s*::\s*jsonb/g)].pop();
  if (!m) return null;
  return normaliseManualFields(JSON.parse(m[1]));
}

/** Which template a statement is about. */
function keyFrom(block) {
  const insert = block.match(/VALUES\s*\(\s*v_org\s*,\s*'([A-Z0-9][A-Z0-9-]*)'/);
  if (insert) return insert[1];
  const update = block.match(/\bWHERE\b[\s\S]*?\btemplate_key\s*=\s*'([A-Z0-9][A-Z0-9-]*)'/);
  return update ? update[1] : null;
}

/**
 * Every contract template db/ defines, as the last word on it wins.
 * Map<template_key, { body, fields, sources: string[] }>.
 */
function readTemplatesFromDb() {
  const out = new Map();
  for (const dir of ["schema", "migrations", "seed"]) {
    const full = path.join(ROOT, "db", dir);
    if (!fs.existsSync(full)) continue;
    for (const name of fs.readdirSync(full).filter((f) => f.endsWith(".sql")).sort()) {
      const sql = fs.readFileSync(path.join(full, name), "utf8");
      if (!/contract_templates/.test(sql)) continue;
      const blocks = stripComments(sql)
        .split(/(?=INSERT INTO contract_templates|UPDATE contract_templates)/)
        .filter((b) => /^(INSERT INTO|UPDATE) contract_templates/.test(b.trim()));
      for (const block of blocks) {
        const key = keyFrom(block);
        if (!key) continue;
        const prev = out.get(key) || { body: null, fields: null, sources: [] };
        const body = bodyFrom(block);
        const fields = fieldsFrom(block);
        out.set(key, {
          body: body ?? prev.body,
          fields: fields ?? prev.fields,
          sources: [...prev.sources, `${dir}/${name}`]
        });
      }
    }
  }
  return out;
}

const TEMPLATES = readTemplatesFromDb();

/* Every route from an offer to a piece of contract copy. The last entry is the
   combined tier, which resolves by tier rather than by offer key. */
const PATHS = Object.freeze([
  { label: "SOFT_PULL", offerKey: "SOFT_PULL", tier: null },
  { label: "FUNDING_DFY", offerKey: "FUNDING_DFY", tier: null },
  { label: "REPAIR_DFY", offerKey: "REPAIR_DFY", tier: null },
  { label: "REPAIR_TRIAL", offerKey: "REPAIR_TRIAL", tier: null },
  { label: "FUNDING_MASTERY", offerKey: "FUNDING_MASTERY", tier: null },
  { label: "FUNDING_PLUS_REPAIR tier", offerKey: "FUNDING_DFY", tier: "FUNDING_PLUS_REPAIR" }
]);

const pathsWithTemplates = PATHS.map((p) => ({
  ...p,
  templateKey: resolveContractTemplateKey({ offerKey: p.offerKey, tier: p.tier }),
  values: defaultContractValues({ offerKey: p.offerKey, tier: p.tier })
})).filter((p) => p.templateKey);

describe("the copy this guard reads is really there", () => {
  // Without this, every assertion below could pass over an empty map — a guard
  // that silently stopped finding anything is worse than no guard.
  test("every contract the catalogue points at was found in db/", () => {
    assert.ok(pathsWithTemplates.length >= 6, "the offer catalogue stopped naming contracts");
    for (const p of pathsWithTemplates) {
      const tpl = TEMPLATES.get(p.templateKey);
      assert.ok(tpl, `${p.label}: no db/ file defines ${p.templateKey}`);
      assert.ok(tpl.body && tpl.body.length > 100, `${p.templateKey}: body did not parse`);
      assert.ok(Array.isArray(tpl.fields) && tpl.fields.length, `${p.templateKey}: blanks did not parse`);
    }
  });

  test("169 is superseded, not edited — editing an applied migration is a no-op", () => {
    // db/migrate.mjs keys schema_migrations by '<dir>/<file>'. A database that
    // already ran 169 never reads it again, so "fixing" it in place changes
    // nothing anywhere and looks like a fix. The defective wording must still
    // be sitting in 169, with a later file correcting it.
    const original = fs.readFileSync(
      path.join(ROOT, "db", "migrations", "169_contract_template_placeholders.sql"), "utf8");
    assert.match(original, /\{\{field\.monthly_fee\}\} per month/,
      "169 was edited in place. Restore it and supersede it with a new numbered migration.");
    const tpl = TEMPLATES.get("CREDIT-REPAIR-AGREEMENT");
    assert.ok(tpl.sources.length >= 2,
      "nothing supersedes 169's repair wording — the monthly fee defect is back");
  });
});

describe("the fee a contract states is the price the catalogue charges", () => {
  for (const p of pathsWithTemplates) {
    const expected = FEE_BLANKS[p.templateKey];

    test(`${p.label}: ${p.templateKey} is registered`, () => {
      assert.ok(expected, `${p.templateKey} has no entry in FEE_BLANKS — add one`);
    });

    for (const { field, offer } of expected || []) {
      test(`${p.label}: ${field} is ${offer}'s price, to the cent`, () => {
        const price = formatCents(OFFERS[offer].priceCents);
        assert.ok(price, `${offer} has no usable priceCents`);
        assert.equal(
          p.values[field], price,
          `${p.templateKey} states its fee in {{field.${field}}}, and offers.mjs fills it ` +
          `with ${JSON.stringify(p.values[field])} while ${offer} costs ${price}. ` +
          `The client would sign for the wrong number.`
        );
      });
    }
  }

  test("a new money blank cannot appear unregistered", () => {
    for (const p of pathsWithTemplates) {
      const registered = new Set([
        ...(FEE_BLANKS[p.templateKey] || []).map((f) => f.field),
        ...(NON_PRICE_BLANKS[p.templateKey] || [])
      ]);
      for (const f of TEMPLATES.get(p.templateKey).fields) {
        if (!MONEY_SHAPED.test(f.key) && !MONEY_SHAPED.test(f.label)) continue;
        assert.ok(
          registered.has(f.key),
          `${p.templateKey} has a money blank "${f.key}" (${f.label}) that this guard ` +
          `does not know about. Add it to FEE_BLANKS with the offer whose price it holds, ` +
          `or to NON_PRICE_BLANKS with the reason it is not one.`
        );
      }
    }
  });
});

describe("no contract describes a charge that repeats", () => {
  test("the premise: every offer in the catalogue is a single charge", () => {
    // PartnerAddOn carries a `billing` field ("monthly" / "per_unit"); Offer has
    // no way to say it, and none of the add-ons has a contract template. If a
    // genuinely recurring CLIENT offer is ever added, this file has to be
    // reopened deliberately rather than quietly relaxed.
    for (const [key, offer] of Object.entries(OFFERS)) {
      assert.equal("billing" in offer, false,
        `${key} gained a billing shape — the fee-wording rule below assumes one charge`);
    }
  });

  for (const p of pathsWithTemplates) {
    test(`${p.templateKey} says nothing about a repeating charge`, () => {
      const tpl = TEMPLATES.get(p.templateKey);
      const hit = tpl.body.match(RECURRING);
      assert.equal(
        hit, null,
        `${p.templateKey} contains ${JSON.stringify(hit && hit[0])} — this product is ` +
        `charged once. Defined in: ${tpl.sources.join(" → ")}`
      );
    });

    test(`${p.templateKey}'s blanks are not named or explained as repeating`, () => {
      for (const f of TEMPLATES.get(p.templateKey).fields) {
        for (const [what, text] of [["key", f.key], ["label", f.label], ["help", f.help || ""]]) {
          const hit = String(text).match(RECURRING);
          assert.equal(
            hit, null,
            `${p.templateKey}: blank "${f.key}" has ${JSON.stringify(hit && hit[0])} in its ` +
            `${what}. That is how the $1,000-a-month defect was written in the first place.`
          );
        }
      }
    });
  }
});

describe("a rename cannot go half way", () => {
  for (const p of pathsWithTemplates) {
    test(`${p.templateKey}: every blank in the words is a blank on the form`, () => {
      const declared = new Set(TEMPLATES.get(p.templateKey).fields.map((f) => f.key));
      for (const tag of tagsIn(TEMPLATES.get(p.templateKey).body)) {
        if (!tag.startsWith("field.")) continue;
        const key = tag.slice("field.".length);
        assert.ok(
          declared.has(key),
          `${p.templateKey} prints {{${tag}}} but declares no such blank, so nobody can ` +
          `fill it and it renders empty.`
        );
      }
    });

    test(`${p.templateKey}: offers.mjs fills every blank the contract requires`, () => {
      // This is the assertion that catches the other half of a rename: the
      // template says one_time_fee, offers.mjs still says monthly_fee, and the
      // fee line goes out blank.
      const missing = missingRequired(TEMPLATES.get(p.templateKey).fields, p.values);
      assert.deepEqual(
        missing, [],
        `${p.label}: defaultContractValues() leaves ${JSON.stringify(missing)} empty on ` +
        `${p.templateKey}. A required blank with nothing in it is a fee line with nothing in it.`
      );
    });
  }
});

describe("the live defect, named", () => {
  test("credit repair is one payment of the catalogue price", () => {
    const tpl = TEMPLATES.get("CREDIT-REPAIR-AGREEMENT");
    assert.match(tpl.body, /\{\{field\.one_time_fee\}\}/,
      "the repair fee blank is no longer one_time_fee");
    assert.doesNotMatch(tpl.body, /monthly_fee/,
      "the repair contract still names a monthly fee blank");
    assert.match(tpl.body, /one time/i,
      "the repair contract no longer says the fee is charged one time");
    assert.equal(
      defaultContractValues({ offerKey: "REPAIR_DFY" }).one_time_fee,
      formatCents(OFFERS.REPAIR_DFY.priceCents)
    );
    assert.equal(formatCents(OFFERS.REPAIR_DFY.priceCents), "$1,000");
  });

  test("the repair trial was checked too, and is a single payment", () => {
    // REPAIR_TRIAL fills `trial_fee` — verified, not assumed. Its sentence
    // ("You pay {{field.trial_fee}} for the first done-for-you dispute round")
    // states one payment for one round, and the blank carries the $200 price.
    const tpl = TEMPLATES.get("REPAIR-TRIAL-AGREEMENT");
    assert.match(tpl.body, /You pay \{\{field\.trial_fee\}\} for the first/);
    assert.equal(
      defaultContractValues({ offerKey: "REPAIR_TRIAL" }).trial_fee,
      formatCents(OFFERS.REPAIR_TRIAL.priceCents)
    );
    assert.equal(formatCents(OFFERS.REPAIR_TRIAL.priceCents), "$200");
  });

  test("the combined agreement states the repair fee the same way", () => {
    const tpl = TEMPLATES.get("REPAIR-AND-FUNDING-AGREEMENT");
    assert.match(tpl.body, /\{\{field\.repair_fee\}\}[^.]*single payment/,
      "the combined agreement no longer says the repair fee is a single payment");
    assert.equal(
      defaultContractValues({ tier: "FUNDING_PLUS_REPAIR" }).repair_fee,
      formatCents(OFFERS.REPAIR_DFY.priceCents)
    );
  });
});

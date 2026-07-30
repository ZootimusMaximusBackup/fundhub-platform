// Regression test for the decoy-directory bug.
//
// db/…/collect.mjs searches three candidate locations for the sibling
// fundhub-docs repo. It used to accept the first candidate that EXISTED, and this
// repo contains its own fundhub-docs/sources/ holding only
// AIRTABLE-BASE-EXTRACT.md. So the in-tree directory won the search, the resolver
// returned a path that could not satisfy a single source doc, and readSources()
// failed with "source doc missing" — burying the real cause (the sibling repo is
// not cloned) and taking eight tests down with it. Those tests each had a correct
// skip guard; the resolver returning successfully is what defeated them.
//
// A candidate now only counts if the docs are actually in it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SOURCES, DOCS_CANDIDATES, hasSources, missingSources, findDocsDir, resolveDocsDir
} from "./collect.mjs";

const NAMES = SOURCES.map((s) => s.file);

function tmpdir(files = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-docs-"));
  for (const f of files) fs.writeFileSync(path.join(dir, f), "# stub\n");
  return dir;
}

describe("resolveDocsDir / findDocsDir", () => {

  test("a directory holding every source doc is usable", () => {
    const dir = tmpdir(NAMES);
    assert.equal(hasSources(dir), true);
    assert.deepEqual(missingSources(dir), []);
    assert.equal(findDocsDir(dir), dir);
    assert.equal(resolveDocsDir(dir), dir);
  });

  test("THE BUG: a directory that exists but holds none of them is NOT usable", () => {
    const decoy = tmpdir(["AIRTABLE-BASE-EXTRACT.md"]);
    assert.equal(hasSources(decoy), false);
    assert.deepEqual(missingSources(decoy).sort(), [...NAMES].sort());
    assert.equal(findDocsDir(decoy), null,
      "existence alone must not qualify a candidate — this is the decoy bug");
  });

  test("a partially-populated directory is not usable either", () => {
    const partial = tmpdir([NAMES[0]]);
    assert.equal(hasSources(partial), false);
    assert.deepEqual(missingSources(partial), NAMES.slice(1));
    assert.equal(findDocsDir(partial), null);
  });

  test("findDocsDir returns null instead of throwing, so a caller can branch", () => {
    assert.equal(findDocsDir(path.join(os.tmpdir(), "definitely-not-here-" + Date.now())), null);
    assert.doesNotThrow(() => findDocsDir());
  });

  test("resolveDocsDir names what is missing, not just that something is", () => {
    const decoy = tmpdir(["AIRTABLE-BASE-EXTRACT.md"]);
    assert.throws(() => resolveDocsDir(decoy), (e) => {
      // The diagnostic the decoy bug destroyed: which files, from which dir.
      assert.match(e.message, /is missing/);
      for (const n of NAMES) assert.match(e.message, new RegExp(n.replace(/\./g, "\\.")));
      return true;
    });
  });

  test("an absent explicit dir is reported differently from an incomplete one", () => {
    const gone = path.join(os.tmpdir(), "fh-absent-" + Date.now());
    assert.throws(() => resolveDocsDir(gone), /docs dir not found/);

    const decoy = tmpdir(["AIRTABLE-BASE-EXTRACT.md"]);
    assert.throws(() => resolveDocsDir(decoy), /is missing/);
  });

  test("with no candidate usable, the error distinguishes absent from incomplete", () => {
    // This repo's in-tree fundhub-docs/sources IS the incomplete case, so the
    // real message is asserted here rather than with a fixture.
    if (findDocsDir()) {
      // fundhub-docs is checked out in this environment — nothing to assert.
      return;
    }
    assert.throws(() => resolveDocsDir(), (e) => {
      assert.match(e.message, /Could not find a fundhub-docs\/sources/);
      assert.match(e.message, /Clone fundhub-docs next to this repo/);
      // At least one candidate should be described, and the in-tree one is
      // present-but-incomplete rather than absent.
      const inTree = DOCS_CANDIDATES[DOCS_CANDIDATES.length - 1];
      if (fs.existsSync(inTree)) {
        assert.match(e.message, /present but missing/);
      }
      return true;
    });
  });

  test("an explicit override still wins over the candidate list", () => {
    const dir = tmpdir(NAMES);
    assert.equal(findDocsDir(dir), dir);
    // And FUNDHUB_DOCS is honoured when no argument is passed.
    const prev = process.env.FUNDHUB_DOCS;
    try {
      process.env.FUNDHUB_DOCS = dir;
      assert.equal(findDocsDir(), dir);
    } finally {
      if (prev === undefined) delete process.env.FUNDHUB_DOCS;
      else process.env.FUNDHUB_DOCS = prev;
    }
  });

  test("an explicit override that is incomplete does NOT silently fall back", () => {
    // Falling through to a candidate would hide the operator's mistake.
    const decoy = tmpdir(["AIRTABLE-BASE-EXTRACT.md"]);
    const prev = process.env.FUNDHUB_DOCS;
    try {
      process.env.FUNDHUB_DOCS = decoy;
      assert.equal(findDocsDir(), null);
    } finally {
      if (prev === undefined) delete process.env.FUNDHUB_DOCS;
      else process.env.FUNDHUB_DOCS = prev;
    }
  });
});

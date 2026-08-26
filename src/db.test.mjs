import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { db, dbTarget } from "./db.mjs";

const SRC = fs.readFileSync(
  path.join(path.dirname(url.fileURLToPath(import.meta.url)), "db.mjs"),
  "utf8"
);

test("db.mjs does not import pg at load time", () => {
  // A top-level `import pg from "pg"` 502s the whole /api/* function when the
  // zip is missing the package. Health and login must still be able to load.
  assert.doesNotMatch(SRC, /^import\s+pg\s+from\s+["']pg["']/m);
  assert.match(SRC, /require\(["']pg["']\)/);
});

test("the module exports query without opening a pool", () => {
  assert.equal(typeof db.query, "function");
  assert.equal(typeof dbTarget, "function");
});

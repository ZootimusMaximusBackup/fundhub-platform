import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { db, dbTarget } from "./db.mjs";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const DB_SRC = fs.readFileSync(path.join(ROOT, "src/db.mjs"), "utf8");
const API_SRC = fs.readFileSync(path.join(ROOT, "netlify/functions/api.mjs"), "utf8");

test("the live function traces pg so the zip keeps the driver", () => {
  assert.match(DB_SRC, /^import pg from ["']pg["']/m);
  assert.match(API_SRC, /^import ["']pg["']/m);
});

test("the module exports query without opening a pool", () => {
  assert.equal(typeof db.query, "function");
  assert.equal(typeof dbTarget, "function");
});

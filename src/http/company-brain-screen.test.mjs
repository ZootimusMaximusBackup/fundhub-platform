import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const HTML = fs.readFileSync(path.join(APP, "company-brain.html"), "utf8");
const SHELL = fs.readFileSync(path.join(APP, "shell.js"), "utf8");

test("company-brain.html loads shell and calls the search API", () => {
  assert.match(HTML, /<script(?:\s+defer)?\s+src="shell\.js">/);
  assert.match(HTML, /\/api\/read\/company-brain/);
  assert.match(HTML, /Ask the company docs/);
  assert.match(HTML, /classification review queue/i);
});

test("company-brain.html is in shell ALL and linked from documents sidebar", () => {
  assert.match(SHELL, /"company-brain\.html"/);
  const docs = fs.readFileSync(path.join(APP, "documents.html"), "utf8");
  assert.match(docs, /href="company-brain\.html"/);
});

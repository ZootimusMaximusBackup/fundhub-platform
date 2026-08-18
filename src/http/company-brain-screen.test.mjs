import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const HTML = fs.readFileSync(path.join(APP, "company-brain.html"), "utf8");
const SHELL = fs.readFileSync(path.join(APP, "shell.js"), "utf8");

/* The screen became a chat on 2026-08-17, so the two copy checks below moved
   with it: the old "Ask the company docs" heading and "classification review
   queue" card are gone by intent. What the test is FOR has not changed — that
   this screen loads the shell, and that every endpoint it depends on is really
   wired up here rather than left behind in a redesign. That is now checked for
   all four endpoints, not one. */
test("company-brain.html loads shell and calls the search API", () => {
  assert.match(HTML, /<script(?:\s+defer)?\s+src="shell\.js">/);
  assert.match(HTML, /\/api\/read\/company-brain/);
  assert.match(HTML, /\/api\/company-brain\/upload/);
  assert.match(HTML, /\/api\/company-brain\/threads/);
  assert.match(HTML, /\/api\/company-brain\/reviews/);
});

test("company-brain.html is a chat: composer, message area, saved conversations", () => {
  assert.match(HTML, /<textarea/, "the chat needs a composer to type into");
  assert.match(HTML, /data-brain-conversation/, "the message area needs its test hook");
  assert.match(HTML, /data-brain-thread-list/, "past conversations need their test hook");
});

test("company-brain.html tells the reader an upload waits for owner approval", () => {
  // The gate is enforced in retrieve.mjs; this asserts the screen SAYS so, so a
  // person is never left wondering why a file they just added answers nothing.
  assert.match(HTML, /approve/i);
  assert.match(HTML, /before it can be used in answers/i);
});

test("company-brain.html is in shell ALL and linked from documents sidebar", () => {
  assert.match(SHELL, /"company-brain\.html"/);
  const docs = fs.readFileSync(path.join(APP, "documents.html"), "utf8");
  assert.match(docs, /href="company-brain\.html"/);
});

/* T10 unit D — Social Studio: the three things a partner with no connected
 * social account must still be able to do.
 *
 * WHAT A PARTNER SAW. The waiting list was read-only. Every post the AI writer
 * put there just sat, with no way to give it a send time and no way to throw it
 * away, and the screen's own empty state said "Nothing can be written or queued
 * until there is one" and pointed at a Connect button a partner is not allowed
 * to press. So a partner with no connected account had a list of posts and no
 * button that did anything to any of them.
 *
 * WHAT WAS ACTUALLY THERE. POST /api/social/posts already did both jobs, was
 * already routed, and already worked with no account picked. Nothing in the
 * browser had ever called it. The fix is entirely in the page: it now calls that
 * endpoint, from a Queue-it and a Throw-it-away control on every waiting row.
 *
 * WHY THIS TEST READS THE FILE AS TEXT. The change is client-side. The 12 tests
 * in social-posts-write.pg.test.mjs pin the SERVER's promises, and the server was
 * not touched by this unit — they pass on the old code and prove nothing about
 * this fix. These assertions are the ones that fail on the old file. They were
 * run against `git show HEAD:public/app/social-studio.html` to prove it.
 *
 * It does not open a browser. What must never come back is a specific SHAPE of
 * source: a waiting list with no write behind it, and a screen that answers the
 * same question two different ways in two different cards.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
/* FH_SOCIAL_STUDIO_HTML exists so this file can be pointed at an old copy of the
   screen to prove these assertions really do fail on it. Nothing in the suite
   sets it; unset, it reads the real screen. */
const FILE = process.env.FH_SOCIAL_STUDIO_HTML || path.join(APP, "social-studio.html");
const HTML = fs.readFileSync(FILE, "utf8");

/* Comments on this screen quote the old wording and explain the bug at length,
   and a comment is not code. Stripped before any shape check, with line counts
   kept so a failure still points at the right place. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^\s*\/\/.*$/gm, (m) => m.replace(/[^\n]/g, " "));
}
const CODE = stripComments(HTML);

/* One named function's body, brace-matched. Used so "queueOne does not send a
   channel" cannot be satisfied by some unrelated part of a 2,300-line file. */
function fnBody(name) {
  const start = CODE.indexOf("function " + name + "(");
  assert.ok(start !== -1, `function ${name}() is gone from social-studio.html`);
  const open = CODE.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < CODE.length; i++) {
    if (CODE[i] === "{") depth++;
    else if (CODE[i] === "}") { depth--; if (depth === 0) return CODE.slice(open + 1, i); }
  }
  assert.fail(`function ${name}() never closes — the file is truncated`);
}

test("the screen actually calls the write that needs no connected account", () => {
  // The whole point of the unit. On the old file this string does not appear at
  // all: /api/social/posts was routed, handled a partner, and was dead code from
  // the browser's side.
  assert.match(CODE, /fetch\('\/api\/social\/posts'/,
    "nothing on this screen posts to /api/social/posts — the waiting list is read-only again");
  assert.match(CODE, /method:\s*'POST'/);
});

test("Queue it does not hard-stop on a missing account", () => {
  const body = fnBody("queueOne");
  assert.match(body, /postWrite\(\{[^}]*id:\s*id/,
    "Queue it no longer sends the post id to the write");
  // A channel id in this body would put the request down the branch that needs a
  // connected account, which is exactly the stop this fix removes.
  assert.doesNotMatch(body, /channel_id/,
    "Queue it sends a channel id, so it refuses again when no account is connected");
  assert.doesNotMatch(body, /Pick an account/,
    "Queue it still tells the partner to pick an account first");
});

test("every waiting post can be thrown away", () => {
  assert.match(CODE, /data-qdrop/, "there is no Throw it away control on a waiting row");
  assert.match(CODE, /Throw it away/, "the Throw it away button lost its label");
  const body = fnBody("discardOne");
  assert.match(body, /action:\s*'discard'/,
    "Throw it away does not send the discard action, so nothing is thrown away");
  assert.match(body, /window\.confirm\(/,
    "Throw it away no longer asks first — CLAUDE.md §5, a throwing-away action confirms");
});

test("both controls are wired to a real row, not just drawn", () => {
  assert.match(CODE, /\[data-qqueue\][\s\S]{0,200}queueOne\(/,
    "the Queue it button is drawn but nothing happens when it is pressed");
  assert.match(CODE, /\[data-qdrop\][\s\S]{0,200}discardOne\(/,
    "the Throw it away button is drawn but nothing happens when it is pressed");
});

test("the screen reports the send time the SERVER saved, not the one in the box", () => {
  /* api/social/posts.mjs saves the time as
       scheduled_for = COALESCE($2::timestamptz, scheduled_for)
     with $2 = body.scheduled_for || row.scheduled_for. An emptied time box
     therefore does NOT clear a saved time. A message built from the box says the
     post will not go out while it still will — a plain false statement to the
     partner about whether something gets published. */
  const body = fnBody("queueOne");
  assert.match(body, /res\.item/,
    "the confirmation is not built from the server's answer, so it can state the opposite of what was saved");
  assert.match(body, /item\.scheduled_for/,
    "the confirmation does not read back the saved send time");
  assert.doesNotMatch(body, /fmt\(when\)/,
    "the confirmation prints the time from the box rather than the time that was saved");
  assert.doesNotMatch(body, /waiting, but it has no send time/,
    "the old sentence is back: it claims a post will not go out when the saved time means it will");
});

test("the screen says plainly that emptying the box does not unschedule", () => {
  // The box invites a partner to clear it. The server cannot clear it. Saying so
  // in the standing caption beats letting them find out by watching a post send.
  assert.match(HTML, /Emptying the time box and pressing "Queue it" does <b>not<\/b> take away a time that is already saved/,
    "the waiting list never tells the partner that a saved send time cannot be cleared here");
});

test("the empty state and the writer give the same answer about writing a post", () => {
  /* With no connected account there is exactly one way to get a post into the
     list: the AI writer. A hand-typed post is only saved by /api/social/schedule,
     which refuses without an account. Both cards must say that. */
  const empty = /No social accounts are connected yet[\s\S]{0,700}?<\/div>/.exec(HTML);
  assert.ok(empty, "the no-accounts empty state is gone from Connected accounts");
  const text = empty[0];

  assert.doesNotMatch(text, /Nothing can be written or queued until there is one/,
    "the empty state still says nothing can be queued — setting a time and throwing away both work");
  assert.doesNotMatch(text, /Posts can still be written/,
    "the empty state claims a post can be written with no account, and the writer on the same screen refuses");
  assert.match(text, /a post typed in the writer below cannot be saved yet/,
    "the empty state does not admit that a typed post cannot be saved with no account");
  assert.match(text, /Write 3 posts for me/,
    "the empty state does not name the one way to get a post into the list");

  // And the writer's own refusal points the same way.
  assert.match(CODE, /There is no account to post to, so a post typed here cannot be saved yet[\s\S]{0,200}Write 3 posts for me/,
    "the writer's refusal no longer names the same way forward the empty state names");
});

test("no internal error word is ever printed to a partner", () => {
  /* CLAUDE.md §10. A 404 from this endpoint is { ok:false, error:"not_found" }
     with no message, so 'Not saved: ' + res.error put the literal words
     "not_found" on a partner's screen. */
  /* An offender is a line that puts res.error where a person will read it.
     Reading res.error to CHOOSE a sentence is fine and is what the two
     translators on this screen do — those lines are named and excluded. */
  const offenders = CODE.split("\n")
    .map((line, i) => [i + 1, line])
    .filter(([, l]) => /res\.error/.test(l))
    .filter(([, l]) => /textContent|innerHTML|qActMsg\(|esc\(|ACTIONS_ERR\s*=/.test(l))
    .filter(([, l]) => !/plainWrite|plainReason/.test(l));
  assert.deepEqual(offenders.map(([n, l]) => `${n}: ${l.trim()}`), [],
    "these lines put the server's internal word straight on the screen");

  assert.match(CODE, /function plainWrite\(res\)/,
    "the plain-words translator is gone, so refusals reach the screen as internal words");
  assert.match(CODE, /case 'not_found':[\s\S]{0,160}That post is not in the list any more/,
    "a missing post no longer has a plain-English answer");
});

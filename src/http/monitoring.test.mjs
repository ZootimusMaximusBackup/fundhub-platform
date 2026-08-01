// The runbook, and the promise it makes about the monitored URL.
//
// THE FINDING (M19). There was no monitoring, no alerting and no runbook
// anywhere in this repo. No .github/ directory, no error-reporting or metrics
// dependency — package.json lists exactly two, pg and inngest — and DEPLOY.md
// had no rollback, incident or on-call section. The only observability surface
// was /api/health, which answered HTTP 200 in every state on purpose, so an
// uptime monitor pointed at it stayed green through a total database outage.
//
// TWO HALVES, AND BOTH ARE PINNED HERE.
//   The machine half is `?strict=1` on /api/health: the same body, but 503 when
//   the deployment is not trustworthy, so an off-the-shelf checker can finally
//   see an outage. It lives in src/http/health.mjs (wantsStrict, httpStatus).
//   The human half is docs/RUNBOOK.md. An alert with nowhere to point is not
//   monitoring — the page that fires at 2am has to arrive at a written
//   procedure, and until this round there was none.
//
// WHY A RUNBOOK IS TESTED AT ALL. Because it rots silently, and its reader is by
// definition someone in the middle of an outage who cannot check whether it is
// still true. Three kinds of rot are caught here: whole topics quietly dropping
// out, a health state gaining no first action, and — the one that matters most —
// the monitored URL going stale. The last case parses the URL OUT of the runbook
// and asks the real wantsStrict() whether that query string still turns strict
// mode on. Rename the flag and this test goes red, instead of the monitor
// silently going back to reading 200 forever.
//
// DELIBERATELY TOLERANT ABOUT SHAPE. It asserts topics and behaviour, never
// heading wording or section order: a runbook that has to be reformatted to keep
// a test green is a runbook nobody updates.
//
// NO DATABASE. Every case is a file read or a pure function, so this runs in the
// passes where DATABASE_URL is unset — which is where an operational check has
// to run, since that is the pass a broken deploy is most like.

import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const RUNBOOK = path.join(ROOT, "docs/RUNBOOK.md");

const runbook = () => fs.readFileSync(RUNBOOK, "utf8");

/* section(text, re) — the heading matching `re` plus everything under it, up to
   the next heading at the same level. Used so "the rollback part mentions the
   database" cannot be satisfied by the word turning up three sections away. */
function section(text, re) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^#{2,4}\s/.test(l) && re.test(l));
  if (start === -1) return "";
  const level = (lines[start].match(/^#+/) || ["##"])[0].length;
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    const h = lines[i].match(/^(#+)\s/);
    if (h && h[1].length <= level) break;
    out.push(lines[i]);
  }
  return out.join("\n");
}

test("runbook: docs/RUNBOOK.md exists", () => {
  assert.ok(fs.existsSync(RUNBOOK),
    "There is no runbook. When the site is down, whoever is looking at it has no " +
    "written procedure — no rollback steps, no first action per failure, and " +
    "nothing that says who answers.");
});

test("runbook: it covers monitoring, alerting, rollback, diagnosis and who is on call", () => {
  // The five topics the finding named as absent, matched by topic rather than by
  // heading text so the document can be organised however reads best.
  const text = runbook();
  const required = [
    ["a section on setting up a monitor", /^#{2,4}\s.*monitor/mi],
    ["a section on rolling a deploy back", /^#{2,4}\s.*(roll ?back|rolling back)/mi],
    ["alerting — what fires and where it goes", /\balert|\balarm|\bpage(?:d|s|r)?\b/i],
    ["on-call — who answers, even if the honest answer is nobody",
     /on[- ]call|\brota\b|rotation|who (?:gets|is) called/i],
    ["diagnosis steps for a live incident", /^#{2,4}\s.*(fix|what to do|down|not answering)/mi]
  ];
  const missing = required.filter(([, re]) => !re.test(text)).map(([name]) => name);
  assert.deepEqual(missing, [], `docs/RUNBOOK.md has no ${missing.join("; no ")}`);
});

test("runbook: it names the monitored URL and says a failing check is a 503", () => {
  const text = runbook();
  assert.match(text, /\/api\/health\?[a-z0-9=&_-]+/i,
    "The runbook must name the exact URL to monitor, query string included — the " +
    "plain /api/health answers 200 in every state, so a monitor pointed at it can " +
    "never go red.");
  assert.match(text, /\b503\b/,
    "The runbook must say what a failing check looks like, which is a 503.");
});

test("runbook: every state the check can report has a written first action", () => {
  // The alert body carries `state`. A state the runbook never names sends the
  // person holding the page into the source code at 2am.
  const text = runbook();
  const missing = ["up", "behind", "unconfigured", "unreachable", "error"]
    .filter((s) => !new RegExp(`\\b${s}\\b`).test(text));
  assert.deepEqual(missing, [],
    `docs/RUNBOOK.md never mentions health states: ${missing.join(", ")} — /api/health ` +
    `reports each of them and each has a different first action.`);
});

test("runbook: rollback names the real deploy target and warns the database does not follow", () => {
  // The trap that would bite hardest mid-incident: db/migrate.mjs is forward-only
  // and records every file in schema_migrations, so putting the code back does
  // NOT put the schema back. Whoever rolls back has to read that first.
  const roll = section(runbook(), /roll ?back|rolling back/i);
  assert.notEqual(roll, "", "no rollback section found in docs/RUNBOOK.md");
  assert.match(roll, /netlify/i,
    "The rollback section must name the real deploy target — this repo deploys to " +
    "Netlify (CLAUDE.md 11). A rollback section that does not say where to click " +
    "or what to run is a heading, not a procedure.");
  assert.match(roll, /database/i,
    "The rollback section must say what happens to the DATABASE. Rolling the code " +
    "back does not roll migrations back; db/migrate.mjs only moves forward.");
  assert.match(roll, /\bnot\b|\bno command\b|forward[- ]only/i,
    "The rollback section mentions the database but never says the rollback does " +
    "not undo it — that reads as a promise it cannot keep.");
});

test("runbook: it does not claim a monitor or an alert exists when none is configured", () => {
  // Honesty check, and the reason this one is worth a test: a runbook that
  // implies someone is watching is worse than no runbook, because it stops the
  // reader from asking. The repo has no .github/, no error reporting and no
  // metrics; the document has to say so out loud.
  const text = runbook();
  assert.match(text, /not (?:yet )?(?:done|set up|configured)|nothing (?:watches|checks|is watching)|no (?:monitoring|alerting|alarms)/i,
    "docs/RUNBOOK.md must state plainly that no monitor and no alerting are " +
    "configured yet. Nothing in this repo watches the site — that gap is only " +
    "manageable if it is written down.");
});

test("runbook: the strict flag it tells operators to use is the one the code honours", () => {
  // The drift guard. The URL is parsed out of the runbook and handed to the real
  // wantsStrict(), so renaming or dropping the flag fails here rather than at
  // 2am, when a stale URL means the monitor reads 200 through an outage.
  const text = runbook();
  const found = text.match(/\/api\/health\?([a-z0-9=&_-]+)/i);
  assert.ok(found, "no /api/health?... URL in docs/RUNBOOK.md to check");
  const query = Object.fromEntries(new URLSearchParams(found[1]));

  // Dynamic import: if the strict helpers are missing, this has to fail with a
  // sentence somebody can act on, not a module-link error across the whole file.
  return import("./health.mjs").then((health) => {
    assert.equal(typeof health.wantsStrict, "function",
      "src/http/health.mjs exports no wantsStrict() — the runbook is documenting a " +
      "flag that does not exist, and the documented URL answers 200 through an outage.");
    assert.equal(typeof health.httpStatus, "function",
      "src/http/health.mjs exports no httpStatus() — nothing can make the monitored " +
      "URL answer 503.");

    assert.equal(health.wantsStrict(query), true,
      `docs/RUNBOOK.md points the monitor at /api/health?${found[1]}, and wantsStrict() ` +
      `does not recognise that query string.`);
    assert.equal(health.httpStatus({ ok: false, state: "unreachable" }, query), 503,
      "the documented URL must answer 503 when the database is not answering");
    assert.equal(health.httpStatus({ ok: false, state: "behind" }, query), 503,
      "the documented URL must answer 503 when the database is behind on migrations");
    assert.equal(health.httpStatus({ ok: true, state: "up" }, query), 200,
      "the documented URL must answer 200 when the deployment is healthy");
    // And the default is untouched: public/app/shell.js:283 and public/crm.html:338
    // read any non-200 as "NO API — not deployed", which would relabel a database
    // outage as a missing deploy on every screen in the CRM.
    assert.equal(health.httpStatus({ ok: false, state: "unreachable" }, {}), 200,
      "the plain /api/health must still answer 200 — the CRM status chip reads it");
  });
});

test("deploy doc: DEPLOY.md points at the runbook and at the monitored URL", () => {
  // Where a deployer actually looks, and the file the finding named as having no
  // rollback, incident or on-call section. A link, not a copy: two procedures in
  // two files disagree within a month.
  const deploy = fs.readFileSync(path.join(ROOT, "DEPLOY.md"), "utf8");
  assert.match(deploy, /docs\/RUNBOOK\.md/,
    "DEPLOY.md has no link to docs/RUNBOOK.md — the person who just deployed is " +
    "exactly the person who needs the rollback steps.");
  assert.match(deploy, /\/api\/health\?strict=1/,
    "DEPLOY.md's verify step must name the monitorable URL. The plain /api/health " +
    "it documents today answers 200 even when the database is refusing connections.");
});

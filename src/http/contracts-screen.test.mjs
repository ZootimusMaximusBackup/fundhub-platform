// The two screens, read as source.
//
// Neither of these files is imported by anything, so nothing else in the suite
// would notice if one of them stopped calling an endpoint that exists, started
// calling one that does not, or — the failure this file mostly exists for — if
// the CLIENT SIGNING PAGE ever picked up the CRM's session machinery.
//
// public/contract.html is served to people who are not employees. If it ever
// loads shell.js, that script demands a session and redirects; if it ever loads
// data.js, every request it makes carries a staff bearer token out of
// localStorage. Either would be a serious defect and neither would be caught by
// any other test in this repository.
//
// It lives under src/ rather than public/ because package.json's test glob only
// walks src/ and scripts/ (CLAUDE.md §12).

import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROUTES } from "../../netlify/functions/api.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, "../../public");
const CRM = fs.readFileSync(path.join(PUBLIC, "app/contracts.html"), "utf8");
const CLIENT_RAW = fs.readFileSync(path.join(PUBLIC, "contract.html"), "utf8");
/* HTML comments stripped: the page's own header comment explains at length why
   it must never load shell.js or data.js, and a naive text search would find
   those names in the explanation and fail over the very rule it documents. What
   is under test is the page, not its prose. */
const CLIENT = CLIENT_RAW.replace(/<!--[\s\S]*?-->/g, "");
const SHELL = fs.readFileSync(path.join(PUBLIC, "app/shell.js"), "utf8");
const HEADERS = fs.readFileSync(path.join(PUBLIC, "_headers"), "utf8");

/* Every /api/... path a file asks for, deduplicated. */
function apiPaths(src) {
  const out = new Set();
  const re = /["'`](\/api\/[a-z0-9/_-]+)/gi;
  let m;
  while ((m = re.exec(src))) out.add(m[1]);
  return [...out];
}

describe("the Contracts screen (public/app/contracts.html)", () => {
  test("is a CRM screen: it loads the shell and the shared data layer", () => {
    assert.match(CRM, /<script src="shell\.js"><\/script>/);
    assert.match(CRM, /<script src="data\.js"><\/script>/);
  });

  test("the shell knows about it, so it is not a page only a typed URL can reach", () => {
    assert.match(SHELL, /"contracts\.html"/);
  });

  test("every endpoint it calls is really routed", () => {
    const called = apiPaths(CRM);
    assert.ok(called.length >= 2, `expected the screen to call the API, found ${called.length}`);
    for (const p of called) {
      const key = p.replace(/^\/api\//, "");
      assert.ok(Object.prototype.hasOwnProperty.call(ROUTES, key),
        `contracts.html calls ${p}, which is not in the ROUTES map — it would 404`);
    }
  });

  test("it reads through /api/read/contracts and writes through /api/contracts", () => {
    assert.match(CRM, /FHData\.read\("contracts"/);
    assert.match(CRM, /FHData\.write\("\/api\/contracts"/);
  });

  test("it can do the whole staff job: pick, fill, preview, send", () => {
    for (const action of ["preview", "create_draft", "send"]) {
      assert.ok(CRM.includes(`action: "${action}"`), `the screen never sends action "${action}"`);
    }
    assert.match(CRM, /id="selTpl"/, "no template picker");
    assert.match(CRM, /id="selClient"/, "no client picker");
    assert.match(CRM, /id="blanks"/, "nowhere to fill the blanks in");
    assert.match(CRM, /id="previewBody"/, "no preview of the finished document");
    assert.match(CRM, /id="linkOut"/, "no link for the staff member to pass on");
  });

  test("it can author wording without a developer — that is the whole point", () => {
    for (const action of ["create_template", "save_template", "archive_template"]) {
      assert.ok(CRM.includes(`action: "${action}"`) || CRM.includes(`"${action}"`),
        `the screen cannot ${action}`);
    }
    assert.match(CRM, /id="tBody"/, "no editor for the contract wording");
  });

  /* The one-screen-two-gates arrangement. The card is display:none in the
     markup and only revealed once the session says owner or admin, so a
     narrower role never sees a control whose endpoint would refuse them. */
  test("the wording card starts hidden and is revealed only for owner or admin", () => {
    assert.match(CRM, /id="tplCard"[^>]*style="display:none/,
      "the contract-wording card must be hidden in the markup, not only by script");
    assert.match(CRM, /isAdmin\s*=\s*norm\(r\)\s*===\s*"owner"\s*\|\|\s*norm\(r\)\s*===\s*"admin"/);
    assert.match(CRM, /\$\("tplCard"\)\.style\.display\s*=\s*isAdmin/);
  });

  test("void is offered only to an owner or admin, matching the endpoint's gate", () => {
    assert.match(CRM, /if \(isAdmin && c\.status !== "signed" && c\.status !== "void"\)/);
  });

  test("it shows the status of every contract, which the brief required", () => {
    for (const s of ["draft", "sent", "viewed", "signed", "void"]) {
      assert.ok(new RegExp(`\\b${s}\\b`).test(CRM), `the screen never mentions the "${s}" state`);
    }
  });

  test("it surfaces a tampered contract rather than hiding it", () => {
    assert.match(CRM, /__integrity/);
    assert.match(CRM, /It cannot be signed/);
  });

  test("it links back out to another screen", () => {
    const links = [...CRM.matchAll(/href="([a-z0-9-]+\.html)"/g)].map((m) => m[1]);
    assert.ok(links.some((h) => h !== "contracts.html"), "no way out of this screen");
  });
});

describe("the client signing page (public/contract.html)", () => {
  /* ── the important ones ─────────────────────────────────────────────────── */

  test("IT DOES NOT LOAD THE CRM SHELL — a client has no session and must not be asked for one", () => {
    assert.equal(/shell\.js/.test(CLIENT), false,
      "contract.html loads shell.js, which would bounce every client to the login page");
  });

  test("IT DOES NOT LOAD data.js — that attaches a staff token to every request", () => {
    assert.equal(/data\.js/.test(CLIENT), false);
    assert.equal(/FHData/.test(CLIENT), false);
  });

  test("it reads no credential out of storage at all", () => {
    assert.equal(/localStorage|sessionStorage|fh_token|authorization/i.test(CLIENT), false,
      "the signing page must hold no credential but the link it was opened with");
  });

  test("it references nothing under /app/", () => {
    assert.equal(/\/app\//.test(CLIENT), false);
  });

  test("it is not indexed — a contract link must not turn up in a search engine", () => {
    assert.match(CLIENT, /<meta name="robots" content="noindex">/);
  });

  /* ── it does the job ────────────────────────────────────────────────────── */

  test("it talks to exactly one endpoint, and that endpoint is routed", () => {
    const called = apiPaths(CLIENT);
    assert.deepEqual(called, ["/api/contracts/sign"]);
    assert.ok(Object.prototype.hasOwnProperty.call(ROUTES, "contracts/sign"));
  });

  test("it passes the link's own query string straight through, unmodified", () => {
    assert.match(CLIENT, /var qs = location\.search/);
    assert.match(CLIENT, /"\/api\/contracts\/sign" \+ qs/);
  });

  test("it captures a typed name, a ticked box, and posts them", () => {
    assert.match(CLIENT, /id="name"/);
    assert.match(CLIENT, /id="agree"[^>]*type="checkbox"/);
    assert.match(CLIENT, /method: "POST"/);
    assert.match(CLIENT, /signer_name: \$\("name"\)\.value/);
    assert.match(CLIENT, /agreed: \$\("agree"\)\.checked/);
  });

  test("the Sign button is disabled until both a name and the box are given", () => {
    assert.match(CLIENT, /<button id="go" disabled>/);
    assert.match(CLIENT, /\$\("go"\)\.disabled = !\(\$\("name"\)\.value\.trim\(\)\.length >= 2 && \$\("agree"\)\.checked\)/);
  });

  /* The page must never hold its own copy of the wording — that would be a
     second source of truth for the one string that has to be exact. The words,
     the title and even the sentence next to the checkbox all come from the
     server on load. */
  test("it holds no contract wording of its own", () => {
    assert.match(CLIENT, /\$\("body"\)\.textContent = c\.body/);
    assert.match(CLIENT, /\$\("statement"\)\.textContent = c\.signature_statement/);
  });

  test("it uses textContent for the document, so a contract cannot inject markup", () => {
    assert.equal(/\$\("body"\)\.innerHTML/.test(CLIENT), false,
      "the contract body must be rendered as text, never as HTML");
  });

  test("it refuses to offer signing on a document that does not verify", () => {
    assert.match(CLIENT, /if \(c\.verified === false\)/);
    assert.match(CLIENT, /\$\("signPanel"\)\.style\.display = "none"/);
    assert.match(CLIENT, /does not match the copy that was sent to you/);
  });

  test("it tells an expired link apart from a broken one", () => {
    assert.match(CLIENT, /status === 410/);
    assert.match(CLIENT, /This link has expired/);
    assert.match(CLIENT, /status === 404/);
  });

  test("it shows the signed copy back — both parties keep one", () => {
    assert.match(CLIENT, /c\.status === "signed"/);
    assert.match(CLIENT, /Signed by/);
    assert.match(CLIENT, /doneRecord/);
  });

  test("it says plainly what is recorded, before anybody signs", () => {
    assert.match(CLIENT, /date and time/);
    assert.match(CLIENT, /internet address/);
  });

  test("it is not cached, because a document somebody is about to sign must be fresh", () => {
    assert.match(HEADERS, /\/contract\.html\n\s+Cache-Control: public, max-age=0, must-revalidate/);
  });
});

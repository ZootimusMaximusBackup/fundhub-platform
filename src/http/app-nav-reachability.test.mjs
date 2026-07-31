// App navigation reachability — the test that fails when a screen has no way in.
//
// THIS FILE DID NOT EXIST. The brief for the Money Map screen said
// "src/http/app-nav-reachability.test.mjs FAILS if a screen has no way in", and
// it was not in the tree. It is here now, and the absence is recorded on the
// shared board rather than quietly fixed.
//
// WHAT KEEPS GOING WRONG, AND WHY THIS IS THE SAME CLASS OF BUG AS routes.test.mjs.
//
// src/http/routes.test.mjs exists because a handler file under api/ is not a
// route: netlify/functions/api.mjs holds a HAND-WRITTEN map, and a handler
// missing from it 404s everywhere while every unit test stays green. The
// browser side has the identical hazard one layer up:
//
//   * public/app/shell.js holds a HAND-WRITTEN list, `ALL`. A screen missing
//     from it is BOUNCED to the role's home page the moment it loads — the file
//     is deployed, the endpoint works, and the screen is unreachable.
//   * every sidebar is HAND-COPIED into all 28 html files. A screen nobody
//     pasted a link to is reachable only by typing its filename, which nobody
//     does.
//
// Either one alone makes a finished feature invisible. Both are text a person
// edits by hand, in files no other test reads.
//
// PURE FILE READS, no database and no browser, so this runs in every pass.

import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "../../public/app");
const SHELL = path.join(APP_DIR, "shell.js");

/* index.html is the router page, not a screen. shell.js's own comment says so:
   PAGE is "" when the URL is /app/, and the router is never in ALL. */
const NOT_A_SCREEN = new Set(["index.html"]);

const htmlFiles = fs
  .readdirSync(APP_DIR)
  .filter((f) => f.endsWith(".html"))
  .sort();

const shellSrc = fs.readFileSync(SHELL, "utf8");

/* Parsed out of shell.js rather than restated here. A copy of the list in this
   file would agree with the real one right up until somebody edited one of
   them, which is the failure this test exists to catch. */
function arrayLiteral(name) {
  const m = new RegExp(`var\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`).exec(shellSrc);
  assert.ok(m, `shell.js no longer has a 'var ${name} = [...]' — this test cannot read it`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

const ALL = arrayLiteral("ALL");
const PRINCIPAL_ONLY = arrayLiteral("PRINCIPAL_ONLY");

/* Every bare same-directory .html link in a file. Query strings and fragments
   are stripped; a link carrying ?client_id= is still a link to the screen. */
function linksIn(file) {
  const src = fs.readFileSync(path.join(APP_DIR, file), "utf8");
  const out = new Set();
  const re = /href="([^"#?:]+\.html)(?:[?#][^"]*)?"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m[1].includes("/")) continue; // not a sibling screen
    out.add(m[1]);
  }
  return out;
}

const linkGraph = new Map(htmlFiles.map((f) => [f, linksIn(f)]));

const inbound = new Map(htmlFiles.map((f) => [f, new Set()]));
for (const [from, targets] of linkGraph) {
  for (const to of targets) {
    if (to !== from && inbound.has(to)) inbound.get(to).add(from);
  }
}

/* ------------------------------------------------------------------ */

test("every link between screens points at a file that exists", () => {
  const broken = [];
  for (const [from, targets] of linkGraph) {
    for (const to of targets) {
      if (!htmlFiles.includes(to)) broken.push(`${from} → ${to}`);
    }
  }
  assert.deepEqual(broken, [], "these links go nowhere:\n  " + broken.join("\n  "));
});

test("every screen file is in shell.js's ALL, or the gate bounces it on load", () => {
  const missing = htmlFiles.filter((f) => !NOT_A_SCREEN.has(f) && !ALL.includes(f));
  assert.deepEqual(
    missing,
    [],
    "these screens are deployed but shell.js will bounce anyone who opens them:\n  " +
      missing.join("\n  ") +
      "\nAdd them to the ALL array in public/app/shell.js."
  );
});

test("every entry in shell.js's ALL is a file that actually exists", () => {
  const ghosts = ALL.filter((f) => !htmlFiles.includes(f));
  assert.deepEqual(ghosts, [], "shell.js lists screens that are not in public/app:\n  " + ghosts.join("\n  "));
});

/* THE ONE THAT MATTERS. A screen nobody links to is finished, deployed, gated
   correctly — and invisible. */
test("every staff screen has at least one way in from another screen", () => {
  const orphans = [];
  for (const f of htmlFiles) {
    if (NOT_A_SCREEN.has(f)) continue;
    /* PRINCIPAL_ONLY screens are deliberately not in any staff sidebar —
       shell.js says partner-galaxy.html "is the one screen no sidebar links to,
       and employees get the real Galaxy instead". A principal reaches it from
       their own home, which the gate decides. */
    if (PRINCIPAL_ONLY.includes(f)) continue;
    if (inbound.get(f).size === 0) orphans.push(f);
  }
  assert.deepEqual(
    orphans,
    [],
    "these screens have no inbound link — nobody can get to them without typing the filename:\n  " +
      orphans.join("\n  ") +
      "\nAdd a <a class=\"navitem\" href=\"...\"> to the sidebar in the other screens."
  );
});

/* The sidebar is hand-copied into every file, so "it is linked from one screen"
   is not the same as "it is in the navigation". A screen reachable from exactly
   one place is one careless edit from being unreachable. */
test("a screen in the sidebar is in EVERY sidebar that carries its group", () => {
  /* Finance is the group this test can check without inventing a rule for the
     other seven: the three finance screens either all appear together in a
     sidebar or none of them do. */
  const FINANCE = ["money-map.html", "finance-os.html", "banking-surface.html"];
  const disagreements = [];
  for (const f of htmlFiles) {
    if (NOT_A_SCREEN.has(f)) continue;
    const links = linkGraph.get(f);
    const present = FINANCE.filter((s) => s !== f && links.has(s));
    const expected = FINANCE.filter((s) => s !== f);
    if (present.length !== 0 && present.length !== expected.length) {
      disagreements.push(`${f} links to ${present.join(", ")} but not ${expected.filter((s) => !present.includes(s)).join(", ")}`);
    }
  }
  assert.deepEqual(
    disagreements,
    [],
    "a sidebar has some of the Finance screens and not the others:\n  " + disagreements.join("\n  ")
  );
});

test("the Money Map is reachable — in ALL, and linked from the sidebars", () => {
  assert.ok(ALL.includes("money-map.html"), "money-map.html is not in shell.js ALL");
  assert.ok(htmlFiles.includes("money-map.html"), "public/app/money-map.html is missing");
  assert.ok(
    inbound.get("money-map.html").size >= 20,
    `money-map.html is linked from only ${inbound.get("money-map.html").size} screen(s) — it should be in every staff sidebar`
  );
});

/* NO WAY OUT BY DESIGN — the same shape as ALLOWED_UNROUTED in routes.test.mjs,
   and for the same reason: leaving a screen without an exit should cost somebody
   a written sentence in a file a reviewer reads, not a line nobody remembered.

   Only one entry, and it is not a debt. shell.js gives the `client` principal
   exactly one screen (ROLE_TABS.client = ["client-portal.html"]), so there is
   nowhere for it to link TO — every other screen in this folder is the staff
   CRM, and a client must not see it. Adding a link here would be the bug. */
const NO_WAY_OUT_BY_DESIGN = {
  "client-portal.html":
    "the client principal has exactly one screen; every other file here is the " +
    "staff CRM and a client must not be linked into it"
};

/* A screen with no way OUT is the other half of the same problem, and it is the
   one that bites hardest on a pasted URL: history.back() does nothing on a first
   page load, so a screen whose only exit is a back button traps whoever opened
   the link. */
test("every screen has at least one outbound link, or a written reason it has none", () => {
  const dead = [];
  for (const f of htmlFiles) {
    if (NOT_A_SCREEN.has(f)) continue;
    if (Object.prototype.hasOwnProperty.call(NO_WAY_OUT_BY_DESIGN, f)) continue;
    const out = [...linkGraph.get(f)].filter((t) => t !== f);
    if (out.length === 0) dead.push(f);
  }
  assert.deepEqual(
    dead,
    [],
    "these screens have no way out — a pasted URL opens them and traps the reader:\n  " +
      dead.join("\n  ") +
      "\nAdd a real href, or add an entry to NO_WAY_OUT_BY_DESIGN with the reason."
  );
});

test("every NO_WAY_OUT_BY_DESIGN entry is still a real screen with still no way out", () => {
  for (const [f, reason] of Object.entries(NO_WAY_OUT_BY_DESIGN)) {
    assert.ok(htmlFiles.includes(f), `${f} is exempted but no longer exists — drop the entry`);
    assert.ok(reason.length > 20, `${f} is exempted without a real reason`);
    const out = [...linkGraph.get(f)].filter((t) => t !== f);
    assert.deepEqual(
      out,
      [],
      `${f} now links to ${out.join(", ")} — it no longer needs the exemption, drop it`
    );
  }
});

/* Tests that every screen the shell will open can actually be reached, and
 * that every screen it opens has a way back out.
 *
 * THE DEFECT THIS FILE EXISTS FOR (audit M20). finance-os.html and
 * banking-surface.html were added to the allowed list in public/app/shell.js
 * and to nothing else. No sidebar on any screen linked to either one, so the
 * only way in was typing the path by hand; and neither screen carried a single
 * link of its own, so the only way out was the browser Back button. Two
 * delivered screens that a signed-in employee could not see or leave.
 *
 * The rules under test:
 *   1. Every screen the shell lists is offered by the shared sidebar (the one
 *      partner screen the shell documents as deliberately unlinked excepted).
 *   2. The sidebar is the same on every screen that has one — it is copied
 *      inline into each file, so a row added to some and not others is a
 *      sidebar that changes as you walk around the app.
 *   3. Every screen the shell gates links back out to another screen.
 *   4. The tab count the session chip prints for a staff role is the number of
 *      sidebar rows that role is actually left looking at.
 *
 * It reads shell.js as text rather than executing it: shell.js is an IIFE that
 * redirects on load and exports nothing. The three lists are lifted out of the
 * source, so this goes red if a screen is added to the shell and nowhere else,
 * which is exactly how M20 happened.
 *
 * It lives under src/ rather than public/ because package.json's test glob only
 * walks src/ and scripts/ (see the traps section of CLAUDE.md).
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const SHELL_SRC = fs.readFileSync(path.join(APP, "shell.js"), "utf8");

/* ── the shell's own lists, lifted from the source ────────────────────────── */

/** shellList — the string array declared as `var <name> = [ ... ];` in shell.js. */
function shellList(name) {
  const m = SHELL_SRC.match(new RegExp("var\\s+" + name + "\\s*=\\s*\\[([\\s\\S]*?)\\];"));
  assert.ok(m, `shell.js no longer declares ${name} — this test cannot read the shell`);
  const items = (m[1].match(/"[^"]*"/g) || []).map((s) => JSON.parse(s));
  assert.ok(items.length, `shell.js ${name} parsed as empty`);
  return items;
}

const ALL = shellList("ALL");
const PRINCIPAL_ONLY = shellList("PRINCIPAL_ONLY");
const OWNER_ADMIN_ONLY = shellList("OWNER_ADMIN_ONLY");
const CLOSER_DESK_ONLY = shellList("CLOSER_DESK_ONLY");
const SALES_FLOOR_ONLY = shellList("SALES_FLOOR_ONLY");
const PORTAL_ONLY = shellList("PORTAL_ONLY");
const HIRING_ONLY = shellList("HIRING_ONLY");

/** staffTabs — shell.js's own staffTabs(), the shared employee surface.
    Role-narrow extras stack on top in allowedFor(). */
const STAFF_TABS = ALL.filter(
  (s) =>
    !PRINCIPAL_ONLY.includes(s) &&
    !OWNER_ADMIN_ONLY.includes(s) &&
    !CLOSER_DESK_ONLY.includes(s) &&
    !SALES_FLOOR_ONLY.includes(s) &&
    !PORTAL_ONLY.includes(s) &&
    !HIRING_ONLY.includes(s)
);

const CLOSER_TABS = [...STAFF_TABS, ...CLOSER_DESK_ONLY];
const SALES_MANAGER_TABS = [...STAFF_TABS, ...SALES_FLOOR_ONLY];

/* ── the screens on disk ──────────────────────────────────────────────────── */

const FILES = fs.readdirSync(APP).filter((f) => f.endsWith(".html")).sort();
const HTML = new Map(FILES.map((f) => [f, fs.readFileSync(path.join(APP, f), "utf8")]));

/** gated — the pages that load the shell, so the shell decides who sees them. */
const GATED = FILES.filter((f) => /<script src="shell\.js">/.test(HTML.get(f)));

/** navHrefs — the sidebar rows in one file, in document order. */
function navHrefs(text) {
  const out = [];
  const re = /<a\s+class="navitem[^"]*"\s+href="([^"]+)"/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1].replace(/^\.\//, ""));
  return out;
}

/** screenLinks — every link in one file that points at another screen file. */
function screenLinks(text) {
  const out = new Set();
  const re = /<a\s[^>]*href="\.?\/?([a-z0-9-]+\.html)"/gi;
  let m;
  while ((m = re.exec(text))) out.add(m[1]);
  return out;
}

const WITH_SIDEBAR = GATED.filter((f) => navHrefs(HTML.get(f)).length > 0);

/* client-portal.html is the only screen ROLE_TABS.client may open (shell.js
   ROLE_TABS), so there is nowhere for it to link to. Every other gated screen
   has somewhere to go and must offer it. */
const SOLE_SCREEN_FOR_ITS_ROLE = ["client-portal.html"];

/* ── the fixture has to be honest ─────────────────────────────────────────── */

describe("app shell — the lists this test reads", () => {
  test("the shell still declares its lists and screens on disk back them", () => {
    assert.ok(ALL.length >= 20, `ALL parsed as only ${ALL.length} screens`);
    for (const s of ALL) {
      assert.ok(HTML.has(s), `shell.js lists ${s} but public/app/${s} does not exist`);
    }
    assert.deepEqual([...CLOSER_DESK_ONLY].sort(), ["closer-call.html", "my-numbers.html"].sort());
    assert.deepEqual(SALES_FLOOR_ONLY, ["sales-floor.html"]);
    assert.deepEqual([...PORTAL_ONLY].sort(), ["affiliate.html", "client-portal.html"].sort());
    assert.deepEqual(HIRING_ONLY, ["hiring.html"]);
    assert.ok(WITH_SIDEBAR.length >= 20,
      `only ${WITH_SIDEBAR.length} screens were found to carry a sidebar`);
  });
});

/* ── the defect ───────────────────────────────────────────────────────────── */

describe("app shell — every screen it opens can be reached", () => {
  test("the sidebar offers every screen the shell lists", () => {
    // partner-galaxy.html is documented in shell.js as the one screen no
    // sidebar links to: employees get the real Galaxy instead.
    const expected = ALL.filter((s) => !PRINCIPAL_ONLY.includes(s));
    const offered = new Set(navHrefs(HTML.get(WITH_SIDEBAR[0])));
    const missing = expected.filter((s) => !offered.has(s));
    assert.deepEqual(missing, [],
      `no sidebar row links to ${missing.join(", ")} — the only way in is typing ` +
        `the path by hand. Add a .navitem for each, in every screen's sidebar.`);
  });

  test("the sidebar is the same on every screen that has one", () => {
    const first = navHrefs(HTML.get(WITH_SIDEBAR[0]));
    for (const f of WITH_SIDEBAR) {
      assert.deepEqual(navHrefs(HTML.get(f)), first,
        `${f}'s sidebar differs from ${WITH_SIDEBAR[0]}'s — the nav must not ` +
          `change as you walk around the app`);
    }
  });

  test("no sidebar row points at a screen the shell has never heard of", () => {
    const stray = navHrefs(HTML.get(WITH_SIDEBAR[0])).filter((h) => !ALL.includes(h));
    assert.deepEqual(stray, [],
      `the sidebar links to ${stray.join(", ")}, which shell.js will not open`);
  });
});

describe("app shell — every screen it opens has a way out", () => {
  for (const f of GATED) {
    if (SOLE_SCREEN_FOR_ITS_ROLE.includes(f)) continue;
    if (!ALL.includes(f)) continue;      // /app/index.html is the router, not a screen

    test(`${f} links to at least one other screen`, () => {
      const out = [...screenLinks(HTML.get(f))].filter((h) => h !== f && ALL.includes(h));
      assert.ok(out.length > 0,
        `${f} contains no link to another screen — once you are on it the only ` +
          `way out is the browser Back button`);
    });
  }
});

describe("app shell — the chip's tab count matches what the sidebar shows", () => {
  const nav = () => navHrefs(HTML.get(WITH_SIDEBAR[0]));

  function visibleFor(allowed) {
    return nav().filter((h) => allowed.includes(h));
  }

  test("a generic staff role sees the shared staff surface only", () => {
    // funding_advisor / setter / inquiry_specialist — no closer desk, no floor.
    const visible = visibleFor(STAFF_TABS);
    assert.equal(visible.length, STAFF_TABS.length);
    assert.deepEqual([...visible].sort(), [...STAFF_TABS].sort());
    for (const h of [...CLOSER_DESK_ONLY, ...SALES_FLOOR_ONLY, ...OWNER_ADMIN_ONLY]) {
      assert.ok(!visible.includes(h), `generic staff must not see ${h}`);
    }
  });

  test("a closer sees the staff surface plus closer desk, not the sales floor", () => {
    const visible = visibleFor(CLOSER_TABS);
    assert.deepEqual([...visible].sort(), [...CLOSER_TABS].sort());
    assert.ok(visible.includes("closer-call.html"));
    assert.ok(visible.includes("my-numbers.html"));
    assert.ok(!visible.includes("sales-floor.html"));
  });

  test("a sales manager sees the staff surface plus sales floor, not closer desk", () => {
    const visible = visibleFor(SALES_MANAGER_TABS);
    assert.deepEqual([...visible].sort(), [...SALES_MANAGER_TABS].sort());
    assert.ok(visible.includes("sales-floor.html"));
    assert.ok(!visible.includes("closer-call.html"));
    assert.ok(!visible.includes("my-numbers.html"));
  });

  test("owner/admin keep every non-partner sidebar row", () => {
    const ownerAllowed = ALL.filter((s) => !PRINCIPAL_ONLY.includes(s));
    const visible = visibleFor(ownerAllowed);
    assert.deepEqual([...visible].sort(), [...ownerAllowed].sort());
  });
});

/* ── ported from the second copy of this file ─────────────────────────────────
   claude/finance-os-dashboard-311v7j wrote its own app-nav-reachability.test.mjs
   without seeing this one — an add/add conflict on merge, two files with the
   same path and different assertions. Its one case that does not restate what
   is above is carried over rather than lost with the file: a link whose TARGET
   does not exist (this file only ever looked at links to screens the shell
   already knows, so a typo'd href was invisible to it).

   The companion case this section used to carry — "the Money Map is in ALL, on
   disk, and offered by every sidebar" — is gone with money-map.html itself.
   Finance OS consolidated eleven Finance screens (money-map, banking-surface,
   card-stack, bank-accounts, bills-cashflow, banking-entry, finance-command,
   finance-add, alerts, deal-model) into one, and Subscriptions moved to Setup —
   an owner decision, not a regression this file should still be guarding. */

describe("app shell — every link points at a file that is really there", () => {
  test("no screen links to an .html file that does not exist", () => {
    const broken = [];
    for (const f of FILES) {
      const hrefs = [...HTML.get(f).matchAll(/href="\.?\/?([a-z0-9-]+\.html)"/gi)].map((m) => m[1]);
      for (const to of new Set(hrefs)) {
        if (!FILES.includes(to)) broken.push(`${f} -> ${to}`);
      }
    }
    assert.deepEqual(broken, [], "these links go nowhere:\n  " + broken.join("\n  "));
  });
});

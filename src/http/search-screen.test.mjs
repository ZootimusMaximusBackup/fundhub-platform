/* Tests for the global CRM search UI in public/app/shell.js, and for the
 * messaging.html ?conversation_id= deep link that search click-through uses.
 *
 * TWO HALVES, same shape as pipeline-screen / messaging-screen:
 *   THE VIEW MODEL — FH-SEARCH-BEGIN/END helpers, driven in a vm.
 *   THE WIRING — shell mounts the overlay; messaging reads conversation_id.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const SHELL = fs.readFileSync(path.join(APP, "shell.js"), "utf8");
const MESSAGING = fs.readFileSync(path.join(APP, "messaging.html"), "utf8");
const DATA = fs.readFileSync(path.join(APP, "data.js"), "utf8");

const BEGIN = "/* FH-SEARCH-BEGIN */";
const END = "/* FH-SEARCH-END */";

function loadSearchHelpers() {
  const a = SHELL.indexOf(BEGIN);
  const b = SHELL.indexOf(END);
  assert.ok(a !== -1 && b > a, "the FH-SEARCH markers are gone from shell.js");
  const sandbox = { window: {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SHELL.slice(a + BEGIN.length, b), sandbox, { filename: "shell.js#FH-SEARCH" });
  assert.ok(sandbox.window.FHSearch, "FHSearch did not attach");
  return sandbox.window.FHSearch;
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

describe("shell.js — global search helpers", () => {
  test("group order and labels cover every backend bucket", () => {
    const S = loadSearchHelpers();
    assert.deepEqual(S.groupOrder(), [
      "clients", "contracts", "documents", "conversations", "cards"
    ]);
    const labels = S.groupLabels();
    for (const key of S.groupOrder()) {
      assert.equal(typeof labels[key], "string");
      assert.ok(labels[key].length > 0);
    }
  });

  test("empty copy is honest — empty query vs no matches", () => {
    const S = loadSearchHelpers();
    assert.match(S.emptyCopy(""), /Type a name/i);
    assert.match(S.emptyCopy("ada"), /No matches for/);
    assert.ok(S.emptyCopy("ada").includes("ada"));
  });

  test("renderGroups skips empty buckets and escapes titles", () => {
    const S = loadSearchHelpers();
    const out = S.renderGroups({
      clients: [{ title: "<b>Ada</b>", subtitle: "a@x", href: "/app/client-control-panel.html?id=1" }],
      contracts: [],
      documents: [],
      conversations: [],
      cards: [{ title: "Ada Co", subtitle: "Sales / New", href: "/app/client-control-panel.html?id=1" }]
    }, esc);
    assert.equal(out.total, 2);
    assert.ok(out.html.includes("Clients"));
    assert.ok(out.html.includes("Pipeline"));
    assert.ok(!out.html.includes("Contracts"), "empty groups must not render a heading");
    assert.ok(!out.html.includes("<b>Ada</b>"), "titles must be escaped");
    assert.ok(out.html.includes("&lt;b&gt;Ada&lt;/b&gt;"));
  });

  test("total counts every row across groups", () => {
    const S = loadSearchHelpers();
    assert.equal(S.total(null), 0);
    assert.equal(S.total({ clients: [{}, {}], cards: [{}] }), 3);
  });
});

describe("shell.js — search wiring", () => {
  test("the overlay, shortcut and FHData.search path are present", () => {
    assert.match(SHELL, /fh-shell-search-overlay/);
    assert.match(SHELL, /fh-shell-search-btn/);
    assert.match(SHELL, /metaKey|\|\|\s*e\.ctrlKey/);
    assert.match(SHELL, /["']k["']|key === "k"/i);
    assert.match(SHELL, /FHData\.search/);
    assert.match(SHELL, /mountSearch\(/);
    assert.match(SHELL, /layoutShellChrome\(/);
    assert.match(SHELL, /SEARCH_SKIP_ROLES/);
    assert.match(SHELL, /--fh-shell-top-clearance/);
  });

  test("principals are skipped — client and partner do not get CRM search", () => {
    assert.match(SHELL, /client:\s*1/);
    assert.match(SHELL, /partner:\s*1/);
    assert.match(SHELL, /affiliate:\s*1/);
  });
});

describe("data.js — FHData.search", () => {
  test("search is a named reader over /api/read/search", () => {
    assert.match(DATA, /search:\s*function/);
    assert.match(DATA, /read\("search"/);
  });
});

describe("messaging.html — conversation_id deep link", () => {
  test("the screen reads conversation_id from the URL after the list loads", () => {
    assert.match(MESSAGING, /FHData\.param\("conversation_id"\)/);
    assert.match(MESSAGING, /loadList\(\)\.then/);
  });

  test("a bad conversation_id is ignored rather than thrown", () => {
    assert.match(MESSAGING, /UUID_RE/);
  });

  test("search click-through targets messaging with conversation_id", () => {
    const searchSrc = fs.readFileSync(path.resolve(HERE, "../../api/read/search.mjs"), "utf8");
    assert.match(searchSrc, /messaging\.html\?conversation_id=/);
  });
});

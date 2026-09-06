// What the whole page must be true of, once the body is wrapped in a document:
// the web-page conversions the owner asked for, the escaping, the branding
// guardrail, and behaviour on a file that is missing everything.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { esc } from "./escape.mjs";
import { DELIVERABLE_DOCS, DELIVERABLE_VARIANTS, renderDeliverableHtml, renderAllDeliverables }
  from "./index.mjs";
import { emptyBlackReportClient } from "../underwrite/black-report-client.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (n) => JSON.parse(readFileSync(join(HERE, "fixtures", n), "utf8"));
const ACADEMY = fixture("academy-client.json");
const REPAIR = fixture("repair-client.json");
const JORDAN = fixture("jordan-sample-client.json");

const pages = (client) => renderAllDeliverables({ client, fontsHref: "/assets/fonts" });

describe("deliverables/escape", () => {
  test("escapes the five characters that matter in HTML", () => {
    assert.equal(esc(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
  test("null and undefined become empty, not the word null", () => {
    assert.equal(esc(null), "");
    assert.equal(esc(undefined), "");
  });
});

describe("the set", () => {
  test("four documents, with the subtype keys the live printer already uses", () => {
    assert.deepEqual(DELIVERABLE_DOCS.map((d) => d.key),
      ["credit_analysis", "funding_snapshot", "lender_match", "roadmap"]);
  });

  test("the v2 treatment is kept out of the default four", () => {
    assert.deepEqual(DELIVERABLE_VARIANTS.map((d) => d.key), ["credit_analysis_v2"]);
    assert.equal(renderAllDeliverables({ client: ACADEMY }).length, 4);
    assert.equal(renderAllDeliverables({ client: ACADEMY, includeVariants: true }).length, 5);
  });

  test("the v2 treatment sets the body class the gradient CSS keys off", () => {
    const v2 = renderDeliverableHtml({ client: ACADEMY, doc: "credit_analysis_v2" });
    assert.ok(v2.html.includes('<body class="v2">'));
  });

  test("an unknown document is an error, not a blank page", () => {
    assert.throws(() => renderDeliverableHtml({ client: ACADEMY, doc: "nope" }), /unknown deliverable/);
  });

  test("no client is an error, not an empty document", () => {
    assert.throws(() => renderDeliverableHtml({ client: null, doc: "roadmap" }), /client is required/);
  });
});

describe("27 numbered sections across the four documents, same as the Python", () => {
  const EXPECTED = { credit_analysis: 8, funding_snapshot: 6, lender_match: 4, roadmap: 9 };
  const count = (html) => (html.match(/<div class="eyebrow">\d\d \//g) || []).length;

  for (const [key, n] of Object.entries(EXPECTED)) {
    test(`${key} has ${n}`, () => {
      const doc = renderDeliverableHtml({ client: JORDAN, doc: key });
      assert.equal(count(doc.html), n);
    });
  }

  test("27 in total", () => {
    assert.equal(Object.values(EXPECTED).reduce((a, b) => a + b, 0), 27);
    const total = pages(JORDAN).reduce((sum, d) => sum + count(d.html), 0);
    assert.equal(total, 27);
  });
});

describe("it is a web page now, not a printed sheet", () => {
  for (const doc of pages(ACADEMY)) {
    test(`${doc.key}: no @page rule survives`, () => {
      assert.ok(!/@page\b[^\n{]*\{/.test(doc.html), "no @page rule is left");
      assert.ok(!doc.html.includes("counter(page)"), "no page counter");
      assert.ok(!doc.html.includes("counter(pages)"), "no page total");
    });

    test(`${doc.key}: the black panels paint their own background and claim a screen`, () => {
      assert.ok(doc.html.includes(".cover, .cta-page { min-height: 100vh;"));
      assert.ok(doc.html.includes("background: #0c0c0c"));
      assert.ok(doc.html.includes('<div class="cover">'));
      assert.ok(doc.html.includes('<div class="cta-page">'));
    });

    test(`${doc.key}: the running footer is in normal flow and carries no page number`, () => {
      assert.ok(doc.html.includes('<footer class="running-foot">'));
      assert.ok(doc.html.includes("·confidential ·prepared for academy sim"));
      const label = DELIVERABLE_DOCS.find((d) => d.key === doc.key).footerLabel;
      assert.ok(doc.html.includes(`<span>${label}</span></footer>`),
        `${doc.key} footer should end with "${label}" and nothing after it`);
    });

    test(`${doc.key}: it is a complete document a browser can open`, () => {
      assert.ok(doc.html.startsWith("<!doctype html>"));
      assert.ok(doc.html.includes('<meta name="viewport"'));
      assert.ok(doc.html.includes(`<title>${doc.title}</title>`));
      assert.ok(doc.html.trimEnd().endsWith("</body></html>"));
      assert.ok(doc.filename.endsWith(".html"));
    });
  }
});

describe("the QR code stays a placeholder — no new dependency", () => {
  test("every document shows the text placeholder", () => {
    for (const doc of pages(ACADEMY)) {
      assert.ok(doc.html.includes('<div class="qr">[ QR CODE ]</div>'), doc.key);
      assert.ok(!doc.html.includes("data:image/png;base64"), `${doc.key} has no generated QR image`);
    }
  });
});

describe("branding guardrail (owner-set)", () => {
  for (const [label, client] of [["clean file", ACADEMY], ["damaged file", REPAIR],
    ["the Python sample", JORDAN]]) {
    test(`"credit repair" appears nowhere in the ${label}`, () => {
      for (const doc of pages(client)) {
        assert.ok(!/credit[\s-]*repair/i.test(doc.html),
          `${doc.key} contains the phrase "credit repair"`);
      }
    });
  }
});

describe("client data is escaped before it reaches the page", () => {
  const NASTY = '</style><script>alert(1)</script>"onload=';
  test("a script tag in a creditor name comes out inert", () => {
    const client = JSON.parse(JSON.stringify(REPAIR));
    client.applicant = NASTY;
    client.revolving[0][0] = NASTY;
    client.negatives[0].creditor = NASTY;
    client.negatives[0].detail = NASTY;
    client.installments.push([NASTY, "Open", "$1", NASTY]);
    client.lenders[0][0] = NASTY;
    client.address = NASTY;
    client.booking_url = NASTY;
    for (const doc of pages(client)) {
      assert.ok(!doc.html.includes("<script>"), `${doc.key} let a script tag through`);
      // exactly one </style>: the renderer's own. The payload's is escaped.
      assert.equal(doc.html.split("</style>").length - 1, 1,
        `${doc.key} let a style close through`);
      assert.ok(doc.html.includes("&lt;script&gt;"), `${doc.key} should show the text escaped`);
    }
  });

  test("no client value is ever interpolated into the stylesheet", () => {
    const client = JSON.parse(JSON.stringify(ACADEMY));
    client.applicant = "}body{display:none}/*";
    for (const doc of pages(client)) {
      const style = doc.html.slice(doc.html.indexOf("<style>"), doc.html.indexOf("</style>"));
      assert.ok(!style.includes("display:none"), `${doc.key} took a client value into CSS`);
    }
  });
});

describe("an empty file renders, and invents nothing", () => {
  const empty = emptyBlackReportClient();

  test("all four documents build from a client with no credit data at all", () => {
    const docs = renderAllDeliverables({ client: empty });
    assert.equal(docs.length, 4);
    for (const doc of docs) assert.ok(doc.html.length > 2000, doc.key);
  });

  test("an unknown number reads '-', never $0", () => {
    // fontsHref keeps the base64 font payload out; "NaN" occurs inside it.
    const html = renderDeliverableHtml({ client: empty, doc: "roadmap", fontsHref: "/assets/fonts" }).html;
    assert.ok(!html.includes("undefined"), "no undefined leaked into the page");
    assert.ok(!html.includes("NaN"), "no NaN leaked into the page");
  });

  test("no Jordan Sample leftovers reach a real client's page", () => {
    for (const doc of pages(ACADEMY)) {
      for (const leak of ["Jordan", "SYNCB", "SIGNET BANK", "San Antonio", "Knoll Krest"]) {
        assert.ok(!doc.html.includes(leak), `${doc.key} leaked ${leak}`);
      }
    }
  });
});

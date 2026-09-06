// THE ENGINE THAT ACTUALLY RAN MUST BE RECORDED. That is what this file guards.
//
// The defect these tests exist for is not "the wrong printer ran". It is "the
// wrong printer ran and nothing said so". For six weeks every real client got
// the short pdf-lib documents instead of the designed WeasyPrint ones, because
// the swap happened with no throw, no log and no flag.
//
// So every assertion below is about the RECORD, not only the bytes:
//   * the returned object names an engine and a reason on every path
//   * every file object carries the engine, so it reaches the document row
//   * a dead service degrades — it never throws, and never returns nothing
//
// These run without WeasyPrint and without a network. The remote path is
// exercised against a real local HTTP server, not a stubbed fetch, because the
// thing being proven is that a real socket failure falls back rather than
// propagating.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { printBlackReports, resolveRenderService, ENGINE } from "./black-report-pdf.mjs";
import { persistFundingLetterFiles } from "./funding-letter-pdf.mjs";
import { memoryProvider, createStore } from "../documents/store.mjs";
import { makeFakeDb } from "../documents/fake-db.mjs";

const CLIENT = { applicant: "Engine Fixture", scores: { experian: 600, equifax: 610, transunion: 620 } };

/** A stand-in render service. `respond` decides what it does with each POST. */
async function withServer(respond, run) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      seen.push({ url: req.url, key: req.headers["x-fundhub-render-key"], body });
      respond(req, res, body);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run({ url, seen });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function fakePdf(text) {
  return Buffer.from(`%PDF-1.7\n% ${text}\n%%EOF\n`);
}

const FOUR_PDFS = JSON.stringify({
  ok: true,
  files: [
    { filename: "credit_analysis_report.pdf", pdf_base64: fakePdf("analysis").toString("base64") },
    { filename: "funding_snapshot.pdf", pdf_base64: fakePdf("snapshot").toString("base64") },
    { filename: "lender_match_list.pdf", pdf_base64: fakePdf("lenders").toString("base64") },
    { filename: "optimization_roadmap.pdf", pdf_base64: fakePdf("roadmap").toString("base64") }
  ]
});

describe("black report engine resolution", () => {
  test("engine 'node' says so, and says why", async () => {
    const printed = await printBlackReports({ client: CLIENT, engine: "node" });
    assert.equal(printed.engine, ENGINE.NODE);
    assert.equal(printed.engineReason, "engine_node_requested");
    assert.ok(printed.files.length > 0);
  });

  test("every file carries the engine, so it reaches the document row", async () => {
    const printed = await printBlackReports({ client: CLIENT, engine: "node" });
    for (const file of printed.files) {
      assert.equal(file.engine, ENGINE.NODE, `${file.filename} has no engine stamped on it`);
    }
  });

  test("no client, no engine claim", async () => {
    const printed = await printBlackReports({ client: null });
    assert.equal(printed.skip, "no_client");
    assert.deepEqual(printed.files, []);
  });

  test("a URL with no key is not configured — the data does not leave", () => {
    assert.equal(resolveRenderService({ BLACK_REPORT_RENDER_URL: "https://r.example" }), null);
    assert.equal(resolveRenderService({ FUNDHUB_RENDER_KEY: "k" }), null);
    assert.equal(resolveRenderService({}), null);
    const ok = resolveRenderService({ BLACK_REPORT_RENDER_URL: "https://r.example/", FUNDHUB_RENDER_KEY: "k" });
    assert.deepEqual(ok, { url: "https://r.example/render", key: "k" });
  });

  test("engine 'remote' with nothing configured degrades to node and names the reason", async () => {
    const printed = await printBlackReports({ client: CLIENT, engine: "remote", env: {} });
    assert.equal(printed.engine, ENGINE.NODE);
    assert.match(printed.engineReason, /render_service_not_configured/);
    assert.ok(printed.files.length > 0, "a missing service must still produce documents");
  });

  test("the service is called with the shared secret, on /render, and its PDFs come back", async () => {
    await withServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(FOUR_PDFS);
    }, async ({ url, seen }) => {
      const printed = await printBlackReports({
        client: CLIENT,
        engine: "remote",
        env: { BLACK_REPORT_RENDER_URL: url, FUNDHUB_RENDER_KEY: "shhh" }
      });
      assert.equal(printed.engine, ENGINE.REMOTE);
      assert.equal(printed.engineReason, "render_service");
      assert.equal(printed.files.length, 4);
      for (const file of printed.files) {
        assert.equal(file.content.subarray(0, 4).toString(), "%PDF");
        assert.equal(file.engine, ENGINE.REMOTE);
      }
      assert.equal(seen.length, 1);
      assert.equal(seen[0].url, "/render");
      assert.equal(seen[0].key, "shhh", "the shared secret must be on the request");
      assert.match(seen[0].body, /Engine Fixture/, "the client payload must actually be sent");
    });
  });

  test("a 500 from the service degrades to node rather than throwing", async () => {
    await withServer((req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "render_failed" }));
    }, async ({ url }) => {
      const printed = await printBlackReports({
        client: CLIENT,
        engine: "remote",
        env: { BLACK_REPORT_RENDER_URL: url, FUNDHUB_RENDER_KEY: "shhh" }
      });
      assert.equal(printed.engine, ENGINE.NODE);
      assert.match(printed.engineReason, /render_service_failed:http_500/);
      assert.ok(printed.files.length > 0);
    });
  });

  test("a 401 degrades — a wrong key must not break a credit pull", async () => {
    await withServer((req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
    }, async ({ url }) => {
      const printed = await printBlackReports({
        client: CLIENT,
        engine: "remote",
        env: { BLACK_REPORT_RENDER_URL: url, FUNDHUB_RENDER_KEY: "wrong" }
      });
      assert.equal(printed.engine, ENGINE.NODE);
      assert.match(printed.engineReason, /http_401/);
    });
  });

  test("a response that is not the agreed shape degrades", async () => {
    await withServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, files: "not an array" }));
    }, async ({ url }) => {
      const printed = await printBlackReports({
        client: CLIENT,
        engine: "remote",
        env: { BLACK_REPORT_RENDER_URL: url, FUNDHUB_RENDER_KEY: "shhh" }
      });
      assert.equal(printed.engine, ENGINE.NODE);
      assert.match(printed.engineReason, /bad_response/);
    });
  });

  test("a service that never answers times out and degrades — it does not hang the pull", async () => {
    await withServer(() => { /* answer nothing, ever */ }, async ({ url }) => {
      const started = Date.now();
      const printed = await printBlackReports({
        client: CLIENT,
        engine: "remote",
        timeoutMs: 250,
        env: { BLACK_REPORT_RENDER_URL: url, FUNDHUB_RENDER_KEY: "shhh" }
      });
      assert.equal(printed.engine, ENGINE.NODE);
      assert.match(printed.engineReason, /render_service_failed/);
      assert.ok(printed.files.length > 0);
      assert.ok(Date.now() - started < 15_000, "the timeout did not fire");
    });
  });

  test("a dead port degrades — the connection refusal never reaches the caller", async () => {
    // Bind, learn the port, close it. Nothing is listening there now.
    const { port } = await withServer(() => {}, async ({ url }) => ({ port: new URL(url).port }));
    const printed = await printBlackReports({
      client: CLIENT,
      engine: "remote",
      timeoutMs: 2000,
      env: { BLACK_REPORT_RENDER_URL: `http://127.0.0.1:${port}`, FUNDHUB_RENDER_KEY: "shhh" }
    });
    assert.equal(printed.engine, ENGINE.NODE);
    assert.match(printed.engineReason, /render_service_failed/);
    assert.ok(printed.files.length > 0, "a dead service must still hand the client documents");
  });
});

/* THE OPERATOR-VISIBLE RECORD.
   A log line scrolls away. The document row does not. This proves the engine
   that printed a client's four analysis PDFs is written onto the row those PDFs
   are stored as, so "did this client get the real documents?" is a database
   question, not a code-reading exercise. */
describe("the engine is recorded on the stored document row", () => {
  const ORG = "11111111-1111-1111-1111-111111111111";
  const CLIENT_ID = "22222222-2222-2222-2222-222222222222";

  async function storeOne(engine) {
    const db = makeFakeDb();
    const store = createStore(memoryProvider());
    await persistFundingLetterFiles(db, store, {
      orgId: ORG,
      clientId: CLIENT_ID,
      files: [{
        type: "credit_analysis",
        filename: "Credit-Analysis-Report.pdf",
        contentType: "application/pdf",
        content: Buffer.from("%PDF-1.7 analysis"),
        ...(engine ? { engine } : {})
      }],
      generatedBy: "engine-record-test"
    });
    // `_documents` is the fake's row store — the same array register.mjs
    // INSERTed into. Read straight off it so this asserts what was written,
    // not what a SELECT the fake happens to understand hands back.
    return db._documents;
  }

  test("a remote WeasyPrint render is recorded as weasyprint-remote", async () => {
    const rows = await storeOne(ENGINE.REMOTE);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].metadata.engine, "weasyprint-remote");
    assert.equal(rows[0].metadata.docType, "credit_analysis");
  });

  test("a degraded fallback render is recorded as pdf-lib, not left blank", async () => {
    const rows = await storeOne(ENGINE.NODE);
    assert.equal(rows[0].metadata.engine, "pdf-lib");
  });

  test("a file with no engine stamps no engine — never a guessed one", async () => {
    const rows = await storeOne(null);
    assert.equal("engine" in rows[0].metadata, false);
  });
});

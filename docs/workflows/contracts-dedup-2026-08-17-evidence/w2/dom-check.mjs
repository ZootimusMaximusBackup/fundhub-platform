/* W2 DOM harness — NOT a live check and NOT netlify dev.
 *
 * Serves public/ as static files and answers every /api/** call from a fixture,
 * so what is being proved is exactly one thing: the DOM this change produces,
 * given the responses the API answer on the board promises. It says nothing
 * about the real database and nothing about the deployed site.
 */
const { chromium } = await import("/Users/zootimusmaximus/fundhub-platform/node_modules/@playwright/test/index.mjs");
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform/public";
const OUT = "/Users/zootimusmaximus/fundhub-platform/docs/workflows/contracts-dedup-2026-08-17-evidence/w2";
fs.mkdirSync(OUT, { recursive: true });

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
               ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split("?")[0]);
  const file = (process.env.BASELINE_DOC && p === "/app/documents.html")
    ? process.env.BASELINE_DOC
    : path.join(ROOT, p);
  if (process.env.BASELINE_DOC && p === "/app/documents.html") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(fs.readFileSync(file)); return;
  }
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end("no"); return;
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const DOC_CONTRACT = "11111111-1111-4111-8111-111111111111";
const DOC_AUTH_CONTRACT = "22222222-2222-4222-8222-222222222222";
const DOC_SIGNED = "33333333-3333-4333-8333-333333333333";
const DOC_PLAIN = "44444444-4444-4444-8444-444444444444";

const documents = (items) => ({ ok: true, count: items.length, limit: 200, offset: 0, hasMore: false, items });

const DOCS_WITH_CONTRACTS = documents([
  { id: DOC_CONTRACT, client_id: "c1", document_key: "k1", kind: "contract", subtype: null,
    title: "Funding Agreement", current_version: 1, generated_at: "2026-08-10T00:00:00Z",
    delivered_at: "2026-08-10T00:00:00Z", delivery_status: "delivered", signature_required: true,
    signed_at: null, signer_name: null, expires_at: null, created_at: "2026-08-10T00:00:00Z",
    client_name: "Katherine Johnson" },
  { id: DOC_AUTH_CONTRACT, client_id: "c2", document_key: "k2", kind: "authorization", subtype: null,
    title: "Soft Pull Authorization", current_version: 1, generated_at: "2026-08-11T00:00:00Z",
    delivered_at: null, delivery_status: "pending", signature_required: true,
    signed_at: null, signer_name: null, expires_at: null, created_at: "2026-08-11T00:00:00Z",
    client_name: "Ada Lovelace" },
  { id: DOC_SIGNED, client_id: "c3", document_key: "k3", kind: "contract", subtype: null,
    title: "Repair Engagement", current_version: 2, generated_at: "2026-08-01T00:00:00Z",
    delivered_at: "2026-08-01T00:00:00Z", delivery_status: "delivered", signature_required: true,
    signed_at: "2026-08-05T00:00:00Z", signer_name: "Grace Hopper", expires_at: null,
    created_at: "2026-08-01T00:00:00Z", client_name: "Grace Hopper" },
  { id: DOC_PLAIN, client_id: "c4", document_key: "k4", kind: "deliverable", subtype: "crs_report",
    title: "UnderwriteIQ Report", current_version: 1, generated_at: "2026-08-12T00:00:00Z",
    delivered_at: "2026-08-12T00:00:00Z", delivery_status: "delivered", signature_required: false,
    signed_at: null, signer_name: null, expires_at: null, created_at: "2026-08-12T00:00:00Z",
    client_name: "Alan Turing" }
]);

const DOCS_NO_CONTRACTS = documents([DOCS_WITH_CONTRACTS.items[3]]);

const CONTRACTS = { ok: true, view: "contracts", count: 3, items: [
  { id: "aaaaaaaa-0000-4000-8000-000000000001", document_id: DOC_CONTRACT, signed_document_id: null,
    status: "sent", title: "Funding Agreement", first_name: "Katherine", last_name: "Johnson" },
  { id: "aaaaaaaa-0000-4000-8000-000000000002", document_id: DOC_AUTH_CONTRACT, signed_document_id: null,
    status: "viewed", title: "Soft Pull Authorization", first_name: "Ada", last_name: "Lovelace" },
  { id: "aaaaaaaa-0000-4000-8000-000000000003", document_id: "99999999-9999-4999-8999-999999999999",
    signed_document_id: DOC_SIGNED, status: "signed", title: "Repair Engagement",
    first_name: "Grace", last_name: "Hopper" }
] };

const session = (role) => ({ ok: true, staff: { id: "s1", role, name: "Test " + role,
  email: role + "@fundhub.ai", org_id: "org1" }, demo: false });

async function run({ role, docs, label }) {
  const calls = [];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const u = new URL(url);
    calls.push({ method: route.request().method(), path: u.pathname + u.search });
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (u.pathname === "/api/auth/session") return json(session(role));
    if (u.pathname === "/api/read/documents") return json(docs);
    if (u.pathname === "/api/read/contracts") {
      if (u.searchParams.get("file") === "contract") {
        return json({ ok: true, file: "contract", filename: "FUNDING-AGREEMENT-signed.pdf",
          signed: u.searchParams.get("signed") === "1",
          pdf_base64: Buffer.from("%PDF-1.7\n").toString("base64") });
      }
      return json(CONTRACTS);
    }
    if (u.pathname === "/api/contracts") {
      const body = route.request().postDataJSON();
      if (body.action === "remind") {
        return json({ ok: true, action: "remind", contract_id: body.id, reminder: 2,
          max_reminders: 4, queued: 0, delivery: { sent: 0, blocked: 0, failed: 0 },
          message: "Nothing was emailed — outbound mail is switched off for this company." });
      }
      if (body.action === "void") {
        return json({ ok: true, action: "void",
          contract: { id: body.id, status: "void", voided_at: "2026-08-17T00:00:00Z", void_reason: body.reason },
          message: "Voided. The link stops working and the contract can no longer be signed." });
      }
    }
    return json({ ok: true }, 200);
  });

  /* data.js is loaded by the page with `defer`, and in THIS harness it had not
     executed by the time the page's inline loader ran (ReferenceError: FHData
     is not defined) — on the baseline file just as much as on the changed one,
     so it is a harness artifact, not a change. The live site does not do it:
     docs/workflows/ui-audit-evidence/documents/restamp/probe.json shows the
     loader's own banner ("live documents · 4 records") and consoleErrors []. So
     the harness pre-defines FHData to remove the difference and test the page. */
  await page.addInitScript({ path: ROOT + "/app/data.js" });

  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  await page.goto(BASE + "/app/documents.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(700);

  const table = await page.evaluate(() => {
    const head = Array.from(document.querySelectorAll("#tbl thead th")).map((t) => t.textContent.trim());
    const rows = Array.from(document.querySelectorAll("#body tr")).map((tr) => {
      const tds = Array.from(tr.querySelectorAll("td"));
      const last = tds[tds.length - 1];
      return {
        cells: tds.length,
        doc: (tds[0] && tds[0].textContent.trim().split("\n")[0]) || "",
        contractCell: last ? last.textContent.trim() : "",
        badge: last && last.querySelector(".badge") ? last.querySelector(".badge").textContent.trim() : null,
        buttons: last ? Array.from(last.querySelectorAll("button[data-ct]")).map((b) => b.getAttribute("data-ct")) : []
      };
    });
    return { head, rows };
  });

  const contractLookups = calls.filter((c) => c.path.startsWith("/api/read/contracts?view=contracts"));

  const out = { label, role, head: table.head, rows: table.rows,
    contractLookupCalls: contractLookups.length, contractLookupPaths: contractLookups.map((c) => c.path),
    pageErrors: consoleErrors, actions: {} };

  /* Open PDF — the signed row must ask for the SIGNED copy; a sent-but-unsigned
     row must not (there is no signed copy to open yet). */
  const openSigned = page.locator('#body tr', { hasText: "Repair Engagement" })
    .locator('button[data-ct="open"]').first();
  if (await openSigned.count()) {
    await openSigned.click(); await page.waitForTimeout(400);
  }
  const openUnsigned = page.locator('#body tr', { hasText: "Funding Agreement" })
    .locator('button[data-ct="open"]').first();
  if (await openUnsigned.count()) {
    await openUnsigned.click(); await page.waitForTimeout(400);
  }
  out.actions.fileCalls = calls.filter((c) => c.path.indexOf("file=contract") !== -1).map((c) => c.path);

  // Remind — the server's own words must reach the screen, unedited.
  const remind = page.locator('#body button[data-ct="remind"]').first();
  if (await remind.count()) {
    await remind.click();
    await page.waitForTimeout(400);
    out.actions.remindMsg = (await page.locator("#ctMsg").textContent()).trim();
  }

  // Void — owner only. Accept the prompt, then read the message.
  const voidBtn = page.locator('#body button[data-ct="void"]').first();
  out.actions.voidButtonsVisible = await page.locator('#body button[data-ct="void"]').count();
  if (await voidBtn.count()) {
    page.once("dialog", (d) => d.accept("no longer needed"));
    await voidBtn.click();
    await page.waitForTimeout(500);
    out.actions.voidMsg = (await page.locator("#ctMsg").textContent()).trim();
  }

  await page.screenshot({ path: path.join(OUT, `documents-${label}.png`), fullPage: true });
  await browser.close();
  return out;
}

const results = [];
results.push(await run({ role: "owner", docs: DOCS_WITH_CONTRACTS, label: "owner-with-contracts" }));
results.push(await run({ role: "closer", docs: DOCS_WITH_CONTRACTS, label: "closer-with-contracts" }));
results.push(await run({ role: "owner", docs: DOCS_NO_CONTRACTS, label: "owner-no-contracts" }));

fs.writeFileSync(path.join(OUT, "dom-check.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
server.close();

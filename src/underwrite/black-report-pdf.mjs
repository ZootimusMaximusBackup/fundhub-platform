// Print Chris's designed client deliverables.
//
// THREE ENGINES, ONE ORDER, AND THE ORDER IS THE WHOLE POINT
// ----------------------------------------------------------
// The designed documents are printed by scripts/black-reports/fundhub_gen.py,
// a WeasyPrint program that produces 12 / 9 / 9 / 14 pages. It has always
// worked. Netlify's Node runtime has no Python, so on the live site it has
// never once run, and printBlackReportsNode — a much smaller pdf-lib printer
// that makes 5 / 4 / 6 / 4 — took its place for every real client.
//
// That swap happened with no throw, no log and no flag. It is why nobody
// noticed for six weeks. Read `enginePicked` below before changing anything
// here: recording which printer ran is not decoration, it is the fix.
//
// Owner decision 2026-09-04: run the Python printer as its own small service
// the site calls over HTTP, and KEEP the Node printer as the last resort so a
// service outage degrades the documents instead of breaking a credit pull.
//
// Resolution order:
//   1. engine "node"        -> Node. An explicit request, honoured immediately.
//   2. local Python         -> a developer laptop with WeasyPrint keeps working
//                             exactly as it did. Nothing about that path moved.
//   3. the remote service   -> production. render-service/, reached over HTTP.
//   4. Node                 -> the fallback, and now a LOUD one.
//
// `engine` selects: "auto" (the order above), "node", "python" (local only),
// "remote" (service only). It defaults from BLACK_REPORT_ENGINE so an operator
// can pin the order without a code change — the same single knob, not a second
// mechanism.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FUNDING_ANALYSIS_FILENAMES } from "./letter-pack-filter.mjs";
import { printBlackReportsNode } from "./black-report-node.mjs";
import { transmit, INTERNAL } from "../lib/outbound-fetch.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const BLACK_REPORT_SCRIPT = join(HERE, "../../scripts/black-reports/fundhub_gen.py");

const PRINTER_FILES = Object.freeze([
  ["credit_analysis_report.pdf", "credit_analysis"],
  ["funding_snapshot.pdf", "funding_snapshot"],
  ["lender_match_list.pdf", "lender_match"],
  ["optimization_roadmap.pdf", "roadmap"]
]);

const PYTHON_CANDIDATES = [
  process.env.WEASYPRINT_PYTHON,
  "/opt/homebrew/opt/weasyprint/libexec/bin/python",
  "python3",
  "python"
].filter(Boolean);

/** The engine names that end up on a document row. Stable strings — an operator
    reads these, and a report that groups by them must not fragment. */
export const ENGINE = Object.freeze({
  LOCAL: "weasyprint",         // the Python printer, run on this machine
  REMOTE: "weasyprint-remote", // the Python printer, run by render-service/
  NODE: "pdf-lib"              // the short fallback documents
});

/** How long to wait on the render service before giving up and printing the
    short documents. A slow service must never hold up a credit pull.
    The Python printer takes single-digit seconds (2.3s measured on the Jordan
    Sample data), so this is a ceiling, not a target.

    WHY 8s AND NOT LONGER. A synchronous Netlify function is killed at 10s on the
    current plan, and nothing in netlify.toml raises it. A DEAD service fails fast
    and the Node fallback runs; a HUNG one does not — it just holds the socket. So
    any timeout at or above the function budget means the platform kills the whole
    function first and the fallback below never gets to run, which is the exact
    silent-short-documents failure this file exists to prevent. 8s leaves ~2s to
    print the fallback and return. Raise it only where the caller genuinely has a
    longer budget than a sync function — an Inngest step does — and raise it there
    with BLACK_REPORT_RENDER_TIMEOUT_MS rather than by editing this default. */
export const REMOTE_TIMEOUT_MS = Number(process.env.BLACK_REPORT_RENDER_TIMEOUT_MS || 8_000);

let cachedPython = undefined;

export function resolveWeasyprintPython() {
  if (cachedPython !== undefined) return cachedPython;
  for (const py of PYTHON_CANDIDATES) {
    const r = spawnSync(py, ["-c", "from weasyprint import HTML, CSS"], {
      encoding: "utf8",
      timeout: 20000
    });
    if (r.status === 0) {
      cachedPython = py;
      return py;
    }
  }
  cachedPython = null;
  return null;
}

export function resetWeasyprintPythonCache() {
  cachedPython = undefined;
}

/* enginePicked — THE THING THAT WAS MISSING.
   Every return from printBlackReports goes through here, so there is no path
   that produces documents without saying which printer made them and why.

   Three places carry it:
     1. the returned object            -> the pack result (letter-pack.mjs)
     2. every file object              -> the stored document row's metadata
     3. one console line               -> Netlify's function log, searchable

   A fallback logs at warn level. A degraded client is an operational event, not
   a detail: Chris has to be able to answer "did this client get the real
   documents?" without reading code. */
function enginePicked(result, engine, reason) {
  const files = (result.files || []).map((f) => ({ ...f, engine }));
  const degraded = engine === ENGINE.NODE;
  const line = `[black-report] engine=${engine} reason=${reason} files=${files.length}`;
  // No client field is ever named here. Counts and reasons only.
  if (degraded) console.warn(`${line} DEGRADED — short documents, not the designed set`);
  else console.log(line);
  return { ...result, files, engine, engineReason: reason };
}

/* nodeFallback — the one door to the short documents, so every trip through it
   is recorded. Nothing in this file may call printBlackReportsNode directly. */
async function nodeFallback(client, reason) {
  return enginePicked(await printBlackReportsNode({ client }), ENGINE.NODE, reason);
}

/**
 * The render service configuration, or null when it is not deployed.
 *
 * A URL with no key is treated as NOT CONFIGURED rather than as an
 * unauthenticated call. The service refuses those anyway; failing here keeps
 * the client data off the wire instead of sending it into a 401.
 */
export function resolveRenderService(env = process.env) {
  const url = String(env.BLACK_REPORT_RENDER_URL || "").trim().replace(/\/+$/, "");
  const key = String(env.FUNDHUB_RENDER_KEY || "").trim();
  if (!url || !key) return null;
  return { url: `${url}/render`, key };
}

/* THE ONLY OUTBOUND CALL IN THIS FEATURE.
   CLAUDE.md §12 fences new outbound fetch into src/messaging/providers/. That
   rule is about transmission that reaches a person or changes a record at a
   vendor. This reaches neither: it is our own render box, printing our own
   document, and nothing leaves it but a PDF coming back. So it goes through the
   repository chokepoint (src/lib/outbound-fetch.mjs) under fence INTERNAL —
   the same category as asking a language model a question — and this module is
   named on the pinned INTERNAL list in src/lib/no-unfenced-transmit.test.mjs.
   It is the one and only module in this feature that touches the network.

   The payload is consumer financial information. It goes to one configured
   host over HTTPS with a shared secret, and render-service/README.md states
   what that host does and does not retain. */
async function printRemote({ client, service, timeoutMs }) {
  const res = await transmit(service.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Fundhub-Render-Key": service.key
    },
    body: JSON.stringify({ client })
  }, {
    fence: INTERNAL,
    what: "black-report render service",
    timeoutMs
  });

  if (!res.ok) {
    // res.error is already redacted by the chokepoint and bounded to 300 chars.
    return { files: [], error: `http_${res.status || 0}` };
  }
  const body = res.body;
  if (!body || body.ok !== true || !Array.isArray(body.files)) {
    return { files: [], error: "bad_response" };
  }

  const byName = new Map();
  for (const f of body.files) {
    if (!f || typeof f.filename !== "string" || typeof f.pdf_base64 !== "string") continue;
    byName.set(f.filename, Buffer.from(f.pdf_base64, "base64"));
  }
  return { files: collectPrinted((name) => byName.get(name)), error: null };
}

/* collectPrinted — the same four documents, in the same order, with the same
   names, whichever Python ran. `read` returns bytes for a generator filename or
   undefined. Shared so the local path and the remote path cannot drift. */
function collectPrinted(read) {
  const files = [];
  for (const [fname, type] of PRINTER_FILES) {
    const content = read(fname);
    if (!content || !content.length) continue;
    if (content.subarray(0, 4).toString() !== "%PDF") continue;
    files.push({
      filename: FUNDING_ANALYSIS_FILENAMES[type] || fname,
      contentType: "application/pdf",
      content,
      type
    });
  }
  return files;
}

export async function printBlackReports({
  client,
  outDir = null,
  engine = process.env.BLACK_REPORT_ENGINE || "auto",
  env = process.env,
  timeoutMs = REMOTE_TIMEOUT_MS
} = {}) {
  if (!client || typeof client !== "object") {
    return { files: [], skip: "no_client" };
  }
  if (engine === "node") return nodeFallback(client, "engine_node_requested");

  const wantsLocal = engine === "auto" || engine === "python";
  const wantsRemote = engine === "auto" || engine === "remote";

  // ── 2. Local Python. A laptop with WeasyPrint behaves exactly as before. ──
  // `localWhy` is carried forward so a fallback names the FIRST thing that went
  // wrong, not the last. "no_local_python" on a Netlify box is the normal state
  // and not a fault; a local run that exited non-zero is.
  let localWhy = "local_python_not_attempted";
  if (wantsLocal) {
    const python = resolveWeasyprintPython();
    if (python && existsSync(BLACK_REPORT_SCRIPT)) {
      const local = printLocal({ client, python, outDir });
      if (local.files.length) {
        return enginePicked(
          { files: local.files, skip: null, outDir: local.outDir },
          ENGINE.LOCAL,
          "local_python"
        );
      }
      localWhy = `local_failed:${local.error}`;
      if (engine === "python") return nodeFallback(client, localWhy);
    } else {
      localWhy = python ? "script_missing" : "no_local_python";
      if (engine === "python") return nodeFallback(client, localWhy);
    }
  }

  // ── 3. The render service. This is the production path. ──
  if (wantsRemote) {
    const service = resolveRenderService(env);
    if (!service) return nodeFallback(client, `render_service_not_configured (${localWhy})`);
    let remote;
    try {
      remote = await printRemote({ client, service, timeoutMs });
    } catch (err) {
      // transmit() does not throw, so reaching here means a programming fault
      // rather than a transport one. It still must not break a credit pull.
      remote = { files: [], error: `threw:${String((err && err.message) || err).slice(0, 80)}` };
    }
    if (remote.files.length) {
      return enginePicked({ files: remote.files, skip: null, outDir: null }, ENGINE.REMOTE, "render_service");
    }
    return nodeFallback(client, `render_service_failed:${remote.error}`);
  }

  return nodeFallback(client, "no_engine_available");
}

/* printLocal — unchanged behaviour, lifted out so the resolution order above
   reads as an order. Writes the client JSON to a temp directory, runs the
   generator, reads the PDFs back, removes the directory it created. */
function printLocal({ client, python, outDir }) {
  const created = !outDir;
  const dir = outDir || mkdtempSync(join(tmpdir(), "fh-black-"));
  const jsonPath = join(dir, "client.json");
  const payload = { ...client };
  if (!payload.date) delete payload.date;
  writeFileSync(jsonPath, JSON.stringify(payload));
  const r = spawnSync(python, [BLACK_REPORT_SCRIPT, "--client", jsonPath, "--out", dir], {
    encoding: "utf8",
    timeout: 180000
  });
  if (r.status !== 0) {
    if (created) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* nothing to keep */ } }
    return { files: [], outDir: null, error: `exit_${r.status ?? "signal"}` };
  }

  const files = collectPrinted((name) => {
    const path = join(dir, name);
    return existsSync(path) ? readFileSync(path) : undefined;
  });
  if (created) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* keep bytes already read */ }
  }
  return { files, outDir: created ? null : dir, error: files.length ? null : "no_pdfs" };
}

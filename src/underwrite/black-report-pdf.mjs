// Spawn Chris's WeasyPrint printer (scripts/black-reports/fundhub_gen.py).
// Same shell-out idea as the gold letter CLI: Node writes CLIENT JSON, Python prints.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FUNDING_ANALYSIS_FILENAMES } from "./letter-pack-filter.mjs";
import { printBlackReportsNode } from "./black-report-node.mjs";

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

export async function printBlackReports({ client, outDir = null, engine = "auto" } = {}) {
  if (!client || typeof client !== "object") {
    return { files: [], skip: "no_client" };
  }
  if (engine === "node") return printBlackReportsNode({ client });
  const python = resolveWeasyprintPython();
  if (!python || engine === "node") return printBlackReportsNode({ client });
  if (!existsSync(BLACK_REPORT_SCRIPT)) return printBlackReportsNode({ client });

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
    return printBlackReportsNode({ client });
  }

  const files = [];
  for (const [fname, type] of PRINTER_FILES) {
    const path = join(dir, fname);
    if (!existsSync(path)) continue;
    const content = readFileSync(path);
    if (content.subarray(0, 4).toString() !== "%PDF") continue;
    files.push({
      filename: FUNDING_ANALYSIS_FILENAMES[type] || fname,
      contentType: "application/pdf",
      content,
      type
    });
  }
  if (created) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* keep bytes already read */ }
  }
  if (!files.length) return printBlackReportsNode({ client });
  return { files, skip: null, outDir: created ? null : dir, engine: "weasyprint" };
}

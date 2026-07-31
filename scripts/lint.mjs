// npm run lint — a syntax gate with no dependencies.
//
// WHY THIS IS NOT ESLINT. CLAUDE.md §6 lists `npm run lint` as a gate that must
// pass before a task is done, and no such script existed — nor a tsconfig, nor
// an eslint config. §8 forbids new dependencies without asking, and `pg` and
// `inngest` are the only two this repo has. So this is the useful part of a
// linter that can be written in under fifty lines: every file the runtime will
// load is parsed, and a file that cannot parse fails the build.
//
// It catches the failure that actually costs time here — a syntax error in a
// file no test imports, which stays invisible until the route is hit in
// production. It does NOT catch style, unused variables or type errors. If
// those are wanted, add eslint deliberately; do not grow this file into a
// half-linter.
//
// The inline <script> blocks in public/app/*.html are checked too. That is
// where this repo's browser logic lives, none of it is imported by a test, and
// a screen with a syntax error renders as a blank page under a green suite.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SKIP = new Set(["node_modules", ".git", "dist", ".netlify"]);
const ROOTS = ["src", "scripts", "api", "netlify", "db", "public"];

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = ROOTS.flatMap((r) => walk(join(ROOT, r)));
const failures = [];
let checked = 0;

for (const file of files) {
  const ext = extname(file);
  if (ext === ".mjs" || ext === ".js") {
    checked++;
    try {
      execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    } catch (e) {
      failures.push(file.replace(ROOT, "") + "\n  " + String(e.stderr || e.message).trim().split("\n").slice(0, 3).join("\n  "));
    }
  } else if (ext === ".html") {
    // Inline scripts only — a src= reference is checked as its own file above.
    const src = readFileSync(file, "utf8");
    const blocks = src.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi) || [];
    blocks.forEach((block, i) => {
      const open = (block.match(/^<script[^>]*>/i) || [""])[0];
      // A <script> is only JavaScript when its type says so or says nothing.
      // public/crm.html carries screen markup in <script type="text/plain">
      // data islands; parsing those as JS reports twenty-one failures that are
      // not failures, which is worse than having no linter at all.
      const type = (open.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
      const isJs = !type || /^(module|text\/javascript|application\/javascript|text\/ecmascript)$/i.test(type);
      if (!isJs) return;
      const body = block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
      if (!body.trim()) return;
      checked++;
      try {
        // Wrapped, because a top-level `return` is legal inside the IIFEs these
        // screens use and is a syntax error at the top level of a check.
        new Function(body);
      } catch (e) {
        failures.push(file.replace(ROOT, "") + " (inline script " + (i + 1) + ")\n  " + e.message);
      }
    });
  }
}

if (failures.length) {
  console.error("lint: " + failures.length + " file(s) failed to parse\n");
  failures.forEach((f) => console.error("  " + f + "\n"));
  process.exit(1);
}
console.log("lint: " + checked + " file(s) and inline script(s) parse clean");

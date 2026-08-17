import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, "../..");
export const SCRAPE_DIR = path.join(ROOT, "credentials/notion-scrape");
export const PROFILE_DIR = path.join(SCRAPE_DIR, "profile");
export const OUTPUT_DIR = path.join(SCRAPE_DIR, "output");
export const START_URL_FILE = path.join(SCRAPE_DIR, "start-url.txt");

export function slugify(title) {
  return (title || "untitled")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "untitled";
}

/** Last 32 hex chars in a Notion page URL (stable id). */
export function pageIdFromUrl(url) {
  const compact = url.split("?")[0].replace(/-/g, "");
  const match = compact.match(/([0-9a-f]{32})$/i);
  return match ? match[1].toLowerCase() : null;
}

export function folderNameForPage(title, url) {
  const id = pageIdFromUrl(url);
  const base = slugify(title);
  return id ? `${base}--${id.slice(0, 8)}` : base;
}

export function isNotionPageUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname;
    const okHost =
      host === "www.notion.so" ||
      host === "notion.so" ||
      host === "app.notion.com" ||
      host.endsWith(".notion.site");
    return (
      okHost &&
      !url.includes("/login") &&
      !url.includes("marketplace") &&
      !u.hash
    );
  } catch {
    return false;
  }
}

/** Match notion page links in browser DOM queries. */
export const NOTION_HREF_SELECTOR =
  'a[href*="notion.so"], a[href*="notion.site"], a[href*="app.notion.com"]';

export function normalizeUrl(url) {
  return url.split("?")[0].split("#")[0];
}

export function walkOutputDirs(base = OUTPUT_DIR) {
  if (!fs.existsSync(base)) return [];
  const dirs = [];
  for (const name of fs.readdirSync(base)) {
    const dir = path.join(base, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    if (!fs.existsSync(path.join(dir, "meta.json"))) continue;
    dirs.push(dir);
  }
  return dirs.sort();
}

export function readMeta(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
}

export function writeMeta(dir, meta) {
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
}

export async function fileExists(p) {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

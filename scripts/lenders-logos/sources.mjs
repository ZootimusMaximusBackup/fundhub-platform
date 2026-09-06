/**
 * Where a bank logo comes from, and how we refuse a bad one.
 *
 * Plain English: we go to the bank's own website and take the picture the bank
 * put there for phone home screens. That picture is the real brand mark. If the
 * bank has no such picture we fall back to the small icon in the browser tab.
 * If even that is missing, or the picture turns out to be junk, we write nothing
 * and report the bank as still missing. A wrong logo is worse than a blank one.
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Pictures we have already caught being wrong. These are the exact images the
 * old run wrote onto banks they do not belong to:
 *   - a generic blue grid that a website builder ships as its default icon
 *   - the AngularJS logo, which is a programming tool, not a bank
 *   - one real bank's mark that got copied onto four unrelated banks
 *   - two 16-pixel blobs too small to read
 * If a download matches one of these, we throw it away.
 */
export const REJECTED_IMAGE_HASHES = new Set([
  "5cc57498259fe770812b06a94c578b55", // generic blue grid, was on 11 banks
  "9364a8b6a282a3a46f09c3f5166de3b8", // AngularJS logo, was on 5 banks
  "9593462e30722e6310c93b23576a6467", // one valley bank's mark, was on 5 banks
  "c5de9477c2fad49657526b08ca5b307b", // green globe blob, 16 pixels
  "a6508aba3c642cea6007ccc9463f45d2" // gold diamond blob, 16 pixels
]);

/** Below this many pixels a logo is a smudge, not a mark. */
export const MIN_SOURCE_PIXELS = 64;

/** What we save. Square, and never blown up past what we downloaded. */
export const OUTPUT_PIXELS = 256;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** @param {number} ms */
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fetch with a timeout so one dead bank site cannot stall the whole run.
 * @param {string} url
 * @param {{ timeoutMs?: number, accept?: string }} [opts]
 */
async function get(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15000);
  try {
    return await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": UA, accept: opts.accept ?? "*/*" }
    });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Read the bank's home page and pull out every picture it offers as its icon,
 * best first. Also brings back proof of whose page it is: the page title, the
 * words on the page, and the address the site ended up at after any forwarding.
 * @param {string} domain
 * @returns {Promise<{ ok: boolean, title: string|null, text: string, finalHost: string|null, blocked?: boolean, candidates: string[], reason?: string }>}
 */
export async function readSiteIcons(domain) {
  const host = String(domain || "").replace(/^www\./, "");
  if (!host) {
    return { ok: false, title: null, text: "", finalHost: null, candidates: [], reason: "no_domain" };
  }

  let sawBlock = false;
  for (const base of [`https://www.${host}`, `https://${host}`]) {
    let html = "";
    let finalUrl = base;
    try {
      const res = await get(base, { accept: "text/html" });
      finalUrl = res.url || base;
      if (!res.ok) {
        // 403 means a bot filter, not a dead bank. The domain is live and owned.
        if (res.status === 403 || res.status === 406 || res.status === 429) sawBlock = true;
        continue;
      }
      html = (await res.text()).slice(0, 400000);
    } catch {
      continue;
    }
    if (!html) continue;

    const title = (html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i)?.[1] || "")
      .replace(/\s+/g, " ")
      .trim();

    // Everything a human would read on the page, so a bank named only in the
    // small print at the bottom still counts as proof.
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .slice(0, 200000);

    let finalHost = null;
    try {
      finalHost = new URL(finalUrl).hostname.replace(/^www\./, "");
    } catch {
      /* leave null */
    }

    /** @type {{ url: string, rank: number, size: number }[]} */
    const found = [];
    const linkTags = html.match(/<link\b[^>]*>/gi) || [];
    for (const tag of linkTags) {
      const rel = (tag.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1] || "").toLowerCase();
      const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
      if (!href || !rel) continue;
      const sizes = tag.match(/\bsizes\s*=\s*["'](\d+)x\d+["']/i)?.[1];
      const size = sizes ? Number(sizes) : 0;
      // Apple's home-screen icon is the bank's real mark at a usable size.
      if (/apple-touch-icon/.test(rel)) found.push({ url: href, rank: 1, size: size || 180 });
      else if (/(^|\s)icon(\s|$)|shortcut icon|mask-icon/.test(rel)) {
        found.push({ url: href, rank: 3, size });
      }
    }
    // Deliberately NOT used: the site's social-sharing picture. On a bank site
    // that is almost always a photograph — a city skyline, a person at a laptop
    // — and saving one puts a stock photo where the logo should be. Two banks
    // got exactly that on the first run.

    // The logo the bank actually shows at the top of its own page. Many smaller
    // banks publish nothing but a tiny tab icon, and this is the only place
    // their real mark appears.
    for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
      const src =
        tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] ||
        tag.match(/\bdata-src\s*=\s*["']([^"']+)["']/i)?.[1];
      if (!src) continue;
      const hay = tag.toLowerCase();
      if (!/logo|brand|wordmark/.test(hay)) continue;
      // Skip the tiny decorations that also carry the word "logo".
      if (/sprite|placeholder|icon-|-icon\.|social|facebook|twitter|linkedin|instagram|youtube|equal.?housing|fdic|member/.test(hay)) {
        continue;
      }
      // Skip award stickers. Banks put "Best Bank 2026" badges in their header
      // and tag them as logos. Two banks ended up with a Forbes award sticker
      // instead of their own mark on the first run.
      if (/award|badge|best.?in.?state|best.?bank|forbes|usatoday|usa.?today|newsweek|ranked|winner|accolade|top.?work|seal/.test(hay)) {
        continue;
      }
      // Skip big marketing pictures and half-built test sites. Banks name these
      // things "hero", "subhero" or "banner", and a staging address is a copy of
      // the site that is not live — neither is the bank's mark.
      if (/hero|banner|slider|carousel|staging|\.dev\.|placeholder/.test(hay)) continue;
      found.push({ url: src, rank: 2, size: 0 });
    }

    found.sort((a, b) => a.rank - b.rank || b.size - a.size);

    const seen = new Set();
    /** @type {string[]} */
    const candidates = [];
    for (const f of found) {
      let abs;
      try {
        abs = new URL(f.url, finalUrl).href;
      } catch {
        continue;
      }
      if (/\.svg(\?|$)/i.test(abs)) continue; // we save PNG on disk, not vector
      if (seen.has(abs)) continue;
      seen.add(abs);
      candidates.push(abs);
    }
    // Almost every site serves this path even when it is not in the HTML.
    candidates.push(new URL("/apple-touch-icon.png", finalUrl).href);
    // Last resort: the tiny tab icon, asked for at the largest size available.
    candidates.push(
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=256`
    );

    return { ok: true, title: title || null, text, finalHost, candidates };
  }

  // The site would not hand over its HTML. If that was a bot filter rather than
  // a dead domain, we can still ask for the icon directly.
  if (sawBlock) {
    return {
      ok: true,
      title: null,
      text: "",
      finalHost: host,
      blocked: true,
      candidates: [
        `https://www.${host}/apple-touch-icon.png`,
        `https://www.${host}/apple-touch-icon-precomposed.png`,
        `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=256`
      ]
    };
  }
  return { ok: false, title: null, text: "", finalHost: null, candidates: [], reason: "site_unreachable" };
}

/** Words that appear in half the bank names in America and prove nothing. */
const GENERIC_WORDS = new Set([
  "the", "bank", "banks", "of", "and", "national", "state", "trust", "company",
  "co", "inc", "financial", "savings", "federal", "credit", "union", "group",
  "banking", "corp", "association", "n", "a"
]);

/** @param {string} s */
function distinctiveWords(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !GENERIC_WORDS.has(w));
}

/** @param {string} s */
function squashed(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Is this really the bank we asked for?
 *
 * Three checks, in order:
 *   1. Did the address forward somewhere else? A bank site that forwards to a
 *      different bank has been bought. We refuse — the logo there belongs to
 *      the buyer, not to the bank on the row.
 *   2. Do the bank's own distinctive words appear anywhere on the page,
 *      including the small print at the bottom? That is a pass.
 *   3. Did the page hand us no readable words at all? Some bank sites draw
 *      themselves with code, so there is nothing to read. We accept those on
 *      the strength of the web address alone and label them unconfirmed, so
 *      they can be eyeballed.
 *
 * @param {string} bankName
 * @param {{ title: string|null, text: string, finalHost: string|null, blocked?: boolean }} site
 * @param {string} requestedDomain
 */
export function siteBelongsToBank(bankName, site, requestedDomain) {
  const want = distinctiveWords(bankName);
  const asked = squashed(String(requestedDomain).replace(/\.[a-z.]+$/, ""));
  const landed = squashed(String(site.finalHost || "").replace(/\.[a-z.]+$/, ""));

  // 1. Forwarded to a different company's website.
  if (landed && asked && landed !== asked && !landed.includes(asked) && !asked.includes(landed)) {
    return {
      ok: false,
      confirmed: false,
      reason: `${requestedDomain} now forwards to ${site.finalHost} — this bank was bought, and that logo belongs to the buyer`
    };
  }

  // 2. The bank names itself somewhere on its own page.
  const haystack = squashed(`${site.title || ""} ${site.text}`);
  if (want.length && haystack) {
    const hits = want.filter((w) => haystack.includes(w)).length;
    if (hits / want.length >= 0.5) return { ok: true, confirmed: true, reason: "the page names this bank" };
  }

  // 3. Nothing readable came back, so the web address is all we have to go on.
  const noWordsToRead = !site.text || site.text.length < 400 || site.blocked;
  if (noWordsToRead) {
    const domainHits = want.filter((w) => asked.includes(w)).length;
    if (want.length && domainHits / want.length >= 0.5) {
      return {
        ok: true,
        confirmed: false,
        reason: site.blocked
          ? "the site blocks automated visits, so this was matched on the web address only — worth a human look"
          : "the site draws itself with code and had no readable words, so this was matched on the web address only — worth a human look"
      };
    }
  }

  return {
    ok: false,
    confirmed: false,
    reason: `the page at ${requestedDomain} never says "${bankName}" — its title reads "${site.title || "(none)"}"`
  };
}

/**
 * Did the saved picture come out blank?
 *
 * Some banks publish their logo in white, meant to sit on a dark strip at the
 * top of their page. Saved on a white square, a white logo is an empty box. We
 * shrink the saved file to a tiny grid, look at the actual colours, and if
 * nearly every dot is the same colour we call it blank and throw it away.
 *
 * The shrink uses `sips` and reads the result as a plain uncompressed bitmap,
 * so this needs no extra software.
 * @param {string} pngAbs
 */
export function looksBlank(pngAbs) {
  const probe = `${pngAbs}.probe.bmp`;
  try {
    execFileSync("sips", ["-s", "format", "bmp", "-z", "16", "16", pngAbs, "--out", probe], {
      stdio: ["ignore", "ignore", "ignore"]
    });
    const bmp = fs.readFileSync(probe);
    const start = bmp.readUInt32LE(10); // where the pixel data begins
    const counts = new Map();
    let total = 0;
    for (let i = start; i + 2 < bmp.length; i += 3) {
      // Bucket colours coarsely so a soft gradient does not read as detail.
      const key = `${bmp[i] >> 5},${bmp[i + 1] >> 5},${bmp[i + 2] >> 5}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      total++;
    }
    if (!total) return false;
    // A real logo puts ink on a good part of the square. If more than nine in
    // ten dots are the same colour, there is almost nothing there to see —
    // usually a white logo saved onto a white background.
    const biggest = Math.max(...counts.values());
    return biggest / total > 0.9;
  } catch {
    return false; // if we cannot check, do not throw away a good file
  } finally {
    fs.rmSync(probe, { force: true });
  }
}

/**
 * Download one picture and, if it is a real usable image, save it as a PNG.
 * Uses the macOS `sips` tool that ships with the machine, so this adds no new
 * software to the project.
 * @param {string} url
 * @param {string} destAbs
 * @returns {Promise<{ ok: boolean, reason: string, bytes?: number, width?: number, height?: number, source?: string }>}
 */
export async function saveImage(url, destAbs) {
  let buf;
  try {
    const res = await get(url, { accept: "image/*" });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const ct = res.headers.get("content-type") || "";
    if (/text\/html/i.test(ct)) return { ok: false, reason: "got_a_web_page_not_an_image" };
    buf = Buffer.from(await res.arrayBuffer());
  } catch {
    return { ok: false, reason: "download_failed" };
  }
  if (buf.length < 300) return { ok: false, reason: "file_too_small_to_be_a_logo" };

  const hash = crypto.createHash("md5").update(buf).digest("hex");
  if (REJECTED_IMAGE_HASHES.has(hash)) return { ok: false, reason: "known_wrong_picture" };

  const tmp = `${destAbs}.download`;
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  fs.writeFileSync(tmp, buf);

  /** @type {{ width: number, height: number }} */
  let dim;
  try {
    const out = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", tmp], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    dim = {
      width: Number(out.match(/pixelWidth:\s*(\d+)/)?.[1] || 0),
      height: Number(out.match(/pixelHeight:\s*(\d+)/)?.[1] || 0)
    };
  } catch {
    fs.rmSync(tmp, { force: true });
    return { ok: false, reason: "not_a_readable_image" };
  }

  if (!dim.width || !dim.height) {
    fs.rmSync(tmp, { force: true });
    return { ok: false, reason: "not_a_readable_image" };
  }
  if (Math.max(dim.width, dim.height) < MIN_SOURCE_PIXELS) {
    fs.rmSync(tmp, { force: true });
    return { ok: false, reason: `too_small_${dim.width}x${dim.height}` };
  }

  // Convert to PNG. Shrink a big picture down; never stretch a small one up.
  // A wide banner-shaped logo gets white space added at top and bottom so every
  // file on disk is the same square shape and the tiles line up on screen.
  const target = Math.min(OUTPUT_PIXELS, Math.max(dim.width, dim.height));
  try {
    execFileSync(
      "sips",
      [
        "-s", "format", "png",
        "-Z", String(target),
        "--padToHeightWidth", String(target), String(target),
        "--padColor", "FFFFFF",
        tmp, "--out", destAbs
      ],
      { stdio: ["ignore", "ignore", "ignore"] }
    );
  } catch {
    fs.rmSync(tmp, { force: true });
    return { ok: false, reason: "could_not_convert_to_png" };
  }
  fs.rmSync(tmp, { force: true });

  if (!fs.existsSync(destAbs)) return { ok: false, reason: "nothing_written" };

  if (looksBlank(destAbs)) {
    fs.rmSync(destAbs, { force: true });
    return { ok: false, reason: "came_out_blank" };
  }

  const finalHash = crypto.createHash("md5").update(fs.readFileSync(destAbs)).digest("hex");
  if (REJECTED_IMAGE_HASHES.has(finalHash)) {
    fs.rmSync(destAbs, { force: true });
    return { ok: false, reason: "known_wrong_picture" };
  }

  return {
    ok: true,
    reason: "saved",
    bytes: fs.statSync(destAbs).size,
    width: dim.width,
    height: dim.height,
    source: url
  };
}

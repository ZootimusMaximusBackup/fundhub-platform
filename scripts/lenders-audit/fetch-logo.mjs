import fs from "node:fs";
import path from "node:path";

/**
 * @param {string} domain e.g. chase.com
 * @param {string} destAbs absolute path to write png
 */
export async function fetchLogoForDomain(domain, destAbs) {
  if (!domain) return { ok: false, reason: "no_domain" };
  const clean = domain.replace(/^www\./, "");
  const sources = [
    `https://logo.clearbit.com/${clean}`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(clean)}&sz=128`
  ];

  for (const src of sources) {
    try {
      const res = await fetch(src, {
        redirect: "follow",
        headers: { "user-agent": "FundhubLenderAudit/1.0" }
      });
      if (!res.ok) continue;
      const ct = res.headers.get("content-type") || "";
      if (!/image\//i.test(ct) && !src.includes("favicons")) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 200) continue;
      fs.mkdirSync(path.dirname(destAbs), { recursive: true });
      fs.writeFileSync(destAbs, buf);
      return { ok: true, source: src, bytes: buf.length };
    } catch {
      /* try next */
    }
  }
  return { ok: false, reason: "logo_fetch_failed" };
}

/** @param {string|null|undefined} url */
export function domainFromUrl(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

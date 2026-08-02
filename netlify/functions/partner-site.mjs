// Serves published partner funnel pages.
//
//   /sites/:partnerId/:slug  — always-on path on the Netlify site
//   Host = verified custom domain, path /:slug (or / → apply)
//
// Drafts are never served. No auth — these are public marketing pages.

import { db } from "../../src/db.mjs";
import { loadPublishedPage, renderPartnerPageHtml } from "../../src/brand/partner-site.mjs";

const MAIN_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "fundhub.ai",
  "www.fundhub.ai",
  "transcendent-wisp-888771.netlify.app"
]);

function parsePath(rawPath) {
  const path = String(rawPath || "/").split("?")[0];
  const sites = path.match(
    /(?:^\/sites\/|^\/\.netlify\/functions\/partner-site\/)([0-9a-f-]{36})\/([a-z0-9][a-z0-9-]{0,62})\/?$/i
  );
  if (sites) return { mode: "sites", partnerId: sites[1], slug: sites[2].toLowerCase() };
  const bare = path.match(/^\/([a-z0-9][a-z0-9-]{0,62})\/?$/i);
  if (bare) return { mode: "host", slug: bare[1].toLowerCase() };
  if (path === "/" || path === "") return { mode: "host", slug: "apply" };
  return { mode: "unknown" };
}

function hostOf(event) {
  const h = (event.headers && (event.headers.host || event.headers.Host)) || "";
  return String(h).toLowerCase().split(":")[0];
}

export async function handler(event) {
  const host = hostOf(event);
  let rawPath = event.path || "/";
  try {
    if (event.rawUrl) rawPath = new URL(event.rawUrl).pathname;
  } catch { /* keep event.path */ }
  // Netlify 200-rewrite to the function name alone leaves the browser path in
  // x-forwarded-url / referer less reliably than rawUrl — also try query.
  const q = event.queryStringParameters || {};
  const parsed = (q.partner_id && q.slug)
    ? { mode: "sites", partnerId: q.partner_id, slug: String(q.slug).toLowerCase() }
    : parsePath(rawPath);

  let loaded = null;
  try {
    if (parsed.mode === "sites") {
      loaded = await loadPublishedPage(db, {
        partnerId: parsed.partnerId,
        slug: parsed.slug
      });
    } else if (parsed.mode === "host" && host && !MAIN_HOSTS.has(host) && !host.endsWith(".netlify.app")) {
      loaded = await loadPublishedPage(db, { host, slug: parsed.slug });
    }
  } catch (err) {
    console.error("[partner-site]", err?.message || err);
    return {
      statusCode: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: "page unavailable"
    };
  }

  if (!loaded) {
    return {
      statusCode: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: "<!doctype html><title>Not found</title><p>This page is not published.</p>"
    };
  }

  return {
    statusCode: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=60"
    },
    body: renderPartnerPageHtml(loaded)
  };
}

export const config = {
  path: ["/sites/*", "/sites/*/"]
};

export default handler;

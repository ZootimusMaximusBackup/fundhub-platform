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

export function parsePath(rawPath) {
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

function hostOf(request) {
  if (request?.headers?.get) {
    return String(request.headers.get("host") || "").toLowerCase().split(":")[0];
  }
  const h = (request?.headers && (request.headers.host || request.headers.Host)) || "";
  return String(h).toLowerCase().split(":")[0];
}

function pathOf(request) {
  try {
    if (request?.url) return new URL(request.url).pathname || "/";
  } catch { /* fall through */ }
  if (request?.rawUrl) {
    try { return new URL(request.rawUrl).pathname || "/"; } catch { /* fall through */ }
  }
  return request?.path || "/";
}

function html(status, body, extra = {}) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...extra }
  });
}

export async function handler(request) {
  const host = hostOf(request);
  const rawPath = pathOf(request);
  let parsed;
  try {
    const url = request?.url ? new URL(request.url) : null;
    const partnerId = url?.searchParams.get("partner_id");
    const slug = url?.searchParams.get("slug");
    parsed = (partnerId && slug)
      ? { mode: "sites", partnerId, slug: String(slug).toLowerCase() }
      : parsePath(rawPath);
  } catch {
    parsed = parsePath(rawPath);
  }

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
    return html(500, "<!doctype html><title>Unavailable</title><p>page unavailable</p>");
  }

  if (!loaded) {
    return html(404, "<!doctype html><title>Not found</title><p>This page is not published.</p>");
  }

  try {
    return html(200, renderPartnerPageHtml(loaded), {
      "cache-control": "public, max-age=60"
    });
  } catch (err) {
    console.error("[partner-site] render", err?.message || err);
    return html(500, "<!doctype html><title>Unavailable</title><p>page unavailable</p>");
  }
}

export const config = {
  path: ["/sites/*", "/sites/*/"]
};

export default handler;

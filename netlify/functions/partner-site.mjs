// Serves published partner funnel pages.
//
//   /sites/:partnerId/:slug  — always-on path on the Netlify site
//   Host = verified custom domain, path /:slug (or / → apply)
//
// Drafts are never served. No auth — these are public marketing pages.
//
// Because there is no auth, every miss answers with the SAME bytes. See
// NOT_LIVE_HTML below.

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

/* ONE MISS PAGE, FOR ALL THREE MISSES, ON PURPOSE. (T10-01, 2026-08-19)
 *
 * Three different things land here: there is no such partner, there is such a
 * partner but no such page, and there IS a page at this exact address but it is
 * a draft. The old body — "This page is not published." — told a partner none of
 * that, and the audit on 2026-08-18 caught a real partner clicking their own
 * Home link into it with no idea why.
 *
 * WE STILL DO NOT TELL THEM APART, AND THAT IS THE DECISION. This endpoint is
 * public and unauthenticated. Anything that answers "a draft exists here" has
 * just told an anonymous visitor that this partner id is real — the same oracle
 * as answering "no such partner", only politer. Somebody walking uuids would
 * learn which ones belong to real partners, and that is a customer list. So
 * every miss gets these identical bytes, and no extra database lookup is made
 * to decide (a second query for "is it a draft?" would leak the same fact
 * through response time even if the body never changed).
 *
 * The partner is not left in the dark: the copy below names the draft case, and
 * their Home banner in public/app/partner-galaxy.html now reads their own page
 * list — where they ARE signed in and it is their own data — and says "draft,
 * not live yet" before they ever click. Useful message to the owner, no oracle
 * for the internet. Privacy was the tie-breaker; see the T10 report. */
export const NOT_LIVE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Not found</title></head>
<body style="font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;max-width:34rem;margin:12vh auto;padding:0 1.5rem;color:#111">
<h1 style="font-size:1.35rem;margin:0 0 .75rem">Nothing is live at this web address</h1>
<p>There is no published page here.</p>
<p><strong>If this is meant to be your page:</strong> a page you have saved but not
published is a <em>draft</em>, and a draft is never shown to the public. Sign in to
Fundhub, open <strong>Brand Studio</strong>, and press <strong>Publish</strong>. This
address starts working the moment you do.</p>
<p style="opacity:.65;font-size:.9rem">Every address that is not live shows this same
page, so nobody can use it to work out which partners exist.</p>
</body></html>`;

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

  // Identical for "no such partner", "no such slug" and "it is a draft" — see
  // NOT_LIVE_HTML above for why that sameness is the security property.
  if (!loaded) return html(404, NOT_LIVE_HTML);

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

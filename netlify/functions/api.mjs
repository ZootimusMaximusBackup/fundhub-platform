// Netlify adapter for the platform's Vercel-style api/ handlers.
//
// One function serves every /api/* path (config.path below). It builds a
// minimal (req, res) pair around the Web Request, calls the exact same
// handler module Vercel would, and converts the captured result into a
// Response. Handlers here only ever use res.status().json() / setHeader /
// end, so the shim implements that surface plus send() for safety.
//
// Zero changes to the handlers themselves — this file is the only
// Netlify-specific code in the repo.

import { safeError } from "../../src/http/health.mjs";
import authLogin from "../../api/auth/login.mjs";
import authLogout from "../../api/auth/logout.mjs";
import authSession from "../../api/auth/session.mjs";
import tasks from "../../api/tasks.mjs";
import inquiry from "../../api/inquiry.mjs";
import dashClients from "../../api/dashboard/clients.mjs";
import dashClient from "../../api/dashboard/client.mjs";
import dashPipeline from "../../api/dashboard/pipeline.mjs";
import dashSeed from "../../api/dashboard/seed.mjs";
import health from "../../api/health.mjs";
import partnerBrand from "../../api/partner-brand.mjs";
import webhooks from "../../api/webhooks/[provider].mjs";
import readCommissions from "../../api/read/commissions.mjs";
import readInvoices from "../../api/read/invoices.mjs";
import readDocuments from "../../api/read/documents.mjs";
import readFundingRounds from "../../api/read/funding-rounds.mjs";
import readAffiliates from "../../api/read/affiliates.mjs";
import readPartners from "../../api/read/partners.mjs";
import readMessageTemplates from "../../api/read/message-templates.mjs";
import readStaff from "../../api/read/staff.mjs";
import readEntitlements from "../../api/read/entitlements.mjs";
import readFailedEvents from "../../api/read/failed-events.mjs";
import readAgents from "../../api/read/agents.mjs";
import readInquiries from "../../api/read/inquiries.mjs";
import readProducts from "../../api/read/products.mjs";
import { webHandler as inngestWeb } from "../../api/inngest.mjs";

export const config = { path: "/api/*" };

const ROUTES = {
  "auth/login": authLogin,
  "auth/logout": authLogout,
  "auth/session": authSession,
  "tasks": tasks,
  "inquiry": inquiry,
  "dashboard/clients": dashClients,
  "dashboard/client": dashClient,
  "dashboard/pipeline": dashPipeline,
  "dashboard/seed": dashSeed,
  "health": health,
  "partner-brand": partnerBrand,
  "read/commissions": readCommissions,
  "read/invoices": readInvoices,
  "read/documents": readDocuments,
  "read/funding-rounds": readFundingRounds,
  "read/affiliates": readAffiliates,
  "read/partners": readPartners,
  "read/message-templates": readMessageTemplates,
  "read/staff": readStaff,
  "read/entitlements": readEntitlements,
  "read/failed-events": readFailedEvents,
  "read/agents": readAgents,
  "read/inquiries": readInquiries,
  "read/products": readProducts
};

/* A NUL byte anywhere in a query value makes Postgres raise
   "invalid byte sequence for encoding UTF8: 0x00" from inside whatever query
   the value reached, which surfaced as a 500 quoting the driver. Postgres text
   cannot hold a NUL at all, so no handler downstream could ever have done
   anything useful with one — reject it here, once, as the bad request it is. */
function hasNul(s) {
  if (typeof s !== "string") return false;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 0) return true;
  return false;
}

function toQueryObject(searchParams) {
  // null-prototype: a key like "constructor" or "toString" must be absent, not
  // inherited. See the ROUTES lookup below for why that matters.
  const q = Object.create(null);
  for (const [k, v] of searchParams.entries()) q[k] = v;
  return q;
}

// routePath — the handler key for a request URL. The function can be reached
// two ways: directly on /api/* via config.path above, or on
// /.netlify/functions/api/* when netlify.toml's rewrite is what routed it.
// Both must reduce to the same key ("auth/session"), or the rewrite path
// 404s on every route.
function routePath(pathname) {
  return pathname
    .replace(/^\/\.netlify\/functions\/api\/?/, "")
    .replace(/^\/api\/?/, "")
    .replace(/\/+$/, "");
}

export default async function handler(request, context) {
  const url = new URL(request.url);
  const path = routePath(url.pathname);

  /* /api/inngest is served by Inngest's own Web-standard handler, which takes a
     Request and returns a Response. It must NOT go through the (req, res) shim
     below: inngest/node's serve() reads the body as a stream and throws on the
     plain object the shim provides, which is why this endpoint 500'd on every
     POST and PUT even once it was routed. */
  if (path === "inngest") return inngestWeb(request);

  /* OWN properties only. `ROUTES[path]` walked the prototype chain, so
     /api/constructor, /api/toString, /api/valueOf, /api/hasOwnProperty and
     /api/__proto__ all resolved to a "route" — Object.prototype members — and
     answered 500 to an UNAUTHENTICATED caller instead of 404. */
  let route = Object.prototype.hasOwnProperty.call(ROUTES, path) ? ROUTES[path] : undefined;
  const query = toQueryObject(url.searchParams);

  // /api/webhooks/:provider → the existing [provider].mjs with req.query.provider
  if (!route && path.startsWith("webhooks/")) {
    route = webhooks;
    query.provider = path.slice("webhooks/".length);
  }

  if (!route) {
    return new Response(JSON.stringify({ ok: false, error: "not_found", path }), {
      status: 404,
      headers: { "content-type": "application/json" }
    });
  }

  // Reject NUL bytes once, here, rather than letting each handler discover them
  // as a Postgres encoding error mid-query.
  for (const k of Object.keys(query)) {
    if (hasNul(query[k]) || hasNul(k)) {
      return new Response(
        JSON.stringify({ ok: false, error: "invalid_parameter", param: hasNul(k) ? undefined : k }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }
  }

  // ---- build req ----------------------------------------------------------
  const headers = {};
  for (const [k, v] of request.headers.entries()) headers[k.toLowerCase()] = v;

  const rawBody = ["GET", "HEAD"].includes(request.method) ? "" : await request.text();
  let body = rawBody;
  const ctype = headers["content-type"] || "";
  if (rawBody && ctype.includes("application/json")) {
    try { body = JSON.parse(rawBody); } catch { body = rawBody; }
  }

  const ip =
    context?.ip ||
    headers["x-nf-client-connection-ip"] ||
    (headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    null;

  const req = {
    method: request.method,
    url: url.pathname + url.search,
    headers,
    query,
    body,
    rawBody,
    socket: { remoteAddress: ip }
  };

  // ---- build res ----------------------------------------------------------
  let resolve;
  const done = new Promise((r) => (resolve = r));
  const res = {
    statusCode: 200,
    _headers: { "content-type": "application/json" },
    _finished: false,
    status(code) { this.statusCode = code; return this; },
    setHeader(k, v) { this._headers[String(k).toLowerCase()] = v; return this; },
    getHeader(k) { return this._headers[String(k).toLowerCase()]; },
    json(obj) { this._finish(JSON.stringify(obj)); },
    send(data) { this._finish(typeof data === "string" ? data : JSON.stringify(data)); },
    end(data) { this._finish(data ?? ""); },
    _finish(payload) {
      if (this._finished) return;
      this._finished = true;
      resolve(new Response(payload, { status: this.statusCode, headers: this._headers }));
    }
  };

  try {
    await route(req, res);
    // A handler that returned without writing gets a clean 500, not a hang.
    if (!res._finished) res.status(500).json({ ok: false, error: "handler_no_response" });
  } catch (err) {
    if (!res._finished) {
      // err.message quotes the DSN on a connection failure, so an
      // UNAUTHENTICATED caller could read the database host, port and username
      // straight out of a 500 body — POST /api/auth/login with the database
      // down was enough. Scrub it the same way health.mjs does.
      res.status(500).json({ ok: false, error: "internal_error", message: safeError(err) });
    }
  }
  return done;
}

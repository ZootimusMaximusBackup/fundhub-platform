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
//
// THIS FILE IS A ROUTING TABLE, AND A ROUTING TABLE IS A PLACE THINGS GET LOST.
// Twice now a feature has been built end to end — handler, service module, tests,
// migration — and then never reached a caller, because nobody added the one line
// here. AUDIT-FINDINGS.md records the first: /api/inngest was absent, so all 47
// workflow functions were unreachable while the operator was told the only
// remaining gate was an unset key. The lesson it draws — "a structural check can
// pass over a half-dead feature" — is exactly right, and it recurred: 21 handler
// files under api/ were missing from ROUTES and answered 404 on every method, on
// the deploy target AND under scripts/dev-server.mjs, which proxies /api/*
// through this same module.
//
// So ROUTES and routePath are EXPORTED, and src/http/routes.test.mjs walks api/
// on disk and fails if a handler file is neither routed nor on its explicit,
// commented ALLOWED-UNROUTED list. That test is the actual fix; the entries below
// are just this round's backlog. Adding a file under api/ now breaks the build
// until someone decides, in writing, whether it is reachable.

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
import readConversations from "../../api/read/conversations.mjs";
import readTradelines from "../../api/read/tradelines.mjs";
import readFinanceOs from "../../api/read/finance-os.mjs";
import readBankingSurface from "../../api/read/banking-surface.mjs";
import readMoneyMap from "../../api/read/money-map.mjs";
import bankingSyncAccounts from "../../api/banking/sync-accounts.mjs";
import inquiries from "../../api/inquiries.mjs";
import pii from "../../api/pii.mjs";
import shifts from "../../api/shifts.mjs";
import campaignsList from "../../api/campaigns/list.mjs";
import campaignsDetail from "../../api/campaigns/detail.mjs";
import campaignsSpend from "../../api/campaigns/spend.mjs";
import campaignsFatigue from "../../api/campaigns/fatigue.mjs";
import campaignsConnections from "../../api/campaigns/connections.mjs";
import campaignsActionLog from "../../api/campaigns/action-log.mjs";
import creativeLibrary from "../../api/creative/library.mjs";
import creativeBrandKits from "../../api/creative/brand-kits.mjs";
import creativeJobs from "../../api/creative/jobs.mjs";
import creativeApprovals from "../../api/creative/approvals.mjs";
import hiringCandidates from "../../api/hiring/candidates.mjs";
import hiringApplication from "../../api/hiring/application.mjs";
import hiringPostings from "../../api/hiring/postings.mjs";
import hiringDecisions from "../../api/hiring/decisions.mjs";
import hiringFunnel from "../../api/hiring/funnel.mjs";
import hiringBench from "../../api/hiring/bench.mjs";
import financeSoftPull from "../../api/finance/soft-pull.mjs";
import bankingRevoke from "../../api/banking/revoke.mjs";
import privacyErasure from "../../api/privacy/erasure.mjs";
import { webHandler as inngestWeb } from "../../api/inngest.mjs";
import documentById from "../../api/documents/[id].mjs";

export const config = { path: "/api/*" };

/* The key is the path minus the leading /api/ — "read/products" serves
   /api/read/products. Exported so src/http/routes.test.mjs can diff it against
   the api/ directory; nothing at runtime reads it from outside this module. */
export const ROUTES = {
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
  "read/products": readProducts,
  "read/conversations": readConversations,

  // read/tradelines was held out of this map by the routing pass because
  // api/read/tradelines.mjs declared a role gate it did not get: it passed
  // { roles: ROLE_SETS.STAFF } as requireAuth's third argument, which is
  // { db, env }, so the key was dropped and any authenticated staff session of
  // any role could read a named client's credit limits and balances. That is
  // now a real requireRole() call in the handler, and the entry it was blocking
  // is here. Routed and gated in the same pass, deliberately — routing it
  // first would have shipped the hole, and fixing it without routing would have
  // left the Closer Dashboard's live mode 404ing against a working endpoint.
  "read/tradelines": readTradelines,

  // read/finance-os summarises the same rows read/tradelines serves, so it
  // carries the same ROLE_SETS.STAFF gate — gating the summary more tightly
  // than the detail would buy nothing, since anyone refused here can read the
  // underlying lines next door and add them up. Routed in the same commit as
  // the handler and the screen: a screen whose endpoint 404s is the failure
  // this map exists to prevent, and it has shipped twice.
  "read/finance-os": readFinanceOs,

  // read/banking-surface is the cash companion to read/finance-os and carries
  // the same ROLE_SETS.STAFF gate. Bank balances are no more sensitive than the
  // credit limits read/tradelines already serves to that set, and splitting the
  // gate would leave a closer able to see a client's cards but not their cash
  // while working the same file. Routed in the same commit as the handler and
  // the screen.
  "read/banking-surface": readBankingSurface,

  // read/money-map gathers what read/finance-os, read/banking-surface and
  // read/tradelines already serve, plus card_liabilities, recurring_bills and
  // cashflow_reminders, into the one screen an owner opens for a client. Same
  // ROLE_SETS.STAFF gate as its three neighbours — it exposes nothing they do
  // not, and splitting the gate would leave a closer able to read the parts but
  // not the summary of the file they are working.
  //
  // It is the only one of the four that also scopes on the SESSION'S org and
  // refuses a session with no org at all. Routed in the same commit as the
  // handler and the screen: a screen whose endpoint 404s is the exact failure
  // this map exists to prevent, and it has shipped twice.
  "read/money-map": readMoneyMap,

  // banking/sync-accounts is the FIRST WRITER `bank_accounts` has ever had —
  // until it, the only INSERT into that table in the whole repository was inside
  // a pg test, and every bank-derived section of the Money Map was empty with no
  // way to fill it.
  //
  // ROLE_SETS.FINANCE — {owner, admin} — NOT the STAFF set its read neighbours
  // use, and deliberately narrower: this one creates the financial rows those
  // screens total. Reading a balance and conjuring one are different powers.
  //
  // The provider is always named by the caller; there is no default, because a
  // default is how a mock ends up running in production. The mock provider is
  // additionally gated on BANKING_MOCK_PROVIDER=1 and every row it writes
  // carries provider='mock' in a NOT NULL checked column. Nothing on either path
  // transmits: the mock reads a fixture in this repository, and the Plaid seam
  // is deliberately unclosed and returns its refusal unchanged.
  "banking/sync-accounts": bankingSyncAccounts,

  // Write endpoints. Hand-rolled rather than readHandler-based, so each one owns
  // its own method switch, its 405 + allow header, and its domain-error mapping.
  // They were built, tested and left unrouted; /api/inquiries in particular is
  // the entire write path of the Inquiry Remover dashboard, whose read half
  // (/api/read/inquiries) has been routed the whole time — the queue rendered
  // and no button on it worked.
  //
  // /api/pii gates on its own IDENTITY_ROLES set — {owner, admin,
  // inquiry_specialist, funding_advisor} — which is NARROWER than ROLE_SETS.STAFF
  // and deliberately so: a setter or closer has no reason to read a social
  // security number. Left exactly as written; routing it does not widen it.
  "inquiries": inquiries,
  "pii": pii,
  "shifts": shifts,

  // Creative Factory. All ten go through src/http/partner-read-api.mjs, which is
  // requirePrincipal(["partner","staff"]) + withPartnerScope, so a partner sees
  // only their own rows via RLS and a staff caller must name ?partner_id=.
  "campaigns/list": campaignsList,
  "campaigns/detail": campaignsDetail,
  "campaigns/spend": campaignsSpend,
  "campaigns/fatigue": campaignsFatigue,
  "campaigns/connections": campaignsConnections,
  "campaigns/action-log": campaignsActionLog,
  "creative/library": creativeLibrary,
  "creative/brand-kits": creativeBrandKits,
  "creative/jobs": creativeJobs,
  "creative/approvals": creativeApprovals,

  // Hiring. ROLE_SETS.HIRING is {owner, admin} — NOT the STAFF set, because
  // these carry applicant PII and the scoring trail of an automated employment
  // decision tool. Routing them changes nothing about that gate.
  "hiring/candidates": hiringCandidates,
  "hiring/application": hiringApplication,
  "hiring/postings": hiringPostings,
  "hiring/decisions": hiringDecisions,
  "hiring/funnel": hiringFunnel,
  "hiring/bench": hiringBench,

  // Finance. The one-tap soft pull for a client already on file. Routed in the
  // same commit that adds the handler, deliberately: this is the third time a
  // feature in this repo has been finished and left unreachable, and a
  // credit-pull ledger that nobody can write to is worse than not having one —
  // it looks like the audit trail exists. The endpoint's own gate is narrower
  // than ROLE_SETS.STAFF and is spelled out in api/finance/soft-pull.mjs.
  // Nothing behind it transmits.
  "finance/soft-pull": financeSoftPull,

  // Banking and privacy. Both are DESTRUCTIVE and both gate on {owner, admin},
  // which is narrower than ROLE_SETS.STAFF and spelled out in each handler rather
  // than inherited. Routed in the same commit that adds the handlers, because a
  // revoke button that 404s is worse than no button: the person clicking it
  // believes their bank connection is gone and it is not.
  //
  // Each gates with TWO calls — requireAuth, then a separate requireRole — because
  // requireAuth forwards its third argument to authenticate(), which reads only
  // { db, env }, so a `roles` key there is silently dropped. That is the exact
  // hole api/read/tradelines.mjs shipped with, and src/http/auth-gate.test.mjs
  // exists to catch it.
  //
  // /api/banking/revoke removes THIS SYSTEM'S stored bank credential. It does not
  // revoke at the provider — nothing here transmits — and the response says so on
  // every call.
  //
  // /api/privacy/erasure de-identifies a client on an explicit request and writes
  // an audit row naming what was removed and what was kept. There is no schedule
  // behind it; nothing in this system erases anything on its own.
  "banking/revoke": bankingRevoke,
  "privacy/erasure": privacyErasure

  /* NOT ROUTED, ON PURPOSE — see ALLOWED_UNROUTED in src/http/routes.test.mjs
     for the current list and the reason attached to each entry. That list is
     EMPTY as of this integration pass: every handler file under api/ is either
     in this map or reached by one of the three prefix/short-circuit branches in
     handler() below. Adding a file under api/ now fails routes.test.mjs until
     somebody decides, in writing, whether it is reachable. */
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
// 404s on every route. Exported so routes.test.mjs can assert that round-trip
// for every key in ROUTES rather than for the two somebody happened to try.
export function routePath(pathname) {
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

  // /api/documents/:id → the signed-link download route.
  if (!route && path.startsWith("documents/")) {
    route = documentById;
    query.id = path.slice("documents/".length);
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

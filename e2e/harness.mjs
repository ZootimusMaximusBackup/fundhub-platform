// Shared Playwright helpers for CRM screen specs.
//
// Mirrors e2e/messaging-inbox.spec.mjs: page.route() answers every /api/**
// call, localStorage carries a fake session, and no real backend is required.

import { expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EXTERNAL_RESOURCE = /Failed to load resource/i;

export const CLIENT_ID = "aaaaaaaa-1111-4111-8111-111111111111";
export const PARTNER_ID = "pppppppp-1111-4111-8111-111111111111";

export const OWNER = {
  ok: true,
  staff: {
    id: "staff-1", name: "Jordan Blake", email: "jordan@fundhub.ai",
    role: "owner", org_id: "org-1", status: "active"
  }
};

export const CLOSER = {
  ok: true,
  staff: {
    id: "staff-2", name: "Casey Reed", email: "casey@fundhub.ai",
    role: "closer", org_id: "org-1", status: "active"
  }
};

export const PARTNER = {
  ok: true,
  staff: {
    id: "staff-p", name: "Pat Partner", email: "pat@partner.test",
    role: "partner", org_id: "org-1", status: "active", partner_id: PARTNER_ID
  }
};

export const EMPTY_PAGE = {
  ok: true, count: 0, limit: 200, offset: 0, hasMore: false, items: []
};

export const AGENT_ROW = {
  code: "AG-01", name: "Lead Follow-up", agent_class: "client_facing",
  channel: "sms", status: "draft", runtime: null,
  owner_label: "Sarah Whitfield",
  prompt: "x".repeat(80),
  guardrails: {
    block: "y".repeat(40), triggers: ["lead.created"],
    escalation: { path: "Sarah Whitfield · Sales Manager", after: "1 hour" }
  },
  prompt_missing: false, guardrails_missing: false
};

export const PRODUCT_ROW = {
  code: "funding_bundle", name: "Funding Bundle", category: "funding",
  default_price: 3000, min_price: 2000, max_price: 5000, price_is_variable: true
};

export const PIPELINE_STAGES = [
  {
    key: "new_lead", name: "New Lead", sort_order: 0, count: 1, amount: 3000,
    cards: [{
      id: "card-1", client_id: CLIENT_ID, name: "Dana Whitfield",
      owner: "Jordan Blake", entered_at: "2026-08-01T10:00:00Z",
      outcome_tier: null, funded: false, amount: 3000
    }]
  },
  {
    key: "booked", name: "Booked", sort_order: 2, count: 0, amount: 0, cards: []
  }
];

export const STAFF_ROW = {
  id: "staff-1", name: "Jordan Blake", email: "jordan@fundhub.ai",
  role: "owner", status: "active"
};

export const CLIENT_ROW = {
  id: CLIENT_ID, first_name: "Dana", last_name: "Whitfield",
  email: "dana@example.com", phone: "+1 555 0100", custom_fields: {}
};

const dueSoon = () => {
  const d = new Date();
  d.setHours(d.getHours() + 1);
  return d.toISOString();
};

export const TASK_NO_LINK = {
  id: "task-nolink", client_id: null, client_name: null,
  title: "Internal note", body: "No client", due_at: dueSoon(), done: false
};

export const TASK_WITH_CALL = {
  id: "task-call", client_id: CLIENT_ID, client_name: "Dana Whitfield",
  title: "Follow-up call", body: "Confirm docs",
  due_at: dueSoon(), assignee_name: "Jordan Blake", done: false,
  meeting_url: "https://meet.example.com/room-1"
};

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "app");
export const SCREENS = fs.readdirSync(appDir).filter((f) => f.endsWith(".html")).sort();

export async function json(route, body, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

function defaultGet(url) {
  if (url.includes("/api/auth/session")) return null;
  if (url.includes("/api/health")) return { ok: true, db: "up" };
  if (url.includes("/api/read/agents")) {
    return { ok: true, count: 1, limit: 200, offset: 0, hasMore: false, items: [AGENT_ROW] };
  }
  if (url.includes("/api/read/products")) {
    return { ok: true, count: 1, limit: 200, offset: 0, hasMore: false, items: [PRODUCT_ROW] };
  }
  if (url.includes("/api/read/staff")) {
    return { ok: true, count: 1, limit: 200, offset: 0, hasMore: false, items: [STAFF_ROW] };
  }
  if (url.includes("/api/read/money-map")) {
    return { ok: true, accounts: [], liabilities: [], bills: [], cards: [] };
  }
  if (url.includes("/api/read/finance-command")) {
    return { ok: true, series: [], totals: {}, cash_on_hand_cents: null };
  }
  if (url.includes("/api/read/underwrite")) return { ok: true, scores: null, tradelines: [] };
  if (url.includes("/api/read/transactions")) return EMPTY_PAGE;
  if (url.includes("/api/read/tradelines")) return { ok: true, tradelines: [], client_id: CLIENT_ID };
  if (url.includes("/api/dashboard/clients")) return { ok: true, clients: [CLIENT_ROW] };
  if (url.includes("/api/dashboard/client")) {
    return {
      ok: true, client: CLIENT_ROW,
      transactions: [], crs_results: [], messages: [], tasks: []
    };
  }
  if (url.includes("/api/dashboard/pipeline")) {
    return { ok: true, pipeline: "sales", total: 1, stages: PIPELINE_STAGES };
  }
  if (url.includes("/api/dashboard/kpis")) {
    return {
      ok: true,
      kpis: {
        cash_collected_cents: 0, funded_count: 0, close_rate: null, show_rate: null,
        cost_per_funded_cents: null, cost_per_funded_reason: "ad_spend_unavailable",
        new_clients: 0, pipeline_movement: 0
      },
      display: {
        cash: "—", funded: "—", close: "—", show: "—", cpf: "—",
        clients: "—", pipeline_movement: "—"
      }
    };
  }
  if (url.includes("/api/shifts") && url.includes("roster")) {
    return { ok: true, roster: [] };
  }
  if (url.includes("/api/shifts")) return { ok: true, shift: null };
  if (url.includes("/api/social/oauth")) {
    return { ok: false, error: "not_configured", missing: ["META_APP_ID"], message: "META_APP_ID unset" };
  }
  if (url.includes("/api/tasks")) return { ok: true, tasks: [] };
  if (url.includes("/api/finance/entities")) {
    return { ok: true, client_id: CLIENT_ID, entities: [] };
  }
  if (url.includes("/api/finance/alerts")) return { ok: true, alerts: [], rules: [], items: [] };
  if (url.includes("/api/consent/capture")) {
    return { ok: true, capture: { version: "2.1", sections: [] } };
  }
  if (url.includes("/api/messages-outbound")) {
    return { ok: true, settings: { outbound_enabled: false }, queue: [] };
  }
  if (url.includes("/api/campaigns/") || url.includes("/api/hiring/")) {
    return { ok: true, items: [] };
  }
  if (url.includes("/api/journeys")) return { ok: true, journeys: [] };
  return EMPTY_PAGE;
}

/**
 * Install /api/** mocks.
 *   wireApi(page, session, extraPathMap)
 *   wireApi(page, { session, handlers })
 */
export async function wireApi(page, sessionOrOpts = OWNER, extra = {}) {
  let session = OWNER;
  let handlers = extra;

  if (sessionOrOpts && typeof sessionOrOpts === "object" &&
      ("session" in sessionOrOpts || "handlers" in sessionOrOpts)) {
    session = sessionOrOpts.session || OWNER;
    handlers = sessionOrOpts.handlers || {};
  } else if (sessionOrOpts && sessionOrOpts.staff) {
    session = sessionOrOpts;
  }

  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    for (const [needle, handler] of Object.entries(handlers)) {
      if (!url.includes(needle)) continue;
      if (typeof handler === "function") {
        const out = handler(route, { url, method });
        if (out && typeof out.then === "function") {
          const resolved = await out;
          if (resolved && typeof resolved === "object" && "ok" in resolved) {
            return json(route, resolved);
          }
          return;
        }
        if (out && typeof out === "object" && "ok" in out) {
          return json(route, out);
        }
        return;
      }
      return json(route, handler);
    }

    if (url.includes("/api/auth/session")) return json(route, session);
    if (url.includes("/api/auth/logout")) return json(route, { ok: true });

    if (method === "GET" || method === "HEAD") {
      const body = defaultGet(url);
      if (body) return json(route, body);
      return json(route, EMPTY_PAGE);
    }

    return json(route, { ok: true });
  });
}

export async function withSession(page, session = OWNER) {
  await page.addInitScript((s) => {
    localStorage.setItem("fh_token", "e2e-token");
    localStorage.setItem("fh_role", (s.staff && s.staff.role) || "owner");
    localStorage.removeItem("fh_demo");
  }, session);
}

export async function gotoScreen(page, file, query = "", session = OWNER) {
  await withSession(page, session);
  const q = query ? (query.startsWith("?") ? query : `?${query}`) : "";
  const target = file.startsWith("/") ? file : `/app/${file}`;
  await page.goto(`${target}${q}`);
}

export function trackErrors(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (!EXTERNAL_RESOURCE.test(text)) errors.push(text);
    }
  });
  return errors;
}

export async function assertPageAlive(page, errors) {
  await expect(page.locator("body")).toBeVisible();
  // Ignore chrome extension / resource noise already filtered; fail only on
  // real pageerrors collected by trackErrors.
  const real = (errors || []).filter((e) => !EXTERNAL_RESOURCE.test(e));
  expect(real, "page threw a JavaScript error:\n" + real.join("\n")).toEqual([]);
}

/** Open a staff screen with session + path-map mocks; waits for async paint. */
export async function openScreen(page, pathName, session = OWNER, extra = {}) {
  const errors = trackErrors(page);
  await withSession(page, session);
  await wireApi(page, session, extra);
  await page.goto(pathName);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(400);
  await assertPageAlive(page, errors);
  return errors;
}

export async function freezeClock(page, iso) {
  await page.addInitScript(`{
    const fixed = new Date(${JSON.stringify(iso)}).valueOf();
    const RealDate = Date;
    class FrozenDate extends RealDate {
      constructor(...args) { if (args.length === 0) super(fixed); else super(...args); }
      static now() { return fixed; }
    }
    Date = FrozenDate;
  }`);
}

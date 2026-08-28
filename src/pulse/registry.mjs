// Live-path registry for the 7:00 a.m. pulse.
// Add a row in the same change as the feature. See .cursor/rules/pulse-registry.mdc.
// Completeness is enforced by registry.test.mjs (routes.test.mjs allow-list pattern).
// Audit only. GET pings. Never auto-fix. Never live CRS. Never charge a card.

export const ALLOWED_UNMONITORED = {
  "inngest": "Inngest serve() is not a GET uptime door. Liveness is the daily-pulse cron itself.",
  "webhooks/[provider]": "Signed webhook POST only. A GET ping is not uptime and can look like a replay.",
  "documents/[id]": "Per-document GET needs a real id and a signed-in caller. Not a desk ping.",
  "contracts/sign": "Signed contract link. GET without id/exp/sig answers 404 on purpose. That is not downtime.",
  "sidebar.fragment.html": "Shared chrome fragment mounted into other pages. Not a live desk."
};

const API_KEYS = [
  "agent-call",
  "agents",
  "ai-bureau-config",
  "applications",
  "auth/admin-reset",
  "auth/invite",
  "auth/login",
  "auth/logout",
  "auth/magic-link-verify",
  "auth/magic-link",
  "auth/reset",
  "auth/session",
  "auth/staff-role",
  "auth/staff-update",
  "auth/suspend",
  "banking/accounts",
  "banking/revoke",
  "banking/sync-accounts",
  "bookings",
  "brand/review",
  "call-outcomes",
  "campaigns/action-log",
  "campaigns/connections",
  "campaigns/detail",
  "campaigns/fatigue",
  "campaigns/list",
  "campaigns/spend",
  "campaigns/sync",
  "campaigns/write",
  "chat/ask",
  "chat/messages",
  "chat/peers",
  "chat/portal-message",
  "client-notes",
  "climate/config",
  "climate/geocode",
  "climate",
  "closer-deck",
  "commission-rules",
  "commissions",
  "company-brain/reviews",
  "company-brain/sync",
  "company-brain/threads",
  "company-brain/upload",
  "consent/capture",
  "content/tiles",
  "content/upload",
  "content/welcome-video",
  "contracts",
  "creative/actions",
  "creative/approvals",
  "creative/brand-kits",
  "creative/generate",
  "creative/jobs",
  "creative/library",
  "creative/run",
  "customer-insights",
  "dashboard/client-archive",
  "dashboard/client",
  "dashboard/clients",
  "dashboard/kpis",
  "dashboard/pipeline-counts",
  "dashboard/pipeline",
  "dashboard/seed",
  "demo/mode",
  "demo/simulate",
  "documents-upload",
  "finance/alerts",
  "finance/bank-accounts",
  "finance/bills",
  "finance/cards",
  "finance/cashflow",
  "finance/crs-pull",
  "finance/entities",
  "finance/liabilities",
  "finance/model",
  "finance/soft-pull",
  "finance/subscriptions",
  "gifts/message-blaster",
  "health",
  "hiring/application",
  "hiring/bench",
  "hiring/candidates",
  "hiring/decide",
  "hiring/decisions",
  "hiring/funnel",
  "hiring/postings",
  "inquiries",
  "inquiry-cases",
  "inquiry",
  "journeys/ask",
  "journeys/run",
  "journeys",
  "lender-observations",
  "lenders",
  "marketing-flags",
  "message-templates",
  "messages-outbound",
  "messages",
  "ops/hire-closer",
  "org-brand",
  "partner-brand/verify-domain",
  "partner-brand",
  "partner-marketing/copy-history",
  "partner-marketing/enable",
  "partner-marketing/generate-copy",
  "partner-marketing/generate-logo",
  "partner-marketing/usage",
  "partner-pages",
  "payment-links",
  "pii",
  "pipeline-cards",
  "pipeline-clients",
  "privacy/erasure",
  "products",
  "proxy/end",
  "proxy/launch",
  "public/affiliate-click",
  "public/education-enroll",
  "public/optimize",
  "public/partner-apply",
  "public/partner-page",
  "public/survey-submit",
  "public/unsubscribe",
  "read/affiliates",
  "read/agent-context",
  "read/agent-shadow-log",
  "read/agents",
  "read/ai-bureau-config",
  "read/bank-inbox",
  "read/banking-surface",
  "read/call-outcomes",
  "read/closer-call",
  "read/closer-deck",
  "read/closer-now",
  "read/commissions",
  "read/company-activity",
  "read/company-brain-affiliate",
  "read/company-brain",
  "read/contracts",
  "read/conversations",
  "read/customer-insights",
  "read/deal-math",
  "read/documents",
  "read/entitlements",
  "read/failed-events",
  "read/finance-ask",
  "read/finance-command",
  "read/finance-os",
  "read/funding-rounds",
  "read/inbox",
  "read/inquiries",
  "read/inquiry-cases",
  "read/invoices",
  "read/lender-matches",
  "read/lender-observations",
  "read/lenders",
  "read/message-templates",
  "read/messages",
  "read/money-map",
  "read/my-numbers",
  "read/ops-pulse",
  "read/partners",
  "read/portal-contracts",
  "read/portal-summary",
  "read/products",
  "read/proxy-sessions",
  "read/repair-cases",
  "read/sales-floor",
  "read/search",
  "read/slo-connections",
  "read/staff",
  "read/tradelines",
  "read/transactions",
  "read/underwrite",
  "read/unrecorded-calls",
  "read/workflows",
  "repair/enroll",
  "repair/exceptions",
  "repair/generate",
  "repair/inbound-mail",
  "repair/send",
  "shifts",
  "slo-connections",
  "social/channels",
  "social/generate",
  "social/oauth",
  "social/posts",
  "social/publish",
  "social/schedule",
  "social/settings",
  "soft-pull-approve",
  "staff/monitoring-consent",
  "staff/telemetry",
  "tasks"
];

const DESK_FILES = [
  "affiliate.html",
  "agent-editor.html",
  "automations.html",
  "brand-studio.html",
  "calendar.html",
  "campaign-manager.html",
  "client-control-panel.html",
  "client-portal.html",
  "closer-call.html",
  "closer-dashboard.html",
  "company-brain.html",
  "consent-capture.html",
  "content-admin.html",
  "contracts.html",
  "creative-factory.html",
  "documents.html",
  "finance-os.html",
  "galaxy.html",
  "hiring.html",
  "index.html",
  "inquiry-remover.html",
  "journeys.html",
  "lenders.html",
  "messaging.html",
  "my-numbers.html",
  "ops-admin.html",
  "partner-galaxy.html",
  "payment-success.html",
  "pipeline.html",
  "present.html",
  "products-commissions.html",
  "sales-floor.html",
  "social-studio.html",
  "soft-pull-approve.html",
  "staff-teams.html"
];

export const PULSE_REGISTRY = [
  ...API_KEYS.map((key) => ({
    id: key,
    kind: "api",
    path: key === "health" ? "/api/health?strict=1" : `/api/${key}`
  })),
  ...DESK_FILES.map((file) => ({
    id: file.replace(/\.html$/, ""),
    kind: "desk",
    path: `/app/${file}`
  }))
];

export function coverageKey(row) {
  if (!row || !row.path) return "";
  if (row.kind === "desk") return row.path.replace(/^.*\//, "");
  return String(row.path).replace(/^\/api\//, "").replace(/\?.*$/, "");
}

export function missingFromRegistry({
  handlerKeys = [],
  deskFiles = [],
  registry = PULSE_REGISTRY,
  allow = ALLOWED_UNMONITORED
} = {}) {
  const covered = new Set([
    ...registry.map(coverageKey),
    ...Object.keys(allow)
  ]);
  const missing = [];
  for (const key of handlerKeys) {
    if (!covered.has(key)) missing.push(key);
  }
  for (const file of deskFiles) {
    if (!covered.has(file)) missing.push(file);
  }
  return missing.sort();
}

function checkRow(row, status, detail, suggestedFix = null) {
  return {
    id: `reg:${row.id}`,
    kind: "registry",
    path: row.path,
    status,
    detail,
    suggestedFix
  };
}

function isUp(row, httpStatus) {
  if (row.kind === "desk") return httpStatus >= 200 && httpStatus < 300;
  return (
    (httpStatus >= 200 && httpStatus < 300) ||
    httpStatus === 400 ||
    httpStatus === 401 ||
    httpStatus === 403 ||
    httpStatus === 405
  );
}

async function pingRow(row, fetchImpl, baseUrl) {
  const url = `${baseUrl}${row.path}`;
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "text/html,application/json" },
      signal: AbortSignal.timeout(15000)
    });
    const status = res.status;
    if (isUp(row, status)) {
      return checkRow(row, "up", `${row.path} ${status}`);
    }
    return checkRow(
      row,
      "down",
      `${row.path} answered ${status}`,
      `Restore ${row.path}. Do not auto-fix from this pulse.`
    );
  } catch (err) {
    return checkRow(
      row,
      "down",
      `${row.path} unreachable: ${String((err && err.message) || err).slice(0, 160)}`,
      `Restore ${row.path}. Do not auto-fix from this pulse.`
    );
  }
}

async function mapPool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => worker()));
  return out;
}

/** GET each registry URL. Writes up / down. Never POSTs. Never auto-fixes. */
export async function checkRegistry({
  fetchImpl,
  baseUrl,
  rows = PULSE_REGISTRY,
  concurrency = 8
} = {}) {
  const origin = String(baseUrl || "").replace(/\/+$/, "");
  return mapPool(rows, concurrency, (row) => pingRow(row, fetchImpl, origin));
}

// Live-path registry for the 7:00 a.m. pulse.
// Add a row in the same change as the feature. See .cursor/rules/pulse-registry.mdc.
// Completeness is enforced by registry.test.mjs (routes.test.mjs allow-list pattern).
// Audit only. GET pings. Never auto-fix. Never live CRS. Never charge a card.

export const ALLOWED_UNMONITORED = {
  "inngest": "Inngest serve() is not a GET uptime door. Liveness is the daily-pulse cron itself.",
  "webhooks/[provider]": "Signed webhook POST only. A GET ping is not uptime and can look like a replay.",
  "documents/[id]": "Per-document GET needs a real id and a signed-in caller. Not a desk ping.",
  "contracts/sign": "Signed contract link. GET without id/exp/sig answers 404 on purpose. That is not downtime.",
  "public/decline-autopsy-upload": "POST only — the paid autopsy_ref plus the merchant attestation are the credential. A GET answers 405 by design, and pinging it with a body would write somebody's declined-deal rows. The sales page at public/decline-autopsy is the monitored door for this offer.",
  "public/decline-autopsy-report": "Signed, expiring report link. A GET without org/ref/exp/sig answers 404 on purpose — and it answers that identically for a forged signature, so the endpoint cannot be used to find out which references exist. That refusal is correct behaviour, not downtime.",
  "trials/provision": "POST only, owner/admin. A GET answers 405 by design, and pinging it with a body would create a partner row, an affiliate row and a login for a trial nobody bought. The eligibility gate and the live dashboard are the monitored doors for this offer.",
  "trials/convert": "POST only, owner/admin. A GET answers 405 by design, and pinging it with a body would stamp a partner agreement or pause a partner. Day 8 is a human decision, not an uptime probe.",
  "campaigns/meta-agency": "POST only. A GET answers 405 by design, and pinging it with a body would store a Meta Business id against a partner and fire a real agency-access request at Meta on their behalf. The monitored door for this surface is campaigns/connections, which reports whether the access actually landed.",
  "training-progress": "POST only, owner/admin. A GET answers 405 by design, and pinging it with a body would stamp a compliance certification against a partner nobody assessed. The monitored door for the training is read/partner-training, which is what a partner actually opens.",
  "sidebar.fragment.html": "Shared chrome fragment mounted into other pages. Not a live desk."
};

const API_KEYS = [
  "adintel/board",
  "agent-call",
  "agents",
  "affiliates/refer",
  "ai-bureau-config",
  "applications",
  "auth/admin-reset",
  "auth/invite",
  "auth/login",
  "auth/logout",
  "auth/magic-link-verify",
  "auth/magic-link",
  "auth/reset",
  "auth/send-portal-link",
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
  /* An employee's own profile photo. GET is a real door — handleDownload
     serves it — so this is monitored rather than excused. Self-scoped: both
     halves act on req.staff.id and nothing else. */
  "staff/avatar",
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
  "documents-download",
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
  "partners/approve",
  /* The white-label add-on menu. A door that asks a partner for money and puts
     them on a monthly cycle, so an outage here is revenue not asked for. */
  "partner-addons",
  "payment-links",
  /* The self-serve paid round. A plain GET answers with the price list and
     whether this client may buy one, so it is a real uptime door: a client
     seeing "could not load" on a page with a price on it is an outage worth
     knowing about. The POST half is the one that mints a hosted checkout link,
     and a GET never touches it. */
  "paid-services",
  "pii",
  "pipeline-cards",
  "pipeline-clients",
  "privacy/erasure",
  "products",
  "proxy/end",
  "proxy/launch",
  "public/affiliate-click",
  /* The Decline Autopsy sales page. A plain GET answers 200 with the price, the
     row cap and the field list, so it is a real uptime door. Its two siblings
     are not — see ALLOWED_UNMONITORED. */
  "public/decline-autopsy",
  "public/education-enroll",
  /* The self-serve till for the /partner/ funnel pages. A plain GET answers 200
     with every price those five pages render and whether checkout is actually
     configured, so it is a real uptime door: if this is down, three sales pages
     show an em dash where the price goes and their buy buttons stay disabled. */
  "public/funnel-checkout",
  "public/optimize",
  "public/partner-apply",
  "public/partner-page",
  "public/survey-submit",
  "public/unsubscribe",
  "read/ad-attribution",
  "read/ad-books",
  "read/affiliates",
  /* One affiliate's own referrals, payouts, rates and payout gates. Separate
     from read/affiliates above, which answers staff with roster-wide counts.
     Monitored because an outage here empties both tables on the affiliate
     screen, whose empty state reads "No referrals on file" — an affiliate would
     read that as their referrals having vanished, not as a server being down. */
  "read/affiliate-portal",
  "read/agent-context",
  "read/agent-shadow-log",
  "read/agents",
  "read/ai-bureau-config",
  "read/bank-inbox",
  "read/banking-surface",
  "read/call-outcomes",
  /* The only read behind the client progress page. An outage here is a client
     who paid up to $10,000 seeing no scores, no checklist and no next step. */
  "read/client-progress",
  "read/closer-call",
  "read/closer-deck",
  "read/closer-now",
  "read/commissions",
  "read/company-activity",
  "read/company-brain-affiliate",
  "read/company-brain",
  "read/contracts",
  "read/conversations",
  /* The CSM's whole day. An outage here and the person who owns every
     post-sale conversation has no list of who to call and no idea who is
     behind on payments. */
  "read/csm-queue",
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
  "read/partner-home-tiles",
  "read/partner-production",
  /* The $10,000 curriculum a partner opens. An outage here is the training half
     of the entry fee missing, and it is the only read behind the gate record. */
  "read/partner-training",
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
  "tasks",
  /* The Live Trial's two public-facing doors. `trials/eligibility` is the gate
     that runs in front of the pay button — if it is down, nobody can buy the
     trial and nobody is told why. `trials/dashboard` is the screen a person
     paid $297 to watch for seven days; an outage there is the product missing.
     Its two write siblings are not pingable — see ALLOWED_UNMONITORED. */
  "trials/dashboard",
  "trials/eligibility"
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
  "partner-training.html",
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

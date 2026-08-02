# Full system audit — 2026-08-02

Read-only. Measured against `main` at `87a7355` (post go-live merge batch) on branch `audit/full-system`.
No product code was changed in this pass.

Worktree: `/Users/zootimusmaximus/fundhub-platform-merge-live`.

---

## 1. Playwright (full suite)

**Result: 122 passed, 2 failed** (Chromium, ~3.0 min).

| Spec | Verdict |
|------|---------|
| agent-editor — New posts create and selects the new agent | **FAIL** — `locator.click` timeout 30s on `#newBtn` (shell Sign-out chip still covering the button at desktop width in the harness) |
| crm-flows — products create posts action create | **FAIL** — same class of failure: click timeout on `#addProdBtn` |
| All other specs (login, messaging inbox, pipeline, ops-admin, screens-smoke, staff-teams, calendar, command-center, controls-persist, …) | **PASS** |

Both failures are UI hit-target / layout races in e2e, not proof that the write APIs are dead. Agent create and product create still post via `FHData.write` in the page scripts.

---

## 2. Wiring re-audit (`public/app/*.html`)

Method: same approach as `docs/WIRING-AUDIT.md` — scan every screen for `FHData` / `fetch(` / `/api/` paths; compare to prior lying list.

### Fixed since the wiring audit

| Screen | Was | Now |
|--------|-----|-----|
| `hiring.html` | Lying (hardcoded APPS, zero fetch) | **Wired** — fetches hiring endpoints; sample only as demo/fallback |
| `creative-factory.html` | Lying (claimed readable/ok with zero fetch) | **Wired** — fetches creative endpoints; banners distinguish sample vs live |
| `social-studio.html` | Stale “unreachable” claim on action-log | Still mostly local/stub copy; action-log route exists (cosmetic) |

### Still lying / fake

| Severity | Screen | Finding |
|----------|--------|---------|
| **lying** | `content-admin.html` | Zero `fetch` / `FHData`. Stats (`#kVideos`, `#kTiers`) driven from in-page arrays only. No `api/content/*` route. |
| **lying** | `galaxy.html` | Zero `fetch` / `FHData`. Entire visualization is static. No galaxy backend route. |
| **fine** (by design) | `sample-data.html` | Documented design-reference page, not a live feature screen. |
| **fine** | `index.html` | Redirect stub. |

### Broken (calls missing route)

**None found** on this pass — same as the original wiring audit.

### Dead backends (still true — no screen caller)

Unchanged in substance from `docs/WIRING-AUDIT.md`: invoices read, funding-rounds read, superseded finance-os/banking-surface reads, shifts, banking/revoke, privacy/erasure, finance/cashflow, banking/accounts (manual), plus any hiring/creative routes that screens still do not call for every action. Hiring/creative **reads** are now called; write paths and some panels may still be stubs (see controls).

---

## 3. Controls re-audit

Method: phrase scan for “not available yet” / “no endpoint” / “coming soon”, plus spot-checks of Brand Studio / Agent Editor / Products after the go-live merges.

### Improved since `docs/CONTROLS-AUDIT.md`

| Area | Now |
|------|-----|
| Brand Studio Save | **WORKS** for CRM org brand via `__fhBrandPersist` → `PUT /api/org-brand` (and partner via `/api/partner-brand`). Submit still disabled (“not available yet”). |
| Agent editor Save / New / promote | **WORKS** in code (`POST /api/agents`) — Playwright click still flakes on chip overlap. |
| Products create/save | **WORKS** in code (`POST /api/products`) — same Playwright flake class. |
| Pipeline MOVE / drag | **WORKS** (`POST /api/pipeline-cards`) per controls-persist merge. |
| Global search (⌘K) | **WORKS** — new this batch (`GET /api/read/search`). |
| Company Brain ask / owner reviews | **WORKS** in code; Drive/OpenAI sync **off** (no credentials set by design). |

### Remaining DEAD / STUB clusters

| Severity | Where | What |
|----------|-------|------|
| **stub** | `content-admin.html` | Most actions: “Not available yet” |
| **stub** | `creative-factory.html` | Generate / several actions: “no endpoint” |
| **stub** | `brand-studio.html` | Submit for approval disabled; “Coming soon” generation |
| **stub** | `command-center.html`, `closer-dashboard.html`, `calendar.html`, `campaign-manager.html` | Controls that still say “no endpoint” for aggregates / some actions |
| **dead** (empty because no read source) | Command Center KPIs, Ops money KPIs, Ops AR table, Products rails column, Staff clock/consent columns | Same gaps listed in CONTROLS-AUDIT “Still no source” — honest empties (`—`), not fake dollars |

---

## 4. `docs/UNFINISHED-AUDIT.md` money-chain findings

**File not present on this tree.** Referenced from CONTROLS-AUDIT (soft-pull note) but never committed as `docs/UNFINISHED-AUDIT.md`.

Money-chain status from **this** pass (detail in `docs/MONEY-CHAIN-AUDIT.md`):

| Piece | Calculated / readable? | Live writer on event? | Status |
|-------|------------------------|-----------------------|--------|
| Sales row | Read paths / commission SQL assume it | **No** production INSERT found outside tests | **broken chain** |
| Funding rounds | Reads + workflow UPDATEs | **No** INSERT writer in workflows/handlers | **broken chain** |
| Commission ledger | `SQL_INSERT_LEDGER` + calculate pure fns; `GET /api/read/commissions` | **No** live caller of the insert | **broken chain** |
| Entitlement grants | `grant()` in `src/entitlements/entitlements.mjs`; `GET /api/read/entitlements` | **Only tests** call `grant` | **broken chain** |
| Invoices | `createInvoice` | **Yes** — workflows F-07 / DS-02 (needs Inngest live) | **partial** |
| Payment links | Full create/send/settle path | **Yes** — CRM + Commas webhook handler | **fine** (vendor sandbox assumptions remain) |

---

## 5. Migration numbering collisions

**None.** After the go-live renumber, `db/migrations/` tops at **133** with unique numeric prefixes (98 migration files counted under `NNN_*.sql`).

Final sequence from the batch:

```
127_retire_affiliates_hiring.sql
128_org_brand.sql
129_contract_template_write_repair.sql
130_company_brain.sql
131_company_brain_sync.sql
132_company_brain_classification.sql
133_company_brain_affiliate_allowlist.sql
```

Production applied all seven on 2026-08-02 (see `docs/MERGE-LOG.md`).

---

## Summary by severity

### Broken
- Money chain core writers missing: **sales**, **funding_rounds insert**, **commission_ledger**, **entitlement grants** (see phase 3 docs).
- Playwright: 2 create-button click timeouts (agent New, product Add).

### Lying
- `content-admin.html` — local-only stats and library.
- `galaxy.html` — static viz with no backend.

### Dead
- Backend reads/actions still with no screen caller (invoices list, funding-rounds list, shifts, erase, banking revoke, …) — see wiring audit §dead.
- Command Center / Ops aggregate tiles: honest empty, no source.

### Stub
- Content admin actions; several Creative Factory generates; Brand Studio submit/approval; scattered “no endpoint” buttons on dashboards.

### Fine
- Contracts, uploads, payment links, pipeline writes, agent/product writes (API), messaging inbox, org brand theming, global search, Company Brain query/review APIs (sync off by design), outbound mail panel (per-company switch; credentials still required to transmit).
- Migration sequence clean; production migrate of 127–133 succeeded.
- Hiring + Creative Factory no longer fully fake on read.

---

## Left for phase 3

Human-readable deep dives:

- `docs/MONEY-CHAIN-AUDIT.md`
- `docs/CUSTOMER-JOURNEY-AUDIT.md`

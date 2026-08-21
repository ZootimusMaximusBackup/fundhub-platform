# CLOSER DASHBOARD SCREEN MERGE — BUILD SPEC v1

**Status:** code landed on `feat/closer-dashboard-screen-merge` (`2f123582`). Spec is the law. Friday friend test and PR still open. Agents do not merge or deploy.
**Canonical inputs:** owner ask (2026-08-20); `docs/workflows/data-redundancy-2026-08-19.md`; `docs/workflows/button-redundancy-2026-08-19.md`.
**Workflow board:** `docs/workflows/closer-dashboard-screen-merge-2026-08-20.md`.

---

## 1. What this is

One screen named **Closer Dashboard** at `public/app/closer-dashboard.html`.

It holds every tool a closer needs on a live call **and** the deal math that used to live on a second screen.

Call Cockpit is not a separate nav destination. Old Call Cockpit links still work through a redirect.

---

## 2. Why it exists

Closers were bouncing between two screens for one job: run the call and do the deal math.

That split slowed the call and made two read paths for the same client facts. One screen. One data path.

---

## 3. Final screen must contain

### From the old Closer Dashboard

- Tradeline math
- Lender matches
- Client context

### From Call Cockpit

- Live-call panel (up next, join, client facts)
- Outcome logging — **Save · next call**
- Contract send
- Credit scores and UnderwriteIQ bands

### Calculators

Both deal calculators live inside one collapsed section labeled **Payment Calculator**.

- Closed by default
- One click opens it
- Support tool for the monthly-payment question — not the main event

---

## 4. One data path (hard rule)

Shared client data on this screen comes from **one** fixed read only:

`GET /api/read/closer-call`

Rules:

- Credit scores come from `triMerge` inside that response.
- Funding bands come from `lite_banner_funding` / UnderwriteIQ fields already on that response.
- **Never** blend with the old dashboard client-read path for shared client facts.
- Unique calculator reads stay only for calculator work:
  - `GET /api/read/tradelines`
  - `GET /api/read/deal-math`
  - `GET /api/read/lender-matches`

If a second shared client-read appears on this screen, that is a FAIL against this spec.

---

## 5. Redirect

`public/app/closer-call.html` is a redirect stub only.

It must preserve the full query string and hash so deep links keep working, including:

- `?client_id=`
- `task_id`
- any other query value already in use

Example: `closer-call.html?client_id=…&task_id=…` lands on Closer Dashboard with the same params.

---

## 6. Nav

- One **Closer Dashboard** row in the shared sidebar.
- The **Call cockpit** row is gone from the real nav source and every generated copy that must stay in sync.
- Role gates for closers (and owner/admin) still reach Closer Dashboard.

---

## 7. App-code file rule

- No new files under `public/`, `src/`, or `api/` for this merge.
- Turning the existing `closer-call.html` into the redirect stub is allowed.
- Board docs, evidence folders, and screenshots are unlimited.

---

## 8. Compatibility

Existing IDs, handlers, and deep links that other code already uses must keep working, including:

- Present handoff
- Contract send
- Call outcome save / next-call handoff
- My Numbers deep links
- Staff help / chat pointers that named Call Cockpit

Do not invent a second send path, a second outcome path, or a second Present entry.

---

## 9. Explicitly out of scope

- Deploy to production
- Merge to `main` (Chris merges after the Friday friend test)
- UI polish beyond what the merge needs
- Killing or redesigning Present
- New endpoints, fields, routes, or dependencies
- Redesigning the sales presentation flow
- Weakening, skipping, or deleting tests to get green

---

## 10. Prove gates (before Chris’s Friday friend test)

All of these must pass with evidence. Chat claims do not count.

1. **Merged screen** at **1440** and **390** with a **real client**:
   - Call panel
   - Outcome save
   - Contract send
   - Tradeline / deal math
   - Collapsed Payment Calculator (closed by default; opens in one click)
2. **Redirect** proven with params preserved (`client_id`, `task_id`, hash if present).
3. **Zero-regression walk** on the other money screens:
   - My Numbers
   - Products & Commissions
   - Finance OS
   - Present
   - Client Portal
4. **Adversary pass** against this spec (sections 1–8).
5. **PR** with marked before/after shots (red boxes + on-image legend per CLAUDE.md).
6. Chris does **one** human pass after automated proof. Agents do **not** merge or deploy.

---

## 11. As-built status (honest)

| Item | Status |
|---|---|
| Code on branch `feat/closer-dashboard-screen-merge` | Landed in commit `2f123582` |
| Workflow board | `docs/workflows/closer-dashboard-screen-merge-2026-08-20.md` |
| Evidence folder | `docs/workflows/closer-dashboard-screen-merge-2026-08-20-evidence/` |
| Marked before shots | Still required |
| After shots / adversary write-up / PR | Still open |
| Deploy / merge to main | Out of scope for agents |

**This document is the law.** If as-built code drifts from sections 1–8, treat that as a FAIL against this spec — not as a soft “we meant to.”

---

## 12. Source of truth map

| Question | Look here |
|---|---|
| What must the screen do? | This build spec |
| What did the redundancy audits say? | `docs/workflows/data-redundancy-2026-08-19.md`, `docs/workflows/button-redundancy-2026-08-19.md` |
| What changed in this batch? | `docs/workflows/closer-dashboard-screen-merge-2026-08-20.md` |
| What should a closer’s journey do? | `docs/journeys/role-closer-intended.md` (agents do not edit) |
| What does code actually do? | `docs/journeys/role-closer-actual.md` |

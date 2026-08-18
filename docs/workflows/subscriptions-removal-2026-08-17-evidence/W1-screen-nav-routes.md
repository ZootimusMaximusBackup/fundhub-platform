# W1 — Screen, nav, and routes sweep

Batch: `docs/workflows/subscriptions-removal-2026-08-17.md`
Workflow: W1 (read-only). Nothing in this sweep was edited.
Date: 2026-08-17

## How this app is put together (read this first)

There is **no JavaScript router and no route table on the front end**. The CRM
is a folder of plain HTML files at `public/app/`. One file is one screen, and
its URL is its filename. So "the route" to Subscriptions is literally the
sidebar link `href="subscriptions.html"`.

Three things therefore act as "routing":

1. The `<a href="subscriptions.html">` link, repeated inside every screen.
2. `public/app/sidebar.fragment.html` — the **one canonical copy** of that
   sidebar. `scripts/sync-sidebar.mjs` stamps it into every screen and into a
   string constant inside `shell.js`.
3. `public/app/shell.js` — four lists that decide whether the row is shown, who
   may open it, whether it gets a BETA badge, and whether the link carries
   `?client_id=`.

**Do not hand-edit the 34 copies of the sidebar.** Edit the fragment, then run
`node scripts/sync-sidebar.mjs`. `src/http/app-nav-reachability.test.mjs` goes
red if any screen's sidebar drifts from the others.

---

## 1. The screen file itself

| File | Notes |
|---|---|
| `/Users/zootimusmaximus/fundhub-platform/public/app/subscriptions.html` | 56,542 bytes. The whole screen — markup, its own inline CSS, and its entire wiring script are all in this one file. |

There is **no separate JS or CSS file that belongs only to this screen.** Every
other `public/app/*.js` and `*.css` file is shared (see section 5). Deleting
this one HTML file deletes the whole screen.

Self-references inside the file (they go with it):

- `public/app/subscriptions.html:6` — `<title>Fundhub — Subscriptions</title>`
- `public/app/subscriptions.html:149` — its own sidebar row, marked `on`
- `public/app/subscriptions.html:198` — breadcrumb `Setup` + `<h1>Subscriptions</h1>`
- `public/app/subscriptions.html:262` — page title `<h1 class="fh-title">Subscriptions</h1>`
- `public/app/subscriptions.html:209`, `:1010` — the deep-link instruction text
  `subscriptions.html?client_id=<uuid>`
- `public/app/subscriptions.html:399–425` — a **private copy of a GET helper**
  (`apiGet`) that lives only in this file. It is not exported and nothing else
  reads it. It dies with the file. The comment at `:395` says it "should be a
  named reader in `data.js` — `FHData.finance(...)`". **That function was never
  written** — `FHData.finance` does not exist in `public/app/data.js`. So there
  is no shared helper to clean up here.

---

## 2. Navigation entries

### 2a. The canonical sidebar (edit this one)

- `/Users/zootimusmaximus/fundhub-platform/public/app/sidebar.fragment.html:26`

```
        <a class="navitem" href="subscriptions.html"><span class="ico">◍</span><span class="lbl">Subscriptions</span></a>
```

It sits in the **Funding** group, as the 4th row after Lenders, Finance OS and
Contracts.

### 2b. The generated copies — 34 screens, one line each

All are byte-identical to the line above (except `subscriptions.html` itself,
which carries `class="navitem on"`). These are produced by
`scripts/sync-sidebar.mjs`, so they should be regenerated, not hand-edited.

| File | Line |
|---|---|
| `public/app/affiliate.html` | 144 |
| `public/app/agent-editor.html` | 200 |
| `public/app/automations.html` | 267 |
| `public/app/brand-studio.html` | 270 |
| `public/app/calendar.html` | 324 |
| `public/app/campaign-manager.html` | 266 |
| `public/app/client-control-panel.html` | 340 |
| `public/app/closer-call.html` | 153 |
| `public/app/closer-dashboard.html` | 222 |
| `public/app/command-center.html` | 698 |
| `public/app/company-brain.html` | 128 |
| `public/app/consent-capture.html` | 171 |
| `public/app/content-admin.html` | 221 |
| `public/app/contracts.html` | 155 |
| `public/app/creative-factory.html` | 324 |
| `public/app/documents.html` | 130 |
| `public/app/finance-os.html` | 225 |
| `public/app/galaxy.html` | 269 |
| `public/app/hiring.html` | 305 |
| `public/app/inquiry-remover.html` | 281 |
| `public/app/journeys.html` | 409 |
| `public/app/lenders.html` | 83 |
| `public/app/messaging.html` | 369 |
| `public/app/my-numbers.html` | 131 |
| `public/app/ops-admin.html` | 252 |
| `public/app/partner-galaxy.html` | 248 |
| `public/app/pipeline.html` | 328 |
| `public/app/products-commissions.html` | 192 |
| `public/app/sales-floor.html` | 131 |
| `public/app/sample-data.html` | 268 |
| `public/app/social-studio.html` | 342 |
| `public/app/staff-teams.html` | 181 |
| `public/app/subscriptions.html` | 149 (`class="navitem on"`) |
| `public/app/template-editor.html` | 183 |

35 files carry the row in total (34 above plus the fragment).

### 2c. The sidebar copy baked into shell.js

- `/Users/zootimusmaximus/fundhub-platform/public/app/shell.js:31` — the
  `SIDEBAR_HTML` string constant, between the markers
  `/* ==SIDEBAR_HTML_START== */` (line 30) and `/* ==SIDEBAR_HTML_END== */`
  (line 32). The Subscriptions `<a>` is inside that one very long string. The
  sync script rewrites this whole block, so again: regenerate, do not hand-edit.

---

## 3. Route definitions, redirects, and deep links

There is no client-side router. The nearest equivalents are four lists in
`public/app/shell.js`, all of which name the screen by filename:

| File | Line | List | What it does |
|---|---|---|---|
| `public/app/shell.js` | 23 | `BETA_PAGES` | Puts a BETA badge on the nav row and a dismissible banner on the page. Remove `"subscriptions.html"` from this array. |
| `public/app/shell.js` | 61 | `ALL` | The master list of every screen the shell will open. Anything not in `ALL` is bounced to the role's home page. Remove the entry **and its 10-line explanatory comment at lines 54–60**. |
| `public/app/shell.js` | 131 | `OWNER_ADMIN_ONLY` | Role gate — only owner and admin see the row. Remove `"subscriptions.html"`. |
| `public/app/shell.js` | 384 | `CLIENT_SCREENS` | Map of screens whose links get `?client_id=` appended. Remove the line `"subscriptions.html": "client_id",`. |

Prose comments in `shell.js` that also name the screen and go stale on delete
(comment-only, nothing breaks if left, but they will be wrong):

- `public/app/shell.js:54–60` — the "one Finance-adjacent screen that survived
  the consolidation" note attached to the `ALL` entry.
- `public/app/shell.js:119–126` — the `OWNER_ADMIN_ONLY` rationale, which states
  `/api/finance/subscriptions` and `/api/finance/cards` both gate on
  `ROLE_SETS.FINANCE`.
- `public/app/shell.js:192` — the `staffTabs()` note listing which rows sit in
  the markup but are hidden by `gateLinks()`.
- `public/app/shell.js:1655` — the "Finance OS and Subscriptions collapse"
  layout-bug history note in `mountFullWidthBar`.
- `public/app/shell.js:1763–1765` — the same history note on the demo-mode
  banner.

### Redirects

**None.** Checked `netlify.toml` (the only redirect table — 5 rules: `/app`,
`/app.html`, `/sites/*`, `/lender-climate`, `/api/*`) and `public/_headers`.
Nothing points at `subscriptions.html`. There is no `public/_redirects` file.

### Deep links

The only documented deep link is `subscriptions.html?client_id=<uuid>`, and it
is named **only inside the screen itself** (`:209`, `:1010`) and in the shell's
`CLIENT_SCREENS` map. **No other screen links to Subscriptions with a client
attached** — the sidebar row is the sole entry point.

---

## 4. Files that "import" the screen

Nothing imports it in a module sense — it is a standalone HTML page with no
build step. The references that exist are:

### Live front-end code (must be updated with the delete)

- `public/app/shell.js` — the 4 lists in section 3, plus `SIDEBAR_HTML`.
- The 35 sidebar copies in section 2.

### Comment-only mentions in other screens (harmless, but stale)

- `public/app/finance-os.html:13` — notes it shares `finance-os.css`.
- `public/app/finance-os.html:23` — notes its chrome was copied from here.
- `public/app/finance-os.html:420` — notes the same `FHData.read()` gap.
- `public/app/hiring.html:2504` — a CSS note referencing the same technique.

### Tests, scripts, docs and journeys (W3's territory — listed for completeness)

| File | Line(s) | What |
|---|---|---|
| `src/http/subscriptions-screen.test.mjs` | whole file (42, 53, 151, 186–357) | **Dedicated test for this screen's inline script.** Reads `public/app/subscriptions.html` from disk. Dies with the screen. |
| `src/http/app-client-carry.test.mjs` | 33, 35, 201–344 (29 occurrences across ~15 assertions) | Tests the `?client_id=` carry using `subscriptions.html` as one of only two `CLIENT_SCREENS`. Line 219 is the pair `["finance-os.html", "subscriptions.html"]`; line 344 asserts a closer may not open it. **Will fail on delete** — assertions must move to `finance-os.html`, the other `CLIENT_SCREENS` entry. |
| `src/http/app-nav-reachability.test.mjs` | 228 (comment) | Lifts `ALL`/`OWNER_ADMIN_ONLY` out of `shell.js` as text and checks every listed screen is offered by the sidebar and that all sidebars match. **Will fail if `shell.js` and the sidebars are not changed together, in the same commit.** |
| `e2e/screens-smoke.spec.mjs` | 24 | `"/app/subscriptions.html"` in the smoke list. |
| `e2e/crm-flows.spec.mjs` | 185 | `"/app/subscriptions.html"`. |
| `e2e/sidebar-roles.spec.mjs` | 37 | `const OWNER_ADMIN_ONLY = ["subscriptions.html", "journeys.html"];` |
| `scripts/tmp-full-live-verify.mjs` | 107 | screen list. |
| `docs/SIDEBAR-STRUCTURE.md` | 28, 47 | Funding group order and the owner/admin gate table. |
| `docs/WIRING-AUDIT.md` | 23, 92, 105 | |
| `docs/CONTROLS-AUDIT.md` | 388 | |
| `docs/END-TO-END-VERIFICATION.md` | 637 | |
| `docs/FINAL-USABILITY-PASS.md` | 30 | |
| `docs/PAYMENT-LINKS-SPEC.md` | — | names the screen as the payment-links UI |
| `docs/UNFINISHED-AUDIT.md` | — | |
| `docs/journeys/CHANGELOG.md` | — | |
| `api/finance/cards.mjs` | 73 | comment: "It shares subscriptions.html" (W2's file) |

Historic evidence folders under `docs/workflows/` (ui-audit, e2e-verify-run4/5,
perf-audit) also name it. Those are dated records of past runs — **leave them
alone**; rewriting history evidence is worse than a stale filename.

---

## 5. SHARED — do NOT delete any of these

Everything the screen loads is shared with other screens. **None of the five
files it pulls in may be deleted.**

| Asset | Used by subscriptions.html at | Who else uses it |
|---|---|---|
| `public/app/fundhub-brand.css` | line 10 | **40 other files** — every CRM screen, `index.html`, `payment-success.html`, `present.html`, `soft-pull-approve.html`, `client-portal.html`, `shell.js`, and `public/fh.css`. |
| `public/app/crm-sidebar.css` | line 11 | **34 other files** — every screen carrying the sidebar, plus `shell.js`. |
| `public/app/finance-os.css` | line 17 | **`public/app/finance-os.html`.** ⚠️ Only two users, and the other one is Finance OS — the screen this work is consolidating into. It carries `.fh-panel`, `.is-unknown` and `.is-partial`, which are the rules that make an unknown render as an em dash instead of `0.00`. **KEEP.** |
| `public/app/shell.js` | line 18 | **44 other files**, including `public/login.html`, `public/portal-login.html`, `public/contract.html`. This is the auth and nav shell for the whole app. **KEEP.** |
| `public/app/data.js` | line 299 | **34 other files** — every wired screen, plus `public/contract.html`, `closer-call.js`, `contract-send.js`, `present.js`. **KEEP.** |

Shared helper functions the screen calls (all live in `data.js`, all used
widely elsewhere — **KEEP**):

`FHData.param`, `FHData.clients`, `FHData.read`, `FHData.write`,
`FHData.banner`, `FHData.explain`.

Shared icon: the nav glyph `◍` is an inline text character in the `<a>` tag, not
an icon file. Nothing to delete.

### Two more shared things worth naming

- **`public/app/sample-data.html:367` and `:380`** contain
  `"subscriptions"` in `COUNT_KEYS` and `LABELS`. These count rows in the
  **`subscriptions` database table** for Demo Mode. They have nothing to do with
  this screen. **Leave them** unless W2 confirms the table itself is going, and
  the board says no table is going.
- **`scripts/sync-sidebar.mjs`** is the generator for all 35 sidebar copies.
  Keep it; run it.

---

## 6. Endpoints this screen calls — for the other workflow

The screen talks to **four** API paths. Two of them it is the **only** front-end
caller of.

### Reads (GET, via the screen's own private `apiGet`)

| Line | Method | URL |
|---|---|---|
| 804 | GET | `/api/finance/subscriptions?client_id=<uuid>` |
| 821 | GET | `/api/finance/cards?client_id=<uuid>&include_removed=1` |
| 971 | GET | `/api/payment-links?client_id=<uuid>` |

### Reads (GET, via shared `FHData.clients`)

| Line | Method | URL |
|---|---|---|
| 322 | GET | `/api/dashboard/clients?limit=200` — **shared.** Also called by `public/app/finance-os.html` and `public/app/client-control-panel.html`. Not exclusive. |

### Writes (POST, via shared `FHData.write`)

| Line | Method | URL | Body action |
|---|---|---|---|
| 742 (via 699) | POST | `/api/finance/subscriptions` | `action: "start"` — `{client_id, tier, price, currency}` |
| 758 (via 699) | POST | `/api/finance/subscriptions` | `action: "change"` — `{client_id, tier?, price?}` |
| 768 (via 699) | POST | `/api/finance/subscriptions` | `action: "cancel"` — `{client_id, ends_at?}` |
| 780 (via 699) | POST | `/api/finance/cards` | `action: "add"` — `{client_id, provider_token, brand?, last4?, exp_month?, exp_year?, provider?}` |
| 788 (via 699) | POST | `/api/finance/cards` | `action: "attach"` — `{client_id, card_id}` |
| 788 (via 699) | POST | `/api/finance/cards` | `action: "remove"` — `{client_id, card_id}` |
| 915 | POST | `/api/payment-links` | `action: "create"` — `{client_id, purpose, price, description?}` |
| 915 | POST | `/api/payment-links` | `action: "send"` — `{id}` |
| 915 | POST | `/api/payment-links` | `action: "expire"` — `{id}` |

### ⚠️ FLAG FOR W4 — two endpoints lose their only screen

Verified by searching all of `public/`:

- **`/api/finance/cards`** — `subscriptions.html` is the **only** front-end
  caller. No other screen reads or writes it.
- **`/api/payment-links`** — `subscriptions.html` is the **only** front-end
  caller. Deleting this screen removes the **entire user interface for creating,
  sending, copying and expiring a client payment link.** There is a spec for it
  at `docs/PAYMENT-LINKS-SPEC.md`, a live endpoint at `api/payment-links.mjs`, a
  settle-by-webhook path, and a landing page at
  `public/app/payment-success.html` that will keep working but will have no way
  to get a link into a client's hands.

This is not a reason to stop the delete — it is a reason to decide, before
deleting, where "send this client a pay link" goes. The board says client
payment tracking moves to Finance OS. Payment links are not mentioned on the
board at all.

Per the batch rule "when in doubt, KEEP": **do not delete `api/payment-links.mjs`
or `api/finance/cards.mjs`.** Only the screen was scoped for removal.

---

## 7. Where the screen came from

**The owner did not create it. An agent did.**

| | |
|---|---|
| Added | 2026-07-31, 19:29:51 +0000 |
| Commit | `f992c13b52d8bb1b59f65a18ddef0cd516b3f4f0` (`f992c13`) |
| Author | `Claude <noreply@anthropic.com>` |
| Committer | `Claude <noreply@anthropic.com>` |
| Co-author trailer | `Claude Sonnet 5 <noreply@anthropic.com>` |
| Subject | `[FINANCE OS BUILDOUT] Scaffold: eight new routes registered, six screens navigable, and the net-cash formula corrected — build tracks still in flight` |
| Branch | `main` only. It was never on a side branch. |
| Total commits touching the file | 26 |

The commit message states the reason plainly: about 7,000 lines of already-tested
business logic (`src/subscriptions/store.mjs` among them) had no screen and no
web address, so the agent built front doors for all of it in one go.
`subscriptions.html` was one of **six** shells added that day. Five of the six
were later deleted when Finance OS absorbed them; this one was kept and moved to
the Setup group.

Full history, newest first:

```
36382c6 | Zooted | 2026-08-17 | Batch overnight work: gifts, inquiry cleanup, marketing audit fixes, specialist desk, notion tools, and evidence.
17c20bc | Zooted | 2026-08-17 | Apply the 2026-08-17 UI audit owner answers.
f23ced1 | Zooted | 2026-08-17 | Speed up CRM screens: defer shell scripts, cut fonts, hold card space.
a277622 | Zooted | 2026-08-17 | Close MEDIUM/LOW UI audit rows with shared type, tap, and wrap rules.
d2208fa | Zooted | 2026-08-17 | UI fix run 3: the HIGH rows.
bb6c7cf | Zooted | 2026-08-17 | UI fix run 1: the five UI-STANDARDS pattern rows.
5455ceb | Claude | 2026-08-06 | Remove the dead per-page sidebar implementation from every screen.
3c157e1 | Claude | 2026-08-06 | Stop the desktop sidebar jumping between tabs; normalise content spacing.
e6d19bf | Zooted | 2026-08-04 | Surface Demo Mode: rename nav and add Ops & Admin toggle.
8ad385c | Zooted | 2026-08-04 | Lock the CRM sidebar: fixed rail, Sales-first structure, role gates.
cbcc6a0 | Zooted | 2026-08-04 | Add closer call cockpit, my-numbers, and sales floor dashboards.
87d5e9e | Zooted | 2026-08-04 | Add lender database, CRM Lenders screen, and match wiring.
f2c6d90 | Zooted | 2026-08-02 | Merge branch 'feat/company-brain' (renumbered 127–130 → 130–133)
65b93df | Zooted | 2026-08-02 | Add Company Brain CRM screen with search and owner review queue.
8bcbac6 | Zooted | 2026-08-02 | Fix contract template save 500 and show plain-English errors.
d55dae4 | Claude | 2026-08-02 | Merge branch 'claude/crm-contract-generator-elsk3q' into main
fa59275 | Claude | 2026-08-02 | Contract generator: write once, send, get it signed — no code needed
64dd8a6 | Claude | 2026-08-02 | Add CRM payment links via Commas: create, send, and settle by webhook
d254512 | Zooted | 2026-08-01 | Align the sidebar on subscriptions.html and template-editor.html
2c9be1a | Zooted | 2026-08-01 | Merge branch 'template-editor'
03e3f3e | Zooted | 2026-08-01 | Merge branch 'sidebar-fixes'
ef283a7 | Zooted | 2026-08-01 | Template editor: staff can edit message copy, owner/admin approves on-screen
26b3c1e | Claude | 2026-08-01 | Consolidate eleven Finance screens into Finance OS, wired to real endpoints
cf7156c | Claude | 2026-07-31 | [FINANCE OS BUILDOUT] Alerts, the deal model and the hub — all six tracks live; plus the reminder-writing defect the verifier caught
560ac3d | Claude | 2026-07-31 | [FINANCE OS BUILDOUT] Four of six tracks live: plan and card on file, the card stack, bank accounts, and bills plus cash flow
f992c13 | Claude | 2026-07-31 | [FINANCE OS BUILDOUT] Scaffold: eight new routes registered, six screens navigable, and the net-cash formula corrected — build tracks still in flight
```

Note: the payment-links panel inside this screen came later and from a different
build — `64dd8a6` (2026-08-02, Claude), "Add CRM payment links via Commas".

---

## Notes for W5 (the only workflow that edits)

1. Edit `public/app/sidebar.fragment.html:26` (delete the line), then run
   `node scripts/sync-sidebar.mjs`. That fixes all 34 screen copies and the
   `SIDEBAR_HTML` constant in `shell.js` in one pass.
2. Then hand-edit the four `shell.js` lists: lines 23, 61 (+ comment 54–60),
   131, 384.
3. Delete `public/app/subscriptions.html`.
4. Delete `src/http/subscriptions-screen.test.mjs` — it reads the deleted file
   and is exclusively about it.
5. Repoint the `subscriptions.html` assertions in
   `src/http/app-client-carry.test.mjs` (lines ~201–344) at `finance-os.html`,
   the only remaining `CLIENT_SCREENS` entry. Do not delete those tests — they
   cover the `?client_id=` carry rule, which still applies.
6. Update `e2e/screens-smoke.spec.mjs:24`, `e2e/crm-flows.spec.mjs:185`,
   `e2e/sidebar-roles.spec.mjs:37`, `scripts/tmp-full-live-verify.mjs:107`.
7. Update `docs/SIDEBAR-STRUCTURE.md:28,47`.
8. Sidebar edits and `shell.js` edits **must land in the same commit**, or
   `src/http/app-nav-reachability.test.mjs` goes red.
9. Keep `public/app/finance-os.css`. Finance OS uses it.
10. Keep `api/payment-links.mjs` and `api/finance/cards.mjs`. Losing the screen
    leaves them with no UI — that is a product question for the owner, not a
    delete.

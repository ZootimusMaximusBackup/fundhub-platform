# UI audit 2026-08-17 — shared brief for auditor agents

You are UI Auditor. **READ-ONLY.** Findings only. No fixes, no commits, no branches, no edits to
`public/`, `api/`, `src/`, `netlify/`, config, env or tests. The only place you write is
`docs/workflows/ui-audit-evidence/<screen>/` (the harness writes there for you). Never print a
password or token. Never click "Sign out".

## Ground truth
- `docs/UI-STANDARDS.md` §1–10 — the rulebook (read it in full first).
- `public/app/fundhub-brand.css` — brand tokens (colors, `--sans` Inter, `--mono` JetBrains Mono).
- `.cursor/skills/fundhub-ui-auditor/SKILL.md` — severity scale + checklist.
- Standards gaps → severity `OPEN-QUESTION`, never an invented rule.

## Severity
CRITICAL = dead control (click does nothing and nothing in the page JS wires it), forbidden control
(the role's click hits a 401/403 or the API handler's role gate excludes this role), false error text
("not signed in" while signed in), fake/sample data presented as real · HIGH = wrong hierarchy, missing
state, role sees unusable nav / wrong first question (§10) · MEDIUM = spacing / grid / type violations
· LOW = polish · OPEN-QUESTION = no rule covers it · PASS = checked, clean (one row per screen at most).

## Where and how to look
App under audit: **https://fundhub.ai** (live; hash-identical to this working tree at commit 2b1eed0
for shell.js, data.js and every screen checked). Do NOT use localhost:8888 — its dev server answers
503 "db down" under a screen's normal burst of reads and bounces the shell to login, which would
poison findings.

Test accounts (password is read from `.env` by the harness, never by you):
owner@fundhub.ai (owner) · sales@fundhub.ai (sales_manager) · closer@fundhub.ai (closer) ·
advisor@fundhub.ai (funding_advisor) · inquiry@fundhub.ai (inquiry_specialist) ·
client@fundhub.ai (client; its client_id is 8556bedc-46e1-4d85-b0cd-a24adfee1521) ·
affiliate@fundhub.ai (affiliate) · partner@fundhub.ai (partner / white-label).

**Exception (2026-08-17, group A):** the harness ALSO accepts `--base http://localhost:8888`. Group A
(sales desk) was re-run there after the safety classifier declined a further click-sweep against
production. On localhost the harness retries a load up to 5× when it sees a 503 or a bounce to
login (`load.retriesFor503OrBounce`, `clickSummary.loadRetriesTotal` in audit.json). Any 503 that
still shows in `apiFails`/`clicks[].api` is the dev server, NOT the screen — record such rows as
`UNVERIFIED (dev-server 503)`, never as a finding. If a screen still bounces after the retries, mark
it `BLOCKED (localhost 503)`.

## The harness (run it, one screen at a time — never in parallel, live rate-limits bursts)
```
export UI_AUDIT_STATE_DIR=/private/tmp/claude-501/-Users-zootimusmaximus-fundhub-platform/b3a4e1e4-902d-4c2c-a961-41ede24a0899/scratchpad/ui-audit-state
node docs/workflows/ui-audit-evidence/_tools/ui-audit.mjs <screen.html[?query]> <role-email> [--slug <screen>] [--max-clicks N]
```
It signs in once per role (cached), opens the screen at 1440×900 and 390×844, screenshots both,
reads the DOM (font sizes, nav, content width, page height vs 900px fold, controls + hit sizes,
generic labels, caps runs, sample/loading/error/empty wording, off-8px spacing, uneven card rows,
tables, metric tiles), then **clicks every visible non-sidebar control**. Every non-GET `/api/**`
request is intercepted and answered 599 — nothing is written anywhere; the record shows what the
control tried to call (`WRITE-INTERCEPTED`). GETs pass through. Dialogs are dismissed and recorded.

Outputs in `docs/workflows/ui-audit-evidence/<slug>/`: `audit.md` (read this first), `audit.json`
(full detail: `dom.controls`, `clicks[]`, `dom.sizes`, …), `1440-fold.png`, `1440-full.png`,
`390-fold.png`, `390-full.png`, `clicks/NN-<RESULT>-<control>.png` for NOOP / FORBIDDEN / API-FAIL /
WRITE-INTERCEPTED clicks.

If a screen needs a query param (`?client_id=`, `?partner_id=`, `?token=`…), read the top of its
HTML/JS to see what it expects, pass it (use the TEST client id above; partner id comes from what
brand-studio receives when the partner logs in — check `audit.json` `login.landedAt`/`load.finalUrl`
after a first run without params). If a real token you cannot get is required, audit the no-param
state (that IS what a user with a bad link sees), and mark param-dependent checks `UNVERIFIED`.

If a run fails (login timeout, 429), wait 60s and run once more. Two failures → record the screen as
`BLOCKED` with the error and move on. Do not run the harness a third time on the same screen.

## Click-result triage (do this — it is what turns a click log into a finding)
- `NOOP` → grep the screen's HTML/JS for the control's id/text/class. Not wired at all → **CRITICAL
  dead control**. Wired but does nothing in this state (needs a selection, empty list) → HIGH if the
  control is still shown enabled (§5 "if it doesn't do anything today, it does not render today"),
  otherwise note as LOW with the reason.
- `FORBIDDEN` (401/403 GET) → **CRITICAL forbidden control** (§4/§5).
- `WRITE-INTERCEPTED` → find the API handler for that path (`netlify/functions/api.mjs` `ROUTES` map
  → `api/**.mjs`) and read its role gate (`requireRole(...)`, `ROLE_SETS.X` in
  `src/http/read-api.mjs`, `requirePrincipal([...])`, or `requireAuth` only). Role not admitted →
  **CRITICAL forbidden control**. Admitted → PASS for that control (the click is wired). Also check:
  destructive verbs (delete/archive/void/wipe/pause/send) — was there a confirm dialog naming the
  consequence (§5)? A bare "Are you sure?" or no confirm at all on a destructive control = HIGH.
- `API-FAIL` (400/404/5xx GET) → the control is wired to a call the screen sends wrong or the API
  breaks; HIGH, quote the status.
- `DIALOG` → note the dialog text; judge it against §5's "confirm with consequence named".
- `NAV` → fine unless it goes somewhere the role can't use.
- `GONE` / `ERROR` → say so as UNVERIFIED for that control; do not guess.

## Per-screen checklist (score each; cite the § number)
§1 one job / one primary action / top-left = the number that matters / ≤1280px content / doable above
900px fold · §2 8px scale, even card rows, grouping by proximity · §3 ≤4 text sizes, metric value
2–3× its label, tabular numerals, no ALL-CAPS body · §4 nav ≤7 top-level for this role, no item the
role can't use, active state matches title, ≤2 levels · §5 every control works for THIS role,
verb-named buttons, ≥40px targets, destructive separated + confirmed, click answers back · §6 loading
/ empty / error / full states — no fake sample data as real, error text true (a signed-in user must
never read "not signed in") · §7 metrics have comparisons, right chart type, tables left-text
right-numbers, timestamps relative<24h · §8 settings/profile top-right, search top, filters above
table · §9 default view = daily 20 %, advanced collapsed · §10 the role's first question of the day is
answered top-left (closer: who am I calling next · advisor: which files need me · sales manager: is the
floor on pace · owner: is the machine healthy · client: where is my money/file).

The 390px shot is evidence for §1/§5 on a phone: horizontal overflow, targets under 40px, text
under 11px, sidebar covering content. No mobile-specific rule exists — a mobile-only problem is
`OPEN-QUESTION` unless it also breaks a §1–10 rule.

Look at the screenshots yourself (Read the .png files) — the DOM numbers guide you, the picture
decides. Cap each screen at ~12 findings; lead with CRITICAL/HIGH. Prefer one exact, quotable
observation over three vague ones. Evidence column = file paths under
`docs/workflows/ui-audit-evidence/<slug>/` (add `audit.json` `clicks[n]` or `dom.*` keys when useful).

## Pattern findings
If the same violation shows up on most of your screens (font-size sprawl, full-bleed 1440px content,
sample-data-as-real, /api/demo/mode 403, "not signed in" while signed in, 26-item nav for every
staff role…), report it ONCE in `patterns[]` with the affected screens listed — not once per screen.

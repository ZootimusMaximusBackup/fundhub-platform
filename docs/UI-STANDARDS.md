# UI-STANDARDS.md — FUNDHUB LAYOUT LAW

Read before building ANY screen. Brand (colors, fonts, spectrum) lives in fundhub-brand.css — this file is layout, hierarchy, and behavior. If a rule here conflicts with a request, flag it, don't silently pick.

---

## 1. THE PAGE

- **One job per screen.** Every screen answers one question or enables one task. If you can't say the job in one sentence, it's two screens.
- **One primary action per screen.** Exactly one filled/prominent button. Everything else is secondary (outline) or tertiary (text link). Two primary buttons = a decision the designer refused to make.
- **Top-left is the most important thing.** Eyes land there first (F-pattern). The number or status the role cares about most goes top-left, largest. Never a logo, never a filter.
- **Max content width 1280px, centered.** Full-bleed dashboards read as unfinished. Tables may go wider inside their own scroll container.
- **The fold matters.** The screen's job must be doable without scrolling on a 13" laptop (900px viewport height). Below the fold is for detail, never for the primary action.

## 2. LAYOUT GRID

- **8px spacing scale only:** 8 / 16 / 24 / 32 / 48 / 64. No 10px, no 14px, no eyeballing. Related items 8-16 apart, groups 24-32 apart, sections 48-64 apart.
- **Proximity is meaning (Gestalt).** Things close together read as related. If two cards aren't related, they need more space or a divider — not a border on everything.
- **12-column grid.** Cards span 3, 4, 6, or 12. Never 5, never 7. Uneven card widths in one row = slop signature #1.
- **Align to edges, not centers.** Left-align text and numbers in cards. Centered body text is for marketing pages only.

## 3. HIERARCHY & TYPE

- **Three text sizes per screen, max four.** Big number / section title / body / caption. More sizes = no hierarchy.
- **Numbers are the heroes on dashboards.** Metric value 2-3x the size of its label. Label above or below in muted color, never beside it fighting for attention.
- **Tabular numerals for all metrics and tables** so columns of numbers align.
- **No ALL-CAPS body text.** Caps for small labels/eyebrows only, with letter-spacing.

## 4. NAVIGATION

- **Max 7 top-level nav items per role (Miller).** More than 7 = group or cut.
- **Role-scoped nav.** A user never sees a nav item they cannot use. No disabled nav, no 403-on-click. If the role can't act on the screen, the item does not render. (This is finding-class UI-12 from the Aug 16 audit — 12 rows of it.)
- **Current location always visible.** Active nav state + page title match. User answers "where am I" in zero seconds.
- **Two levels deep, max.** If it needs a third level, the IA is wrong.

## 5. ACTIONS & CONTROLS

- **Big targets (Fitts):** minimum 40px hit area, primary actions 44px+. Destructive actions physically separated from safe ones — never adjacent.
- **Every visible control works.** No buttons wired to nothing, no controls the role lacks permission for, no "coming soon" UI in production. If it doesn't do anything today, it does not render today.
- **Buttons say what happens:** "Send letters," "Add closer," "Run soft pull" — never "Submit," "OK," "Go."
- **Destructive = confirm with consequence named.** "Delete 14 contacts? This can't be undone." Never a bare "Are you sure?"
- **Every action answers back.** Click → immediate state change: spinner in the button (not page takeover), then success/failure where the user is looking. Silent success is a bug.

## 6. STATES (every screen ships all four or it isn't done)

1. **Loading** — skeletons in the real layout. Never a blank screen, never a full-page spinner.
2. **Empty** — says what will appear here + one action to make it appear. "No clients yet. Add your first client." NEVER fake sample data presented as real. (Audit finding: sample furniture with a false excuse = trust destroyed.)
3. **Error** — says what failed, in the user's words, and what to do next. Never a raw status code, never a lie ("not signed in" when they are signed in).
4. **Full** — the happy path, designed against realistic volume: 27 clients, not 3. Long names truncate with tooltips, tables paginate at 25.

## 7. DATA DISPLAY

- **Data-ink (Tufte):** no gridlines heavier than the data, no borders around everything, no gradients or 3D on charts, no decorative icons beside every metric. If deleting a pixel loses no information, delete it.
- **Right chart for the job:** trend = line, comparison = bar, composition = stacked bar (pie only with ≤3 slices), single status = big number. Default is the big number, not a chart.
- **Every metric has a comparison.** A number alone means nothing: vs yesterday, vs target, vs last week — small, muted, beside or under the value.
- **Tables:** left-align text, right-align numbers, one-line rows, sort on the column the role cares about by default. Row click opens detail; actions live in the row's far right.
- **Timestamps:** relative under 24h ("2h ago"), absolute after ("Aug 14, 3:02 PM"). Always tooltip the exact time.

## 8. FAMILIARITY (Jakob's Law)

- Settings gear top-right. Profile top-right corner. Search top. Notifications bell. Filters above the table, left. Save bottom-right of forms.
- Don't invent novel patterns for solved problems. Novelty budget is zero on internal tools.

## 9. PROGRESSIVE DISCLOSURE

- **Default view = the 20% used daily.** Everything else one click deeper (tabs, "View details," drawers).
- Advanced filters collapsed by default. Bulk actions appear on selection, not before.
- A new employee should understand any screen's default state in 10 seconds without training.

## 10. ROLE LENS (Fundhub-specific)

Every dashboard is built for its role's first question of the day:
- **Closer:** "Who am I calling next?" — today's calls, top-left. Not company metrics.
- **Funding advisor:** "Which files need me?" — action queue first.
- **Sales manager:** "Is the floor on pace?" — held/booked/closed today vs target.
- **Owner:** "Is the machine healthy?" — cash, CAC, close rate, pipeline. The ONLY role that sees company-wide metrics by default.
- **Client:** "Where is my money/file?" — status of their thing, next step, one contact action.
If a screen serves the wrong question first, it fails this doc regardless of how clean it looks.

---

*Slop signatures (instant fail): uneven card rows · five borders where spacing would do · buttons that 403 · sample data as real · full-page spinner · centered paragraphs · "Submit" · six font sizes · metrics with no comparison · nav items a role can't use.*

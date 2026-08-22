# Portal course surface — 2026-08-21

**Goal:** Decide how the 2 paid courses show inside the client portal after payment unlock.

**Courses (only these two):**

| Key | Tile today | What it is |
|---|---|---|
| `UWIQ_DELIVERABLES` | UnderwriteIQ Deliverables Package · $1,000+ | PDFs + **mini course** (“How To Use This”) |
| `FUNDING_MASTERY` | Funding Mastery course (A to Z) · $5,000 | Full program |

**Constraint Chris named:** tiles unlock → press the tile → course appears from that.

## Workflows

| ID | Owns | Status | Owner |
|---|---|---|---|
| W1 | Ground: unlock + course names | pending | — |
| W2 | Mock concepts (pickable) | done | this session |

## W2 deliverable

Canvas: [portal-course-surface-mocks](/Users/zootimusmaximus/.cursor/projects/Users-zootimusmaximus-fundhub-platform/canvases/portal-course-surface-mocks.canvas.tsx)

Patterns:
- **A** Tile flips into a door (closest to Chris’s lean)
- **B** Unlock More sells · Your Courses plays
- **C** Pack tile opens a shelf (PDFs + mini course)
- **D** Sticky Continue learning bar
- **E** Course row inside What You Own

Waiting on Chris pick (letter or mix).

## Owner decision (2026-08-21) — built

**Pattern: expand-in-place accordion on the existing Unlock More tiles.**

- Do **not** remove tiles.
- Keep the current `#tiles` grid and the six `article.tile` cards.
- After payment: course tiles show **Unlocked** + **Open**; tap tile or Open → expands modules under that tile; rest of portal stays.
- Non-course included tiles still say **Included** / **View status**.
- `MAP.FUNDING_MASTERY` → `funding-mastery-course` so the $5k tile can unlock when entitled.

## Change manifest

- `public/app/client-portal.html` — course expand CSS, panels on UWIQ + Mastery tiles only, paintTile Open/Close, tap toggle, Mastery MAP
- `e2e/client-portal-ux.spec.mjs` — expand tests for both course tiles
- Videos: honest empty slots (“Video will show here when it is ready”) until real lesson files exist

## Ship (2026-08-21)

- Status: **blocked on Netlify credits** — code is on `main` (`48482eab`), live site still old hash
- Files: portal HTML + e2e + this board (committed + pushed)
- Mock `public/course-expand-mock.html`: removed (local preview only; not customer surface)
- CLI/API deploy error: `Account credit usage exceeded - new deploys are blocked until credits are added`
- After credits: one production deploy from `main`, then prove Open on unlocked UWIQ + Funding Mastery tiles at `/app/client-portal.html`

## Left for later

- Real lesson videos / Content Admin wiring into `.tc-vid`
- Live prove after credits + deploy

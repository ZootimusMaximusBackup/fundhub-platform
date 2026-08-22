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

- Status: **LIVE** — course expand is on production
- Code on `main`: `48482eab` (feature) … `4f52cafa` (credit-block note); `origin/main` matches local HEAD
- Production deploy published: `6a88ea62a8f1524f4aa37f06` (context production, branch `main`, published `2026-08-22T00:16:56Z`)
  - URL: https://fundhub.ai
  - Admin: https://app.netlify.com/projects/transcendent-wisp-888771/deploys/6a88ea62a8f1524f4aa37f06
- Credits: no longer blocking (deploys accepted again)
- Follow-up remote build `6a88eb62bb8cefe5b20a50f2` failed build script exit 2 (did not unpublish the ready deploy)
- Live proof (`https://fundhub.ai/app/client-portal.html`):
  - HTML shasum matches `public/app/client-portal.html` on main (`2d195722…`)
  - Markers present: `tile-course` (14), `COURSE_TILES` (2), `data-course-toggle` (6), `funding-mastery-course` (1)
- Mock `public/course-expand-mock.html`: removed (not customer surface)

## Left for later

- Real lesson videos / Content Admin wiring into `.tc-vid`
- Human click-prove Open on an unlocked UWIQ + Funding Mastery account (needs a real entitled client login)

# ClickFunnels fragment repair — shared board

**Status:** done (local pack green)  
**Pack location:** `clickfunnels-fragments/`  
**Source zips:** `~/Downloads/Fundhub FUnnel FOr CUrsosr.zip`, `~/Downloads/more bullshit.zip`

## Task list

| Unit | Owner | Status |
|------|-------|--------|
| Import pack + scrape missing live fragments | this session | done |
| A — Harness (local CF sandwich) | this session | done |
| B — Bug 1 fix `02b` | this session | done |
| C — Grid architecture + black audit (Bugs 3–4) | this session | done |
| D — Floating cards + consistency (Bugs 2–5) | this session | done |
| E — Playwright break suite | this session | done |
| Emit `fixes.md` + drop-in fragments | this session | done |
| Paste into live ClickFunnels | Chris | pending |

## Drop-in files

- `01-vsl.html`
- `02a-apply-top.html`
- `02b-apply-bottom.html`
- `04a-book-top.html`
- `04b-book-bottom.html`
- `05-thank-you.html`

Originals under `originals/`. Change log in `fixes.md`.

## Verify

```bash
cd clickfunnels-fragments && npm test
# 654 passed
```

## Change manifests

- Fragments: single fixed `body::before` grid; no `100vw` hacks; no page-level `#0A0A0A`; 900px column; Survey/AppointmentScheduler floating cards.
- `02b`: keyframes closed, CSS vars on `.fh-b`, marquee animation restored, logo restored.
- Harness + Playwright under `clickfunnels-fragments/`.

## Blockers / open questions

1. Chris pastes drop-ins into CF Custom HTML elements (manual).
2. Live CF widget chrome may need a visual check after paste (harness uses placeholders).

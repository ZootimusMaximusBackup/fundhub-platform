# Messaging review — 2026-08-21

Read-only inventory + timing audit. No app fixes in this batch. **Not complete until Chris marks decisions.**

## Tasks

| Id | Owner | Status | Notes |
|---|---|---|---|
| A-copy-pack | agent | done | `A-copy-inventory.md` + `journey-spine.md` (refreshed — wired bodies fixed) |
| B-agent-prompts | agent | done | `B-agent-prompts.md` (vendor + GHL + chat/repair/creative) |
| C-timing-audit | agent | done | `C-timing-audit.md` — 55 workflows + findings 1–10 |
| D-merge-docx | agent | done | `Fundhub-Messaging-Review.docx` rebuilt after alias fix |
| E-editable-canvas | agent | done | [messaging-review canvas](/Users/zootimusmaximus/.cursor/projects/Users-zootimusmaximus-fundhub-platform/canvases/messaging-review.canvas.tsx) — KEEP/CHANGE/KILL/WRONG-TIME |
| F-chris-marks | Chris | **parked** | Template copy marks — footer debate closed; resume later if needed |
| G-workflows-canvas | agent | done | [workflows-audit canvas](/Users/zootimusmaximus/.cursor/projects/Users-zootimusmaximus-fundhub-platform/canvases/workflows-audit.canvas.tsx) — 55 registered workflows |
| H-chris-workflow-marks | Chris | **pending** | Mark workflows KEEP / CHANGE / KILL / WRONG-TIME; Export → paste in chat |

## Deliverables

- Word: [`docs/workflows/messaging-review-2026-08-21-evidence/Fundhub-Messaging-Review.docx`](messaging-review-2026-08-21-evidence/Fundhub-Messaging-Review.docx)
- Canvas: [`messaging-review.canvas.tsx`](/Users/zootimusmaximus/.cursor/projects/Users-zootimusmaximus-fundhub-platform/canvases/messaging-review.canvas.tsx)
- Evidence folder: `docs/workflows/messaging-review-2026-08-21-evidence/`

## Scope (owner-locked)

- Main body: journey-wired templates + timing beside each beat
- Appendix A: orphans (141)
- Appendix A2: duplicate alias rows (9) — not what workflows send; mark KILL unless intentional
- Appendix A3: missing BS-REPAIR grid slots (6) — not in live dump
- Journey-wired keys: **93**
- Decisions Chris marks: KEEP / CHANGE / KILL / WRONG-TIME

## Pack refresh (2026-08-21 afternoon)

Earlier pack preferred alias live rows over wired keys, so some SMS bodies shown were **wrong** (unapproved duplicates). Fixed in `_build-pack.mjs` / rebuilt Word + canvas. Do **not** treat the pre-refresh Word as truth.

## Manifests

### A — Copy pack

- Evidence: `messaging-review-2026-08-21-evidence/A-copy-inventory.md`
- Bodies: `journey-spine.md` (source for Word)
- Live dump reused: `docs/workflows/live-journey-2026-08-20-evidence/all-template-copy.md` (237 rows)

### B — Agent prompts

- Evidence: `messaging-review-2026-08-21-evidence/B-agent-prompts.md`
- Includes: setter, Experian, Equifax, TransUnion, collections, doc-chase, 8× GHL `$prompt$`, portal/staff assistants, bureau response, creative copy

### C — Timing audit

- Evidence: `messaging-review-2026-08-21-evidence/C-timing-audit.md`
- 55 workflow files; sleeps + template keys + agentic flag

### Findings (timing / pack — no fixes)

1. **165/237** templates `compliance_passed=false` → queue refuses send → looks like “never came.”
2. **`booking.created` pile-up:** S-04B + BS-01 (email grid + 3 SMS) + AI-SET-01 + AI-SET-04 + DPC-05 (+ N-03) all can fire.
3. **`survey.submitted` pile-up:** N-02 + S-NOBOOK (2h/24h/72h).
4. **`round.started` pile-up:** round-started SMS + F-02 (3h/+2d) + F-10.
5. **Day-of duplicate risk:** BS-01 DAYOF (−2h) and S-04B remind (−2h).
6. **Dispatch sweeper** must drain queue; `outbound_enabled` + providers gate all outbound.
7. **AX-07** email/SMS seeded, no workflow caller found.
8. **Alias duplicates:** 9 live SMS keys differ from wired keys workflows send (Appendix A2).
9. **Missing BS-REPAIR slots:** 6 expected grid emails not in live dump (Appendix A3).

## Still needs Chris

Open the canvas (preferred) or Word. Mark **journey-wired only** first. Paste Export / decisions back in chat.

**Stop.** No Fixer, no `compliance_passed` flips, no button crawl until marks return.

## Status (2026-08-21 evening)

- **Email footer:** parked. Chris is done debating it for now — do not reopen footer copy/layout in this batch.
- **Workflows view (preferred):** [`workflows-flowchart.canvas.tsx`](/Users/zootimusmaximus/.cursor/projects/Users-zootimusmaximus-fundhub-platform/canvases/workflows-flowchart.canvas.tsx) — life-moment piles + repair holes (TWEAK / MOVE / ADD-REPAIR / OK). Not messaging KEEP/KILL.
- **Next:** mark one pile on the workflows flowchart; Fixer waits.
  - Older list canvas (optional): [`workflows-audit.canvas.tsx`](/Users/zootimusmaximus/.cursor/projects/Users-zootimusmaximus-fundhub-platform/canvases/workflows-audit.canvas.tsx)
  - Evidence: `C-timing-audit.md` + `src/workflows/index.mjs` (55 registered)

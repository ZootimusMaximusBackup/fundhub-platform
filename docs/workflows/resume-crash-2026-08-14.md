# Resume after crash — 2026-08-14

The last cloud run died after dumping gold-break + gold-deliverables onto
`cursor/cloud-agent-1786743383383-szndn` (one commit: “Apply local changes”).
This branch `cursor/resume-gold-break-1dea` is that snapshot. Continue from here.

**Model law:** Grok only for subagents. Grok 4.6 extra-high if wrong is expensive
(letters, QR, reports). Grok 4.5 high for smash wiring/tests. W8 typeface stays
Claude — do not run it on Grok.

**Hard fences:** `CRS_ALLOW_LIVE=0`. Do not `--prod`. Do not drain the outbox
(`outbound_enabled` stays false). Do not print secrets. Do not dump the queue.
GHL is OUT. SMS prove is Monday. One agent per file fence.

Shared board for smash details: `docs/workflows/gold-break-gauntlet.md`.
Gold look: `docs/workflows/gold-deliverables-v5.md` (W8 parked).

## Task list

| id | unit | files | status |
|----|------|-------|--------|
| R0 | Recover crashed snapshot onto this branch + this board | this file | **done** |
| R1 | CI: regenerate stale journeys | `docs/journeys/*-actual.md` | **done** — parent |
| R2 | CI: outbound fence | `src/finance/crs-pull.mjs` allowlisted as wrap; deleted `netlify/functions/tmp-cf-seam-watch.mjs` | **done** — parent |
| R3 | CI: SMS tests after GHL stub | `src/messaging/dispatch.test.mjs`, `dispatch-fence.test.mjs` | **done** — parent |
| R4 | Smash remaining registered workflows (one agent each) | see smash table | launching |
| R5 | C-06 in-repo funding pack (kill Vercel 401) | `src/workflows/c-06-crs-results-router.mjs` + test | **done** |
| R6 | CRM inbox + docs re-check after W2/W3 mail | live `fundhub.ai` only; evidence under `e2e-verify-run4-evidence/w4-crm-ui/` | pending — needs live login `.env` |
| R7 | Delete leftover tmp prove scripts | `scripts/tmp-*`, `netlify/functions/tmp-*` except anything R2 already deleted | **done** |
| R8 | Live Playwright 100 | `npm run test:e2e:live` vs fundhub.ai | **blocked** — no `.env` on this VM. Last PASS 100/100 on 2026-08-14 |
| W8 | Letter typeface Inter + JetBrains Mono | letter-generator fonts only | **parked — Claude session** |

## Smash remaining (not on gold-break as done)

Each unit owns **only** `<file>.mjs` + `<file>.test.mjs` + append to
`docs/workflows/gold-break-gauntlet.md`. No other files. No `--prod`. No email.

Copy the smash pattern from `src/workflows/dpc-03-inbound-reply-router.test.mjs`
(null event no throw, missing client, duplicate, fetch trap, source grep vs
`fetch` / CRS live / outbox drain).

| id | file | model |
|----|------|-------|
| S-AF02 | `af-02-referral-ownership-capture` | Grok 4.5 high |
| S-AI03 | `ai-set-03-no-answer-cadence` | Grok 4.5 high |
| S-AI04 | `ai-set-04-3way-handoff` | Grok 4.5 high |
| S-AT01 | `at-01-first-touch-capture` | Grok 4.5 high |
| S-BC01 | `bc-01-customer-responsiveness` | Grok 4.5 high |
| S-BC02 | `bc-02-customer-friction` | Grok 4.5 high |
| S-BS01 | `bs-01-precall-launcher` | Grok 4.5 high |
| S-CC | `contract-chaser` | Grok 4.5 high |
| S-MDS | `message-dispatch-sweeper` | Grok 4.6 extra-high — tests only, never call drain live |
| S-DPC05 | `dpc-05-no-progress-escalation` | Grok 4.5 high |
| S-F01 | `f-01-funding-intake` | Grok 4.5 high |
| S-F02 | `f-02-portal-id-missing` | Grok 4.5 high |
| S-F03 | `f-03-round-submitted` | Grok 4.5 high |
| S-F04 | `f-04-round-approvals` | Grok 4.5 high |
| S-F06 | `f-06-funding-conditions-missing-docs` | Grok 4.5 high |
| S-F07 | `f-07-funding-locked` | Grok 4.5 high |
| S-F08 | `f-08-post-funding-monitoring` | Grok 4.5 high |
| S-F09 | `f-09-funding-declined-no-path` | Grok 4.5 high |
| S-F10 | `f-10-client-funding-inbox-provisioner` | Grok 4.5 high |
| S-F11 | `f-11-bank-email-event-router` | Grok 4.5 high |
| S-N01 | `n-01-cold-nurture` | Grok 4.5 high |
| S-N02 | `n-02-warm-nurture` | Grok 4.5 high |
| S-N03 | `n-03-hot-nurture` | Grok 4.5 high |
| S-N04 | `n-04-post-funding-nurture` | Grok 4.5 high |
| S-N06 | `n-06-renewal-second-wave` | Grok 4.5 high |
| S-RND | `round-started-client-notify` | Grok 4.5 high |
| S-S01 | `s-01-new-lead-intake` | Grok 4.5 high |
| S-S02 | `s-02-incomplete-survey-nudge` | Grok 4.5 high |
| S-S04 | `s-04-call-booked` | Grok 4.5 high |
| S-S05A | `s-05a-no-show-recovery` | Grok 4.5 high |
| S-S06 | `s-06-post-call-funding-purchased` | Grok 4.5 high |
| S-S08 | `s-08-post-call-funding-declined` | Grok 4.5 high |
| S-SYS1 | `sys-01-client-value-calculator` | Grok 4.5 high |
| S-SYS1B | `sys-01-ltv-calculator` | Grok 4.5 high |

## Parent owns

R1–R3 CI green on this branch. Then PR update. Smash agents PR into
`cursor/resume-gold-break-1dea`, not `main`.

## Left from last run (do not redo)

Gold-break B1–B36 marked **done** on that board. CRS company prove W1–W5 PASS
with C-06 UIQ 401 as the recorded gap. Demo wipe done. Twilio A2P waiting.
Outbox paused.

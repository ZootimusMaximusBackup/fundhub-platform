# 03 — Interactions (event spine)

How LIVE 05/30 pieces chain. **CONFIRMED** from Part A; Mermaid is STRUCTURE-INFERRED packaging of those bullets.

## Happy path — funding client

```mermaid
flowchart TD
  A[Stage 0: First touch<br/>AT-01 / AF-02] --> B[Stage 1: S-01 + Survey]
  B --> C{Stage 2: Survey gates}
  C -->|PASS both| D[Stage 3: Book call<br/>S-04 / S-04B / AI-SET-01]
  C -->|FAIL either| X[App-stage repair downsell<br/>outsourced — not R-series]
  D --> E[Stage 4: On-call soft pull<br/>C-00 → U-03 → U-04<br/>write recommendation]
  E --> F{Stage 5: C-06 fork}
  F -->|FUNDING| G[Close funding<br/>S-06 + funding letters]
  F -->|REPAIR downsell| H{Rep Sales Outcome}
  F -->|HARD DECLINE| I[Decline tag + email/SMS]
  H -->|Referral Sent| J[DS-01 partner refer]
  H -->|DIY Purchased| K[DS-02 paid letters]
  G --> L[Stage 6: F-01 / F-02 / F-06 / F-10]
  L --> M[Stage 7: F-03 / F-04<br/>F-05 → C-02 → C-03 → C-04]
  M --> N[Stage 8: F-07 Funding Locked]
  N --> O[Stage 9: AR-01..04 while Balance Due > 0]
  N --> P[Stage 10: F-08 → N-04; later N-06]
```

## Always-on overlays (any stage)

```mermaid
flowchart LR
  subgraph Always
    AT[AT / AF ownership]
    BC[BC-01/02/03 tone]
    DPC[DPC-02/03/04/05]
    HX[HX health + Recon]
  end
  Contact((Contact)) --- Always
```

## Critical sequencing truths (CONFIRMED)

1. **Recommendation does not exist until Stage 4** (on-call CRS). Anything that routes on recommendation **before** the call is outdated.  
2. DS-01 / DS-02 fire from **Stage 5 Sales Outcome**, not from survey alone (survey fail has its own earlier downsell).  
3. Funding letters: C-06 FUNDING branch (and historically U-02 funding path — tension; see gaps).  
4. DIY: **no re-pull** after DS-02 — CRS already ran on the call.  
5. AR only while **Balance Due > 0**.  
6. DPC-05 catches stalls anywhere after 72 hours without progress.

## Canonical events in current code (STRUCTURE-INFERRED map)

Repo spine (`src/events/canonical.mjs`) approximates:

| Stage intent | Closest canonical event(s) |
|---|---|
| First touch / lead | `entry.captured` |
| Survey done | `survey.submitted` |
| Soft-pull paid | `diagnostic.paid` |
| CRS / analysis done | `analysis.completed` (+ `decision.rendered`) |
| Booked | `booking.created` |
| Call done / no-show | `call.completed` / `booking.noshow` |
| Funding deposit | `deposit.paid` / `sale.closed` |
| Rounds | `round.started` / `submitted` / `approved` / `funded` |
| DIY payment | `payment.received` (generic — risk) |
| Inbound SMS | `message.inbound` |
| Bank mail | `mail.response` |
| Inquiry cleared | `inquiry.removed` |

**Extra in current code (tension with Part A):** full `repair.*` and `diy.package.*` event families in `canonical.mjs`, plus `src/repair/` handlers registered from `src/workflows/index.mjs`.

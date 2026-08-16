# Sample roster · usable packs — 2026-08-14

**Owner laws:** GHL out. No Vercel. Funding mail = Underwrite IQ analysis PDFs (credit analysis, roadmap, funding snapshot, lender list) plus letter-generator bureau letters. Repair mail = dispute letters after DIY pay. Email = Resend with real PDFs attached. No SMS. Sandbox CRS copy. Outbox stays paused. One-shot `dispatchMessage` only.

**Bar:** no PDF on the mail → do not send. Funding mail without the four analysis PDFs → do not send.

| Unit | Owner | Status |
|------|-------|--------|
| W0 Attachments + existing UIQ PDFs | this chat | done |
| W0b UIQ analysis deliverables (not just letters) | this chat | done |
| W1 Five sample clients + CRS sandbox | this chat | done |
| W2 Funding packs (people 1–3) | this chat | **done** — +full 12:49; +fpr/+prem 1:12pm |
| W3 Repair pack (person 4) | this chat | done (letters, 12 PDFs) |
| W4 Review/hold + Gmail check | this chat | +review correctly has **no** pack |

## Five mock clients (do not skip)

All mail lands in `stanbridgejchris@gmail.com` (plus-alias on the client row; Resend sends to the exact Gmail).

| Person | Path | Expected mail | Status 2026-08-14 |
|--------|------|---------------|-------------------|
| `+full` | FULL_FUNDING | Funding pack: 4 analysis PDFs + letters | **PASS** — 12:49, 11 PDFs, `sent` (ignore 12:39 JSON junk) |
| `+fpr` | FUNDING_PLUS_REPAIR | Same funding pack | **PASS** — 1:12pm, 10 PDFs (4 analysis + letters), `sent` |
| `+prem` | PREMIUM_STACK | Same funding pack | **PASS** — 1:12pm, 10 PDFs (4 analysis + letters), `sent` |
| `+repair` | REPAIR_ONLY after DIY pay | Dispute/correction letters | **PASS** — 12:25, 12 PDFs, `sent` |
| `+review` | MANUAL_REVIEW | **No** pack email | **PASS** — zero outbound rows |

Templates: `EMAIL-U02-ANALYZER-FUNDING-DELIVERY` and `EMAIL-DS02-DIY-LETTERS-READY` are `compliance_passed=true`. Repair U-02 template stays **false** (must not send a free repair pack).

Live Playwright 100 (`docs/workflows/live-playwright-100.md`) is a **site** score, not this email roster. Last evidence 2026-08-13: **19/19**. That does not check these five packs.

Org: `fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6` (`fundhub`)
All mail → `stanbridgejchris@gmail.com`. Phone `+16616180865`.

12:39 Gmail subject `Your Underwrite IQ analysis pack is ready` was broken (Claude JSON dumped into PDF). Fixed prompt + renderer guard. Resent **12:49** (`Fundhub 2`) with readable markdown PDFs — open that one, ignore 12:39.

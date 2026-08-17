# Live re-verify — portals (partner / affiliate / client) — 2026-08-17 20:13Z

Live `https://fundhub.ai`. Harness `--no-clicks`. Logins all ok (`STAFF_E2E_PASSWORD` only; no separate client/affiliate/partner password names in `.env`).

| Screen | Login | HTTP | Bounce | 503 retry |
|---|---|---|---|---|
| brand-studio.html | partner@fundhub.ai → role partner | 200 | no | 0 |
| affiliate.html | affiliate@fundhub.ai → role affiliate | 200 | no | 0 |
| client-portal.html | client@fundhub.ai → role client | 200 | no | 0 |
| payment-success.html | client@fundhub.ai (cached) | 200 | no | 0 |

Evidence: `_reverify-live/brand-studio/` · `_reverify-live/affiliate/` · `_reverify-live/client-portal/` · `_reverify-live/payment-success/` (`1440-fold.png`, `1440-full.png`, `audit.json`, `audit.md`).

Stamps were not trusted. HOLDS only if Expected was true on this run. Click-only claims are UNVERIFIED.

| Line | Screen | Expected | Live | Verdict | Evidence |
|---|---|---|---|---|---|
| 234 | PATTERN — brand-studio, affiliate, client-portal | Success shown only after the server confirms | Settled load: Brand Studio chip is DRAFT, no Saved / IN REVIEW. Affiliate has no License signed. Client portal shows no unlock-success flash. Writes were not clicked. | **HOLDS** on settled paint. Click path not run. | brand-studio/1440-fold.png · affiliate/1440-fold.png · client-portal/1440-fold.png |
| 235 | PATTERN — brand-studio, client-portal | Portal screens call routes that admit the portal principal | Partner: `/api/partner-brand` and `/api/partner-pages` → 200. Client: `/api/read/documents` → 403 and `/api/dashboard/client` → 403. | **DOES-NOT-HOLD** | client-portal/audit.json · brand-studio/audit.json |
| 236 | PATTERN — brand-studio, affiliate, client-portal | Status strip does not cover controls | Brand Studio Save & apply at y=821 sits above the bottom strip. Affiliate Ask is in the Company Brain block. Client Chat / Send sit above the tan footer. | **HOLDS** | brand-studio/1440-fold.png · affiliate/1440-fold.png · client-portal/1440-fold.png |
| 523 | brand-studio.html | Verify works for the partner, or does not render | No Verify control in the DOM. Domain card is NOT CONNECTED. | **HOLDS** | brand-studio/1440-full.png · audit.json |
| 524 | brand-studio.html | Submit for approval sends for review and only then reports success | Button reads Submit for approval. Chip stays DRAFT. No IN REVIEW on load. Click not run (`--no-clicks`). | **UNVERIFIED** | brand-studio/1440-fold.png |
| 525 | brand-studio.html | Save & apply reports success only after the server accepts | No Saved copy on load. Click not run. | **UNVERIFIED** | brand-studio/1440-fold.png |
| 526 | brand-studio.html | Funnel cards, FUNNELS LIVE tile, and Create pages agree on selection | Tile is 0 of 6 available. Six funnel cards, none treated as live. Copy: No page drafts yet. Select funnels above, then Create pages. | **HOLDS** | brand-studio/1440-full.png |
| 527 | brand-studio.html | Primary action fully visible and clickable at 1440×900 | Save & apply is above the fold (y=821, 116×39). Submit is also above the fold. | **HOLDS** | brand-studio/1440-fold.png · audit.json |
| 528 | brand-studio.html | Use text is hidden or disabled when no wordmark is uploaded | Use text is `disabled: true`. Wordmark is No file chosen. | **HOLDS** | brand-studio/1440-fold.png · audit.json |
| 529 | brand-studio.html | Reset resets to defaults, or does not render for a saved brand | Reset is visible. Partner brand is already saved (GET partner-brand 200, fields filled). Click not run. | **UNVERIFIED** | brand-studio/1440-fold.png |
| 530 | brand-studio.html | If a control does nothing today it does not render | BS-06 is tagged Coming soon (Generate VSL / ad scripts / wordmark). | **DOES-NOT-HOLD** | brand-studio/1440-full.png |
| 531 | brand-studio.html | Exactly one filled button | Two filled: Create pages from selected funnels, Save & apply. | **DOES-NOT-HOLD** | brand-studio/audit.md |
| 532 | brand-studio.html | All buttons ≥40px; primary ≥44px | Eight targets under 40px. Save 39px. Submit 35px. Create pages 35px. | **DOES-NOT-HOLD** | brand-studio/audit.json |
| 533 | brand-studio.html | 8px scale; columns on 3/4/6/12 | Off-scale 14/13/6/10/9px. Uneven rows at y=120, 232, 632. Content width 1440. | **DOES-NOT-HOLD** | brand-studio/audit.json |
| 534 | brand-studio.html | A tile named Funnels live counts live funnels | Tile reads 0 of 6 available (selected/available), not live pages. | **DOES-NOT-HOLD** | brand-studio/1440-fold.png |
| 536 | affiliate.html | Sign license opens the license, or does not render | No Sign license button. No License signed copy. | **HOLDS** | affiliate/1440-full.png · audit.json |
| 537 | affiliate.html | Metric values come from a data source or show — | REFERRED / CONVERTED / PAID are — with not connected to this page yet. OWED is $0 (not $0.00) after GET `/api/read/affiliates` 200, captioned accrued, not yet paid. No five bars of $0.00. | **HOLDS** | affiliate/1440-fold.png · audit.json |
| 538 | affiliate.html | Link, hold status, and money are the first thing seen | Top-left is the Beta banner, then AF-00 scoped view and Company Brain Ask. Referral link is AF-01 below that. | **DOES-NOT-HOLD** | affiliate/1440-fold.png |
| 539 | affiliate.html | One filled button; primary ≥44px | One filled: Ask at 55×43 (under 44). | **DOES-NOT-HOLD** | affiliate/audit.json |
| 541 | affiliate.html | Empty state: No referrals yet. Share your link. | Table: No referrals on file here — this page is not connected to the referral list yet. No Share your link action. | **DOES-NOT-HOLD** | affiliate/1440-full.png |
| 542 | affiliate.html | Status filter and business search on the left above the table | Both sit above the table on the right (`stFilter` left=1053, `q` left=1219). | **DOES-NOT-HOLD** | affiliate/audit.json · 1440-full.png |
| 544 | client-portal.html | Documents load; if they cannot, the message says what failed. Signed-in user never reads not signed in. | Signed in (Sign out + TEST — Client Role). No not signed in. GET documents → 403. Footer: your files are not listed here — your advisor sends them (does not say the read failed). | **DOES-NOT-HOLD** | client-portal/1440-fold.png · audit.json |
| 545 | client-portal.html | Text and Call reach the funding advisor | No Text or Call buttons. Advisor path is chat. | **HOLDS** | client-portal/1440-fold.png · audit.json |
| 546 | client-portal.html | An Unlock button leads to checkout | Six Unlock buttons exist (below the fold). Centered copy: Online checkout is not available yet. Ask an advisor in chat. | **DOES-NOT-HOLD** | client-portal/audit.json |
| 547 | client-portal.html | Book a call / Talk to an advisor lets the client pick a time or reach someone | Chat is open above the fold (Message staff / Send). Ask for a call (118×45) and Talk to an advisor (187×21) exist below the fold. Click not run. | **HOLDS** on chat reach. | client-portal/1440-fold.png · audit.json |
| 548 | client-portal.html | One filled button | Three filled: Chat, Message staff, Send. | **DOES-NOT-HOLD** | client-portal/audit.md |
| 549 | client-portal.html | Sign to authorize dispute letters loads legal wording and can record a signature | GET `/api/consent/capture?kind=dispute_authorization` → 200. H2 includes Metro 2 Dispute Letter Pack. No I sign / signature control in the inventory. Click not run. | **UNVERIFIED** | client-portal/audit.json |
| 550 | client-portal.html | Status of their thing top-left, next step, one contact above the fold | Fold is Facebook promo + a large Welcome video is not available block. Money/file and Unlock sit below. | **DOES-NOT-HOLD** | client-portal/1440-fold.png |
| 551 | client-portal.html | All targets ≥40px | 15 targets under 40px (Talk to an advisor 187×21, tabs 35px, Sign out 21px). | **DOES-NOT-HOLD** | client-portal/audit.json |
| 552 | client-portal.html | A missing video is a small line, not a 410px black block | Welcome video is not available is a large dark block on the fold. | **DOES-NOT-HOLD** | client-portal/1440-fold.png |
| 553 | client-portal.html | 8px scale; left-aligned copy | Off-scale 14/18/15/20/22/17/10px. One centered paragraph (checkout note). | **DOES-NOT-HOLD** | client-portal/audit.json |
| 556 | payment-success.html | One link back to the portal or to the advisor | Zero controls. Body tells the client to close this tab and return to your Meet. No portal / advisor link. | **DOES-NOT-HOLD** | payment-success/1440-fold.png · audit.json |
| 557 | payment-success.html | Confirms a payment it can verify, or says if your payment went through | Copy: Thanks — your payment cleared. Stay on the call with your advisor. Zero API calls. Page cannot know. | **DOES-NOT-HOLD** | payment-success/1440-fold.png · audit.json |
| 558 | payment-success.html | Three sizes, max four | Five sizes: 26 / 14 / 13 / 11 / 10. | **DOES-NOT-HOLD** | payment-success/audit.json |

## Counts

| Verdict | n |
|---|---|
| HOLDS | 11 |
| DOES-NOT-HOLD | 19 |
| UNVERIFIED | 4 |
| Total owned inventory lines | 34 |

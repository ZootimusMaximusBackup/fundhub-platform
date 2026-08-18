# K4 — Present send-contract (TEST)

Date: 2026-08-18  
TEST only: `8556bedc-…`. Never opened `9af65808-…`. Did **not** click pay. Did **not** click the $32 soft-pull send.

Ground truth: intended journeys do not name Present / send-contract. **MISSING.**

---

## Score

| Ask | Result |
|---|---|
| Present opens TEST | **PASS** |
| Send contract leaves a draft + sign link | **PASS** — two `/api/contracts` **200**s. Second has 1 link. |
| Pay link | not clicked |

---

## PASS — Send contract

- Opened `/app/present.html?contact=8556bedc-…`. Header: TEST CLIENT ROLE. Live name not on the deck.
- Slide **S-23**. Buttons include Send contract and Send agreement + pay link. Did not press pay.
- Send contract → Send this wording once.
- HTTP: create_draft **200** (contract id present). send **200** (`link_n=1`).
- Did not print the sign link.
- Screen still says “Your numbers are not on this file yet.” That is a paint note, not a send fail.

Evidence: `01-present.png` `03-s23.png` `04-after-contract.png` `walk.json` `follow.json`

## Left undone

- Did not press Send agreement + pay link.
- Did not press Generate letters.
- Did not send a second wording.

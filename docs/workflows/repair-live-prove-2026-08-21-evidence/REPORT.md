# Repair live prove — 2026-08-21

TEST client only: `8556bedc-46e1-4d85-b0cd-a24adfee1521`. Live client never touched.

## Results

| Check | Result |
|-------|--------|
| Staff login | PASS |
| Specialist Repair tab | PASS — TEST row present (trial 1/2, Waiting) |
| Portal bureau door | PASS after granting `metro2-letter-pack` |
| Upload bureau response | PASS — UI + API 200; `documents.kind=bureau_response` with storage key |

## Gap found and fixed

Enroll wrote `repair_programs` but did **not** grant `metro2-letter-pack`, so the portal hid every upload door. Enroll now grants that entitlement. TEST client backfilled for this prove.

## Shots

- `02-repair-tab.png` — Repair desk with TEST client
- `30-portal-with-entitlement.png` — bureau door visible
- `31-after-upload.png` — after upload

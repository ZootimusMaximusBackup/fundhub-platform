# client-portal C/M/L restamp — 2026-08-17 live

Live: https://fundhub.ai/app/client-portal.html as client@fundhub.ai
Shots: 1440-fold.png, 1440-full.png, 1440-after-unlock.png, probe.json, probe-unlock.json

| LINE | Sev | Verdict | Evidence | Live |
|---|---|---|---|---|
| 535 | CRITICAL | CONFIRMED-FIXED | 1440-fold.png, probe.json bodySample | Bottom bar: "your files are not listed here — your advisor sends them". No "sample documents" / "not signed in for real data". Signed-in client. |
| 536 | CRITICAL | CONFIRMED-FIXED | 1440-full.png, probe.json buttons | No Text / Call advisor buttons. Advisor card says use chat. |
| 541 | MEDIUM | STILL-OPEN | 1440-fold.png | Fold is still Facebook promo + 410px "Welcome video is not available". Money/file below the fold. |
| 542 | MEDIUM | STILL-OPEN | probe.json | "Talk to an advisor" links still 187×21. |
| 543 | MEDIUM | STILL-OPEN | 1440-fold.png | Welcome video still a large dark empty block. |
| 544 | MEDIUM | STILL-OPEN | 1440-fold.png | Off-8px spacing still visible in cards/modals. |

Note: GET /api/read/documents and /api/dashboard/client still 401 for this client (probe.json apiFails). The false banner is gone; the staff-only calls are not.

# PATTERN CRITICAL restamp (screens in this batch) — 2026-08-17 live

Board lines moved; live rows are 223 / 225 / 226.

| LINE | Screen set | Sev | Verdict | Evidence | Live |
|---|---|---|---|---|---|
| 223 | campaign / social / creative | CRITICAL | CONFIRMED-FIXED | campaign-manager/restamp/1440-fold.png, social-studio/restamp/1440-fold.png, creative-factory/restamp/1440-fold.png | No Ironwood/Larkspur/Halcyon roster. Campaigns empty+honest. Social clock live, caption empty. Creative sends no request without partner_id. |
| 225 | brand / affiliate / client | CRITICAL | CONFIRMED-FIXED | brand-studio/restamp/1440-after-submit.png, affiliate/restamp/probe.json (Sign license NOT-FOUND), client-portal/restamp/1440-after-unlock.png | Submit says nothing was sent, stays DRAFT. No Sign license theatre. Unlock modal says checkout is not available yet (honest). |
| 226 | brand / client | CRITICAL | STILL-OPEN | brand-studio/restamp/1440-full.png (Verify gone), client-portal/restamp/probe.json apiFails | Verify button gone for partner. Client still GETs /api/read/documents and /api/dashboard/client → 401 while signed in. Banner text is honest now; the forbidden calls remain. |

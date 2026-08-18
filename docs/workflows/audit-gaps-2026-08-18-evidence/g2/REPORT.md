# G2 — admin, setter, inquiry

Live: `https://fundhub.ai`  
When: 2026-08-18  
Shots + numbers: this folder. Table: `matrix.md`. Raw: `walk.json`.

No intended file for admin or setter. Those two are **MISSING ground truth**. Live OPEN / BOUNCE is still recorded. Inquiry is scored against `docs/journeys/role-inquiry-remover-intended.md` desk items 1–7.

Did not press Inquiry Send. Did not hire, reject, reset, revoke, invite, or save staff. Did not open client `9af65808-…`. Did not send a contract or a text.

---

## G2a — admin@fundhub.ai

**Ground truth:** MISSING. README puts admin in FINANCE, STAFF, OPS, HIRING, LENDERS.

**Lands on:** Pipeline. Shot: `admin-00-landing.png`.

**Nav after every group is opened (29 rows):** all **OPEN**. Shot: `admin-00-nav-expanded.png`.

Owner-set screens this login can open (each has a shot):

| Set | Screen | Result | Shot |
|---|---|---|---|
| FINANCE | Finance OS | OPEN | `admin-nav-finance-os.png` |
| FINANCE / STAFF | Staff & Teams | OPEN | `admin-nav-staff-teams.png` |
| OPS | Ops & Admin | OPEN | `admin-nav-ops-admin.png` |
| HIRING | Hiring | OPEN | `admin-nav-hiring.png` |
| LENDERS | Lenders | OPEN | `admin-nav-lenders.png` |

**Typed URLs the nav hid:**

- Home (`partner-galaxy.html`) — nav hides it. Typing it **OPEN**. Shot: `admin-typed-home.png`.
- Present (`present.html`) — not in nav. **OPEN**. Shot: `admin-typed-present.png`.
- Client Portal as a client (`/portal-login.html`) — **OPEN** (public “email me a link” page). Shot: `admin-typed-client-portal-as-a-client.png`.

**Client Portal (staff nav row):** **OPEN**. Not bounced. Banner: “We could not load your file.” Shot: `admin-nav-client-portal.png`.

**Affiliate:** in the admin nav. **OPEN**. Shot: `admin-nav-affiliate.png`.

---

## G2b — setter@fundhub.ai

**Ground truth:** MISSING. README maps setter to STAFF only.

**Lands on:** Pipeline. Shot: `setter-00-landing.png`.

**Nav after every group is opened (10 rows), all OPEN:**

Pipeline · Closer Dashboard · Calendar · Client Control Panel · Messaging · Documents · Specialist · Workflows · Message Copy · Contract templates.

Shot: `setter-00-nav-expanded.png`.

**The four things Chris named:**

| Screen | In nav? | Result | Shot |
|---|---|---|---|
| Pipeline | yes | OPEN | `setter-nav-pipeline.png` |
| Call | no | BOUNCE → Pipeline | `setter-typed-call-cockpit.png` |
| Present | no | OPEN (needs `?contact=`) | `setter-typed-present.png` |
| Messaging | yes | OPEN | `setter-nav-messaging.png` |

**Typed and bounced to Pipeline:** Home, Call, My numbers, Sales floor, Lenders, Finance OS, Company Brain, Galaxy, Ops & Admin, Agent Editor, Journeys, Campaigns, Social Studio, Creative Factory, Staff & Teams, Hiring, Products & Commissions, Brand Studio, Client Portal, Affiliate.

**Typed and stayed open:** Present. Client Portal as a client (`/portal-login.html`).

---

## G2c — inquiry@fundhub.ai

**Ground truth:** Specialist desk items 1–7.

**Lands on:** Specialist. Side-menu row says **Specialist**. Shot: `inquiry-00-landing.png`.

**Rest of nav:** same 10 rows as setter, all OPEN. Same bounce list as setter (home = Specialist, not Pipeline). Present typed **OPEN**. Client Portal / Affiliate typed **BOUNCE**.

### Desk items

| # | Expected | Observed | Score | Shot |
|---|---|---|---|---|
| 1 | Side-menu row says Specialist. No extra repair row. | Row says Specialist. Repair is a toggle, not a second nav row. | PASS | `inquiry-00-landing.png` |
| 2 | Toggle Inquiries / Repair. Inquiries on first. | Both tabs there. Inquiries on first. | PASS | `inquiry-desk-inquiries.png` |
| 3 | Need-me number visible. Answers how many files need a person today. | Tile is there. Value is **—**, not a number. Three queued test cases sit on the same page. | **FAIL** | `inquiry-desk-inquiries.png` |
| 4 | Inquiry queue. Send still needs a click. Phone work on hold. | Case list loaded (3 test-client rows). **SEND** showed after open. Send not pressed. Work Queue stayed **Loading inquiry queue…** (8+ seconds). | case list PASS · work queue **FAIL** | `inquiry-desk-inquiries.png`, `inquiry-desk-test-case.png` |
| 5 | Repair list, or empty copy “No repair files yet.” | Empty copy matches. Need me on Repair = **0**. | PASS | `inquiry-desk-repair.png` |
| 6 | Click a repair row. Send letters only when a letter is ready. | Test client not on the repair list. No row opened. | **UNVERIFIED** | `inquiry-desk-repair.png` |
| 7 | Stuck files / bureau confirm show if this role may see them. Do not confirm. | Stuck block hidden. No “Mark as checked”. Nothing to confirm. | not shown · **UNVERIFIED** if the role can see them when some exist | `inquiry-desk-repair.png` |

Test case opened: test client `8556bedc-…` only. Send not pressed. G3 owns that fire.

---

## FAIL

```
FAIL — role-inquiry-remover / desk item 3 (Need me)
Expected: top-left Need me is a number for files that need a person today
Observed: tile shows "—". Three queued test cases are on the page.
Evidence: docs/workflows/audit-gaps-2026-08-18-evidence/g2/inquiry-desk-inquiries.png
          walk.json desk.item3_needMe.value = "—"
```

```
FAIL — role-inquiry-remover / desk item 4 (Work Queue)
Expected: inquiry queue finishes or says work is on hold
Observed: "Loading inquiry queue…" still on screen after 8 seconds. No 4xx in the net log.
Evidence: docs/workflows/audit-gaps-2026-08-18-evidence/g2/inquiry-desk-inquiries.png
          walk.json desk.item4_inquiryQueue.workQueueLoading = true
```

```
FAIL — G2a admin / client file (board prove line)
Expected: admin is blocked from the client file
Observed: Client Portal is in the admin nav and the page opens. Banner: "We could not load your file."
Evidence: docs/workflows/audit-gaps-2026-08-18-evidence/g2/admin-nav-client-portal.png
```

---

## Also recorded (not a desk FAIL)

- **Present has no role gate.** Admin, setter, and inquiry all stay on `/app/present.html` when they type it. No sidebar row. Shots: `*-typed-present.png`.
- **`/portal-login.html` is public.** All three logins stay on the client sign-in page. Shots: `*-typed-client-portal-as-a-client.png`.
- Admin Home is hidden in the nav (partner Home) but **OPEN** if typed.

---

## OPEN / BOUNCE (W5 style)

See `matrix.md`. Short version:

- **Admin:** every nav row OPEN. Home / Present / portal-login typed OPEN.
- **Setter and inquiry:** 10 staff rows OPEN. Finance / Ops / Hiring / Lenders / portals / closer-desk / sales-floor / marketing beta rows BOUNCE. Present typed OPEN.

---

## Left undone

- Send on the test inquiry case (G3).
- Bureau confirm click (none on screen).
- Repair-row open (empty list).
- No zip. No fix.

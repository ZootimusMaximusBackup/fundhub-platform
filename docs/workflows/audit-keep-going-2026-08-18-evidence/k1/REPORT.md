# K1 — Calendar + Messaging after tonight’s fires

Date: 2026-08-18  
Signed in: owner `chris@`  
TEST client: `8556bedc-…`  
New funnel client: `edca0767-…` (E2e Fire)  
Never opened: `9af65808-…`  
No send. No new book. No deploy. No commit.

Ground truth: `docs/journeys/role-owner-intended.md` only says Documents is a reachable page. It does **not** say Calendar must show a booked call, or that Messaging must show a reply. Scored against Chris’s K1 ask.

---

## 1. Owner Calendar — does the 8:00 PM hold show?

**Claim:** After F-FUNNEL booked 8:00–8:30 PM Phoenix, Calendar today shows “Strategy session booked” / E2e Fire.

**Database (real):**

- Booking event `f370a046-…` is there. Source ClickFunnels. Start 8:00 PM Phoenix.
- Task `d5300a31-…` title **Strategy session booked**. Client is the new funnel person. Due 8:00 PM Phoenix / 11:00 PM New York. Not done.
- Still no `bookings` table.
- ClickFunnels `booking.created` count is **27**. Cal.com count is **0**.

**Screen:** Tuesday, August 18 still says **Nothing booked.** Booked / Done / Left stay **dashes**. Up Next is empty. No 8:00. No E2e Fire.

**API on the same login:** `GET /api/tasks` **200**. 69 open jobs. The E2e Fire task **is** in that list.

So the hold is in the database. The page never paints it. Same empty look as G5b, after the new book.

**Why the page stays blank:** Calendar runs its load script before `data.js` is ready. The load never starts. Counts stay dashes forever. When we asked the same API by hand, it answered.

**Score:** **FAIL** on the screen. **PASS** in the database.

**Evidence:** `01-calendar-today.png` · `13-calendar-api.json` · `db.json`

---

### Failure

- Journey: owner Calendar (no intended step)
- Step: show today’s booked call
- Expected: 8:00 PM Strategy session booked / E2e Fire
- Observed: Nothing booked. Dashes. API has the row.
- Evidence: `k1/01-calendar-today.png` `k1/13-calendar-api.json` `k1/db.json`

---

## 2. Staff Messaging — TEST client

**EMAIL:** Opened the EMAIL thread. The inbound **e2e fire reply — ignore** is on the screen. STOP is there too.

**Score:** **PASS**

**Evidence:** `15-messaging-email.png` · `17-messaging-api.json` · `db.json` (inbound row `00dd72b5-…`)

**SMS:** First paint opened the SMS thread. **Fundhub e2e ping — ignore.** is on the screen. Two older audit pings say they were not sent.

The left list only shows the EMAIL row. SMS is under “Their other threads.”

**Score:** **PASS** for the ping on the thread. Left list does not show SMS.

**Evidence:** `16-messaging-sms.png` · `14-messaging-home.json` · `db.json` (sms row `8755f790-…`)

---

## 3. Documents + Pipeline for the new funnel client

**Documents:** Search “E2e Fire” → **Nothing matches that filter.** API: **0** documents. The page still shows 9 other company files.

**Score:** Honest empty. No file for this person.

**Evidence:** `18-documents-funnel.png` · `19-documents-api.json`

**Pipeline:** Sales board. **E2e Fire** card sits in **Booked**. Click opened the side panel. Panel says When **Aug 18, 2026, 8:00 PM**, status Upcoming, What **Strategy session booked**.

**Score:** **PASS**

**Evidence:** `20-pipeline-funnel.png` · `20b-pipeline-funnel-open.png` · `db.json` (card `2714d8c6-…`, stage booked)

---

## 4. Calendar clicks (no new mail)

| Claim | Happen |
|---|---|
| Day | Stays on day |
| Week | Switches to week of Aug 16–22. Still empty |
| ‹ | Aug 18 → Aug 17 |
| › | Aug 17 → Aug 18; again → Aug 19 |
| Today | Back to Tuesday, August 18 |
| Week strip Sun–Sat | Each day opens. All say Nothing booked |
| Then row | None to click |
| Day event row | None to click |
| Demo drawer | Button not on screen. Stayed closed |
| Join Call | Not clicked |
| Client file | Gray. No client linked |

**Evidence:** `02`–`09` shots · `22-clicks.json`

---

## Left undone

- Did not click Join Call.
- Did not send mail or texts.
- Did not open the live file.
- Intended journey still has no Calendar or Messaging paint step.

# T1 — Client Portal & welcome video · what we found and what we fixed

**COMPLIANCE REVIEW REQUIRED** — this thread touches the client portal's consent (dispute
signature) card and customer-facing wording on a regulated product.

Written for a non-coder. Every claim below has a file next to it that proves it.

---

## The short version

Six of the twenty-one items **were already fixed** by other people before this thread started.
We proved that by walking the live site, not by reading code.

The big one that was **still broken** is now fixed: when a client clicked the sign-in link in
their email, the site signed them in and then said **"We could not load your file."**

The cause was one missing line. The sign-in page was told who the client was and threw it away.

---

## Item by item

| Item | What we found | Proof |
|---|---|---|
| T1-01 Portal fails when staff open it | **Already fixed.** Owner opened the test client's portal live — it says "Welcome back, TEST". Fixed earlier by commit `80d4d3d`. | `repro-portal-owner-live/1440-fold.png` |
| T1-02 Portal fails for a client | **Was broken. Now fixed.** | `shots/10-BEFORE…png` vs `shots/20-AFTER…png` |
| T1-03 Nobody could ever test the email link | **Now tested, for the first time.** The test client's address turned out to be a plus-tagged address on Chris's own Gmail, not the protected inbox — so the walk was safe to run. | `dumps/magiclink-BEFORE.json` |
| T1-04 Client chat reaches staff | **Still works.** Not touched. | — |
| T1-05 Dispute card says "You already signed" | **Correct, not stuck.** The site re-checks with the server on every page load. It said that because the agreement really was signed on 18 Aug. After the fix the full legal wording loads behind it (504 characters of real text). | `dumps/magiclink-AFTER.json` |
| T1-06 Content library has no videos | **Half already fixed, half true.** The Content screen now opens and works (7 tiers, upload form). The library really is empty — nobody has uploaded a video yet. That is honest, not a bug. | `repro-content-admin-live/1440-fold.png` |
| T1-07 "Welcome video is not available" | **Still true.** There was no way for a client to ever fetch a video — see below. | `shots/20-AFTER…png` |
| T1-08 / 09 / 10 / 11 Offers 1, 2, 3, 5 | **Not built. Needs your decision.** See "What we did not build". | `dumps/…` |
| T1-12 Never seen after payment | **Now closed** — we have live screenshots of the real client's screen. | `shots/20-AFTER…png` |
| T1-13 Email link signs in but cannot load the file | **Fixed.** Same root cause as T1-02. | `shots/10/20…png` |
| T1-14 Portal never counts the unlocked offers | **Fixed.** It now reads them. | `dumps/magiclink-AFTER.json` |
| T1-15 Back end returns real data | **Still true.** Confirmed again live. | `dumps/magiclink-AFTER.json` |
| T1-16 Nobody looked since the agreement was signed | **Now closed.** | `shots/20-AFTER…png` |

---

## The fix, in plain words

When a client clicks the link in their email, the site checks the link and gets back two things:
a pass (which proves who they are) and **their file number**.

The sign-in page kept the pass and threw the file number away. The portal page then had nothing
to look up, so it gave up before asking the server anything at all — which is why the file, the
video slot, the offer count and the signature box were all dead at once. One cause, four symptoms.

We now keep the file number. We also taught the portal page a second way to find it: ask the
server "who am I?" — the answer already contained the file number and was being ignored.

### Measured on the live site, same client, same server

| | Before | After |
|---|---|---|
| Greeting | "We could not load your file." | "Welcome back, TEST" |
| Questions the page asked the server | **0** | **6, all answered** |
| Signature box | "Sign in to load the legal wording" (to someone already signed in) | The real agreement text loads |
| Agreements on file | not read | "2 on file" |

---

## What we did not build, and why

**The welcome video.** There is now a way for a client's browser to ask for one. But **no video
can actually play in production yet**, and no code change fixes that: the setting that decides
where uploaded files are kept (`DOCUMENT_STORE_PROVIDER`) has never been switched on, so an
uploaded video's record is saved while the video itself vanishes when the server restarts.
**This is yours to switch on — we did not touch it.**

Also: the Content screen lets you point a video at each product tier, but **nothing in the code
decides which tier a client is in**. So today the video is served from the "Default" slot, which
the Content screen already offers. Picking a video per tier needs your rule first.

**A place for the client to read their chat history.** A client can send a message; they cannot
read it back, and a staff reply never reaches them. We designed the fix and did not build it,
because no intended journey says a client should read their chat history, and the house rule is
to stop and ask rather than invent the step.

**Offers 1, 2, 3 and 5.** These are not wiring problems. There is no way for a client to read
their credit score, their applications, or their dispute letters — those screens are staff-only
by design and there is no client-facing version of them. Building one is a new surface, which is
your call, not ours. The four questions are in the task report.

---

## How the evidence was made

- `repro-*-live/` — the read-only walking harness against `https://fundhub.ai`, signed in as owner.
- `shots/10-BEFORE…` — the real client's screen after clicking a real emailed sign-in link, on the
  deployed site.
- `shots/20-AFTER…` — the same real client, same live server and database, with the two fixed pages
  served in place of the deployed ones. Same seam, so it is a fair comparison.
- `dumps/*.json` — every request the browser made and what came back.

Nothing was deleted. No card was charged, no credit bureau was contacted, no text message was sent,
and the live credit file `9af65808-…` was never opened.
